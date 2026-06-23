/**
 * Half-width-space detection for `.jpnov` prose. Pure, synchronous, and import-free, so it runs
 * directly on Node's native test loader (like the highlight recognizer) with no `#/` value imports.
 *
 * In Japanese vertical prose a half-width space (U+0020) is almost always a typo: paragraph
 * indentation should be a full-width space (U+3000, `　`), and a space inside a Japanese run is
 * unintended. Western names keep their ASCII spaces (e.g. "Arill Stains"), so an interior run is
 * flagged ONLY when sandwiched between two non-ASCII characters — a run touching ASCII on either
 * side, or sitting at a line edge, is left alone (intentional or ambiguous).
 *
 * The server (server.ts) maps each span to a `lint.halfWidthSpace` Warning diagnostic.
 */

/** A flagged half-width-space run on one line; `[startChar, endChar)` are UTF-16 column offsets. */
export interface ProseSpan {
  readonly line: number;
  readonly startChar: number;
  readonly endChar: number;
}

/** U+0020 — the ASCII space this scanner flags (as opposed to U+3000, the legitimate indent). */
const HALF_SPACE = ' ';

/** True for any non-ASCII code unit (kana, kanji, full-width punctuation, surrogate halves). */
function isNonAscii(ch: string): boolean {
  return ch.charCodeAt(0) > 0x7f;
}

/**
 * Finds the half-width-space runs worth flagging in `text`:
 * - a leading run at a line's start (indentation should be a full-width space), and
 * - an interior run sandwiched between two non-ASCII characters (a space inside Japanese text).
 *
 * A run that touches ASCII on either side (Western names, code) or a line edge is not flagged.
 */
export function findHalfWidthSpaces(text: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  for (const [line, raw] of text.split('\n').entries()) {
    const lt = raw.replace(/\r$/, '');
    const n = lt.length;

    // Leading indentation run: the whole run is one span (this is where `　` belongs).
    let i = 0;
    while (i < n && lt[i] === HALF_SPACE) {
      i++;
    }
    if (i > 0) {
      spans.push({ line, startChar: 0, endChar: i });
    }

    // Interior runs: flag only when both neighbours are non-ASCII.
    let j = i;
    while (j < n) {
      if (lt[j] !== HALF_SPACE) {
        j++;
        continue;
      }
      const runStart = j;
      while (j < n && lt[j] === HALF_SPACE) {
        j++;
      }
      const before = lt[runStart - 1];
      const after = lt[j];
      if (before !== undefined && after !== undefined && isNonAscii(before) && isNonAscii(after)) {
        spans.push({ line, startChar: runStart, endChar: j });
      }
    }
  }
  return spans;
}
