/**
 * Chunk boundaries for the kernel lint pass. `sentence-splitter` (inside sentence-length and
 * no-unmatched-pair) is O(n²) in the TEXT PASSED PER CALL, so `lintStream` feeds it bounded
 * chunks instead of the whole stream — turning a 30s+ whole-document lint into linear work
 * (measured 46× on a 400KB chapter) with findings identical by construction.
 *
 * Why these seams are safe: sentence-splitter does NOT end a sentence at a bare newline (a
 * sentence continues across `\n`, including inside （…） pairs); only 。！？ (and their ASCII
 * kin) or a blank line end one. Both quadratic rules operate per-Sentence. So a chunk boundary
 * placed just after a newline whose preceding character is a sentence terminator — or after a
 * blank line — can never split a sentence, and per-sentence findings cannot differ from an
 * unchunked run. Per-char/run rules cannot cross a newline, and the line-based rule
 * (general-novel-style-ja) still sees every chunk starting at a line head.
 *
 * The only divergence window is the FORCED seam: a single "sentence" longer than `max` with no
 * terminator before a newline forces a commit at the first newline at or past `max` (soft cap),
 * which may split that pathological sentence. Real Japanese prose never produces it; the cap
 * exists so adversarial input stays O(max²) per chunk instead of O(n²).
 *
 * Relative imports only (native test loader; see streams.ts). Pure — no vscode, no I/O.
 */

/** Sentence terminators sentence-splitter breaks after (full-width and ASCII). */
const SENTENCE_END = new Set(['。', '！', '？', '.', '!', '?']);

const NEWLINE = 0x0a; // \n

/** Preferred chunk size (UTF-16 units): big enough to amortize kernel overhead, small enough
 *  that one chunk's quadratic pass stays a few ms. */
const CHUNK_TARGET = 3000;
/** Hard-ish upper bound: past this, commit at the next newline even mid-sentence (see header). */
const CHUNK_MAX = 16000;

/**
 * Splits `[0, text.length)` into half-open ranges that tile the text exactly, each ending just
 * after a newline (except the final range, which ends at EOF). A range only closes at a SAFE
 * seam (sentence terminator or blank line before the newline, CRLF-aware) once it has reached
 * `target` — or at any newline once it has reached `max` (the forced seam).
 */
export function chunkRanges(
  text: string,
  target: number = CHUNK_TARGET,
  max: number = CHUNK_MAX,
): readonly (readonly [number, number])[] {
  if (text.length <= target) {
    return [[0, text.length]];
  }
  const ranges: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== NEWLINE) {
      continue;
    }
    const size = i + 1 - start;
    if (size < target) {
      continue;
    }
    // The character the line actually ends with, looking through a CR of a CRLF pair.
    const p = i > 0 && text.charAt(i - 1) === '\r' ? i - 1 : i;
    const prev = p > 0 ? text.charAt(p - 1) : '';
    const safe = p === 0 || prev === '\n' || SENTENCE_END.has(prev);
    if (safe || size >= max) {
      ranges.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < text.length) {
    ranges.push([start, text.length]);
  }
  return ranges;
}
