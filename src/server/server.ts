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
  CodeActionKind,
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import type {
  CancellationToken,
  CodeAction,
  CodeActionParams,
  DidChangeWatchedFilesParams,
  InitializeParams,
  InitializeResult,
  WorkDoneProgressReporter,
  WorkspaceFoldersChangeEvent,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { renderPreview } from '#/shared/compiler/preview.ts';
import { resolvePreviewSettings } from '#/shared/config/settings.ts';
import type { ResolvedConfig } from '#/shared/config/types.ts';
import { selectRules } from '#/shared/lint/select.ts';
import type { InitializationOptions } from '#/shared/protocol.ts';
import type {
  BuildParams,
  BuildResult,
  LintConfigChangedParams,
  ListBooksParams,
  ListBooksResult,
  RenderFileParams,
  RenderFileResult,
  WorkspaceTrustChangedParams,
} from '#/shared/protocol.ts';

import { handleBuild, handleListBooks } from './build.ts';
import { buildCodeActions } from './lint/codeActions.ts';
import { computeLintFindings, LintCancelled } from './lint/kernel.ts';
import type { LintFinding } from './lint/kernel.ts';
import { reportError } from './report.ts';
import {
  addRoot,
  normalizeRootUri,
  reparseAllRoots,
  removeRoot,
  rootForUri,
} from './roots.ts';
import type { ServerContext } from './roots.ts';
import { createRecognizer } from './highlight/recognizer.ts';
import type { Recognizer } from './highlight/recognizer.ts';
import { buildSemanticTokens, SEMANTIC_LEGEND } from './semanticTokens.ts';
import { annotationDiagnostics } from './syntax.ts';
import { completeFilelist, diagnoseFilelist, documentLinksForFilelist } from './filelist.ts';

const connection = createConnection(ProposedFeatures.all);

const context: ServerContext = {
  connection,
  roots: new Map(),
  configBaseName: 'novel.jp',
  lastKnownTrust: false,
  lintSelection: selectRules({}), // all rules off until the client's snapshot arrives at initialize
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
  context.lintSelection = selectRules(options?.lintConfig ?? {});
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
      // Auto-fix for the fixable lint rules: per-diagnostic quick-fixes + a source.fixAll bundle
      // (the latter also enables fix-on-save via the user's editor.codeActionsOnSave).
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll],
      },
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
            for (const f of event.removed) {
              // removeRoot drops the RootState; drop its cached recognizer too (same key form).
              rootRecognizers.delete(normalizeRootUri(f.uri));
            }
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

// Prose-lint settings changed (jpnov.lint.*): re-resolve the enabled-rule selection from the fresh
// snapshot and re-lint every open .jpnov so toggles take effect immediately. The findings cache is
// keyed by document VERSION, which a settings toggle does NOT bump — so clear it explicitly, or a
// code-action requested in the re-lint debounce window would be served from the stale selection.
connection.onNotification(
  'jpnov/lintConfigChanged',
  (params: LintConfigChangedParams) => {
    context.lintSelection = selectRules(params.lintConfig);
    findingsCache.clear();
    revalidateOpenNovels();
  },
);

// Build: omit `root` to build all valid roots. Progress flows over $/progress via the
// request's work-done reporter (3rd handler arg), tied to the client's workDoneToken.
connection.onRequest(
  'jpnov/build',
  (
    params: BuildParams,
    _token: unknown,
    workDone?: WorkDoneProgressReporter,
  ): Promise<BuildResult> => handleBuild(context, params, workDone),
);

// List books: enumerate every `.filelist` of every root in the request's projectDirs map.
// PURE enumeration (no reads/diagnostics); the wire may omit params, so accept the nullable form.
connection.onRequest(
  'jpnov/listBooks',
  (params: ListBooksParams | undefined): Promise<ListBooksResult> =>
    handleListBooks(params ?? { projectDirs: {} }),
);

// Preview: render one file's live buffer to a standalone HTML document. Strings only.
// charsPerLine, 禁則, and display chrome all ride the request's settings snapshot
// (re-resolved here — the wire payload is untrusted).
connection.onRequest(
  'jpnov/renderFile',
  (params: RenderFileParams): RenderFileResult => {
    const settings = resolvePreviewSettings(params.settings);
    return {
      html: renderPreview(params.text, {
        charsPerLine: settings.charsPerLine,
        avoidLineBreaks: settings.avoidLineBreaks,
        chrome: settings,
      }),
    };
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

// Live prose-lint Warnings for an open .jpnov. The enabled rules run through the textlint kernel
// (see lint/kernel.ts), which is async once any rule is on — so, like the filelist path, a version
// recheck AFTER the await guards against publishing results for stale text. With no rule enabled the
// driver returns synchronously (a plain []), so the common case still publishes at once. The short
// debounce keeps typing snappy on long chapters.
const proseDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const PROSE_DEBOUNCE_MS = 200;

// Last published findings per open .jpnov (uri -> {version, findings}); the code-action handler reuses
// them so it never re-lints when the cache is current. Kept in lockstep with what is published.
const findingsCache = new Map<string, { version: number; findings: LintFinding[] }>();

/** Cache the findings and publish their diagnostics (one place keeps cache and diagnostics aligned). */
function publishFindings(uri: string, version: number, findings: LintFinding[]): void {
  findingsCache.set(uri, { version, findings });
  // Syntax Errors (unclosed ［＃) ride the same single publish per URI. Re-derived from the live
  // document (same version as `findings` — the callers' version guards run synchronously before
  // this call) and kept OUT of findingsCache: they carry no fix, so code actions never see them.
  const doc = documents.get(uri);
  const syntax = doc === undefined ? [] : annotationDiagnostics(doc);
  // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
  void connection.sendDiagnostics({
    uri,
    diagnostics: [...syntax, ...findings.map((f) => f.diagnostic)],
  });
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
      // Superseded runs abort between chunks instead of running to completion: the version
      // check is the same one the post-resolve guard below applies, just polled mid-run.
      const result = computeLintFindings(current.getText(), context.lintSelection, current, {
        shouldCancel: () => documents.get(uri)?.version !== scheduledVersion,
      });
      if (Array.isArray(result)) {
        // No rule enabled (or only sync pre-scans): nothing async to race.
        publishFindings(uri, scheduledVersion, result);
        return;
      }
      void result
        .then((findings) => {
          // A newer edit (or a config change) since scheduling supersedes this run.
          if (documents.get(uri)?.version === scheduledVersion) {
            publishFindings(uri, scheduledVersion, findings);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof LintCancelled) {
            return; // superseded — the newer edit's own schedule publishes instead
          }
          reportError(context, err);
        });
    }, PROSE_DEBOUNCE_MS),
  );
}

// Quick-fix + fix-all code actions for an open .jpnov. Reuse the cached findings when they match the
// document version; otherwise recompute (e.g. an action requested before the debounced lint landed).
connection.onCodeAction((
  params: CodeActionParams,
  token: CancellationToken,
): CodeAction[] | Promise<CodeAction[]> => {
  const doc = documents.get(params.textDocument.uri);
  if (doc?.languageId !== 'novel-jp') {
    return [];
  }
  const uri = doc.uri;
  const version = doc.version;
  const cached = findingsCache.get(uri);
  if (cached?.version === version) {
    return buildCodeActions(uri, cached.findings, params.range, params.context.only);
  }
  // A cache-miss recompute honors the LSP cancellation (the client cancels a code-action
  // request as the cursor moves on) and aborts when an edit lands mid-run.
  const result = computeLintFindings(doc.getText(), context.lintSelection, doc, {
    shouldCancel: () => token.isCancellationRequested || documents.get(uri)?.version !== version,
  });
  if (Array.isArray(result)) {
    findingsCache.set(uri, { version, findings: result });
    return buildCodeActions(uri, result, params.range, params.context.only);
  }
  return result
    .then((findings) => {
      if (documents.get(uri)?.version === version) {
        findingsCache.set(uri, { version, findings });
      }
      return buildCodeActions(uri, findings, params.range, params.context.only);
    })
    .catch((err: unknown): CodeAction[] => {
      if (err instanceof LintCancelled) {
        return []; // cancelled request / superseded text — no actions to offer
      }
      throw err;
    });
});

/** Re-lint every open .jpnov — used when the lint selection changes (no text edit drives it). */
function revalidateOpenNovels(): void {
  for (const doc of documents.all()) {
    if (doc.languageId === 'novel-jp') {
      scheduleProseDiagnostics(doc);
    }
  }
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
  findingsCache.delete(e.document.uri);
  if (e.document.languageId === 'novel-jp-filelist' || e.document.languageId === 'novel-jp') {
    // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  }
});

connection.listen();
