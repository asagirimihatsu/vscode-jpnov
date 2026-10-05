/**
 * Sentence segmentation over one line's {@link ProseView} — the engine-level boundary definition
 * shared by every sentence-based rule (sentenceLength, maxTen), so their reported positions can
 * never drift apart.
 *
 * A sentence ends at a run of terminators 。！？ (half-width !? and ‼⁇⁈⁉ included),
 * absorbing any closing brackets right after it, or at the end of the view (a line IS a paragraph;
 * nothing continues across a line break). The '\n' separator unit of a dialogue view is a hard
 * boundary. Leading whitespace is not part of a sentence; … and dashes do not terminate (a
 * trailing …… simply leaves the sentence open until the line ends).
 *
 * Relative imports only (native test loader); vscode-free.
 */
import type { ProseView } from './types.ts';

/** Half-open `[start, end)` index range into the view this sentence covers. */
interface SentenceSpan {
  readonly start: number;
  readonly end: number;
}

/** The ！？ marks that end a sentence: either width, and the characters that hold two of them. */
export const SENTENCE_MARKS = new Set(['！', '？', '!', '?', '‼', '⁇', '⁈', '⁉']);
/** What ends a sentence. Exported with {@link SENTENCE_MARKS} so format.ts derives its sets from
 *  the same marks. */
export const TERMINATORS = new Set(['。', ...SENTENCE_MARKS]);
/** Closers absorbed into the sentence right after its terminator run (〜。」 stays one sentence).
 *  Exported as THE closing-bracket set of the rule layer — format.ts derives its line-end and
 *  after-！？ sets from it, so the three closer sets can never drift apart again. */
export const CLOSERS = new Set(['」', '』', '）', ')', '】', '〉', '》', '］', '”', '’']);
const WHITESPACE = new Set([' ', '　', '\t', '\n']);

export function splitSentences(view: ProseView): readonly SentenceSpan[] {
  const text = view.text;
  const out: SentenceSpan[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && WHITESPACE.has(text.charAt(i))) {
      i += 1; // skip inter-sentence whitespace and the dialogue '\n' separator
    }
    if (i >= text.length) {
      break;
    }
    const start = i;
    while (i < text.length && text.charAt(i) !== '\n' && !TERMINATORS.has(text.charAt(i))) {
      i += 1;
    }
    while (i < text.length && TERMINATORS.has(text.charAt(i))) {
      i += 1; // the terminator run (！？, ？？ …) belongs to the sentence
    }
    while (i < text.length && CLOSERS.has(text.charAt(i))) {
      i += 1; // 〜。」 — the closer stays inside
    }
    out.push({ start, end: i });
  }
  return out;
}
