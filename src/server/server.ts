/**
 * Japanese Novel language server (forked Node process, IPC). MUST stay vscode-free — there is
 * no `vscode` module in the forked process; a value-import would crash it. Only
 * `import type` of vscode is permitted (and eslint enforces this for src/server/**).
 *
 * Responsibilities wired here:
 * - `initialize`: read workspace folders + `initializationOptions{isTrusted,
 *   configBaseName}`, reply the negotiated capabilities, seed roots.
 * - `workspace/didChangeWorkspaceFolders`: add/remove roots (multi-root).
 * - `workspace/didChangeWatchedFiles`: reparse the owning root on a `novel.jp.*` edit.
 * - `jpnov/build`, `jpnov/renderFile`, `jpnov/workspaceTrustChanged` handlers.
 */
import {
  createConnection,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import type {
  Diagnostic,
  DidChangeWatchedFilesParams,
  InitializeParams,
  InitializeResult,
  WorkDoneProgressReporter,
  WorkspaceFoldersChangeEvent,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { renderPreview } from '#/shared/compiler/preview.ts';
import { DEFAULT } from '#/shared/config/types.ts';
import type { ResolvedConfig } from '#/shared/config/types.ts';
import type { InitializationOptions } from '#/shared/protocol.ts';
import type {
  BuildParams,
  BuildResult,
  ListBooksParams,
  ListBooksResult,
  RenderFileParams,
  RenderFileResult,
  WorkspaceTrustChangedParams,
} from '#/shared/protocol.ts';

import { handleBuild, handleListBooks } from './build.ts';
import { diagnostic } from './diagnostics.ts';
import { reportError } from './report.ts';
import { findHalfWidthSpaces } from './prose.ts';
import {
  addRoot,
  reparseAllRoots,
  removeRoot,
  rootForUri,
} from './roots.ts';
import type { ServerContext } from './roots.ts';
import { createRecognizer } from './highlight/recognizer.ts';
import type { Recognizer } from './highlight/recognizer.ts';
import { buildSemanticTokens, SEMANTIC_LEGEND } from './semanticTokens.ts';
import { completeFilelist, diagnoseFilelist, documentLinksForFilelist } from './filelist.ts';

const connection = createConnection(ProposedFeatures.all);

const context: ServerContext = {
  connection,
  roots: new Map(),
  configBaseName: 'novel.jp',
  lastKnownTrust: false,
};

// Open-document tracker (so semantic-tokens requests have document text to highlight) plus the
// per-root narration recognizer (cast names + coined keywords) that powers body highlighting.
const documents = new TextDocuments(TextDocument);
documents.listen(connection);

// Each root whose config declares `characters` / `keywords` gets a recognizer, cached by its
// resolved-config identity — a reparse swaps in a fresh `resolved` (configLoad.ts), so we rebuild.
// The recognizer is pure and synchronous (no dictionary, no async), so it is built on demand with
// no startup cost.
const rootRecognizers = new Map<string, { resolved: ResolvedConfig; recognizer: Recognizer }>();
const NONE: readonly string[] = [];

/** The recognizer for a document's owning root, or undefined when it declares no cast/keywords. */
function recognizerForUri(uri: string): Recognizer | undefined {
  const root = rootForUri(context, uri);
  const resolved = root?.resolved;
  if (root === undefined || resolved === undefined) {
    return undefined;
  }
  const characters = resolved.characters ?? NONE;
  const keywords = resolved.keywords ?? NONE;
  if (characters.length === 0 && keywords.length === 0) {
    return undefined;
  }
  const cached = rootRecognizers.get(root.rootUri);
  if (cached?.resolved === resolved) {
    return cached.recognizer;
  }
  const recognizer = createRecognizer(characters, keywords);
  rootRecognizers.set(root.rootUri, { resolved, recognizer });
  return recognizer;
}

/** The document selector the client uses to route docs/requests to this server. */
const DOCUMENT_SELECTOR = [
  { language: 'novel-jp' },
  { language: 'novel-jp-filelist' },
  { pattern: '**/novel.jp.*' },
] as const;

/** Whether the client declared `workspace.workspaceFolders` support at `initialize`. */
let hasWorkspaceFolderCapability = false;
/** Initial workspace-folder URIs, seeded into roots once the client is `initialized`. */
let initialFolderUris: string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const options = params.initializationOptions as InitializationOptions | undefined;
  context.lastKnownTrust = options?.isTrusted ?? false;
  hasWorkspaceFolderCapability = Boolean(params.capabilities.workspace?.workspaceFolders);
  // configBaseName is frozen to "novel.jp" and already seeded on the context, so there
  // is nothing to reconcile from initializationOptions here.

  // Defer seeding to `onInitialized`: client-bound work (watch registration, configState
  // notifications) and the workspace-folders event getter are only valid after that point.
  initialFolderUris = (params.workspaceFolders ?? []).map((folder) => folder.uri);

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
      },
      semanticTokensProvider: {
        legend: SEMANTIC_LEGEND,
        full: true,
      },
      // *.filelist editor features (routed for `novel-jp-filelist` via the document selector).
      // Trigger on "/" (descend a subdir) AND on every digit: VS Code's quick-suggest does not
      // auto-fire on a leading digit (it reads it as a number literal), so digit-led filenames
      // (e.g. 0001-chapter.jpnov) would otherwise need a manual Ctrl+Space.
      completionProvider: {
        triggerCharacters: ['/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      },
      documentLinkProvider: { resolveProvider: false },
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
      // No executeCommandProvider: this extension drives everything through custom requests.
      // The document selector is advertised for the client to mirror onto its
      // LanguageClient (ServerCapabilities has no standard slot for it).
      experimental: { documentSelector: DOCUMENT_SELECTOR },
    },
  };
});

// All client-bound work waits for `initialized`: seed the initial roots, and (only if the
// client supports it) subscribe to multi-root add/remove. Touching the
// `onDidChangeWorkspaceFolders` getter before `initialized` throws — which previously
// crashed the forked server on load.
connection.onInitialized(() => {
  // Seed the initial roots. addRoot() never rejects today (loadRootConfig funnels every failure
  // into the 'error' config-state, and registerConfigWatch self-catches), so this catch is
  // DEFENSIVE per the error-reporting policy: any future-introduced rejection becomes a client
  // popup instead of an unhandled rejection. The IIFE is voided because onInitialized is sync;
  // the catch is what makes that void safe.
  void Promise.all(initialFolderUris.map((uri) => addRoot(context, uri))).catch((err: unknown) => {
    reportError(context, err);
  });

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(
      (event: WorkspaceFoldersChangeEvent) => {
        // Multi-root add/remove. removeRoot awaits connection.sendNotification (can reject only on
        // a dead connection); addRoot is defensive per above. Either rejection is reported to the
        // client rather than dropped. The IIFE is voided because the event callback is sync; the
        // inner try/catch is what makes that void safe.
        void (async () => {
          try {
            await Promise.all(event.removed.map((f) => removeRoot(context, f.uri)));
            await Promise.all(event.added.map((f) => addRoot(context, f.uri)));
          } catch (err) {
            reportError(context, err);
          }
        })();
      },
    );
  }
});

// A watched `novel.jp.*` change reparses the owning root. Dedupe by root so several
// events on the same root in one batch trigger a single reparse.
connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const dirtyRoots = new Set<string>();
  for (const change of params.changes) {
    // Config file URIs (novel.jp.*) never carry a trailing slash, so the raw uri is
    // already in the normalized form rootForUri compares against.
    const state = rootForUri(context, change.uri);
    if (state) {
      dirtyRoots.add(state.rootUri);
    }
  }
  void (async () => {
    try {
      for (const rootUri of dirtyRoots) {
        // Re-add reuses the existing RootState (watcher kept) and reparses the config.
        await addRoot(context, rootUri);
      }
    } catch (err) {
      reportError(context, err);
    }
    // A config edit may have changed the cast / keywords; re-request semantic tokens so open
    // documents recolor (recognizerForUri rebuilds the root's recognizer on the new config arrays).
    // LSP send: rejects only on a dead connection (nothing to recover), so the promise is dropped.
    void connection.languages.semanticTokens.refresh();
  })();
});

// Workspace-trust transitions: update the gate; false->true unlocks executable configs.
connection.onNotification(
  'jpnov/workspaceTrustChanged',
  (params: WorkspaceTrustChangedParams) => {
    const wasTrusted = context.lastKnownTrust;
    context.lastKnownTrust = params.isTrusted;
    if (!wasTrusted && params.isTrusted) {
      // DEFENSIVE per the error-reporting policy: reparseAllRoots maps to loadRootConfig, which
      // never throws today, so this effectively cannot reject — but route any future rejection to
      // a client popup instead of dropping it. void because onNotification's callback is sync.
      void reparseAllRoots(context).catch((err: unknown) => {
        reportError(context, err);
      });
    }
  },
);

// Build: omit `root` to build all valid roots. Progress flows over $/progress via the
// request's work-done reporter (3rd handler arg), tied to the client's workDoneToken.
connection.onRequest(
  'jpnov/build',
  (
    // The wire may omit params entirely (build all roots), so accept the nullable form.
    params: BuildParams | undefined,
    _token: unknown,
    workDone?: WorkDoneProgressReporter,
  ): Promise<BuildResult> => handleBuild(context, params ?? {}, workDone),
);

// List books: enumerate every `.filelist` of every valid root for the client's Books panel.
// PURE enumeration (no reads/diagnostics); the wire may omit params, so accept the nullable form.
connection.onRequest(
  'jpnov/listBooks',
  (params: ListBooksParams | undefined): Promise<ListBooksResult> =>
    handleListBooks(context, params ?? {}),
);

// Preview: render one file's live buffer to a standalone HTML document. Strings only.
// Lines wrap at the owning root's charsPerLine (折り返し) and honor its avoidLineBreaks (禁則) —
// the SAME layout engine the build uses; both fall back to defaults when the file is not under
// any tracked/valid root.
connection.onRequest(
  'jpnov/renderFile',
  (params: RenderFileParams): RenderFileResult => {
    const owner = rootForUri(context, params.uri);
    const charsPerLine = owner?.resolved?.charsPerLine ?? DEFAULT.charsPerLine;
    const avoidLineBreaks = owner?.resolved?.avoidLineBreaks ?? false;
    return { html: renderPreview(params.text, { charsPerLine, avoidLineBreaks }) };
  },
);

// Semantic tokens: Aozora markup + dialogue colouring (always), plus cast/keyword highlighting when
// the owning root declares any. Fully synchronous — markup and colours emit on the first request.
connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  // Only novel-jp documents are highlighted. The config files (novel.jp.json, etc.) also match the
  // client's document selector but are plain JSON/JS — never highlight them.
  if (doc?.languageId !== 'novel-jp') {
    return { data: [] };
  }
  return buildSemanticTokens(doc, recognizerForUri(params.textDocument.uri));
});

// --- *.filelist editor features (novel-jp-filelist) -------------------------

/** Returns line `n`'s text (no terminator); `position.character` indexes into this. */
function lineAt(doc: TextDocument, line: number): string {
  const text = doc.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
  return text.replace(/\r$/, '');
}

// File-path autocompletion: only for filelists, delegated to the fs-backed resolver.
connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (doc?.languageId !== 'novel-jp-filelist') {
    return [];
  }
  return completeFilelist(doc.uri, lineAt(doc, params.position.line), params.position);
});

// Cmd+click targets: one link per valid line pointing at the resolved file URI.
connection.onDocumentLinks((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (doc?.languageId !== 'novel-jp-filelist') {
    return [];
  }
  return documentLinksForFilelist(doc.uri, doc.getText());
});

// Live per-line diagnostics for an open .filelist (missing/escaping/duplicate paths). Debounced
// per URI and version-guarded so async fs existence checks never publish results for stale text.
const filelistDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const FILELIST_DEBOUNCE_MS = 250;

function scheduleFilelistDiagnostics(doc: TextDocument): void {
  const uri = doc.uri;
  const scheduledVersion = doc.version;
  clearTimeout(filelistDebounce.get(uri));
  filelistDebounce.set(
    uri,
    setTimeout(() => {
      filelistDebounce.delete(uri);
      const current = documents.get(uri);
      if (current?.languageId !== 'novel-jp-filelist' || current.version !== scheduledVersion) {
        return;
      }
      void (async () => {
        try {
          const diagnostics = await diagnoseFilelist(uri, current.getText());
          // Re-check after the async fs work: a newer edit (with its own schedule) wins.
          if (documents.get(uri)?.version === scheduledVersion) {
            // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
            void connection.sendDiagnostics({ uri, diagnostics });
          }
        } catch (err) {
          reportError(context, err);
        }
      })();
    }, FILELIST_DEBOUNCE_MS),
  );
}

// Live half-width-space Warnings for an open .jpnov (see prose.ts for the smart rule). The scan is
// pure + synchronous (no fs), so there is no async stale-result window like the filelist path — a
// short debounce just keeps typing snappy on long chapters.
const proseDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const PROSE_DEBOUNCE_MS = 200;

/** Map the prose scan's spans to `lint.halfWidthSpace` Warning diagnostics. */
function proseDiagnostics(text: string): Diagnostic[] {
  return findHalfWidthSpaces(text).map((s) =>
    diagnostic(
      {
        start: { line: s.line, character: s.startChar },
        end: { line: s.line, character: s.endChar },
      },
      { code: 'lint.halfWidthSpace' },
      DiagnosticSeverity.Warning,
    ),
  );
}

function scheduleProseDiagnostics(doc: TextDocument): void {
  const uri = doc.uri;
  const scheduledVersion = doc.version;
  clearTimeout(proseDebounce.get(uri));
  proseDebounce.set(
    uri,
    setTimeout(() => {
      proseDebounce.delete(uri);
      const current = documents.get(uri);
      if (current?.languageId !== 'novel-jp' || current.version !== scheduledVersion) {
        return;
      }
      // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
      void connection.sendDiagnostics({ uri, diagnostics: proseDiagnostics(current.getText()) });
    }, PROSE_DEBOUNCE_MS),
  );
}

// onDidChangeContent fires on open AND on every edit, so it covers initial validation too.
documents.onDidChangeContent((e) => {
  if (e.document.languageId === 'novel-jp-filelist') {
    scheduleFilelistDiagnostics(e.document);
  } else if (e.document.languageId === 'novel-jp') {
    scheduleProseDiagnostics(e.document);
  }
});

// Closing a filelist drops its (buffer-scoped) diagnostics; a later build republishes if needed.
documents.onDidClose((e) => {
  clearTimeout(filelistDebounce.get(e.document.uri));
  filelistDebounce.delete(e.document.uri);
  clearTimeout(proseDebounce.get(e.document.uri));
  proseDebounce.delete(e.document.uri);
  if (e.document.languageId === 'novel-jp-filelist' || e.document.languageId === 'novel-jp') {
    // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  }
});

connection.listen();
