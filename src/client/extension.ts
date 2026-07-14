/**
 * Extension entry (client / host side). This is the ONLY tree permitted to
 * value-import `vscode`. It launches the forked Node language server over IPC and owns
 * the host-side concerns: the Books build panel (in the extension's own Activity Bar
 * container) and the live preview. The novel-jp language id is bound declaratively to
 * `.jpnov` (package.json), so there is no runtime language-id management here.
 *
 * The pure compiler + all book parsing live server-side; the client is a thin
 * orchestrator that translates `jpnov/*` protocol messages into VS Code UI effects
 * and translates VS Code events (settings pushes, build actions) back to the server.
 *
 * Activation is two-phase so the window-open path stays cheap (`onStartupFinished`
 * activates this extension in EVERY window, novel or not):
 *   Phase 1 `activate()`  — synchronous registrations only (commands, serializer,
 *     lazy-start listeners). No LanguageClient, no fork, no fs beyond one
 *     root readDirectory per workspace folder. Instant `.jpnov` colorization does not
 *     depend on any of this — the TextMate grammar is applied by VS Code core.
 *   Phase 2 `ensureStarted()` — single-flight; constructs the client + UI singletons
 *     and forks the server on the FIRST real demand: a novel-jp/filelist document, a
 *     jpnov command, a restored preview panel, or a probe hit on a workspace folder
 *     (so a novel workspace still self-populates its Books view shortly after
 *     startup, just off the window-open critical path).
 */
import * as vscode from 'vscode';

import {
  LanguageClient,
  State,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

import {
  HighlightChangedNotification,
  LintConfigChangedNotification,
  ServerErrorNotification,
  type HighlightChangedParams,
  type LintConfigChangedParams,
  type ServerErrorParams,
} from '#/shared/protocol.ts';

import { BooksView } from './booksView.ts';
import { command } from './commands.ts';
import { buildHighlightSnapshot } from './highlightConfig.ts';
import { buildLintSnapshot } from './lintConfig.ts';
import { folderIsNovelProject } from './probe.ts';
import { isLocalizableMessage, renderMessage } from './messages.ts';
import { Preview } from './preview.ts';

let client: LanguageClient | undefined;
let preview: Preview | undefined;
let booksView: BooksView | undefined;
let extCtx: vscode.ExtensionContext | undefined;
/** Phase-2 latch: `ensureStarted()` is single-flight and never un-runs until deactivate. */
let started = false;

/** Documents that justify starting the language server. */
function isNovelDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'novel-jp' || doc.languageId === 'novel-jp-filelist';
}

/**
 * Starts the server iff some folder looks like a novel project. The per-folder decision
 * (workspace/folder-level `jpnov.*` settings, or project filenames in the folder root)
 * lives in `probe.ts`; this loop just short-circuits once anything started us.
 */
async function startIfProjectPresent(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<void> {
  for (const folder of folders) {
    if (started) {
      return; // another trigger won while we awaited
    }
    if (await folderIsNovelProject(folder)) {
      ensureStarted();
      return;
    }
  }
}

/**
 * Phase 2: construct the LanguageClient + UI singletons and start the server.
 * Idempotent and synchronous through construction, so `preview`/`booksView` exist the
 * instant any caller returns; `client.start()` is fire-and-forget — vscode-languageclient
 * queues requests issued after `start()` until the initialize handshake completes, so
 * callers never await this.
 */
function ensureStarted(): void {
  if (started || extCtx === undefined) {
    return;
  }
  started = true;
  // Reveal the Books panel (gated on `jpnov.active`); its empty state shows the welcome guide.
  // Never un-set for the session, like the `started` latch above.
  void vscode.commands.executeCommand('setContext', 'jpnov.active', true);
  const context = extCtx;

  // Run the bundled server as a forked Node process over IPC. We deliberately do NOT set
  // `runtime`: letting vscode-languageclient `fork` the module runs it in the host's Node
  // (Electron with ELECTRON_RUN_AS_NODE handled internally). Setting `runtime:
  // process.execPath` would instead *spawn* the Electron binary as an app, so the server
  // never starts and the IPC connection closes during `initialize`.
  const serverModule = context.asAbsolutePath('dist/server/server.js');
  const serverOptions: ServerOptions = {
    module: serverModule,
    transport: TransportKind.ipc,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: 'novel-jp' },
      { language: 'novel-jp-filelist' },
    ],
    initializationOptions: {
      lintConfig: buildLintSnapshot(),
      highlight: buildHighlightSnapshot(),
    },
    middleware: {
      // Server diagnostics carry English in `.message` (the fallback VS Code shows) and the
      // localizable `{code,args}` in `.data`. Replace `.message` with the localized render when
      // data is present; otherwise leave the English fallback untouched.
      handleDiagnostics(uri, diagnostics, next) {
        for (const d of diagnostics) {
          const data = (d as vscode.Diagnostic & { data?: unknown }).data;
          if (isLocalizableMessage(data)) {
            d.message = renderMessage(data);
          }
        }
        next(uri, diagnostics);
      },
      // Lint code actions come from the vscode-free server with English titles. Localize them:
      // the fix-all bundle is recognized by its source.fixAll kind; a quick-fix reuses the localized
      // message of its diagnostic (the same data the diagnostic middleware above renders).
      async provideCodeActions(document, range, context, token, next) {
        const actions = await next(document, range, context, token);
        if (!actions) {
          return actions;
        }
        for (const action of actions) {
          if (!(action instanceof vscode.CodeAction)) {
            continue; // Command-shaped actions carry no localizable title
          }
          if (action.kind !== undefined && vscode.CodeActionKind.SourceFixAll.contains(action.kind)) {
            action.title = vscode.l10n.t('Fix all auto-fixable problems (Japanese Novel)');
            continue;
          }
          const diag = action.diagnostics?.[0] as (vscode.Diagnostic & { data?: unknown }) | undefined;
          if (isLocalizableMessage(diag?.data)) {
            action.title = renderMessage(diag.data);
          }
        }
        return actions;
      },
    },
  };

  client = new LanguageClient(
    'jpnov',
    vscode.l10n.t('Japanese Novel Language Server'),
    serverOptions,
    clientOptions,
  );

  preview = new Preview(client);
  booksView = new BooksView(client);

  // Dispose UI singletons on deactivate (order: stop the client separately in deactivate()).
  context.subscriptions.push(preview, booksView);

  // Push jpnov.lint.* changes so the server re-lints open files live; re-render the preview
  // when its layout/preview settings change; re-enumerate books when a project dir moves.
  // Gated on Running: a change during start/stop is dropped (the next start re-seeds lint via
  // initializationOptions; the preview/books re-read their snapshots on the next request
  // anyway). jpnov.html.* changes need no push — they only feed on-demand builds.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (client?.state !== State.Running) {
        return;
      }
      if (e.affectsConfiguration('jpnov.lint')) {
        const params: LintConfigChangedParams = { lintConfig: buildLintSnapshot() };
        void client.sendNotification(LintConfigChangedNotification, params);
      }
      if (e.affectsConfiguration('jpnov.highlight')) {
        const params: HighlightChangedParams = { highlight: buildHighlightSnapshot() };
        void client.sendNotification(HighlightChangedNotification, params);
      }
      if (e.affectsConfiguration('jpnov.layout') || e.affectsConfiguration('jpnov.preview')) {
        preview?.refresh();
      }
      if (e.affectsConfiguration('jpnov.project')) {
        // A moved outDir changes which books exist (it is excluded from discovery) and where
        // output lands: re-list
        // (refresh() self-catches and is refreshSeq-serialized, so the dropped promise is safe).
        void booksView?.refresh();
      }
    }),
  );

  // Server-reported unexpected errors: the vscode-free server emits a LocalizableMessage; render
  // it to localized text and surface it as a popup. showErrorMessage never rejects, so void it.
  context.subscriptions.push(
    client.onNotification(ServerErrorNotification, (params: ServerErrorParams) => {
      void vscode.window.showErrorMessage(renderMessage(params.message));
    }),
  );

  // Folder add/remove while running: re-push the FULL highlight map (replacement semantics —
  // this is also how a removed root's vocabulary is dropped) and re-enumerate books. Gated on
  // Running like the settings pushes above; a change inside the startup window is folded into
  // the initialize snapshot / the post-start refresh below.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (client?.state !== State.Running) {
        return;
      }
      const params: HighlightChangedParams = { highlight: buildHighlightSnapshot() };
      void client.sendNotification(HighlightChangedNotification, params);
      void booksView?.refresh();
    }),
  );

  // Start the client (and the server process). start() is called exactly once (single-flight
  // latch above), so a hard startup failure surfaces exactly one popup. On success, kick the
  // first Books enumeration — nothing else fills the panel on a cold start (the filelist
  // watcher only reacts to create/delete).
  client.start().then(
    () => void booksView?.refresh(),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // Terminal popup inside the rejection branch; showErrorMessage never rejects so void is safe.
      void vscode.window.showErrorMessage(
        vscode.l10n.t("Japanese Novel: couldn't start the language server. {0}", message),
      );
    },
  );
}

export function activate(context: vscode.ExtensionContext): void {
  extCtx = context;

  // Revive the preview panel the workbench restored from the previous session (window
  // reload); without a registered serializer the restored tab would stay blank forever.
  // Registered eagerly: `onWebviewPanel` activation can precede every other trigger.
  // ensureStarted() runs synchronously first, so `preview` exists and its adopt() paints
  // the loading shell immediately — the first render then queues behind client.start().
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(Preview.viewType, {
      deserializeWebviewPanel: (panel: vscode.WebviewPanel, state: unknown) => {
        ensureStarted();
        preview?.adopt(panel, state);
        // adopt() is synchronous through its first paint and never throws; returning
        // already-resolved keeps VS Code's revival pipeline unblocked (a rejection
        // would surface an "error restoring view" page instead).
        return Promise.resolve();
      },
    }),
  );

  // Commands. All server-dependent bodies go through ensureStarted() so any command is a
  // start trigger. The build actions live on the Books panel (the extension's Activity Bar
  // container) and operate on its checkbox selection; there is no command-palette build
  // entry — a build needs at least one discovered, selected book, so the palette is the
  // wrong home for it.
  context.subscriptions.push(
    command('jpnov.books.buildHtml', () => { ensureStarted(); return booksView?.buildHtml(); }),
    command('jpnov.books.buildTxt', () => { ensureStarted(); return booksView?.buildTxt(); }),
    command('jpnov.books.buildPdf', () => { ensureStarted(); return booksView?.buildPdf(); }),
    command('jpnov.books.selectAll', () => { ensureStarted(); return booksView?.selectAll(); }),
    command('jpnov.books.deselectAll', () => { ensureStarted(); return booksView?.deselectAll(); }),
    command('jpnov.books.refresh', () => { ensureStarted(); return booksView?.refresh(); }),
    command('jpnov.preview', () => { ensureStarted(); return preview?.open(false); }),
    command('jpnov.previewToSide', () => { ensureStarted(); return preview?.open(true); }),
  );

  // Lazy-start triggers. The listener covers documents opened AFTER activation; the
  // synchronous scan below covers the one that caused an onLanguage activation (it was
  // open before this listener existed, so the listener alone would miss it). A language-
  // mode change is covered too: VS Code reopens the document (close + open events).
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (!started && isNovelDoc(doc)) {
        ensureStarted();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      // Only the not-yet-started case lives here; once started, the Running-gated listener
      // registered in ensureStarted() re-pushes the vocabulary map and refreshes the books.
      if (!started) {
        void startIfProjectPresent(e.added);
      }
    }),
  );

  if (vscode.workspace.textDocuments.some(isNovelDoc)) {
    ensureStarted();
  } else {
    // Novel workspace with no novel editor open (the onStartupFinished case): probe the
    // folder roots and self-populate the Books view shortly after startup.
    // Not awaited — activate() must return immediately; the probe is internally
    // started-guarded, so racing another trigger is harmless.
    void startIfProjectPresent(vscode.workspace.workspaceFolders ?? []);
  }
}

export function deactivate(): Thenable<void> | undefined {
  // The disposables (preview, books panel) are torn down by the extension host via
  // context.subscriptions; we only need to stop the client, which shuts down the forked
  // server process.
  const stopping = client?.stop();
  client = undefined;
  preview = undefined;
  booksView = undefined;
  extCtx = undefined;
  started = false;
  return stopping;
}
