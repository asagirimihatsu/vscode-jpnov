/**
 * A minimal in-memory `vscode` stand-in for client unit tests under `node --test`.
 *
 * The real `vscode` module only exists inside the extension host, so these tests run
 * against this stub installed via `mock.module('vscode', ...)` (Node's
 * `--experimental-test-module-mocks`). It implements ONLY the surface the client
 * modules touch; anything else is intentionally absent so accidental new dependencies
 * fail loudly.
 *
 * NOT wired into `npm test` this round (test/client is authored-only); run with:
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */

export type Listener<T> = (e: T) => unknown;

/** A trivial Event emitter matching vscode's `Event<T>` + `EventEmitter` shape. */
export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(data: T): void {
    for (const l of [...this.listeners]) {
      l(data);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Disposable {
  private readonly fn: () => void;
  constructor(fn: () => void) {
    this.fn = fn;
  }
  dispose(): void {
    this.fn();
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      for (const i of items) {
        i.dispose();
      }
    });
  }
}

/** Just enough of vscode.Uri: parse/file + toString + path/scheme/authority. */
export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  private constructor(scheme: string, authority: string, path: string) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
  }
  static parse(value: string): Uri {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
    if (m) {
      const [, scheme = 'file', authority = '', path = ''] = m;
      return new Uri(scheme, authority, path);
    }
    // Fallback: treat as a file path.
    return new Uri('file', '', value.startsWith('/') ? value : `/${value}`);
  }
  static file(path: string): Uri {
    return new Uri('file', '', path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.path.replace(/\/+$/, ''), ...segments].join('/');
    return new Uri(base.scheme, base.authority, joined);
  }
  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
  get fsPath(): string {
    return this.path;
  }
}

/** vscode.FileType bitmask. */
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

/** vscode.FileSystemError: an Error carrying the `.code` the client narrows on. */
export class FileSystemError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'FileSystemError';
  }
  static FileNotFound(uri?: Uri | string): FileSystemError {
    return new FileSystemError('FileNotFound', uri === undefined ? undefined : String(uri));
  }
  static FileExists(uri?: Uri | string): FileSystemError {
    return new FileSystemError('FileExists', uri === undefined ? undefined : String(uri));
  }
}

export class RelativePattern {
  readonly base: Uri | string;
  readonly pattern: string;
  constructor(base: Uri | string, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
}

export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export class MarkdownString {
  value = '';
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ViewColumn = { One: 1, Two: 2, Three: 3, Beside: -2 } as const;
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

export interface FakeTextDocument {
  uri: Uri;
  languageId: string;
  getText(): string;
}

export interface FakeStatusBarItem {
  id: string;
  name: string | undefined;
  text: string;
  tooltip: unknown;
  color: unknown;
  backgroundColor: unknown;
  command: unknown;
  shown: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface FakeWebview {
  html: string;
  cspSource: string;
  options: unknown;
  /** Messages sent via `postMessage`, captured for assertions. */
  posted: unknown[];
  postMessage(message: unknown): Promise<boolean>;
}

/** Just enough of a TextEditor: its document + the cursor selections. */
export interface FakeSelection {
  active: { line: number };
}
export interface FakeTextEditor {
  document: FakeTextDocument;
  selections: readonly FakeSelection[];
  viewColumn?: number;
}
export interface FakeSelectionChange {
  textEditor: FakeTextEditor;
  selections: readonly FakeSelection[];
}

export interface FakeWebviewPanel {
  viewType: string;
  title: string;
  webview: FakeWebview;
  disposed: boolean;
  reveal(): void;
  dispose(): void;
  onDidDispose(listener: Listener<void>): Disposable;
}

/** Mutable test harness backing the mocked `vscode` namespace. */
export interface MockState {
  trusted: boolean;
  textDocuments: FakeTextDocument[];
  statusItems: FakeStatusBarItem[];
  panels: FakeWebviewPanel[];
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  writtenFiles: { uri: string; content: string }[];
  onDidGrantTrust: EventEmitter<void>;
  onDidChangeDoc: EventEmitter<{ document: FakeTextDocument }>;
  onDidChangeActiveEditor: EventEmitter<{ document: FakeTextDocument } | undefined>;
  activeEditor: { document: FakeTextDocument; viewColumn?: number } | undefined;
  /** Editors the preview's cursor-follow consults via `window.visibleTextEditors`. */
  visibleEditors: FakeTextEditor[];
  onDidChangeSelection: EventEmitter<FakeSelectionChange>;
  /** Programmed responses for the init-workspace prompts (FIFO; undefined = Esc/cancel). */
  quickPickQueue: unknown[];
  quickPickCalls: { items: unknown; options: unknown }[];
  inputBoxQueue: (string | undefined)[];
  inputBoxCalls: { options: unknown }[];
  /** Folders the init command may scaffold into; undefined = no folder open. */
  workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined;
  workspaceFolderPickResult: { uri: Uri } | undefined;
  /** Uris `workspace.openTextDocument` must reject (simulates deleted/unloadable files). */
  unopenableDocs: Set<string>;
  /** In-memory filesystem the init guard probes: uri string → FileType. */
  fsEntries: Map<string, number>;
  /** File contents for readFile (uri string → utf8 text). */
  fsContent: Map<string, string>;
  /** Settings store for `workspace.getConfiguration().get(key, dflt)` (full key → value). */
  config: Record<string, unknown>;
  /** Scope-aware settings values: `${scopeUri}|${section.key}` (or `|full.key`) → value. */
  scopedConfig: Map<string, unknown>;
  /** `inspect()` results: `${scopeUri}|${section.key}` → the per-scope value object. */
  inspectResults: Map<
    string,
    { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }
  >;
  /** `workspace.fs.readDirectory` responses: uri string → entries, or 'error' to reject. */
  readDirectoryResults: Map<string, [string, number][] | 'error'>;
  createdDirs: string[];
  openedDocs: string[];
  errorMessages: string[];
  infoMessages: string[];
}

export function createMockState(): MockState {
  return {
    trusted: true,
    textDocuments: [],
    statusItems: [],
    panels: [],
    registeredCommands: new Map(),
    writtenFiles: [],
    onDidGrantTrust: new EventEmitter<void>(),
    onDidChangeDoc: new EventEmitter<{ document: FakeTextDocument }>(),
    onDidChangeActiveEditor: new EventEmitter<
      { document: FakeTextDocument } | undefined
    >(),
    activeEditor: undefined,
    visibleEditors: [],
    onDidChangeSelection: new EventEmitter<FakeSelectionChange>(),
    quickPickQueue: [],
    quickPickCalls: [],
    inputBoxQueue: [],
    inputBoxCalls: [],
    workspaceFolders: undefined,
    workspaceFolderPickResult: undefined,
    unopenableDocs: new Set<string>(),
    fsEntries: new Map<string, number>(),
    fsContent: new Map<string, string>(),
    config: {},
    scopedConfig: new Map<string, unknown>(),
    inspectResults: new Map(),
    readDirectoryResults: new Map<string, [string, number][] | 'error'>(),
    createdDirs: [],
    openedDocs: [],
    errorMessages: [],
    infoMessages: [],
  };
}

/**
 * Reset a state object IN PLACE between tests. `mock.module('vscode', ...)` is installed
 * ONCE (before the modules under test import it), so the mock closes over a single
 * `MockState` instance for the whole file; per-test isolation comes from clearing that
 * instance here rather than swapping it (a swap would not reach already-cached modules).
 */
export function resetMockState(s: MockState): void {
  s.trusted = true;
  s.textDocuments.length = 0;
  s.statusItems.length = 0;
  s.panels.length = 0;
  s.registeredCommands.clear();
  s.writtenFiles.length = 0;
  s.activeEditor = undefined;
  s.visibleEditors.length = 0;
  s.onDidChangeSelection.dispose();
  s.onDidGrantTrust.dispose();
  s.onDidChangeDoc.dispose();
  s.onDidChangeActiveEditor.dispose();
  s.quickPickQueue.length = 0;
  s.quickPickCalls.length = 0;
  s.inputBoxQueue.length = 0;
  s.inputBoxCalls.length = 0;
  s.workspaceFolders = undefined;
  s.workspaceFolderPickResult = undefined;
  s.unopenableDocs.clear();
  s.fsEntries.clear();
  s.fsContent.clear();
  s.config = {};
  s.scopedConfig.clear();
  s.inspectResults.clear();
  s.readDirectoryResults.clear();
  s.createdDirs.length = 0;
  s.openedDocs.length = 0;
  s.errorMessages.length = 0;
  s.infoMessages.length = 0;
}

/**
 * Build a `vscode`-shaped namespace object bound to `state`. Pass this to
 * `mock.module('vscode', { defaultExport: ..., namedExports: ... })` — but because the
 * client does `import * as vscode`, install it as the default+namespace via the
 * `namedExports` returned here.
 */
export function buildVscode(state: MockState): Record<string, unknown> {
  const window = {
    get activeTextEditor() {
      return state.activeEditor;
    },
    onDidChangeActiveTextEditor: state.onDidChangeActiveEditor.event,
    onDidChangeTextEditorSelection: state.onDidChangeSelection.event,
    get visibleTextEditors() {
      return state.visibleEditors;
    },
    createStatusBarItem(
      id?: string | number,
      ...rest: unknown[]
    ): FakeStatusBarItem {
      void rest; // alignment + priority are irrelevant to the mock
      const item: FakeStatusBarItem = {
        id: typeof id === 'string' ? id : 'anon',
        name: undefined,
        text: '',
        tooltip: undefined,
        color: undefined,
        backgroundColor: undefined,
        command: undefined,
        shown: false,
        show() {
          this.shown = true;
        },
        hide() {
          this.shown = false;
        },
        dispose() {
          /* no-op */
        },
      };
      state.statusItems.push(item);
      return item;
    },
    createWebviewPanel(
      viewType: string,
      title: string,
      _show: unknown,
      _opts: unknown,
    ): FakeWebviewPanel {
      const panel = createFakePanel(viewType, title, _opts);
      state.panels.push(panel);
      return panel;
    },
    showErrorMessage(...args: unknown[]): Promise<undefined> {
      if (typeof args[0] === 'string') {
        state.errorMessages.push(args[0]);
      }
      return Promise.resolve(undefined);
    },
    showInformationMessage(...args: unknown[]): Promise<undefined> {
      if (typeof args[0] === 'string') {
        state.infoMessages.push(args[0]);
      }
      return Promise.resolve(undefined);
    },
    showQuickPick(items: unknown, options?: unknown): Promise<unknown> {
      state.quickPickCalls.push({ items, options });
      return Promise.resolve(state.quickPickQueue.shift());
    },
    showInputBox(options?: unknown): Promise<string | undefined> {
      state.inputBoxCalls.push({ options });
      return Promise.resolve(state.inputBoxQueue.shift());
    },
    showWorkspaceFolderPick(options?: unknown): Promise<{ uri: Uri } | undefined> {
      void options;
      return Promise.resolve(state.workspaceFolderPickResult);
    },
    showTextDocument(document: unknown): Promise<unknown> {
      return Promise.resolve(document);
    },
    withProgress<R>(_opts: unknown, task: () => Thenable<R>): Thenable<R> {
      return task();
    },
  };

  const fsApi = {
    writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      const text = Buffer.from(content).toString('utf8');
      state.writtenFiles.push({ uri: uri.toString(), content: text });
      state.fsEntries.set(uri.toString(), FileType.File);
      state.fsContent.set(uri.toString(), text);
      return Promise.resolve();
    },
    readFile(uri: Uri): Promise<Uint8Array> {
      if (!state.fsEntries.has(uri.toString())) {
        return Promise.reject(FileSystemError.FileNotFound(uri));
      }
      return Promise.resolve(Buffer.from(state.fsContent.get(uri.toString()) ?? '', 'utf8'));
    },
    stat(uri: Uri): Promise<{ type: number }> {
      const type = state.fsEntries.get(uri.toString());
      if (type === undefined) {
        return Promise.reject(FileSystemError.FileNotFound(uri));
      }
      return Promise.resolve({ type });
    },
    createDirectory(uri: Uri): Promise<void> {
      state.createdDirs.push(uri.toString());
      state.fsEntries.set(uri.toString(), FileType.Directory);
      return Promise.resolve();
    },
    readDirectory(uri: Uri): Promise<[string, number][]> {
      const entries = state.readDirectoryResults.get(uri.toString());
      if (entries === 'error') {
        return Promise.reject(FileSystemError.FileNotFound(uri));
      }
      return Promise.resolve(entries ?? []);
    },
  };

  const workspace = {
    get isTrusted() {
      return state.trusted;
    },
    get textDocuments() {
      return state.textDocuments;
    },
    get workspaceFolders() {
      return state.workspaceFolders;
    },
    fs: fsApi,
    onDidGrantWorkspaceTrust: state.onDidGrantTrust.event,
    onDidChangeTextDocument: state.onDidChangeDoc.event,
    // Settings reads. Bare getConfiguration() + full keys (renderConfig.ts) resolves from
    // `state.config` as before; the section/scope form (highlightConfig.ts, probe.ts)
    // consults `state.scopedConfig` first — keyed `${scopeUri}|${section ? section + '.' : ''}${key}`
    // — and falls back to `state.config` under the same composite key. `inspect()` reads
    // `state.inspectResults` under the same key shape (probe's section-level inspect included).
    getConfiguration(section?: string, scope?: { toString(): string } | null) {
      const scopeKey = scope ? scope.toString() : '';
      const fullKey = (key: string): string => (section ? `${section}.${key}` : key);
      return {
        get<T>(key: string, dflt: T): T {
          const scoped = `${scopeKey}|${fullKey(key)}`;
          if (state.scopedConfig.has(scoped)) {
            return state.scopedConfig.get(scoped) as T;
          }
          const full = fullKey(key);
          return full in state.config ? (state.config[full] as T) : dflt;
        },
        inspect(key: string):
          | { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }
          | undefined {
          return state.inspectResults.get(`${scopeKey}|${fullKey(key)}`);
        },
      };
    },
    openTextDocument(uri: Uri): Promise<FakeTextDocument> {
      state.openedDocs.push(uri.toString());
      if (state.unopenableDocs.has(uri.toString())) {
        return Promise.reject(FileSystemError.FileNotFound(uri));
      }
      // Prefer a registered document (lets tests control languageId/text); fall back
      // to fabricating a novel-jp doc so pre-existing tests keep working unchanged.
      const existing = state.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      );
      return Promise.resolve(existing ?? doc(uri.toString(), 'novel-jp'));
    },
  };

  const commands = {
    registerCommand(
      id: string,
      handler: (...args: unknown[]) => unknown,
    ): Disposable {
      state.registeredCommands.set(id, handler);
      return new Disposable(() => state.registeredCommands.delete(id));
    },
  };

  // l10n.t passthrough: returns the English source literal with {0}/{1}… substituted, so tests
  // assert against the source strings (no ja bundle is loaded under `node --test`).
  const l10n = {
    t(message: string, ...args: unknown[]): string {
      return message.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const i = Number(index);
        return i < args.length ? String(args[i]) : whole;
      });
    },
  };

  return {
    window,
    workspace,
    commands,
    l10n,
    Uri,
    FileType,
    FileSystemError,
    RelativePattern,
    ThemeColor,
    MarkdownString,
    Disposable,
    EventEmitter,
    StatusBarAlignment,
    ViewColumn,
    ProgressLocation,
  };
}

export function doc(uri: string, languageId: string, text = ''): FakeTextDocument {
  return { uri: Uri.parse(uri), languageId, getText: () => text };
}

/**
 * A standalone webview panel fake. `window.createWebviewPanel` delegates here (and
 * records into `state.panels`); tests can also build one directly to stand in for a
 * workbench-restored panel handed to `Preview.adopt()` — the extension never created
 * that panel, so it is deliberately NOT recorded in `state.panels`.
 */
export function createFakePanel(
  viewType = 'jpnov.preview',
  title = '',
  opts?: unknown,
): FakeWebviewPanel {
  const disposeEmitter = new EventEmitter<void>();
  return {
    viewType,
    title,
    webview: {
      html: '',
      cspSource: 'vscode-webview://test',
      options: opts,
      posted: [],
      postMessage(message: unknown): Promise<boolean> {
        this.posted.push(message);
        return Promise.resolve(true);
      },
    },
    disposed: false,
    reveal() {
      /* no-op */
    },
    dispose() {
      this.disposed = true;
      disposeEmitter.fire();
    },
    onDidDispose: disposeEmitter.event,
  };
}
