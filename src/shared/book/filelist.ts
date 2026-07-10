/**
 * Pure, vscode-free parsing for the per-book `*.filelist` manifest, plus the output-name
 * derivation and the fs-free file-path completion logic.
 *
 * A `.filelist` is plain text: one relative `.jpnov` source path per line, in reading order.
 * Unlike the former `book.json` (a JSON index whose *folder* implied the output name), a
 * `.filelist`'s OWN name and location imply the output path (mirroring the source tree) —
 * JS-module style: `volume01/index.filelist` and `volume01.filelist` both build `volume01`
 * (-> `volume01.txt` + `volume01.html`), and `part1/vol2.filelist` builds `part1/vol2`.
 *
 * Split of concerns: this module does syntax/grammar, naming, and completion *decisions*
 * only. It never touches the filesystem — path containment and existence are resolved by the
 * server (`src/server/filelist.ts`) where the filelist's directory URI and `node:fs` are
 * available. An `'ok'` line here means "a backslash-free relative `.jpnov` path"; the server
 * still resolves it through {@link resolveContained} and stats it before trusting it.
 */
import type { LocalizableMessage } from '#/shared/protocol.ts';

/** A column span within a single document line (`endChar` exclusive). */
export interface FilelistRange {
  readonly startChar: number;
  readonly endChar: number;
}

/**
 * Classification of one source line:
 * - `'blank'`     — empty or whitespace-only; skipped (no diagnostic, no link, not built).
 * - `'ok'`        — a syntactically valid `.jpnov` path (existence/containment unverified).
 * - `'duplicate'` — a valid path that repeats an earlier `'ok'` line; a Warning, not built.
 * - `{ error }`   — a syntax problem (e.g. backslash, non-`.jpnov`) to surface as an Error.
 *                  Its value is a {@link LocalizableMessage} the server renders/diagnoses.
 */
export type FilelistLineKind =
  | 'blank'
  | 'ok'
  | 'duplicate'
  | { readonly error: LocalizableMessage };

export interface ParsedLine {
  /** 0-based line number within the document (LSP line coordinate). */
  readonly line: number;
  /** Span of the trimmed path content; zero-width (`{0,0}`) for blank lines. */
  readonly range: FilelistRange;
  /** The line text with any trailing `\r` removed (no line terminator). */
  readonly raw: string;
  /** The trimmed path (empty for blank lines). */
  readonly value: string;
  readonly kind: FilelistLineKind;
}

/** ECMAScript whitespace (incl. the full-width ideographic space U+3000) trims line edges. */
function isEdgeWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Parses raw `.filelist` text into one {@link ParsedLine} per source line. CRLF-safe; blank
 * lines are skipped; interior whitespace is preserved (a filename may contain spaces). Each
 * non-blank line must be a backslash-free `.jpnov` path; later exact repeats of an earlier
 * valid path are marked `'duplicate'`. Never throws.
 */
export function parseFilelist(text: string): ParsedLine[] {
  const seen = new Set<string>();
  const lines: ParsedLine[] = [];

  text.split('\n').forEach((rawLine, line) => {
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
      return;
    }

    const range = { startChar: start, endChar: end };
    let kind: FilelistLineKind;
    if (value.includes('\\')) {
      kind = { error: { code: 'filelist.backslashSeparator', args: [value] } };
    } else if (!value.endsWith('.jpnov')) {
      kind = { error: { code: 'filelist.notJpnov', args: [value] } };
    } else if (seen.has(value)) {
      kind = 'duplicate';
    } else {
      seen.add(value);
      kind = 'ok';
    }
    lines.push({ line, range, raw: content, value, kind });
  });

  return lines;
}

/**
 * Derives the output RELATIVE PATH (stem, no extension) for a `.filelist`, mirroring the
 * tree under the workspace folder root (POSIX `/`; backslashes tolerated as separators). The build appends
 * `.txt` and `.html` to it. Strips `.filelist`; a basename of `index` collapses to its parent
 * directory when one exists (so `vol1/index.filelist` and `vol1.filelist` agree on `vol1`);
 * remaining segments join with `/`. A root-level `index.filelist` has no parent, so it keeps
 * `index`.
 *
 * Two distinct filelists that collide on this path are a BUILD-level error (detected by the
 * caller via the output-path map).
 */
export function filelistOutRel(filelistRel: string): string {
  const segments = filelistRel.split(/[\\/]+/).filter((seg) => seg !== '' && seg !== '.');
  const last = (segments.pop() ?? '').replace(/\.filelist$/i, '');
  if (!(last === 'index' && segments.length > 0)) {
    segments.push(last);
  }
  return segments.join('/');
}

/** A directory entry handed to {@link completeFilelistLine} (the caller does the `readdir`). */
export interface CompletionEntry {
  readonly name: string;
  readonly isDir: boolean;
}

/** One completion proposal: `replace` is the segment span on the line to overwrite. */
export interface FilelistCompletion {
  readonly label: string;
  readonly insertText: string;
  readonly kind: 'file' | 'folder';
  readonly replace: FilelistRange;
}

/**
 * Computes file-path completions for the current line, given `linePrefix` (line start up to
 * the cursor) and `entries` — the already-listed directory the caller resolved from the
 * prefix's directory portion. Pure and fs-free.
 *
 * Offers `.jpnov` files and subdirectories (the latter inserted with a trailing `/` to keep
 * drilling) whose name case-insensitively starts with the current segment (text after the
 * last `/`). Dotfiles and `.filelist` files are hidden; on-disk casing is inserted; results
 * are capped. The "suppress when the whole line already names a file" rule is the CALLER's
 * concern (it needs fs) — not handled here.
 */
export function completeFilelistLine(
  linePrefix: string,
  entries: readonly CompletionEntry[],
  cap = 500,
): FilelistCompletion[] {
  let pathStart = 0;
  while (pathStart < linePrefix.length && isEdgeWhitespace(linePrefix.charAt(pathStart))) {
    pathStart += 1;
  }
  const lastSlash = linePrefix.lastIndexOf('/');
  const segStart = lastSlash >= pathStart ? lastSlash + 1 : pathStart;
  const seg = linePrefix.slice(segStart).toLowerCase();
  const replace = { startChar: segStart, endChar: linePrefix.length };

  const out: FilelistCompletion[] = [];
  for (const entry of entries) {
    if (out.length >= cap) {
      break;
    }
    const lower = entry.name.toLowerCase();
    if (entry.name.startsWith('.') || lower.endsWith('.filelist')) {
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
