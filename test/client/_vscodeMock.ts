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
  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
  get fsPath(): string {
    return this.path;
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
  _fireDispose(): void;
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
      const disposeEmitter = new EventEmitter<void>();
      const panel: FakeWebviewPanel = {
        viewType,
        title,
        webview: {
          html: '',
          cspSource: 'vscode-webview://test',
          options: _opts,
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
        _fireDispose() {
          disposeEmitter.fire();
        },
      };
      state.panels.push(panel);
      return panel;
    },
    showErrorMessage(...args: unknown[]): Promise<undefined> {
      void args;
      return Promise.resolve(undefined);
    },
    showInformationMessage(...args: unknown[]): Promise<undefined> {
      void args;
      return Promise.resolve(undefined);
    },
    withProgress<R>(_opts: unknown, task: () => Thenable<R>): Thenable<R> {
      return task();
    },
  };

  const fsApi = {
    writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      state.writtenFiles.push({
        uri: uri.toString(),
        content: Buffer.from(content).toString('utf8'),
      });
      return Promise.resolve();
    },
  };

  const workspace = {
    get isTrusted() {
      return state.trusted;
    },
    get textDocuments() {
      return state.textDocuments;
    },
    fs: fsApi,
    onDidGrantWorkspaceTrust: state.onDidGrantTrust.event,
    onDidChangeTextDocument: state.onDidChangeDoc.event,
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

  return {
    window,
    workspace,
    commands,
    Uri,
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
