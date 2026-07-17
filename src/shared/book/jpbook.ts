/**
 * Pure, vscode-free parsing for the per-book `*.jpbook` manifest, plus the output-name
 * derivation, per-book chrome composition, and the fs-free completion logic.
 *
 * A `.jpbook` is plain text in two parts. An OPTIONAL front-matter block — opened by a
 * `---` on the first non-blank line and closed by a second `---` — holds `key: value`
 * metadata (the book's OWN properties: title and page furniture). Everything after it (or
 * the whole file when no block opens) is the chapter list: one relative `.jpnov` source
 * path per line, in reading order.
 *
 * The `.jpbook`'s OWN name and location imply the output path (mirroring the source
 * tree) — JS-module style: `volume01/index.jpbook` and `volume01.jpbook` both build
 * `volume01` (-> `volume01.txt` + `volume01.html`), and `part1/vol2.jpbook` builds
 * `part1/vol2`. Metadata never affects the output path.
 *
 * Split of concerns: this module does syntax/grammar, naming, and completion *decisions*
 * only. It never touches the filesystem — path containment and existence are resolved by the
 * server (`src/server/jpbook.ts`) where the manifest's directory URI and `node:fs` are
 * available. An `'ok'` line here means "a backslash-free relative `.jpnov` path"; the server
 * still resolves it through {@link resolveContained} and stats it before trusting it.
 */
import type { BuildChrome, PageNumberPosition } from '../compiler/chrome.ts';
import { PAGE_NUMBER_POSITIONS } from '../compiler/chrome.ts';
import { BUILD_CHROME_DEFAULT } from '../config/settings.ts';
import type { LocalizableMessage } from '../protocol.ts';

/** A column span within a single document line (`endChar` exclusive). */
export interface JpbookRange {
  readonly startChar: number;
  readonly endChar: number;
}

/**
 * Classification of one source line:
 * - `'blank'`     — empty or whitespace-only; skipped (no diagnostic, no link, not built).
 * - `'fence'`     — a front-matter `---` delimiter.
 * - `'meta'`      — a recognized, valid `key: value` front-matter line.
 * - `'ok'`        — a syntactically valid `.jpnov` path (existence/containment unverified).
 * - `'duplicate'` — a valid path that repeats an earlier `'ok'` line; a Warning, not built.
 * - `{ error }`   — a syntax problem (e.g. backslash, non-`.jpnov`, key-less metadata) to
 *                  surface as an Error. Its value is a {@link LocalizableMessage}.
 * - `{ warning }` — a tolerated metadata problem (unknown/duplicate key, bad enum value);
 *                  the line is ignored and the book still builds.
 */
export type JpbookLineKind =
  | 'blank'
  | 'fence'
  | 'meta'
  | 'ok'
  | 'duplicate'
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

/**
 * The recognized front-matter keys, in completion order, shared VERBATIM with
 * {@link BuildChrome}'s furniture field names. Adding a key: extend {@link JpbookMeta},
 * handle it in the parser's key switch and (when it feeds the render) in
 * {@link composeBookChrome}; the unknown-key message derives its list from here.
 */
export const META_KEYS = ['title', 'header', 'pageNumber', 'pageNumberFormat'] as const;
type MetaKey = (typeof META_KEYS)[number];

/**
 * Parsed front-matter values, field names = file keys. All optional — an absent key falls
 * back at composition time ({@link composeBookChrome} for the page furniture; `title` has
 * no fallback, it is display metadata only and never affects the output path).
 */
export interface JpbookMeta {
  readonly title?: string;
  readonly header?: string;
  readonly pageNumber?: PageNumberPosition;
  readonly pageNumberFormat?: string;
}

export interface ParsedJpbook {
  readonly lines: readonly ParsedLine[];
  readonly meta: JpbookMeta;
}

/** ECMAScript whitespace (incl. the full-width ideographic space U+3000) trims line edges. */
function isEdgeWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/** The `key: value` separator: the first ASCII or full-width colon (IME slips are common). */
function colonIndex(value: string): number {
  const half = value.indexOf(':');
  const full = value.indexOf('：');
  if (half < 0) {
    return full;
  }
  return full < 0 ? half : Math.min(half, full);
}

const FENCE = '---';

/**
 * Parses raw `.jpbook` text into one {@link ParsedLine} per source line plus the collected
 * {@link JpbookMeta}. CRLF-safe; blank lines are skipped everywhere; interior whitespace is
 * preserved (a filename may contain spaces). Front matter opens ONLY on the first non-blank
 * line; inside it, duplicate keys keep the FIRST value, and an unclosed block turns the
 * opening fence into an Error (the remaining lines still parse as metadata). Chapter lines
 * must be backslash-free `.jpnov` paths; later exact repeats of an earlier valid path are
 * marked `'duplicate'`. Never throws.
 */
export function parseJpbook(text: string): ParsedJpbook {
  const seen = new Set<string>();
  const lines: ParsedLine[] = [];
  const meta: { -readonly [K in keyof JpbookMeta]: JpbookMeta[K] } = {};

  // 'start' until the first non-blank line; 'meta' inside an open front-matter block.
  let state: 'start' | 'meta' | 'body' = 'start';
  let openFence = -1;

  const metaKind = (value: string): JpbookLineKind => {
    const sep = colonIndex(value);
    const key = sep < 0 ? '' : value.slice(0, sep).trim();
    if (key === '') {
      return { error: { code: 'jpbook.metaNotKeyValue', args: [value] } };
    }
    if (!(META_KEYS as readonly string[]).includes(key)) {
      return { warning: { code: 'jpbook.metaUnknownKey', args: [key, META_KEYS.join(', ')] } };
    }
    const metaKey = key as MetaKey;
    if (meta[metaKey] !== undefined) {
      return { warning: { code: 'jpbook.metaDuplicateKey', args: [key] } };
    }
    const val = value.slice(sep + 1).trim();
    if (metaKey === 'pageNumber') {
      if (!(PAGE_NUMBER_POSITIONS as readonly string[]).includes(val)) {
        return {
          warning: { code: 'jpbook.metaBadEnum', args: [key, val, PAGE_NUMBER_POSITIONS.join(', ')] },
        };
      }
      meta.pageNumber = val as PageNumberPosition;
    } else {
      meta[metaKey] = val;
    }
    return 'meta';
  };

  const bodyKind = (value: string): JpbookLineKind => {
    if (value.includes('\\')) {
      return { error: { code: 'jpbook.backslashSeparator', args: [value] } };
    }
    if (!value.endsWith('.jpnov')) {
      return { error: { code: 'jpbook.notJpnov', args: [value] } };
    }
    if (seen.has(value)) {
      return 'duplicate';
    }
    seen.add(value);
    return 'ok';
  };

  const rawLines = text.split('\n');
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
    if (state === 'start' && value === FENCE) {
      state = 'meta';
      openFence = line;
      kind = 'fence';
    } else if (state === 'meta') {
      if (value === FENCE) {
        state = 'body';
        kind = 'fence';
      } else {
        kind = metaKind(value);
      }
    } else {
      state = 'body';
      kind = bodyKind(value);
    }
    lines.push({ line, range, raw: content, value, kind });
  }

  if (state === 'meta') {
    const fence = lines[openFence];
    if (fence !== undefined) {
      lines[openFence] = { ...fence, kind: { error: { code: 'jpbook.metaUnterminated', args: [] } } };
    }
  }

  return { lines, meta };
}

/**
 * The front-matter region of a parse as fence line numbers — `close` is `null` when the
 * block is unterminated (it then extends to EOF) — or `null` when no block opens. Lines
 * strictly BETWEEN the fences are metadata territory; the completion router keys off this.
 */
export function metaRegionOf(
  lines: readonly ParsedLine[],
): { readonly open: number; readonly close: number | null } | null {
  const first = lines.find((pl) => pl.kind !== 'blank');
  if (first === undefined) {
    return null;
  }
  if (typeof first.kind === 'object' && 'error' in first.kind && first.kind.error.code === 'jpbook.metaUnterminated') {
    return { open: first.line, close: null };
  }
  if (first.kind !== 'fence') {
    return null;
  }
  const close = lines.find((pl) => pl.kind === 'fence' && pl.line > first.line);
  return { open: first.line, close: close?.line ?? null };
}

/**
 * Composes one book's resolved {@link BuildChrome}: the proofing chrome (line numbers /
 * edge rules) comes from the workspace SETTINGS base, the page furniture (柱/ノンブル)
 * from the book's OWN front matter, defaults filling any absent key. This is the single
 * seam where "how I proof" (settings) meets "what this book is" (`.jpbook`).
 */
export function composeBookChrome(
  base: Pick<BuildChrome, 'lineNumbers' | 'edgeLine'>,
  meta: JpbookMeta,
): BuildChrome {
  return {
    lineNumbers: base.lineNumbers,
    edgeLine: base.edgeLine,
    pageNumber: meta.pageNumber ?? BUILD_CHROME_DEFAULT.pageNumber,
    pageNumberFormat: meta.pageNumberFormat ?? BUILD_CHROME_DEFAULT.pageNumberFormat,
    header: meta.header ?? BUILD_CHROME_DEFAULT.header,
  };
}

/**
 * Derives the output RELATIVE PATH (stem, no extension) for a `.jpbook`, mirroring the
 * tree under the workspace folder root (POSIX `/`; backslashes tolerated as separators). The build appends
 * `.txt` and `.html` to it. Strips `.jpbook`; a basename of `index` collapses to its parent
 * directory when one exists (so `vol1/index.jpbook` and `vol1.jpbook` agree on `vol1`);
 * remaining segments join with `/`. A root-level `index.jpbook` has no parent, so it keeps
 * `index`.
 *
 * Two distinct book files that collide on this path are a BUILD-level error (detected by the
 * caller via the output-path map).
 */
export function jpbookOutRel(jpbookRel: string): string {
  const segments = jpbookRel.split(/[\\/]+/).filter((seg) => seg !== '' && seg !== '.');
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

  const out: JpbookCompletion[] = [];
  for (const entry of entries) {
    if (out.length >= cap) {
      break;
    }
    const lower = entry.name.toLowerCase();
    if (entry.name.startsWith('.') || lower.endsWith('.jpbook')) {
      continue;
    }
    if (!entry.isDir && !lower.endsWith('.jpnov')) {
      continue;
    }
    if (!lower.startsWith(seg)) {
      continue;
    }
    out.push({
      label: entry.name,
      insertText: entry.isDir ? `${entry.name}/` : entry.name,
      kind: entry.isDir ? 'folder' : 'file',
      replace,
    });
  }
  return out;
}

/**
 * Computes completions for a FRONT-MATTER line: metadata keys while the cursor is before
 * any colon (inserted as `key: `), and the enum members when the line's key is
 * `pageNumber` and the cursor sits after the colon. Both filter by case-insensitive
 * prefix. Pure and fs-free.
 */
export function completeMetaLine(linePrefix: string): JpbookCompletion[] {
  let keyStart = 0;
  while (keyStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(keyStart))) {
    keyStart += 1;
  }
  const sep = colonIndex(linePrefix);

  if (sep < 0) {
    const typed = linePrefix.slice(keyStart).toLowerCase();
    const replace = { startChar: keyStart, endChar: linePrefix.length };
    return META_KEYS.filter((k) => k.toLowerCase().startsWith(typed)).map((k) => ({
      label: k,
      insertText: `${k}: `,
      kind: 'key',
      replace,
    }));
  }

  const key = linePrefix.slice(keyStart, sep).trim();
  if (key !== 'pageNumber') {
    return [];
  }
  let valStart = sep + 1;
  while (valStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(valStart))) {
    valStart += 1;
  }
  const typed = linePrefix.slice(valStart).toLowerCase();
  const replace = { startChar: valStart, endChar: linePrefix.length };
  return PAGE_NUMBER_POSITIONS.filter((v) => v.toLowerCase().startsWith(typed)).map((v) => ({
    label: v,
    insertText: v,
    kind: 'value',
    replace,
  }));
}
