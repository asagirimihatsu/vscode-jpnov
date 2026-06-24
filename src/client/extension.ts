/**
 * Extension entry (client / host side). This is the ONLY tree permitted to
 * value-import `vscode`. It launches the forked Node language server over IPC and owns
 * the host-side concerns: the aggregated status bar, the Books build panel + its Run-and-Debug
 * launch entries, and the live preview. The novel-jp language id is bound declaratively to
 * `.jpnov` (package.json), so there is no runtime language-id management here.
 *
 * The pure compiler + all config/book parsing live server-side; the client is a thin
 * orchestrator that translates `jpnov/*` protocol messages into VS Code UI effects
 * and translates VS Code events (workspace trust, build actions) back to the server.
 */
import * as vscode from 'vscode';

import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

import {
  ConfigStateNotification,
  ReadFileRequest,
  ServerErrorNotification,
  WorkspaceTrustChangedNotification,
  type ConfigStateParams,
  type ReadFileParams,
  type ReadFileResult,
  type ServerErrorParams,
  type WorkspaceTrustChangedParams,
} from '#/shared/protocol.ts';

import { BooksView } from './booksView.ts';
import { registerBuildDebugger } from './buildDebug.ts';
import { command } from './commands.ts';
import { registerInitWorkspace } from './initWorkspace.ts';
import { isLocalizableMessage, renderMessage } from './messages.ts';
import { Preview } from './preview.ts';
import { StatusBar } from './statusBar.ts';

let client: LanguageClient | undefined;
let statusBar: StatusBar | undefined;
let preview: Preview | undefined;
let booksView: BooksView | undefined;

export function activate(context: vscode.ExtensionContext): void {
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
      { pattern: '**/novel.jp.*' },
    ],
    initializationOptions: {
      isTrusted: vscode.workspace.isTrusted,
      configBaseName: 'novel.jp',
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
    },
  };

  client = new LanguageClient(
    'jpnov',
    vscode.l10n.t('Japanese Novel Language Server'),
    serverOptions,
    clientOptions,
  );

  statusBar = new StatusBar();
  preview = new Preview(client);
  booksView = new BooksView(client);

  // Dispose UI singletons on deactivate (order: stop the client separately below).
  context.subscriptions.push(statusBar, preview, booksView);

  // Surface "Build selected as HTML/Text" in the Run and Debug launch dropdown (▶), driven by the
  // Books panel's checkbox selection. See buildDebug.ts for why this is modeled as a debugger.
  context.subscriptions.push(registerBuildDebugger(booksView));

  // The server emits one configState per root whenever a root's config changes; the
  // client only needs it to refresh the aggregated status-bar item.
  context.subscriptions.push(
    client.onNotification(ConfigStateNotification, (params: ConfigStateParams) => {
      statusBar?.update(params.root, params.state, params.error);
      booksView?.onConfigState(params);
    }),
  );

  // Virtual-fs bridge: the forked Node server cannot read non-`file:` schemes itself, so
  // it asks the client (which has the host `vscode.workspace.fs`) to fetch CONFIG bytes.
  // base64 keeps the bytes intact over the IPC channel; a missing/unreadable file resolves
  // to `null`, which the server treats as "config absent".
  context.subscriptions.push(
    client.onRequest(
      ReadFileRequest,
      async (params: ReadFileParams): Promise<ReadFileResult> => {
        try {
          const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(params.uri));
          return { base64: Buffer.from(bytes).toString('base64') };
        } catch {
          return { base64: null };
        }
      },
    ),
  );

  // Trust can be granted AFTER activation; tell the server so it can (re)load any
  // executable configs (novel.jp.{js,ts,mjs,cjs}) that were previously skipped.
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      const params: WorkspaceTrustChangedParams = { isTrusted: true };
      // Fire-and-forget C->S notify: sendNotification rejects only if the connection is already
      // dead (server gone), in which case there is nothing to (re)load and nothing to report.
      void client?.sendNotification(WorkspaceTrustChangedNotification, params);
    }),
  );

  // Server-reported unexpected errors: the vscode-free server emits a LocalizableMessage; render
  // it to localized text and surface it as a popup. showErrorMessage never rejects, so void it.
  context.subscriptions.push(
    client.onNotification(ServerErrorNotification, (params: ServerErrorParams) => {
      void vscode.window.showErrorMessage(renderMessage(params.message));
    }),
  );

  // Commands. The build actions live on the Books panel (Run and Debug) and operate on its
  // checkbox selection; there is no command-palette build entry — a build needs a resolved
  // config plus at least one selected book, so the palette is the wrong home for it.
  context.subscriptions.push(
    // Scaffold a fresh novel project (.vscode/, novel.jp.json, a sample chapter). Palette-only;
    // available in an empty workspace via the implicit onCommand activation (vscode >= 1.74).
    registerInitWorkspace(),
    command('jpnov.books.buildHtml', () => booksView?.buildHtml()),
    command('jpnov.books.buildTxt', () => booksView?.buildTxt()),
    command('jpnov.books.selectAll', () => booksView?.selectAll()),
    command('jpnov.books.deselectAll', () => booksView?.deselectAll()),
    command('jpnov.books.refresh', () => booksView?.refresh()),
    command('jpnov.preview', () => preview?.open(false)),
    command('jpnov.previewToSide', () => preview?.open(true)),
  );

  // Start the client (and the server process). Surface a hard startup failure.
  client.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Terminal popup inside a .catch(); showErrorMessage never rejects so void is safe here.
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Japanese Novel: couldn't start the language server. {0}", message),
    );
  });
}

export function deactivate(): Thenable<void> | undefined {
  // The disposables (status bar, preview, books panel) are torn down by the extension host
  // via context.subscriptions; we only need to stop the client, which shuts down the forked
  // server process.
  const stopping = client?.stop();
  client = undefined;
  statusBar = undefined;
  preview = undefined;
  booksView = undefined;
  return stopping;
}
