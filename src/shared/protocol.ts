/**
 * LSP message names + payload interfaces for the Japanese Novel client (host) <-> server
 * (forked Node) split. This module is PURE and vscode-free; both sides import it.
 *
 * SINGLE-REPO CONTRACT: the wire shapes live here. Client and server ship together
 * from this one repo, so changing a name/shape is fine as long as BOTH sides move in
 * the same commit — there is no external consumer.
 *
 * Every custom payload below is defined with plain strings so it survives IPC
 * (structured-clone over the forked-process channel) without vscode value types.
 */
import type { BuildChrome, PreviewChrome } from './compiler/chrome.ts';
import type { LintCode } from './lint/catalog.ts';

// ---------------------------------------------------------------------------
// initialize (C->S)
// ---------------------------------------------------------------------------

/**
 * A flat snapshot of the user's `jpnov.lint.*` settings, keyed by full setting key
 * (`jpnov.lint.<stream>.<id>`) -> primitive. Plain primitives only, so it survives IPC; the server
 * resolves it to enabled rules via `selectRules()` (`src/shared/lint/select.ts`). Absent keys (and
 * `null`) mean "off", so the client may ship a sparse object.
 */
export type RawLintConfigWire = Readonly<Record<string, boolean | number | string | null>>;

/**
 * Carried on the standard LSP `initialize` request as `initializationOptions`.
 * `isTrusted` reflects the host workspace-trust state at startup; the server keeps
 * a `lastKnownTrust` and gates executable-config import() on it. `configBaseName`
 * is the fixed `"novel.jp"` stem the server watches/matches per root. `lintConfig` seeds the
 * prose-lint selection at startup (omitted = no rules enabled). `highlight` seeds the per-root
 * narration vocabulary the same way (omitted = no vocabulary anywhere).
 */
export interface InitializationOptions {
  readonly isTrusted: boolean;
  readonly configBaseName: 'novel.jp';
  readonly lintConfig?: RawLintConfigWire;
  readonly highlight?: HighlightVocabularyMap;
}

// ---------------------------------------------------------------------------
// Localizable server messages (S->C)
// ---------------------------------------------------------------------------

/**
 * The forked server is vscode-free (no `vscode.l10n`), so it never produces final UI text.
 * It emits a CODE plus positional ARGS; the CLIENT renders the localized string via
 * `renderMessage()` (`src/client/messages.ts`) -> `vscode.l10n.t()`. The server fills the
 * English `Diagnostic.message` FALLBACK via the vscode-free `renderEnglish()`
 * (`src/shared/messages.ts`). `args` are IPC-safe primitives, indexed by the `{0}`/`{1}`
 * in each message's English template.
 */
export type MsgCode =
  | 'config.execNeedsFileScheme' // args: [format]
  | 'config.execNeedsTrust' // args: [format]
  | 'config.loadFailed' // args: [detail]  (detail = raw parse/load error, untranslatable)
  | 'book.entryNeedsFileScheme' // args: [value]
  | 'book.entryFileNotFound' // args: [value]  (ENOENT)
  | 'book.entryReadFailed' // args: [value, why]  (why = raw OS error, untranslatable)
  | 'build.outPathCollision' // args: [outRel, list]
  | 'build.failed' // args: [detail]  (detail = raw build error, untranslatable)
  | 'filelist.backslashSeparator' // args: [value]
  | 'filelist.notJpnov' // args: [value]
  | 'filelist.duplicateEntry' // args: [value]
  | 'filelist.entryIsDirectory' // args: [value]
  | 'filelist.fileNotFound' // args: [value]
  | 'path.empty' // args: [LabelId]
  | 'path.rootDot' // args: [LabelId]  (the root "." or a path collapsing to it)
  | 'path.homeRelative' // args: [LabelId]
  | 'path.absolute' // args: [LabelId]
  | 'path.invalid' // args: [LabelId]
  | 'path.escapesRoot' // args: [LabelId]
  | 'syntax.unclosedAnnotation' // args: [] — unterminated ［＃ (no ］ before the line end); the diagnostic range IS the span
  | 'syntax.unterminatedBlock' // args: [] — ［＃ここから…］ with no matching ［＃ここで…終わり］ before EOF; range = the ここから annotation
  | 'syntax.danglingBlockEnd' // args: [] — ［＃ここで…終わり］ with no open block; range = the 終わり annotation
  | LintCode // args: [] — one static prose-lint code per (stream, rule); see lint/catalog.ts
  | 'server.unexpected'; // args: [detail]  (detail = raw unexpected server error, untranslatable)

/**
 * Config-field labels carried by the `path.*` codes. Only `filelistEntry` remains (the
 * migrated `jpnov.project.*` paths fail silently to their defaults instead of diagnosing);
 * it is prose and is localized client-side.
 */
export type LabelId = 'filelistEntry';

/** A server-produced message: a code plus the positional args its template substitutes. */
export interface LocalizableMessage {
  readonly code: MsgCode;
  readonly args?: readonly (string | number)[];
}

// ---------------------------------------------------------------------------
// jpnov/configState (S->C notification)
// ---------------------------------------------------------------------------

export const ConfigStateNotification = 'jpnov/configState';

export type ConfigState = 'valid' | 'error' | 'absent' | 'removed';

/**
 * One-shot report of a root's config status; drives the aggregated status-bar item.
 * The language id is bound declaratively to the `.jpnov` extension, so the status bar
 * is this notification's only consumer — there is no client-side language switching to drive.
 *
 * - `valid`   -> the root's config resolved cleanly; status item shows the book icon.
 * - `error`   -> `error` present; status item shows the red-cross + opens the config.
 * - `absent`  -> no config at this root.
 * - `removed` -> config (or the root) was deleted; status item drops this root.
 */
export interface ConfigStateParams {
  readonly root: string;
  readonly state: ConfigState;
  /** Present only for `error`: the localizable cause + the config uri to open on click. */
  readonly error?: LocalizableMessage & {
    readonly configUri: string;
  };
}

// ---------------------------------------------------------------------------
// jpnov/workspaceTrustChanged (C->S notification)
// ---------------------------------------------------------------------------

export const ServerErrorNotification = 'jpnov/serverError';

/**
 * An unexpected server-side failure surfaced to the user as a popup. The server is vscode-free,
 * so it cannot show UI itself; its lifecycle paths funnel thrown errors through `reportError()`
 * (`src/server/report.ts`), which sends this notification carrying a localizable cause. The client
 * renders `.message` via `renderMessage()` and shows it with `vscode.window.showErrorMessage`.
 */
export interface ServerErrorParams {
  readonly message: LocalizableMessage;
}

export const WorkspaceTrustChangedNotification = 'jpnov/workspaceTrustChanged';

export interface WorkspaceTrustChangedParams {
  readonly isTrusted: boolean;
}

// ---------------------------------------------------------------------------
// jpnov/lintConfigChanged (C->S notification)
// ---------------------------------------------------------------------------

export const LintConfigChangedNotification = 'jpnov/lintConfigChanged';

/**
 * Pushed when the user edits any `jpnov.lint.*` setting (mirrors the workspace-trust push). The
 * server keeps a vscode-free `RuleSelection`; this carries a fresh full snapshot, which the server
 * re-resolves and then re-lints all open `.jpnov` documents against.
 */
export interface LintConfigChangedParams {
  readonly lintConfig: RawLintConfigWire;
}

// ---------------------------------------------------------------------------
// jpnov/highlightChanged (C->S notification)
// ---------------------------------------------------------------------------

export const HighlightChangedNotification = 'jpnov/highlightChanged';

/**
 * One workspace folder's narration vocabulary, read from the `jpnov.highlight.*` settings.
 * Both fields are always present — the client sends the folder's effective values verbatim
 * (empty arrays included); the server normalizes (drops non-strings/empties, dedups) on apply.
 */
export interface HighlightVocabulary {
  readonly characters: readonly string[];
  readonly keywords: readonly string[];
}

/**
 * The full per-root vocabulary snapshot, keyed by folder URI (as sent by the client, verbatim).
 * REPLACEMENT semantics: each push carries every workspace folder — a root absent from the map
 * has no vocabulary (mirrors ProjectDirsMap, where the map itself defines the target roots).
 * Empty-listed roots still get an entry so a nested folder's (empty) vocabulary shadows its
 * parent's under longest-prefix routing.
 */
export type HighlightVocabularyMap = Readonly<Record<string, HighlightVocabulary>>;

/**
 * Pushed when the user edits any `jpnov.highlight.*` setting, and re-pushed in full when
 * workspace folders change while the client is running (mirrors the lint push).
 */
export interface HighlightChangedParams {
  readonly highlight: HighlightVocabularyMap;
}

// ---------------------------------------------------------------------------
// Render settings (C->S, carried on jpnov/renderFile and jpnov/build)
// ---------------------------------------------------------------------------

/**
 * The `jpnov.layout.*` / `jpnov.preview.*` snapshot the client ships on every
 * `jpnov/renderFile` request. Read at default (resource-less) scope — one window-global
 * set of values, like the lint snapshot. The server re-resolves it (clamp + enum
 * coercion) before rendering; the wire payload is untrusted at runtime.
 */
export interface PreviewSettings extends PreviewChrome {
  readonly charsPerLine: number;
  /** 禁則処理 toggle; rides BOTH snapshots so preview and build stay same-source. */
  readonly avoidLineBreaks: boolean;
}

/**
 * The `jpnov.layout.*` / `jpnov.html.*` snapshot the client ships on every `jpnov/build`
 * request. Only the `.html` artifact consumes it (`.txt` is the raw Aozora source).
 */
export interface HtmlSettings extends BuildChrome {
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  /** 禁則処理 toggle; rides BOTH snapshots so preview and build stay same-source. */
  readonly avoidLineBreaks: boolean;
}

// ---------------------------------------------------------------------------
// jpnov/build (C->S request)
// ---------------------------------------------------------------------------

export const BuildRequest = 'jpnov/build';

/** Which artifact kind a build emits when narrowed to one. */
export type BuildFormat = 'html' | 'txt';

/**
 * The `jpnov.project.*` snapshot for ONE workspace folder: RAW relative strings exactly as
 * configured (`scope: resource`, read per folder — unlike the window-global render snapshot).
 * The client never resolves them; the server resolves each against its root and silently
 * falls back to the default on any invalid value (empty / absolute / escaping / `.`).
 */
export interface ProjectDirs {
  readonly sourceDir: string;
  readonly outDir: string;
}

/**
 * The per-root `jpnov.project.*` snapshot carried on `jpnov/listBooks` and `jpnov/build`:
 * one entry per workspace folder, keyed by folder URI. The map DEFINES which roots the
 * request targets — a root absent from it contributes no books and builds nothing.
 */
export type ProjectDirsMap = Readonly<Record<string, ProjectDirs>>;

/**
 * Build selectors:
 * - `root`        — restrict to a single root. The Books panel leaves it unset and selects
 *                   with `books` instead.
 * - `books`       — restrict to these `.filelist` URIs. ABSENT = every discovered book;
 *                   PRESENT-BUT-EMPTY (`[]`) = build NOTHING. The two are deliberately distinct.
 * - `format`      — emit only this kind. ABSENT = BOTH `.txt` and `.html`.
 * - `settings`    — the client's render-settings snapshot (required; client and server ship
 *                   together, so there is no legacy sender to tolerate).
 * - `projectDirs` — the per-root source/output dirs (see {@link ProjectDirsMap}).
 */
export interface BuildParams {
  readonly root?: string;
  readonly books?: readonly string[];
  readonly format?: BuildFormat;
  readonly settings: HtmlSettings;
  readonly projectDirs: ProjectDirsMap;
}

export interface BuildArtifact {
  /** Workspace-relative-or-absolute output path string; the CLIENT writes it. */
  readonly path: string;
  /** Rendered output bytes (UTF-8 text) — a `.txt` or `.html` payload per `path`. */
  readonly content: string;
}

export interface BuildError extends LocalizableMessage {
  /** Book identity (e.g. the book dir relative to sourceDir). */
  readonly book: string;
}

export interface BuildResult {
  readonly ok: boolean;
  readonly artifacts?: readonly BuildArtifact[];
  readonly errors?: readonly BuildError[];
}

// ---------------------------------------------------------------------------
// jpnov/listBooks (C->S request)
// ---------------------------------------------------------------------------

export const ListBooksRequest = 'jpnov/listBooks';

/** Omit `root` to enumerate the books of EVERY root in `projectDirs`. */
export interface ListBooksParams {
  readonly root?: string;
  readonly projectDirs: ProjectDirsMap;
}

/**
 * One buildable book = one `*.filelist` discovered under a root's sourceDir. Its
 * `uri` is the STABLE identity the Books panel keys checkbox state on and echoes back in
 * {@link BuildParams.books}; `outRel` rides along so the panel can show the real output
 * path without re-deriving it (the derivation stays single-sourced in the server).
 */
export interface BookEntry {
  /** Absolute URI of the `.filelist` file (stable id + build selector). */
  readonly uri: string;
  /** Owning root URI (normalized, no trailing slash). */
  readonly rootUri: string;
  /** Path relative to the root's sourceDir (POSIX separators), e.g. `"part1/vol2.filelist"`. */
  readonly fileRel: string;
  /** Derived output relative path (`filelistOutRel`, POSIX `/`); the build writes `${outRel}.{txt,html}`. */
  readonly outRel: string;
}

export interface ListBooksResult {
  readonly books: readonly BookEntry[];
}

// ---------------------------------------------------------------------------
// jpnov/renderFile (C->S request)
// ---------------------------------------------------------------------------

export const RenderFileRequest = 'jpnov/renderFile';

/** `text` is the live dirty buffer of the previewed file; `settings` the client's snapshot. */
export interface RenderFileParams {
  readonly uri: string;
  readonly text: string;
  readonly settings: PreviewSettings;
}

export interface RenderFileResult {
  readonly html: string;
}

// ---------------------------------------------------------------------------
// jpnov/readFile (S->C request)
// ---------------------------------------------------------------------------

export const ReadFileRequest = 'jpnov/readFile';

/** Virtual-fs bridge for CONFIG bytes on non-`file:` schemes only. */
export interface ReadFileParams {
  readonly uri: string;
}

export interface ReadFileResult {
  /** base64 of the file bytes, or `null` when the file does not exist. */
  readonly base64: string | null;
}
