/**
 * The "Books" panel: a client-owned tree view in the extension's own Activity Bar container
 * (`contributes.viewsContainers.activitybar` + `views.jpnov`, see package.json). It lists every
 * buildable book — one `*.jpbook` discovered under each workspace folder root — with
 * a checkbox each, and drives the two build actions from the view title bar: "Build to HTML" and
 * "Build to Text" each render ONLY the checked books, in ONLY that one format.
 *
 * Data flow mirrors the rest of the client: the SERVER enumerates books (`jpnov/listBooks`) and
 * renders them (`jpnov/build` with a `books`/`format` selection); this view only owns the VS Code
 * UI — the tree, the checkbox set, and the artifact writes (the server never touches `vscode.fs`).
 *
 * The view's visibility is gated by the `jpnov.active` context key (set once in extension.ts
 * when the extension starts), so the panel — and its empty-state `viewsWelcome` guide — appear
 * for any novel workspace, not only once a book exists. The checkbox set defaults every
 * newly-discovered book to CHECKED, so a fresh panel builds everything until the user narrows
 * it; un-checking is the way to scope a build down.
 */
import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import type { LanguageClient } from 'vscode-languageclient/node';

import {
  BuildRequest,
  ListBooksRequest,
  type BookEntry,
  type BuildFormat,
  type BuildParams,
  type BuildResult,
  type ListBooksParams,
  type ListBooksResult,
} from '#/shared/protocol.ts';

import { chapterLines, metaRows, moveChapterTo } from '#/shared/book/edits.ts';
import { parseJpbook } from '#/shared/book/jpbook.ts';

import { buildForest, type TreeDir } from './tree.ts';
import { applyBookEdits, metaLabel, metaValueLabel } from './manage.ts';
import type { BookNode } from './nodes.ts';
import { resolveBrowserExecutable } from '../browser.ts';
import { renderMessage } from '../messages.ts';
import { lastPathSegment } from '../paths.ts';
import { convertHtmlToPdf } from '../pdf.ts';
import { buildProjectDirs } from '../projectConfig.ts';
import { buildHtmlSettings } from '../renderConfig.ts';

/** A Books-panel build action: the two wire formats plus the client-only PDF post-process. */
type BuildAction = BuildFormat | 'pdf';

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Walks the forest to the {@link TreeDir} at `prefix` under `rootUri` (`''` = the root level). */
function dirAt(forest: Map<string, TreeDir>, rootUri: string, prefix: string): TreeDir | undefined {
  let dir = forest.get(rootUri);
  if (!dir || prefix === '') {
    return dir;
  }
  for (const seg of prefix.split('/')) {
    dir = dir.dirs.get(seg);
    if (!dir) {
      return undefined;
    }
  }
  return dir;
}

/** Child nodes of one `TreeDir`: sub-folders first (alpha), then book leaves (alpha by outRel). */
function dirChildren(dir: TreeDir, rootUri: string, prefix: string): BookNode[] {
  const folders = [...dir.dirs.keys()].sort(compareStr).map(
    (seg): BookNode => ({
      kind: 'folder',
      rootUri,
      prefix: prefix === '' ? seg : `${prefix}/${seg}`,
      label: seg,
    }),
  );
  const books = [...dir.books]
    .sort((a, b) => compareStr(a.outRel, b.outRel))
    .map((entry): BookNode => ({ kind: 'book', entry }));
  return [...folders, ...books];
}

export class BooksView implements vscode.TreeDataProvider<BookNode>, vscode.Disposable {
  private readonly client: LanguageClient;
  private readonly treeView: vscode.TreeView<BookNode>;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BookNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Latest enumerated books (from `jpnov/listBooks`), sorted server-side per root. */
  private books: readonly BookEntry[] = [];
  /** Folder forest (per root) derived from `books`, mirroring the output tree; rebuilt in `refresh()`. */
  private forest = new Map<string, TreeDir>();
  /** The build selection: book URIs whose checkbox is ticked. */
  private readonly checked = new Set<string>();
  /** Serializes `refresh()` so a slow `listBooks` can't clobber a newer enumeration. */
  private refreshSeq = 0;
  /** True while a PDF build runs, so a second click can't spawn an overlapping browser batch. */
  private pdfBuilding = false;

  constructor(client: LanguageClient) {
    this.client = client;

    // The books form a collapsible folder hierarchy (mirroring the output tree), so Collapse All is
    // meaningful. Refresh / Select All / Deselect All remain inline title actions.
    this.treeView = vscode.window.createTreeView<BookNode>('jpnov.books', {
      treeDataProvider: this,
      showCollapseAll: true,
      dragAndDropController: new ChapterDnD(),
    });

    // A `.jpbook` appearing/disappearing changes the book SET, and a SAVE can change its
    // front-matter title (shown as the leaf label), so create/delete/change all re-list.
    // The watcher only fires onDidChange for on-disk writes — not per keystroke.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.jpbook');

    this.disposables.push(
      this.treeView,
      this._onDidChangeTreeData,
      this.treeView.onDidChangeCheckboxState((e) => {
        this.onCheckboxChanged(e);
      }),
      watcher,
      // Fire-and-forget re-list on a .jpbook appearing/disappearing/saving: refresh() self-catches
      // its sendRequest (returns on failure) and is sequenced by refreshSeq, so a dropped result is safe.
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
      watcher.onDidChange(() => void this.refresh()),
    );
  }

  // --- TreeDataProvider ----------------------------------------------------

  getTreeItem(element: BookNode): vscode.TreeItem {
    if (element.kind === 'root') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `root:${element.rootUri}`;
      item.contextValue = 'jpnovRoot';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.resourceUri = vscode.Uri.parse(element.rootUri);
      item.tooltip = element.rootUri;
      return item;
    }

    if (element.kind === 'folder') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `folder:${element.rootUri} ${element.prefix}`;
      item.contextValue = 'jpnovFolder';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.tooltip = element.prefix;
      // Navigation only: no checkbox (selection lives on book leaves) and no open command.
      return item;
    }

    if (element.kind === 'info') {
      const item = new vscode.TreeItem(vscode.l10n.t('Book Info'), vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `info:${element.entry.uri}`;
      item.contextValue = 'jpnovInfo';
      item.iconPath = new vscode.ThemeIcon('gear');
      return item;
    }

    if (element.kind === 'meta') {
      // Tree-as-form: the four keys always show in fixed order; an absent one displays its
      // default. Clicking the row opens the matching editor (InputBox / QuickPick).
      const item = new vscode.TreeItem(metaLabel(element.metaKey), vscode.TreeItemCollapsibleState.None);
      item.id = `meta:${element.entry.uri}:${element.metaKey}`;
      item.contextValue = 'jpnovMeta';
      item.description = metaValueLabel(element.metaKey, element.value);
      item.iconPath = new vscode.ThemeIcon('edit');
      item.command = {
        command: 'jpbook.editMeta',
        title: metaLabel(element.metaKey),
        arguments: [element],
      };
      return item;
    }

    if (element.kind === 'chapter') {
      const slash = element.rel.lastIndexOf('/');
      const item = new vscode.TreeItem(element.rel.slice(slash + 1), vscode.TreeItemCollapsibleState.None);
      item.id = `ch:${element.entry.uri}:${String(element.line)}`;
      item.contextValue = 'jpnovChapter';
      const target = chapterUri(element.entry.rootUri, element.rel);
      item.resourceUri = target; // tooltips + problem decorations (icon set explicitly below)
      if (slash >= 0) {
        item.description = element.rel.slice(0, slash);
      }
      // A ThemeIcon, not the file-icon theme: theme icons share one rendering slot with the
      // gear/pencil rows, so the chapter column aligns instead of reading a level deeper.
      if (element.missing) {
        item.iconPath = new vscode.ThemeIcon('warning');
        item.tooltip = vscode.l10n.t('file not found: {0}', element.rel);
      } else {
        item.iconPath = new vscode.ThemeIcon('file');
      }
      item.command = { command: 'vscode.open', title: vscode.l10n.t('Open Chapter'), arguments: [target] };
      return item;
    }

    const { entry } = element;
    // Label by the front-matter title when the book declares one, else by the book's OUTPUT
    // name's last segment (e.g. `vol2`); ancestor folders carry the prefix. The source
    // manifest path is the description.
    const label = entry.title ?? entry.outRel.slice(entry.outRel.lastIndexOf('/') + 1);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = entry.uri; // stable identity for selection/expansion + checkbox state
    item.resourceUri = vscode.Uri.parse(entry.uri);
    item.description = entry.fileRel;
    item.tooltip = `${entry.fileRel} → ${entry.outRel}.{txt,html}`;
    item.contextValue = 'jpnovBook';
    item.checkboxState = this.checked.has(entry.uri)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    // Clicking the label (not the checkbox) opens the underlying `.jpbook`.
    item.command = {
      command: 'vscode.open',
      title: vscode.l10n.t('Open Book File'),
      arguments: [vscode.Uri.parse(entry.uri)],
    };
    return item;
  }

  getChildren(element?: BookNode): vscode.ProviderResult<BookNode[]> {
    if (element === undefined) {
      const roots = [...this.forest.keys()];
      if (roots.length <= 1) {
        // Single (or no) root: show its folder hierarchy directly, with no root wrapper.
        const rootUri = roots[0];
        if (rootUri === undefined) {
          return [];
        }
        const dir = this.forest.get(rootUri);
        return dir ? dirChildren(dir, rootUri, '') : [];
      }
      // Multi-root: one collapsible group per root, sorted by display label.
      return roots
        .map((rootUri) => ({ kind: 'root' as const, rootUri, label: lastPathSegment(rootUri) }))
        .sort((a, b) => compareStr(a.label, b.label));
    }
    if (element.kind === 'root') {
      const dir = this.forest.get(element.rootUri);
      return dir ? dirChildren(dir, element.rootUri, '') : [];
    }
    if (element.kind === 'folder') {
      const dir = dirAt(this.forest, element.rootUri, element.prefix);
      return dir ? dirChildren(dir, element.rootUri, element.prefix) : [];
    }
    if (element.kind === 'book') {
      return bookChildren(element.entry);
    }
    if (element.kind === 'info') {
      return metaChildren(element.entry);
    }
    return [];
  }

  // --- commands (wired in extension.ts) ------------------------------------

  /** `jpbook.selectAll`: tick every book. */
  selectAll(): void {
    for (const b of this.books) {
      this.checked.add(b.uri);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /** `jpbook.deselectAll`: clear every tick. */
  deselectAll(): void {
    this.checked.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * `jpbook.refresh` (and the file watcher / folder changes): re-enumerate books and reconcile
   * the checkbox set — drop ticks for books that vanished, and default any newly-discovered book to
   * CHECKED (so "all-checked" holds on first load and when a `.jpbook` is added). Leaves the
   * current list in place if the request fails (e.g. server not yet started).
   */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;
    const params: ListBooksParams = { projectDirs: buildProjectDirs() };
    let result: ListBooksResult;
    try {
      result = await this.client.sendRequest<ListBooksResult>(ListBooksRequest, params);
    } catch {
      return;
    }
    if (seq !== this.refreshSeq) {
      return; // a newer refresh already superseded this one
    }

    const prev = new Set(this.books.map((b) => b.uri));
    const next = new Set(result.books.map((b) => b.uri));
    for (const uri of [...this.checked]) {
      if (!next.has(uri)) {
        this.checked.delete(uri);
      }
    }
    for (const uri of next) {
      if (!prev.has(uri)) {
        this.checked.add(uri);
      }
    }
    this.books = result.books;
    this.forest = buildForest(this.books);
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  // --- internals -----------------------------------------------------------

  private onCheckboxChanged(e: vscode.TreeCheckboxChangeEvent<BookNode>): void {
    // VS Code has already re-rendered the toggled rows, so only update the selection set here.
    for (const [node, state] of e.items) {
      if (node.kind !== 'book') {
        continue;
      }
      if (state === vscode.TreeItemCheckboxState.Checked) {
        this.checked.add(node.entry.uri);
      } else {
        this.checked.delete(node.entry.uri);
      }
    }
  }

  /**
   * The localized "built N {label} file(s)" success toast. l10n.t has no plural support, so the
   * singular/plural bundle pair lives here (Japanese maps both to one number-invariant string).
   */
  private reportBuilt(count: number, label: string): void {
    // showInformationMessage never rejects, so void is safe.
    void vscode.window.showInformationMessage(
      count === 1
        ? vscode.l10n.t('Japanese Novel: built 1 {0} file.', label)
        : vscode.l10n.t('Japanese Novel: built {0} {1} files.', String(count), label),
    );
  }

  /**
   * The build driver behind the panel's title actions (`jpbook.buildHtml`/`buildTxt`/
   * `buildPdf`): render the CHECKED books to `action`'s one format (`pdf` = `.html` on the
   * wire, converted client-side), write the returned artifacts (the client owns all
   * filesystem writes), and report results. An empty selection is a no-op with a nudge
   * rather than a silent "built 0".
   */
  async buildSelected(action: BuildAction): Promise<void> {
    const books = [...this.checked];
    // 'HTML' / 'PDF' are proper nouns (not localized); 'text' translates. The label is passed
    // already-localized into the count templates below.
    const label = action === 'pdf' ? 'PDF' : action === 'html' ? 'HTML' : vscode.l10n.t('text');
    if (books.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Japanese Novel: no books selected. Check a book in the Books panel, then build.'),
      );
      return;
    }
    // A PDF build spawns a browser per book and is slow; block an overlapping second run.
    if (action === 'pdf') {
      if (this.pdfBuilding) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Japanese Novel: a PDF build is already in progress.'),
        );
        return;
      }
      this.pdfBuilding = true;
    }

    const c = this.client;
    // A PDF build asks the server for HTML on the wire, then converts client-side; txt/html pass through.
    const wireFormat: BuildFormat = action === 'pdf' ? 'html' : action;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: books.length === 1
            ? vscode.l10n.t('Japanese Novel: building 1 book to {0}…', label)
            : vscode.l10n.t('Japanese Novel: building {0} books to {1}…', String(books.length), label),
          cancellable: action === 'pdf',
        },
        async (progress, token) => {
          let result: BuildResult;
          try {
            const params: BuildParams = {
              books,
              format: wireFormat,
              settings: buildHtmlSettings(),
              projectDirs: buildProjectDirs(),
            };
            result = await c.sendRequest<BuildResult>(BuildRequest, params);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // This granular popup means buildSelected returns normally (no rethrow) -> no
            // boundary double-popup from the command wrapper.
            void vscode.window.showErrorMessage(vscode.l10n.t('Japanese Novel: build failed. {0}', message));
            return;
          }

          // The CLIENT owns all filesystem writes (the server never touches vscode.fs).
          const written: string[] = [];
          for (const artifact of result.artifacts ?? []) {
            try {
              await vscode.workspace.fs.writeFile(
                vscode.Uri.parse(artifact.path),
                Buffer.from(artifact.content, 'utf8'),
              );
              written.push(artifact.path);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              void vscode.window.showErrorMessage(
                vscode.l10n.t("Japanese Novel: couldn't write {0}. {1}", artifact.path, message),
              );
            }
          }

          // Per-book build errors (each isolated server-side; never aborts the rest). The server
          // sends a {code,args}; the client renders it to localized text.
          const errors = result.errors ?? [];
          for (const e of errors) {
            void vscode.window.showErrorMessage(
              vscode.l10n.t('Japanese Novel: build error for {0}. {1}', e.book, renderMessage(e)),
            );
          }

          // PDF: convert the just-written .html files, then report the PDF count in place of HTML.
          if (action === 'pdf' && written.length > 0) {
            await this.convertToPdf(written, label, progress, token);
            return;
          }

          if (written.length > 0) {
            // One artifact per book now (a single format), so the file count IS the book count.
            this.reportBuilt(written.length, label);
          } else if (errors.length === 0) {
            void vscode.window.showInformationMessage(
              vscode.l10n.t('Japanese Novel: nothing to build.'),
            );
          }
        },
      );
    } finally {
      if (action === 'pdf') {
        this.pdfBuilding = false;
      }
    }
  }

  /**
   * Converts the just-written `.html` artifacts (URI strings) to sibling `.pdf` files with a
   * detected Chromium-family browser. With no browser found the HTML is left in place and the
   * user is nudged to print it or set a path, so a PDF build never hard-fails once the HTML
   * exists. Conversions run serially (one browser at a time) and stop on cancellation.
   */
  private async convertToPdf(
    htmlUris: readonly string[],
    label: string,
    progress: vscode.Progress<{ message?: string }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const browserExe = resolveBrowserExecutable({
      configuredPath: vscode.workspace.getConfiguration().get<string>('jpnov.layout.browserPath', ''),
      env: process.env,
      platform: process.platform,
      exists: existsSync,
    });
    if (browserExe === undefined) {
      const openFolder = vscode.l10n.t('Open Output Folder');
      const configure = vscode.l10n.t('Configure Browser Path');
      // showWarningMessage never rejects; void the button-handling promise so this can't re-throw.
      void vscode.window
        .showWarningMessage(
          vscode.l10n.t(
            'Japanese Novel: no Chrome, Edge, or Chromium browser found. Built the HTML instead — open it in a browser and print to PDF, or set jpnov.layout.browserPath.',
          ),
          openFolder,
          configure,
        )
        .then((pick) => {
          if (pick === openFolder && htmlUris[0] !== undefined) {
            void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.parse(htmlUris[0]));
          } else if (pick === configure) {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'jpnov.layout.browserPath');
          }
        });
      return;
    }

    // Kill the in-flight conversion when the user cancels the progress notification.
    const abort = new AbortController();
    const cancelSub = token.onCancellationRequested(() => {
      abort.abort();
    });
    const pdfs: string[] = [];
    try {
      let done = 0;
      for (const htmlUri of htmlUris) {
        if (token.isCancellationRequested) {
          break;
        }
        done += 1;
        progress.report({
          message: vscode.l10n.t('converting to PDF… ({0}/{1})', String(done), String(htmlUris.length)),
        });
        const htmlPath = vscode.Uri.parse(htmlUri).fsPath;
        const pdfPath = htmlPath.replace(/\.html$/i, '.pdf');
        try {
          await convertHtmlToPdf(browserExe, htmlPath, pdfPath, 60_000, abort.signal);
          pdfs.push(pdfPath);
        } catch (err) {
          // A cancel aborts the child, surfacing as a rejection here — don't report that as a failure.
          if (abort.signal.aborted) {
            break;
          }
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(
            vscode.l10n.t("Japanese Novel: couldn't convert {0} to PDF. {1}", lastPathSegment(htmlUri), message),
          );
        }
      }
    } finally {
      cancelSub.dispose();
    }

    if (pdfs.length > 0) {
      this.reportBuilt(pdfs.length, label);
    }
  }
}

/** A chapter's file URI from its root-relative entry (joinPath handles the encoding). */
function chapterUri(rootUri: string, rel: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.parse(rootUri), ...rel.split('/'));
}

/** One book's expansion: the Book Info group, then its chapters in document order. */
async function bookChildren(entry: BookEntry): Promise<BookNode[]> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
  } catch {
    return [];
  }
  const lines = parseJpbook(doc.getText()).lines;
  const chapters = await Promise.all(
    chapterLines(lines).map(async (line): Promise<BookNode> => {
      const pl = lines[line];
      const rel = pl?.value ?? '';
      let missing = false;
      try {
        const st = await vscode.workspace.fs.stat(chapterUri(entry.rootUri, rel));
        missing = (st.type & vscode.FileType.File) === 0;
      } catch {
        missing = true;
      }
      return { kind: 'chapter', entry, line, rel, missing };
    }),
  );
  // Chapters lead (the book's actual content); the Info group closes the block so the
  // chapter rows hang visually under the book title, not under the group.
  return [...chapters, { kind: 'info', entry }];
}

/** The Book Info expansion: all four metadata keys, fixed order, defaults shown when absent. */
async function metaChildren(entry: BookEntry): Promise<BookNode[]> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
  } catch {
    return [];
  }
  return metaRows(doc.getText()).map((row) => ({
    kind: 'meta',
    entry,
    metaKey: row.key,
    value: row.value,
  }));
}

/**
 * Chapter reorder by drag & drop, WITHIN one book: dropping on a chapter inserts before
 * it, dropping on the book (or its Info row) moves to the end. Cross-book drops are
 * ignored (move-vs-copy is ambiguous there — the context menu can grow that later).
 * The edit goes through the same plan-apply-save path as every other panel action.
 */
class ChapterDnD implements vscode.TreeDragAndDropController<BookNode> {
  private static readonly MIME = 'application/vnd.code.tree.jpnov.books';
  readonly dragMimeTypes = [ChapterDnD.MIME];
  readonly dropMimeTypes = [ChapterDnD.MIME];

  handleDrag(source: readonly BookNode[], dataTransfer: vscode.DataTransfer): void {
    const chapters = source.filter((n) => n.kind === 'chapter');
    if (chapters.length === 1) {
      dataTransfer.set(ChapterDnD.MIME, new vscode.DataTransferItem(chapters));
    }
  }

  async handleDrop(target: BookNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dragged = dataTransfer.get(ChapterDnD.MIME)?.value as BookNode[] | undefined;
    const src = dragged?.[0];
    if (src?.kind !== 'chapter' || target === undefined || target.kind === 'root' || target.kind === 'folder') {
      return;
    }
    if (target.entry.uri !== src.entry.uri) {
      return; // cross-book drop: out of scope
    }
    const before = target.kind === 'chapter' ? target.line : null;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(src.entry.uri));
    const edits = moveChapterTo(doc.getText(), src.line, before);
    if (edits !== null) {
      await applyBookEdits(doc.uri, edits);
    }
  }
}
