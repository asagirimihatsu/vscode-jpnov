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

// ---------------------------------------------------------------------------
// initialize (C->S)
// ---------------------------------------------------------------------------

/**
 * Carried on the standard LSP `initialize` request as `initializationOptions`.
 * `isTrusted` reflects the host workspace-trust state at startup; the server keeps
 * a `lastKnownTrust` and gates executable-config import() on it. `configBaseName`
 * is the fixed `"novel.jp"` stem the server watches/matches per root.
 */
export interface InitializationOptions {
  readonly isTrusted: boolean;
  readonly configBaseName: 'novel.jp';
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
  | 'lint.halfWidthSpace' // args: [] — static prose diagnostic, no substitution
  | 'server.unexpected'; // args: [detail]  (detail = raw unexpected server error, untranslatable)

/**
 * Config-field labels carried by the `path.*` codes. `sourceDir`/`outDir` name a literal JSON
 * key the user typed and render VERBATIM; `filelistEntry` is prose and is localized client-side.
 */
export type LabelId = 'sourceDir' | 'outDir' | 'filelistEntry';

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
// jpnov/build (C->S request)
// ---------------------------------------------------------------------------

export const BuildRequest = 'jpnov/build';

/** Which artifact kind a build emits when narrowed to one. */
export type BuildFormat = 'html' | 'txt';

/**
 * Build selectors — all optional, so a bare `{}` builds every book of every valid root as
 * BOTH formats:
 * - `root`   — restrict to a single root. The Books panel leaves it unset and selects
 *              with `books` instead.
 * - `books`  — restrict to these `.filelist` URIs. ABSENT = every discovered book;
 *              PRESENT-BUT-EMPTY (`[]`) = build NOTHING. The two are deliberately distinct.
 * - `format` — emit only this kind. ABSENT = BOTH `.txt` and `.html`.
 */
export interface BuildParams {
  readonly root?: string;
  readonly books?: readonly string[];
  readonly format?: BuildFormat;
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

/** Omit `root` to enumerate the books of EVERY currently-valid root. */
export interface ListBooksParams {
  readonly root?: string;
}

/**
 * One buildable book = one `*.filelist` discovered under a valid root's sourceDir. Its
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

/** Strings only — `text` is the live dirty buffer of the previewed file. */
export interface RenderFileParams {
  readonly uri: string;
  readonly text: string;
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
