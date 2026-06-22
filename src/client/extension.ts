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
  WorkspaceTrustChangedNotification,
  type ConfigStateParams,
  type ReadFileParams,
  type ReadFileResult,
  type WorkspaceTrustChangedParams,
} from '#/shared/protocol.ts';

import { BooksView } from './booksView.ts';
import { registerBuildDebugger } from './buildDebug.ts';
import { registerInitWorkspace } from './initWorkspace.ts';
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
  };

  client = new LanguageClient(
    'jpnov',
    'Japanese Novel Language Server',
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
      void client?.sendNotification(WorkspaceTrustChangedNotification, params);
    }),
  );

  // Commands. The build actions live on the Books panel (Run and Debug) and operate on its
  // checkbox selection; there is no command-palette build entry — a build needs a resolved
  // config plus at least one selected book, so the palette is the wrong home for it.
  context.subscriptions.push(
    // Scaffold a fresh novel project (.vscode/, novel.jp.json, a sample chapter). Palette-only;
    // available in an empty workspace via the implicit onCommand activation (vscode >= 1.74).
    registerInitWorkspace(),
    vscode.commands.registerCommand('jpnov.books.buildHtml', () => {
      booksView?.buildHtml();
    }),
    vscode.commands.registerCommand('jpnov.books.buildTxt', () => {
      booksView?.buildTxt();
    }),
    vscode.commands.registerCommand('jpnov.books.selectAll', () => {
      booksView?.selectAll();
    }),
    vscode.commands.registerCommand('jpnov.books.deselectAll', () => {
      booksView?.deselectAll();
    }),
    vscode.commands.registerCommand('jpnov.books.refresh', () => {
      void booksView?.refresh();
    }),
    vscode.commands.registerCommand('jpnov.preview', () => {
      preview?.open(false);
    }),
    vscode.commands.registerCommand('jpnov.previewToSide', () => {
      preview?.open(true);
    }),
  );

  // Start the client (and the server process). Surface a hard startup failure.
  client.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Japanese Novel: failed to start language server: ${message}`);
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
