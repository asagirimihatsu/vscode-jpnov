/**
 * Pure, vscode-free parsing of the per-book `*.jpbook` manifest, plus the output-name
 * derivation, per-book chrome composition, and the fs-free completion logic.
 *
 * A `.jpbook` opens with its metadata — the format version ({@link VERSION_KEY}) and the seven
 * `key: value` lines of {@link META_KEYS}, all required, plus the optional `cover:` list — closes
 * it with a `---` line, and continues with one chapter path per line.
 *
 * Chapter and cover paths are relative to the book's OWNING WORKSPACE FOLDER root, so moving
 * the `.jpbook` itself never invalidates them. The `.jpbook`'s OWN name and location imply the
 * output path (mirroring the source tree): `volume01/index.jpbook` and `volume01.jpbook` both
 * build `volume01`, `part1/vol2.jpbook` builds `part1/vol2`. Metadata never affects the output
 * path.
 *
 * Syntax, naming and completion decisions only — never the filesystem: an `'ok'` line means
 * "a backslash-free relative `.jpnov` path"; the server (`src/server/jpbook.ts`) resolves it
 * through {@link resolveContained} and stats it before trusting it.
 */
import type { BuildChrome, FurnitureAlign } from '../compiler/chrome.ts';
import { FURNITURE_ALIGNS } from '../compiler/chrome.ts';
import { indentAnnotation } from '../ast/notation.ts';
import { scan } from '../ast/scan.ts';
import { displayText } from '../chars.ts';
import type { LocalizableMessage } from '../protocol.ts';

/** A column span within a single document line (`endChar` exclusive). */
export interface JpbookRange {
  readonly startChar: number;
  readonly endChar: number;
}

/**
 * Classification of one source line:
 * - `'blank'`     — empty or whitespace-only; skipped (no diagnostic, no link, not built).
 * - `'fence'`     — the `---` line that closes the metadata.
 * - `'meta'`      — a recognized, valid `key: value` metadata line.
 * - `'ok'`        — a syntactically valid `.jpnov` path (existence/containment unverified).
 * - `'duplicate'` — a valid path that repeats an earlier `'ok'` line; a Warning, not built.
 * - `'cover'`     — a bare `cover:` key line, opening the cover list.
 * - `'coverEntry'` — a `- ` cover path; a front page in the html build ({@link coverPathOf}).
 * - `'coverDuplicate'` — a cover path repeating an earlier one; a Warning, not built.
 * - `{ error }`   — a syntax problem (e.g. backslash, non-`.jpnov`, key-less metadata, an empty
 *                  `title`, a bad alignment) to surface as an Error; a book with any such line is not built
 *                  ({@link checkJpbook}). Its value is a {@link LocalizableMessage}.
 * - `{ warning }` — a tolerated metadata problem (unknown/duplicate key); the line is ignored
 *                  and the book still builds.
 */
export type JpbookLineKind =
  | 'blank'
  | 'fence'
  | 'meta'
  | 'ok'
  | 'duplicate'
  | 'cover'
  | 'coverEntry'
  | 'coverDuplicate'
  | { readonly error: LocalizableMessage }
  | { readonly warning: LocalizableMessage };

export interface ParsedLine {
  /** 0-based line number within the document (LSP line coordinate). */
  readonly line: number;
  /** Span of the trimmed content; zero-width (`{0,0}`) for blank lines. */
  readonly range: JpbookRange;
  /** The line text with any trailing `\r` removed (no line terminator). */
  readonly raw: string;
  /** The trimmed content (empty for blank lines). */
  readonly value: string;
  readonly kind: JpbookLineKind;
}

/** A chapter entry line — `duplicate` still counts (it renders, moves, and dedupes like `ok`). */
function isChapter(pl: ParsedLine): boolean {
  return pl.kind === 'ok' || pl.kind === 'duplicate';
}

/** A cover path line — `coverDuplicate` counts too (it links and rename-tracks). */
export function isCover(pl: ParsedLine): boolean {
  return pl.kind === 'coverEntry' || pl.kind === 'coverDuplicate';
}

/** The two editable entry lists of a book — the panel's sections and the `list` its verbs carry. */
const ENTRY_LISTS = ['chapters', 'covers'] as const;
export type EntryList = (typeof ENTRY_LISTS)[number];

/** The line predicate of one list: chapters = ok|duplicate, covers = coverEntry|coverDuplicate. */
export function isEntryOf(list: EntryList): (pl: ParsedLine) => boolean {
  return list === 'chapters' ? isChapter : isCover;
}

/** Narrows an untrusted value (a webview message field) to a list name. */
export function isEntryList(v: unknown): v is EntryList {
  return typeof v === 'string' && (ENTRY_LISTS as readonly string[]).includes(v);
}

/**
 * The recognized single-valued metadata keys, every one required; the page-furniture keys are
 * shared VERBATIM with {@link BuildChrome}'s field names. Adding a key: extend {@link JpbookMeta},
 * the book template (`create.ts`), handle it in the parser's key switch and — when it feeds the
 * render — in {@link composeBookChrome} for page furniture, or at the assembly seam
 * (`renderBook`/`concatBookText`) for BODY content like `divider`, which is never chrome.
 */
export const META_KEYS = ['title', 'author', 'header', 'headerAlign', 'footer', 'footerAlign', 'divider'] as const;
export type MetaKey = (typeof META_KEYS)[number];

/**
 * The format-version key, written first in every book file. A value other than
 * {@link JPBOOK_VERSION} is an Error. Not a {@link JpbookMeta} field.
 */
export const VERSION_KEY = 'version';
export const JPBOOK_VERSION = '1.0';

/** The keys every book file writes, in writing order: the version, then the metadata. */
export const REQUIRED_KEYS = [VERSION_KEY, ...META_KEYS] as const;
export type RequiredKey = (typeof REQUIRED_KEYS)[number];

/** The keys whose value is one of {@link FURNITURE_ALIGNS}: the parser checks it, completion and the panel offer it. */
export function isAlignKey(key: string): key is 'headerAlign' | 'footerAlign' {
  return key === 'headerAlign' || key === 'footerAlign';
}

/** The list-valued front-page key — parsed as line kinds, never a {@link JpbookMeta} field. */
export const COVER_KEY = 'cover';

/** Cover list-item markers; the `.jpbook` grammar derives its class from this (grammar-sync). */
export const COVER_ITEM_MARKS = ['-', '－'] as const;

/** True iff `ch` opens a cover list item. The ONE marker test — the completion router runs it
 *  at the cursor's path start, the parser at the head of a trimmed line. */
export function isCoverMark(ch: string): boolean {
  return (COVER_ITEM_MARKS as readonly string[]).includes(ch);
}

/** Every recognized key in writing order (unknown-key message, key completion, key insertion).
 *  `version` and `cover` stay out of {@link META_KEYS}: the panel's meta rows and `setMeta`
 *  edit the book's own metadata, one line per key. */
export const KNOWN_KEYS = [...REQUIRED_KEYS, COVER_KEY] as const;

/** The line that closes the metadata; the chapters follow it. */
export const FENCE = '---';

/** A metadata line as the panel and the template write it: `key: value`, or `key:` when empty. */
export function metaLine(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`;
}

/** The key portion of a metadata line's trimmed content, or null when key-less. */
export function metaKeyOf(value: string): string | null {
  const sep = colonIndex(value);
  const key = sep < 0 ? '' : value.slice(0, sep).trim();
  return key === '' ? null : key;
}

/** The path portion of an ITEM line's TRIMMED value and its offset within it; null otherwise. */
function coverShape(value: string): { readonly path: string; readonly offset: number } | null {
  if (!isCoverMark(value.charAt(0))) {
    return null;
  }
  let offset = 1;
  while (offset < value.length && isEdgeWhitespace(value.charAt(offset))) {
    offset += 1;
  }
  return { path: value.slice(offset), offset };
}

/**
 * A cover item's path and its absolute column span — the ONE slicing rule diagnostics,
 * document links and rename tracking share. Keyed on the line's KIND, never its shape: a
 * fence is item-shaped too (`---` slices to `--`).
 */
export function coverPathOf(pl: ParsedLine): { readonly value: string; readonly range: JpbookRange } | null {
  if (!isCover(pl)) {
    return null;
  }
  const shape = coverShape(pl.value);
  if (shape === null || shape.path === '') {
    return null;
  }
  const startChar = pl.range.startChar + shape.offset;
  return { value: shape.path, range: { startChar, endChar: startChar + shape.path.length } };
}

/** The path + span a chapter or cover line points at; null for every other line. */
export function entryPathOf(pl: ParsedLine): { readonly value: string; readonly range: JpbookRange } | null {
  return isChapter(pl) ? { value: pl.value, range: pl.range } : coverPathOf(pl);
}

/**
 * A book's metadata, field names = file keys, values as written. Every key is required: a
 * parse holds the keys its lines took ({@link ParsedJpbook.meta} is partial), and
 * {@link checkJpbook} hands the build the complete set or the error that stands in its way.
 * `title` is display metadata only and never affects the output path.
 */
export interface JpbookMeta {
  /** Never empty: the EPUB's dc:title and the panel's label (an empty line is an Error). */
  readonly title: string;
  /** ペンネーム — display metadata (the EPUB package's dc:creator); '' = no author. */
  readonly author: string;
  /** Header line, filled like `footer`; '' = no header. */
  readonly header: string;
  readonly headerAlign: FurnitureAlign;
  /**
   * Footer line: `.jpnov` notation whose ［＃ここに「…」の値を表示］ fields fill from the book and
   * the page ({@link BuildChrome.footer}); '' = no footer.
   */
  readonly footer: string;
  readonly footerAlign: FurnitureAlign;
  /**
   * Chapter-divider line inserted between chapters that do not open with a 見出し. A line of
   * `.jpnov` notation: a bare mark is centred at build time; a ［＃○字下げ］ prefix positions
   * it instead ({@link parseDividerValue}). '' = no divider.
   */
  readonly divider: string;
}

export interface ParsedJpbook {
  readonly lines: readonly ParsedLine[];
  /** The values the valid key lines hold; a key with no line, or with an Error line, is absent. */
  readonly meta: Partial<JpbookMeta>;
  /**
   * The `---` line that closes the metadata; null when none does, and the whole file is then
   * metadata ({@link metaEndOf}). Lines before it are metadata, lines after it chapters.
   */
  readonly fence: number | null;
  /** The required keys no line took, in writing order (a line in Error takes its key). */
  readonly missing: readonly RequiredKey[];
}

/** The line the metadata ends before: its closing fence, else the end of the file. */
export function metaEndOf(parsed: ParsedJpbook): number {
  return parsed.fence ?? parsed.lines.length;
}

/** ECMAScript whitespace (incl. the full-width ideographic space U+3000) trims line edges. */
function isEdgeWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/** The `key: value` separator: the first ASCII or full-width colon (IME slips are common). */
export function colonIndex(value: string): number {
  const half = value.indexOf(':');
  const full = value.indexOf('：');
  if (half < 0) {
    return full;
  }
  return full < 0 ? half : Math.min(half, full);
}

/** True iff `name` carries the manuscript extension, in any letter case (as the editor and the
 *  chapter picker match it). */
export function hasJpnovExt(name: string): boolean {
  return /\.jpnov$/i.test(name);
}

/** The segments of a relative path, either separator; `.` and empty ones (`a//b`, a trailing `/`) dropped. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter((seg) => seg !== '' && seg !== '.');
}

/**
 * The identity of an entry path: `./` and empty segments collapsed, NFC. `./a.jpnov` and
 * `a.jpnov` name one file, so they are one entry; the value as written stays what the line
 * shows and the build reads.
 */
export function entryIdentity(path: string): string {
  return pathSegments(path.normalize('NFC')).join('/');
}

/**
 * Parses raw `.jpbook` text into one {@link ParsedLine} per source line plus the collected
 * metadata. CRLF-safe; blank lines are skipped everywhere; interior whitespace is preserved (a
 * filename may contain spaces). Every line above the first `---` is metadata, and a line there
 * without a key is an Error. Duplicate keys keep the FIRST line (one in Error included: an empty `title:` or a bad
 * alignment takes its key and reports itself). A `cover` list survives blank lines and closes at
 * any other metadata line or the fence. Chapter and cover paths must be backslash-free `.jpnov`
 * (any letter case); later repeats of a path (by {@link entryIdentity}) are
 * `'duplicate'`/`'coverDuplicate'`, the two lists deduping independently. Never throws.
 */
export function parseJpbook(text: string): ParsedJpbook {
  const seen = new Set<string>();
  const seenCovers = new Set<string>();
  /** Records `path` in `seen` by its identity; true when it was there already. */
  const repeated = (seen: Set<string>, path: string): boolean => {
    const key = entryIdentity(path);
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
    return false;
  };
  // Keys a line already took, a line in Error included.
  const takenKeys = new Set<RequiredKey>();
  const lines: ParsedLine[] = [];
  const meta: { -readonly [K in keyof JpbookMeta]?: JpbookMeta[K] } = {};

  let state: 'meta' | 'body' = 'meta';
  let coverKeySeen = false;
  // 'muted' = a DUPLICATE bare `cover:`: its items warn instead of collecting, so a whole
  // second list cannot cascade into orphan-item Errors.
  let coverList: 'open' | 'muted' | null = null;

  // Rejections quote the WHOLE line: a sliced marker can leave a fence-lookalike (`----`).
  const coverPathKind = (path: string, line: string): JpbookLineKind => {
    if (path.includes('\\')) {
      return { error: { code: 'jpbook.backslashSeparator', args: [line] } };
    }
    if (!hasJpnovExt(path)) {
      return { error: { code: 'jpbook.notJpnov', args: [line] } };
    }
    return repeated(seenCovers, path) ? 'coverDuplicate' : 'coverEntry';
  };

  const coverItemKind = (value: string): JpbookLineKind => {
    if (coverList === null) {
      return { error: { code: 'jpbook.coverItemWithoutKey', args: [value] } };
    }
    if (coverList === 'muted') {
      return { warning: { code: 'jpbook.metaDuplicateKey', args: [COVER_KEY] } };
    }
    return coverPathKind(coverShape(value)?.path ?? '', value);
  };

  const metaKind = (value: string): JpbookLineKind => {
    coverList = null; // any key/value (or broken) metadata line ends an open cover list
    const key = metaKeyOf(value);
    if (key === null) {
      return { error: { code: 'jpbook.metaNotKeyValue', args: [value] } };
    }
    if (key === COVER_KEY) {
      // List-only: the grammar paints any `key: value` as a string and VS Code withholds
      // completion inside strings, so cover paths live on `- ` lines, like chapters.
      if (value.slice(colonIndex(value) + 1).trim() !== '') {
        return { error: { code: 'jpbook.coverNeedsList', args: [value] } };
      }
      if (coverKeySeen) {
        coverList = 'muted';
        return { warning: { code: 'jpbook.metaDuplicateKey', args: [key] } };
      }
      coverKeySeen = true;
      coverList = 'open';
      return 'cover';
    }
    if (key !== VERSION_KEY && !(META_KEYS as readonly string[]).includes(key)) {
      return { warning: { code: 'jpbook.metaUnknownKey', args: [key, KNOWN_KEYS.join(', ')] } };
    }
    const metaKey = key as RequiredKey;
    if (takenKeys.has(metaKey)) {
      return { warning: { code: 'jpbook.metaDuplicateKey', args: [key] } };
    }
    takenKeys.add(metaKey);
    // metaKeyOf returned a key, so the line has a colon: colonIndex is non-negative here.
    const val = value.slice(colonIndex(value) + 1).trim();
    if (metaKey === VERSION_KEY) {
      return val === JPBOOK_VERSION ? 'meta' : { error: { code: 'jpbook.versionUnsupported', args: [val, JPBOOK_VERSION] } };
    }
    if (isAlignKey(metaKey)) {
      if (!(FURNITURE_ALIGNS as readonly string[]).includes(val)) {
        return { error: { code: 'jpbook.metaBadEnum', args: [key, val, FURNITURE_ALIGNS.join(', ')] } };
      }
      meta[metaKey] = val as FurnitureAlign;
      return 'meta';
    }
    // Blank once the characters no output can carry are dropped.
    if (metaKey === 'title' && displayText(val).trim() === '') {
      return { error: { code: 'jpbook.metaEmptyValue', args: [key] } };
    }
    meta[metaKey] = val;
    return 'meta';
  };

  const bodyKind = (value: string): JpbookLineKind => {
    if (value.includes('\\')) {
      return { error: { code: 'jpbook.backslashSeparator', args: [value] } };
    }
    if (!hasJpnovExt(value)) {
      return { error: { code: 'jpbook.notJpnov', args: [value] } };
    }
    return repeated(seen, value) ? 'duplicate' : 'ok';
  };

  const rawLines = text.split('\n');
  let fence: number | null = null;
  for (let line = 0; line < rawLines.length; line += 1) {
    const rawLine = rawLines[line] ?? '';
    const content = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    let start = 0;
    while (start < content.length && isEdgeWhitespace(content.charAt(start))) {
      start += 1;
    }
    let end = content.length;
    while (end > start && isEdgeWhitespace(content.charAt(end - 1))) {
      end -= 1;
    }
    const value = content.slice(start, end);

    if (value === '') {
      lines.push({ line, range: { startChar: 0, endChar: 0 }, raw: content, value: '', kind: 'blank' });
      continue;
    }

    const range = { startChar: start, endChar: end };
    let kind: JpbookLineKind;
    if (state === 'body') {
      kind = bodyKind(value);
    } else if (value === FENCE) {
      state = 'body';
      fence = line;
      kind = 'fence';
    } else if (isCoverMark(value.charAt(0))) {
      kind = coverItemKind(value);
    } else {
      kind = metaKind(value);
    }
    lines.push({ line, range, raw: content, value, kind });
  }

  return { lines, meta, fence, missing: REQUIRED_KEYS.filter((key) => !takenKeys.has(key)) };
}

/** The keys written in the metadata (any kind of line), `line` excluded — what key completion leaves out. */
export function writtenKeysOf(parsed: ParsedJpbook, exceptLine = -1): Set<string> {
  const written = new Set<string>();
  for (const pl of parsed.lines.slice(0, metaEndOf(parsed))) {
    const key = pl.kind === 'blank' || pl.line === exceptLine ? null : metaKeyOf(pl.value);
    if (key !== null) {
      written.add(key);
    }
  }
  return written;
}

/** What a book parse amounts to: its complete metadata, or the one error that stops the build. */
export type JpbookVerdict =
  | { readonly ok: true; readonly meta: JpbookMeta }
  | { readonly ok: false; readonly error: LocalizableMessage };

/** An error about the metadata as a whole, placed on the line its diagnostic marks. */
export interface MetaError {
  readonly line: number;
  readonly range: JpbookRange;
  readonly error: LocalizableMessage;
}

/**
 * The one error the metadata as a whole has, or null: no closing fence (marked on the first
 * non-blank line; reported alone), else the missing keys (marked on the fence; at 0:0 in a
 * blank file).
 */
export function metaErrorOf(parsed: ParsedJpbook): MetaError | null {
  const first = parsed.lines.find((pl) => pl.kind !== 'blank');
  if (parsed.fence === null && first !== undefined) {
    return { line: first.line, range: first.range, error: { code: 'jpbook.metaUnterminated', args: [] } };
  }
  if (parsed.missing.length === 0) {
    return null;
  }
  const error = { code: 'jpbook.metaMissingKeys', args: [parsed.missing.join(', ')] } as const;
  const fence = parsed.fence === null ? undefined : parsed.lines[parsed.fence];
  return fence === undefined
    ? { line: 0, range: { startChar: 0, endChar: 0 }, error }
    : { line: fence.line, range: fence.range, error };
}

/**
 * The build's gate: the first error in document order — an `{ error }` line's, or the
 * metadata's own ({@link metaErrorOf}), which wins a tie — else the complete metadata.
 * Warnings and duplicates never count.
 */
export function checkJpbook(parsed: ParsedJpbook): JpbookVerdict {
  const metaError = metaErrorOf(parsed);
  for (const pl of parsed.lines) {
    if (metaError !== null && metaError.line <= pl.line) {
      return { ok: false, error: metaError.error };
    }
    if (typeof pl.kind === 'object' && 'error' in pl.kind) {
      return { ok: false, error: pl.kind.error };
    }
  }
  if (metaError !== null) {
    return { ok: false, error: metaError.error };
  }
  const { meta } = parsed;
  if (!isComplete(meta)) {
    return { ok: false, error: { code: 'jpbook.metaMissingKeys', args: [parsed.missing.join(', ')] } };
  }
  return { ok: true, meta };
}

function isComplete(meta: Partial<JpbookMeta>): meta is JpbookMeta {
  return META_KEYS.every((key) => meta[key] !== undefined);
}

/**
 * Composes one book's resolved {@link BuildChrome}: the proofing chrome (line numbers /
 * edge rules) comes from the workspace SETTINGS base, the page furniture (header / footer)
 * from the book's OWN metadata, as written. This is the single seam where "how I proof"
 * (settings) meets "what this book is" (`.jpbook`).
 */
export function composeBookChrome(
  base: Pick<BuildChrome, 'lineNumbers' | 'edgeLine'>,
  meta: Pick<JpbookMeta, 'header' | 'headerAlign' | 'footer' | 'footerAlign'>,
): BuildChrome {
  return {
    lineNumbers: base.lineNumbers,
    edgeLine: base.edgeLine,
    header: meta.header,
    headerAlign: meta.headerAlign,
    footer: meta.footer,
    footerAlign: meta.footerAlign,
  };
}

/** Suggested divider marks — the GUI QuickPick and the value completion share this list. */
export const DIVIDER_PRESETS = ['＊', '＊　＊　＊', '◇'] as const;

/** A `divider` VALUE split into its mark and position (`indent: null` = 天地中央揃え). */
export interface DividerValue {
  readonly mark: string;
  readonly indent: number | null;
}

/**
 * Splits a `divider` value into mark + position: a leading ［＃○字下げ］ (the
 * scanner's own classification, so the GUI and the render can never disagree) yields its
 * amount, a bare value yields `indent: null` = centred at build time. Flush-head is
 * deliberately not expressible — it exists in neither the print nor the web convention.
 * A 字下げ above INDENT_MAX is not an indent: it stays in the mark, and the `.jpbook` diagnostics
 * warn about it.
 */
export function parseDividerValue(value: string): DividerValue {
  const first = scan(value).lines[0]?.syntax[0];
  if (first?.kind === 'indent') {
    return { mark: value.slice(first.span.end), indent: first.amount };
  }
  return { mark: value, indent: null };
}

/**
 * The inverse of {@link parseDividerValue} for an `indent` up to INDENT_MAX; the 字下げ spelling
 * comes from the notation.
 */
export function composeDividerValue(mark: string, indent: number | null): string {
  return indent === null ? mark : indentAnnotation(indent) + mark;
}

/**
 * Derives the output RELATIVE PATH (stem, no extension) for a `.jpbook`, mirroring the
 * tree under the workspace folder root (POSIX `/`; backslashes tolerated as separators). The build
 * appends the format extension to it. Strips `.jpbook`; a basename of `index` collapses to its parent
 * directory when one exists (so `vol1/index.jpbook` and `vol1.jpbook` agree on `vol1`);
 * remaining segments join with `/`. A root-level `index.jpbook` has no parent, so it keeps
 * `index`.
 *
 * Two distinct book files that collide on this path are a BUILD-level error (detected by the
 * caller via the output-path map).
 */
export function jpbookOutRel(jpbookRel: string): string {
  const segments = pathSegments(jpbookRel);
  const last = (segments.pop() ?? '').replace(/\.jpbook$/i, '');
  if (!(last === 'index' && segments.length > 0)) {
    segments.push(last);
  }
  return segments.join('/');
}

/** A directory entry handed to {@link completeEntryLine} (the caller does the `readdir`). */
export interface CompletionEntry {
  readonly name: string;
  readonly isDir: boolean;
}

/** One completion proposal: `replace` is the segment span on the line to overwrite. */
export interface JpbookCompletion {
  readonly label: string;
  readonly insertText: string;
  readonly kind: 'file' | 'folder' | 'key' | 'value';
  readonly replace: JpbookRange;
}

/**
 * Computes file-path completions for a CHAPTER line, given `linePrefix` (line start up to
 * the cursor) and `entries` — the already-listed directory the caller resolved from the
 * prefix's directory portion. Pure and fs-free.
 *
 * Offers `.jpnov` files and subdirectories (the latter inserted with a trailing `/` to keep
 * drilling) whose name case-insensitively starts with the current segment (text after the
 * last `/`). Dotfiles and `.jpbook` files are hidden; on-disk casing is inserted; results
 * are capped. The "suppress when the whole line already names a file" rule is the CALLER's
 * concern (it needs fs) — not handled here.
 */
export function completeEntryLine(
  linePrefix: string,
  entries: readonly CompletionEntry[],
  cap = 500,
): JpbookCompletion[] {
  let pathStart = 0;
  while (pathStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(pathStart))) {
    pathStart += 1;
  }
  const lastSlash = linePrefix.lastIndexOf('/');
  const segStart = lastSlash >= pathStart ? lastSlash + 1 : pathStart;
  const seg = linePrefix.slice(segStart).toLowerCase();
  const replace = { startChar: segStart, endChar: linePrefix.length };

  return entries
    .filter((entry) => {
      const lower = entry.name.toLowerCase();
      return !entry.name.startsWith('.') &&
        !lower.endsWith('.jpbook') &&
        (entry.isDir || hasJpnovExt(entry.name)) &&
        lower.startsWith(seg);
    })
    .slice(0, cap)
    .map((entry) => ({
      label: entry.name,
      insertText: entry.isDir ? `${entry.name}/` : entry.name,
      kind: entry.isDir ? 'folder' : 'file',
      replace,
    }));
}

/**
 * Computes completions for a METADATA line: the keys not in `written` while the cursor is
 * before any colon (inserted as `key: `), and value proposals after it — the enum members for
 * `headerAlign` and `footerAlign`, the preset marks for `divider`. Both filter by
 * case-insensitive prefix. Pure and fs-free.
 */
export function completeMetaLine(linePrefix: string, written: ReadonlySet<string> = new Set()): JpbookCompletion[] {
  let keyStart = 0;
  while (keyStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(keyStart))) {
    keyStart += 1;
  }
  const sep = colonIndex(linePrefix);

  if (sep < 0) {
    const typed = linePrefix.slice(keyStart).toLowerCase();
    const replace = { startChar: keyStart, endChar: linePrefix.length };
    return KNOWN_KEYS.filter((k) => !written.has(k) && k.toLowerCase().startsWith(typed)).map((k) => ({
      label: k,
      insertText: `${k}: `,
      kind: 'key',
      replace,
    }));
  }

  const key = linePrefix.slice(keyStart, sep).trim();
  const values: readonly string[] | null =
    isAlignKey(key) ? FURNITURE_ALIGNS : key === 'divider' ? DIVIDER_PRESETS : null;
  if (values === null) {
    return [];
  }
  let valStart = sep + 1;
  while (valStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(valStart))) {
    valStart += 1;
  }
  const typed = linePrefix.slice(valStart).toLowerCase();
  const replace = { startChar: valStart, endChar: linePrefix.length };
  return values.filter((v) => v.toLowerCase().startsWith(typed)).map((v) => ({
    label: v,
    insertText: v,
    kind: 'value',
    replace,
  }));
}
