/**
 * The "Books" panel: a client-owned tree view in the extension's own Activity Bar container
 * (`contributes.viewsContainers.activitybar` + `views.jpnov`, see package.json). It lists every
 * buildable book — one `*.filelist` discovered under each workspace folder root — with
 * a checkbox each, and drives the two build actions from the view title bar: "Build to HTML" and
 * "Build to Text" each render ONLY the checked books, in ONLY that one format.
 *
 * Data flow mirrors the rest of the client: the SERVER enumerates books (`jpnov/listBooks`) and
 * renders them (`jpnov/build` with a `books`/`format` selection); this view only owns the VS Code
 * UI — the tree, the checkbox set, and the artifact writes (the server never touches `vscode.fs`).
 *
 * The view is gated by the `jpnov.hasBooks` context key, recomputed after every refresh():
 * true while the enumeration finds at least one book ("a bookshelf appears once there are
 * books"). The checkbox set defaults every newly-discovered book
 * to CHECKED, so a fresh panel builds everything until the user narrows it; un-checking is
 * the way to scope a build down.
 */
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

import { buildForest, type TreeDir } from './bookTree.ts';
import { renderMessage } from './messages.ts';
import { lastPathSegment } from './paths.ts';
import { buildProjectDirs } from './projectConfig.ts';
import { buildHtmlSettings } from './renderConfig.ts';

/**
 * A tree node: a per-root GROUP header (only when more than one valid root has books), a FOLDER in
 * the output-path hierarchy, or a BOOK leaf. Only leaves carry a checkbox; root/folder headers
 * never do (bulk selection is the title-bar Select-All / Deselect-All instead), which sidesteps
 * parent/child checkbox propagation.
 */
type BookNode =
  | { readonly kind: 'root'; readonly rootUri: string; readonly label: string }
  | { readonly kind: 'folder'; readonly rootUri: string; readonly prefix: string; readonly label: string }
  | { readonly kind: 'book'; readonly entry: BookEntry };

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
  /** Last pushed `jpnov.hasBooks` context value (books.length > 0 after a refresh). */
  private hasBooks = false;
  /** Serializes `refresh()` so a slow `listBooks` can't clobber a newer enumeration. */
  private refreshSeq = 0;

  constructor(client: LanguageClient) {
    this.client = client;

    // The books form a collapsible folder hierarchy (mirroring the output tree), so Collapse All is
    // meaningful. Refresh / Select All / Deselect All remain inline title actions.
    this.treeView = vscode.window.createTreeView<BookNode>('jpnov.books', {
      treeDataProvider: this,
      showCollapseAll: true,
    });

    // A `.filelist` appearing/disappearing changes the book SET (the output name is derived from
    // the path, not the contents), so only create/delete need a re-list — not content edits.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.filelist');

    this.disposables.push(
      this.treeView,
      this._onDidChangeTreeData,
      this.treeView.onDidChangeCheckboxState((e) => {
        this.onCheckboxChanged(e);
      }),
      watcher,
      // Fire-and-forget re-list on a .filelist appearing/disappearing: refresh() self-catches its
      // sendRequest (returns on failure) and is sequenced by refreshSeq, so a dropped result is safe.
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
    );

    // Start hidden until the first enumeration finds a book. setContext rejects only on a
    // dead connection (extension shutting down); the gate then no longer matters, so void it.
    void vscode.commands.executeCommand('setContext', 'jpnov.hasBooks', false);
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

    const { entry } = element;
    // Label by the book's OUTPUT name's last segment (e.g. `vol2`); ancestor folders carry the
    // prefix. The source manifest path is the description.
    const label = entry.outRel.slice(entry.outRel.lastIndexOf('/') + 1);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = entry.uri; // stable identity for selection/expansion + checkbox state
    item.resourceUri = vscode.Uri.parse(entry.uri);
    item.description = entry.fileRel;
    item.tooltip = `${entry.fileRel} → ${entry.outRel}.{txt,html}`;
    item.contextValue = 'jpnovBook';
    item.checkboxState = this.checked.has(entry.uri)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    // Clicking the label (not the checkbox) opens the underlying `.filelist`.
    item.command = {
      command: 'vscode.open',
      title: vscode.l10n.t('Open Filelist'),
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
    return [];
  }

  // --- commands (wired in extension.ts) ------------------------------------

  /** `jpnov.books.buildHtml`: render the checked books to `.html` only. */
  buildHtml(): Promise<void> {
    return this.buildSelected('html');
  }

  /** `jpnov.books.buildTxt`: render the checked books to `.txt` only. */
  buildTxt(): Promise<void> {
    return this.buildSelected('txt');
  }

  /** `jpnov.books.selectAll`: tick every book. */
  selectAll(): void {
    for (const b of this.books) {
      this.checked.add(b.uri);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /** `jpnov.books.deselectAll`: clear every tick. */
  deselectAll(): void {
    this.checked.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * `jpnov.books.refresh` (and the file watcher / folder changes): re-enumerate books and reconcile
   * the checkbox set — drop ticks for books that vanished, and default any newly-discovered book to
   * CHECKED (so "all-checked" holds on first load and when a `.filelist` is added). Leaves the
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
    const hasBooks = this.books.length > 0;
    if (hasBooks !== this.hasBooks) {
      this.hasBooks = hasBooks;
      // setContext rejects only on a dead connection (shutdown); the gate is then irrelevant.
      void vscode.commands.executeCommand('setContext', 'jpnov.hasBooks', hasBooks);
    }
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
   * The build driver behind the panel's title actions: render the CHECKED books to `format`,
   * write the returned artifacts (the client owns all filesystem writes), and report results.
   * An empty selection is a no-op with a nudge rather than a silent "built 0".
   */
  async buildSelected(format: BuildFormat): Promise<void> {
    const books = [...this.checked];
    // 'HTML' is a proper noun (not localized); 'text' translates. The label is passed
    // already-localized into the count templates below.
    const label = format === 'html' ? 'HTML' : vscode.l10n.t('text');
    if (books.length === 0) {
      // UI notification: showInformationMessage never rejects, so void is safe.
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Japanese Novel: no books selected. Check a book in the Books panel, then build.'),
      );
      return;
    }

    const c = this.client;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        // l10n.t has no plural support, so branch into a singular/plural pair of bundle keys;
        // Japanese maps both to one (number-invariant) string.
        title: books.length === 1
          ? vscode.l10n.t('Japanese Novel: building 1 book to {0}…', label)
          : vscode.l10n.t('Japanese Novel: building {0} books to {1}…', String(books.length), label),
        cancellable: false,
      },
      async () => {
        let result: BuildResult;
        try {
          const params: BuildParams = {
            books,
            format,
            settings: buildHtmlSettings(),
            projectDirs: buildProjectDirs(),
          };
          result = await c.sendRequest<BuildResult>(BuildRequest, params);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // UI notification: showErrorMessage never rejects, so void is safe. This granular popup
          // means buildSelected returns normally (no rethrow) -> no boundary double-popup.
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
            // UI notification: showErrorMessage never rejects, so void is safe.
            void vscode.window.showErrorMessage(
              vscode.l10n.t("Japanese Novel: couldn't write {0}. {1}", artifact.path, message),
            );
          }
        }

        // Per-book build errors (each isolated server-side; never aborts the rest). The server
        // sends a {code,args}; the client renders it to localized text.
        const errors = result.errors ?? [];
        for (const e of errors) {
          // UI notification: showErrorMessage never rejects, so void is safe.
          void vscode.window.showErrorMessage(
            vscode.l10n.t('Japanese Novel: build error for {0}. {1}', e.book, renderMessage(e)),
          );
        }

        if (written.length > 0) {
          // One artifact per book now (a single format), so the file count IS the book count.
          // UI notification: showInformationMessage never rejects, so void is safe.
          void vscode.window.showInformationMessage(
            written.length === 1
              ? vscode.l10n.t('Japanese Novel: built 1 {0} file.', label)
              : vscode.l10n.t('Japanese Novel: built {0} {1} files.', String(written.length), label),
          );
        } else if (errors.length === 0) {
          // UI notification: showInformationMessage never rejects, so void is safe.
          void vscode.window.showInformationMessage(
            vscode.l10n.t('Japanese Novel: nothing to build.'),
          );
        }
      },
    );
  }
}
