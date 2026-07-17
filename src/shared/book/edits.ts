/**
 * Pure edit planners for the Books panel's tree-as-form editing: each returns LSP-style
 * range replacements against the CURRENT `.jpbook` text, which the client applies as one
 * `WorkspaceEdit` (text stays the single source of truth — the panel and code mode can
 * never disagree). Metadata is UPSERT-ONLY by design: an existing key is edited in place
 * (its line never moves), an absent key is appended, and nothing here ever deletes or
 * reorders a metadata line — authors who care about metadata layout use code mode.
 */
import {
  META_KEYS,
  metaKeyOf,
  metaRegionOf,
  parseJpbook,
  type MetaKey,
  type ParsedLine,
} from './jpbook.ts';

/** One replacement (LSP coordinates; `end` exclusive; insertion = zero-width range). */
export interface TextReplace {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
  readonly newText: string;
}

/** The document's newline flavour, so inserted lines never mix EOLs into a CRLF file. */
function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function at(line: number, character: number): { line: number; character: number } {
  return { line, character };
}

/** Single-line values only: a pasted newline would break the line-per-entry grammar. */
function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Sets `key` to `value` (canonical `key: value` form). The FIRST occurrence of the key —
 * the one the parser lets win — is rewritten in place; an absent key is appended at the
 * end of the front matter, and a missing block is created at the very top. Never deletes:
 * writing a default (or empty) value keeps the line.
 */
export function upsertMeta(text: string, key: MetaKey, value: string): TextReplace {
  const parsed = parseJpbook(text);
  const eol = eolOf(text);
  const clean = sanitizeValue(value);
  const entry = clean === '' ? `${key}:` : `${key}: ${clean}`;

  for (const pl of parsed.lines) {
    if (pl.kind === 'meta' && metaKeyOf(pl.value) === key) {
      return { start: at(pl.line, pl.range.startChar), end: at(pl.line, pl.range.endChar), newText: entry };
    }
  }

  const region = metaRegionOf(parsed.lines);
  if (region === null) {
    // No front matter: create the block above everything (the fence must be the first
    // non-blank line, and line 0 always satisfies that).
    return { start: at(0, 0), end: at(0, 0), newText: `---${eol}${entry}${eol}---${eol}` };
  }
  if (region.close !== null) {
    return { start: at(region.close, 0), end: at(region.close, 0), newText: `${entry}${eol}` };
  }
  // Unterminated block (an Error state): everything below the fence is already metadata
  // territory, so appending at the end of the document stays inside it.
  const last = parsed.lines[parsed.lines.length - 1];
  if (last === undefined || last.raw === '') {
    const line = last?.line ?? 0;
    return { start: at(line, 0), end: at(line, 0), newText: `${entry}${eol}` };
  }
  return { start: at(last.line, last.raw.length), end: at(last.line, last.raw.length), newText: `${eol}${entry}` };
}

/**
 * Appends chapters (root-relative paths) at the end of the document, skipping any already
 * listed (a GUI add must not manufacture `duplicate` warnings). Null when nothing new.
 */
export function appendChapters(text: string, rels: readonly string[]): TextReplace | null {
  const parsed = parseJpbook(text);
  const eol = eolOf(text);
  const listed = new Set(
    parsed.lines.filter((pl) => pl.kind === 'ok' || pl.kind === 'duplicate').map((pl) => pl.value),
  );
  const fresh = rels.filter((rel) => !listed.has(rel));
  if (fresh.length === 0) {
    return null;
  }

  const last = parsed.lines[parsed.lines.length - 1];
  const block = fresh.join(eol);
  if (last === undefined || last.raw === '') {
    // Empty document, or one already ending in a newline (the split leaves a '' line).
    const line = last?.line ?? 0;
    return { start: at(line, 0), end: at(line, 0), newText: `${block}${eol}` };
  }
  return { start: at(last.line, last.raw.length), end: at(last.line, last.raw.length), newText: `${eol}${block}` };
}

/** The chapter (`ok`/`duplicate`) line at `line`, or null — the guard every mover uses. */
function chapterAt(lines: readonly ParsedLine[], line: number): ParsedLine | null {
  const pl = lines[line];
  return pl !== undefined && (pl.kind === 'ok' || pl.kind === 'duplicate') ? pl : null;
}

/**
 * Deletes the chapter line entirely (the file itself is untouched). The trailing newline
 * goes with it; deleting the document's last line swallows the PRECEDING newline instead,
 * so no blank tail accumulates. Null when `line` is not a chapter.
 */
export function removeChapter(text: string, line: number): TextReplace | null {
  const parsed = parseJpbook(text);
  const pl = chapterAt(parsed.lines, line);
  if (pl === null) {
    return null;
  }
  if (line + 1 < parsed.lines.length) {
    return { start: at(line, 0), end: at(line + 1, 0), newText: '' };
  }
  const prev = parsed.lines[line - 1];
  const startPos = prev === undefined ? at(line, 0) : at(prev.line, prev.raw.length);
  return { start: startPos, end: at(line, pl.raw.length), newText: '' };
}

/**
 * Moves the chapter at `fromLine` to sit BEFORE the chapter at `beforeLine` (`null` =
 * after the last chapter). Planned as delete + insert against the ORIGINAL text — the
 * ranges never overlap, so they apply as one `WorkspaceEdit`. Blank lines and metadata
 * stay where they are; only the chapter line travels. Null when the move is a no-op or
 * either line is not a chapter.
 */
export function moveChapterTo(
  text: string,
  fromLine: number,
  beforeLine: number | null,
): TextReplace[] | null {
  const parsed = parseJpbook(text);
  const eol = eolOf(text);
  const from = chapterAt(parsed.lines, fromLine);
  if (from === null) {
    return null;
  }

  const removal = removeChapter(text, fromLine);
  if (removal === null) {
    return null;
  }

  if (beforeLine !== null) {
    const target = chapterAt(parsed.lines, beforeLine);
    if (target === null || beforeLine === fromLine || beforeLine === fromLine + 1) {
      return null; // not a chapter, or already in place
    }
    return [removal, { start: at(beforeLine, 0), end: at(beforeLine, 0), newText: `${from.raw}${eol}` }];
  }

  const chapters = parsed.lines.filter((pl) => pl.kind === 'ok' || pl.kind === 'duplicate');
  const last = chapters[chapters.length - 1];
  if (last === undefined || last.line === fromLine) {
    return null; // already the last chapter
  }
  return [removal, { start: at(last.line, last.raw.length), end: at(last.line, last.raw.length), newText: `${eol}${from.raw}` }];
}

/** The chapter line numbers in document order — the panel's row → line mapping. */
export function chapterLines(lines: readonly ParsedLine[]): number[] {
  return lines.filter((pl) => pl.kind === 'ok' || pl.kind === 'duplicate').map((pl) => pl.line);
}

/** Fixed display order + current values for the panel's metadata rows (absent = undefined). */
export function metaRows(text: string): { key: MetaKey; value: string | undefined }[] {
  const meta = parseJpbook(text).meta;
  return META_KEYS.map((key) => ({ key, value: meta[key] }));
}
