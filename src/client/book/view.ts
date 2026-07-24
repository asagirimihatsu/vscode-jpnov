/**
 * The "Books" panel: a client-owned WebviewView in the extension's own Activity Bar container
 * (`contributes.views.jpnov`, `"type": "webview"`, see package.json). It lists every buildable
 * book — one `*.jpbook` discovered under each workspace folder root — each with a checkbox, and
 * drills into a per-book DETAIL screen (chapters + Book Info). The bottom build bar renders ONLY
 * the checked books, to ONE format: "Build to PDF" (primary), "txt", or "HTML".
 *
 * Split of concerns: the SERVER enumerates books
 * (`jpnov/listBooks`) and renders them (`jpnov/build`); this provider owns the VS Code UI and the
 * artifact writes (the server never touches `vscode.fs`). The provider is the single source of
 * truth for the book list and the checkbox selection; the webview is a render + dispatch surface
 * that reflects the last `state` it was pushed. All the presentation lives in `webviewHtml.ts`.
 *
 * The host owns the heavy work: `buildSelected` (build + write + PDF conversion + txt Shift_JIS
 * encoding) here, and the form editing in `manage.ts` (reached from the webview by dispatching the
 * `jpbook.*` commands with a synthesized node). The view's visibility is gated by the
 * `jpnov.active` context key set in extension.ts.
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
import { META_KEYS, parseJpbook, type MetaKey } from '#/shared/book/jpbook.ts';
import { encodeTxt, TXT_ENCODING_DEFAULT, type TxtEncoding } from '#/shared/encoding.ts';

import { applyBookEdits, metaLabel, metaValueParts } from './manage.ts';
import type { BookNode } from './nodes.ts';
import { booksHtml } from './webviewHtml.ts';
import { resolveBrowserExecutable } from '../browser.ts';
import { renderMessage } from '../messages.ts';
import { lastPathSegment } from '../paths.ts';
import { convertHtmlToPdf } from '../pdf.ts';
import { buildProjectDirs } from '../projectConfig.ts';
import { buildHtmlSettings } from '../renderConfig.ts';

/** A Books-panel build action: the two wire formats plus the client-only PDF post-process. */
type BuildAction = BuildFormat | 'pdf';

/** One book row in the pushed `state` (a flat, per-root-grouped list; no folder nesting). */
interface BookVM {
  readonly uri: string;
  readonly title: string;
  readonly fileRel: string;
  readonly checked: boolean;
}

/** One chapter row in a pushed `detail`. */
interface ChapterVM {
  readonly line: number;
  readonly name: string;
  readonly folder: string;
  readonly fileUri: string;
  readonly missing: boolean;
}

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A chapter's file URI from its root-relative entry (joinPath handles the encoding). */
function chapterUri(rootUri: string, rel: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.parse(rootUri), ...rel.split('/'));
}

/** The book's display label: its front-matter title, else the last segment of the output name. */
function bookTitle(entry: BookEntry): string {
  return entry.title ?? entry.outRel.slice(entry.outRel.lastIndexOf('/') + 1);
}

export class BooksViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  /** The view id (matches `contributes.views.jpnov[].id` in package.json). */
  static readonly viewId = 'jpnov.books';

  private readonly client: LanguageClient;
  private readonly disposables: vscode.Disposable[] = [];
  /** The live view, once resolved (visible at least once). Undefined while never-shown / disposed. */
  private view: vscode.WebviewView | undefined;
  /** Per-resolve message subscription, replaced on re-resolve and disposed with the provider. */
  private messageSub: vscode.Disposable | undefined;

  /** Latest enumerated books (from `jpnov/listBooks`), sorted server-side per root. */
  private books: readonly BookEntry[] = [];
  /** The build selection: book URIs whose checkbox is ticked. */
  private readonly checked = new Set<string>();
  /** Serializes `refresh()` so a slow `listBooks` can't clobber a newer enumeration. */
  private refreshSeq = 0;
  /** False until the first successful enumeration, so the webview shows a loading state (not the
   *  misleading "no books yet" welcome) during the server-start window before books are known. */
  private hasLoaded = false;
  /** True while a PDF build runs, so a second click can't spawn an overlapping browser batch. */
  private pdfBuilding = false;
  /** The book whose DETAIL screen is currently open, so edits/refreshes re-push it. */
  private openDetailUri: string | undefined;

  constructor(client: LanguageClient) {
    this.client = client;

    // A `.jpbook` appearing/disappearing changes the book SET, and a SAVE can change its
    // front-matter title (a book label) or chapters (the open detail), so create/delete/change
    // all re-list. The watcher only fires onDidChange for on-disk writes — not per keystroke.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.jpbook');

    this.disposables.push(
      vscode.window.registerWebviewViewProvider(BooksViewProvider.viewId, this, {
        // Keep the DOM (scroll / detail nav) alive when the view is hidden; a ready->state
        // handshake re-hydrates if VS Code disposes it anyway.
        webviewOptions: { retainContextWhenHidden: true },
      }),
      watcher,
      // Fire-and-forget re-list: refresh() self-catches its sendRequest and is refreshSeq-serialized,
      // so a dropped result is safe.
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
      watcher.onDidChange(() => void this.refresh()),
    );
  }

  // --- WebviewViewProvider -------------------------------------------------

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = booksHtml(view.webview);

    this.messageSub?.dispose();
    this.messageSub = view.webview.onDidReceiveMessage((m: unknown) => {
      void this.onMessage(m);
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    // The webview posts `ready` once its script loads; we answer with the current state there,
    // so no eager post is needed here (and none would land before the document loads anyway).
  }

  // --- commands (wired in extension.ts) ------------------------------------

  /** `jpbook.selectAll`: tick every book. */
  selectAll(): void {
    for (const b of this.books) {
      this.checked.add(b.uri);
    }
    this.postState();
  }

  /** `jpbook.deselectAll`: clear every tick. */
  deselectAll(): void {
    this.checked.clear();
    this.postState();
  }

  /**
   * `jpbook.refresh` (and the file watcher / folder changes): re-enumerate books and reconcile
   * the checkbox set — drop ticks for books that vanished, default any newly-discovered book to
   * CHECKED — then re-push the list (and the open detail, if any). Leaves the current list in
   * place if the request fails (e.g. server not yet started).
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
    this.hasLoaded = true;

    // A vanished open book returns the webview to the list; otherwise re-push its (possibly edited) detail.
    if (this.openDetailUri !== undefined && !next.has(this.openDetailUri)) {
      this.openDetailUri = undefined;
      void this.view?.webview.postMessage({ type: 'closeDetail' });
    }
    this.postState();
    if (this.openDetailUri !== undefined) {
      void this.postDetail(this.openDetailUri);
    }
  }

  dispose(): void {
    this.messageSub?.dispose();
    this.messageSub = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  // --- webview messaging ---------------------------------------------------

  /** Book entry for a URI from the current enumeration, or undefined if it vanished. */
  private entryOf(uri: unknown): BookEntry | undefined {
    return typeof uri === 'string' ? this.books.find((b) => b.uri === uri) : undefined;
  }

  private async onMessage(m: unknown): Promise<void> {
    if (typeof m !== 'object' || m === null || !('type' in m)) {
      return;
    }
    const msg = m as { type: string; [k: string]: unknown };
    switch (msg.type) {
      case 'ready':
        this.postState();
        if (this.openDetailUri !== undefined) {
          await this.postDetail(this.openDetailUri);
        }
        break;
      case 'toggle':
        // Optimistic on the webview; here we only record the authoritative selection (no echo,
        // so a per-row toggle never re-renders and drops keyboard focus). A later full `state`
        // push — refresh / select-all — reconciles the checkboxes.
        if (typeof msg.uri === 'string') {
          if (msg.checked === true) {
            this.checked.add(msg.uri);
          } else {
            this.checked.delete(msg.uri);
          }
        }
        break;
      case 'selectAll':
        this.selectAll();
        break;
      case 'deselectAll':
        this.deselectAll();
        break;
      case 'build':
        if (msg.format === 'html' || msg.format === 'txt' || msg.format === 'pdf') {
          await this.buildSelected(msg.format);
        }
        break;
      case 'openDetail':
        if (typeof msg.uri === 'string') {
          this.openDetailUri = msg.uri;
          await this.postDetail(msg.uri);
        }
        break;
      case 'closeDetail':
        this.openDetailUri = undefined;
        break;
      case 'openFile':
        if (typeof msg.uri === 'string') {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(msg.uri));
        }
        break;
      case 'editMeta':
        await this.dispatchEditMeta(msg.uri, msg.metaKey);
        break;
      case 'addChapters': {
        const entry = this.entryOf(msg.uri);
        if (entry !== undefined) {
          const node: BookNode = { kind: 'book', entry };
          await vscode.commands.executeCommand('jpbook.addChapters', node);
        }
        break;
      }
      case 'removeChapter':
        await this.dispatchChapter('jpbook.removeChapter', msg.uri, msg.line);
        break;
      case 'moveChapter':
        await this.dispatchChapter(msg.dir === -1 ? 'jpbook.moveChapterUp' : 'jpbook.moveChapterDown', msg.uri, msg.line);
        break;
      case 'moveChapterTo':
        await this.dispatchMoveTo(msg.uri, msg.line, msg.before);
        break;
      case 'welcome':
        this.dispatchWelcome(msg.action);
        break;
    }
  }

  /** Re-parse the book for the CURRENT value (authoritative), then open the native meta editor. */
  private async dispatchEditMeta(uri: unknown, metaKey: unknown): Promise<void> {
    const entry = this.entryOf(uri);
    if (entry === undefined || typeof metaKey !== 'string' || !(META_KEYS as readonly string[]).includes(metaKey)) {
      return;
    }
    let value: string | undefined;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
      value = metaRows(doc.getText()).find((r) => r.key === metaKey)?.value;
    } catch {
      return;
    }
    const node: BookNode = { kind: 'meta', entry, metaKey: metaKey as MetaKey, value };
    await vscode.commands.executeCommand('jpbook.editMeta', node);
  }

  /** Dispatch a chapter command (remove / move) with a synthesized node — `manage.ts` keys off `line`. */
  private async dispatchChapter(command: string, uri: unknown, line: unknown): Promise<void> {
    const entry = this.entryOf(uri);
    if (entry === undefined || typeof line !== 'number') {
      return;
    }
    const node: BookNode = { kind: 'chapter', entry, line };
    await vscode.commands.executeCommand(command, node);
  }

  /**
   * Drag-and-drop reorder: move the chapter at `line` to sit before `before` (null = end of list),
   * reusing the same pure planner + save path as the up/down buttons. A no-op move plans nothing.
   */
  private async dispatchMoveTo(uri: unknown, line: unknown, before: unknown): Promise<void> {
    const entry = this.entryOf(uri);
    if (entry === undefined || typeof line !== 'number') {
      return;
    }
    const beforeLine = typeof before === 'number' ? before : null;
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
    } catch {
      return;
    }
    const edits = moveChapterTo(doc.getText(), line, beforeLine);
    if (edits !== null) {
      await applyBookEdits(doc.uri, edits);
    }
  }

  /** Runs an empty-state welcome-link action (create book / open guide / open folder). */
  private dispatchWelcome(action: unknown): void {
    if (action === 'createBook') {
      void vscode.commands.executeCommand('workbench.action.files.newUntitledFile', { languageId: 'jpbook' });
    } else if (action === 'openGuide') {
      void vscode.commands.executeCommand('jpnov.openGuide');
    } else if (action === 'openFolder') {
      void vscode.commands.executeCommand('workbench.action.files.openFolder');
    }
  }

  /** Push the book list (per-root sections; single root shown flat) + selection to the webview. */
  private postState(): void {
    const view = this.view;
    if (view === undefined) {
      return;
    }
    const byRoot = new Map<string, BookEntry[]>();
    for (const b of this.books) {
      const bucket = byRoot.get(b.rootUri);
      if (bucket === undefined) {
        byRoot.set(b.rootUri, [b]);
      } else {
        bucket.push(b);
      }
    }
    const multiRoot = byRoot.size > 1;
    const groups = [...byRoot.entries()]
      .sort((a, b) => compareStr(lastPathSegment(a[0]), lastPathSegment(b[0])))
      .map(([rootUri, entries]) => ({
        rootLabel: multiRoot ? lastPathSegment(rootUri) : null,
        books: entries
          .slice()
          .sort((a, b) => compareStr(a.outRel, b.outRel))
          .map((entry): BookVM => ({
            uri: entry.uri,
            title: bookTitle(entry),
            fileRel: entry.fileRel,
            checked: this.checked.has(entry.uri),
          })),
      }));
    const noFolder = (vscode.workspace.workspaceFolders ?? []).length === 0;
    void view.webview.postMessage({ type: 'state', loading: !this.hasLoaded, noFolder, groups });
  }

  /** Parse one book and push its chapters (with missing-file flags) + metadata rows to the webview. */
  private async postDetail(uri: string): Promise<void> {
    const view = this.view;
    const entry = this.entryOf(uri);
    if (view === undefined || entry === undefined) {
      return;
    }
    let text: string;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      text = doc.getText();
    } catch {
      return;
    }
    if (this.openDetailUri !== uri) {
      return; // the user navigated away while the document loaded
    }
    const parsed = parseJpbook(text);
    const chapters = await Promise.all(
      chapterLines(parsed.lines).map(async (line): Promise<ChapterVM> => {
        const rel = parsed.lines[line]?.value ?? '';
        const slash = rel.lastIndexOf('/');
        const target = chapterUri(entry.rootUri, rel);
        let missing = false;
        try {
          const st = await vscode.workspace.fs.stat(target);
          missing = (st.type & vscode.FileType.File) === 0;
        } catch {
          missing = true;
        }
        return {
          line,
          name: rel.slice(slash + 1),
          folder: slash >= 0 ? rel.slice(0, slash) : '',
          fileUri: target.toString(),
          missing,
        };
      }),
    );
    const meta = metaRows(text).map((row) => {
      const parts = metaValueParts(row.key, row.value);
      return { key: row.key, label: metaLabel(row.key), value: parts.value, note: parts.note };
    });
    if (this.openDetailUri !== uri) {
      return; // navigated away during the async stats
    }
    void view.webview.postMessage({ type: 'detail', uri, title: bookTitle(entry), chapters, meta });
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
   * The build driver behind the panel's build actions (`jpbook.buildHtml`/`buildTxt`/
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

          // The CLIENT owns all filesystem writes and encodings.
          const txtEncoding = vscode.workspace
            .getConfiguration()
            .get<TxtEncoding>('jpnov.layout.txt.encoding', TXT_ENCODING_DEFAULT);
          const written: string[] = [];
          let substitutions = 0;
          for (const artifact of result.artifacts ?? []) {
            let bytes: Uint8Array;
            if (artifact.path.endsWith('.txt')) {
              const encoded = encodeTxt(artifact.content, txtEncoding);
              bytes = encoded.bytes;
              substitutions += encoded.substitutions;
            } else {
              bytes = Buffer.from(artifact.content, 'utf8');
            }
            try {
              await vscode.workspace.fs.writeFile(vscode.Uri.parse(artifact.path), bytes);
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
            if (substitutions > 0) {
              void vscode.window.showWarningMessage(
                substitutions === 1
                  ? vscode.l10n.t('Japanese Novel: 1 character became 〓 in the text output.')
                  : vscode.l10n.t('Japanese Novel: {0} characters became 〓 in the text output.', String(substitutions)),
              );
            }
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
