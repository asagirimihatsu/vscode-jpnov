/**
 * Stream separation + source-offset mapping — the one place `.jpnov` source is split into the three
 * CLEAN prose streams the lint kernel runs on, and the one place lint hits map back to source.
 *
 * A single walk over `tokenize(src)` (the same token stream the highlighter uses) produces:
 *   - narration: the source with each TOP-LEVEL 「…」/『…』 interior collapsed to a single 〇 (U+3007)
 *       placeholder — the corners stay IN PLACE and newlines are preserved, so line-head rules and
 *       である/ですます keep working and a quote never shifts the following 地の文 onto a new "line".
 *       Ruby is collapsed to its base (｜巳一《みはつ》 -> 巳一); annotations (［＃…］, 傍点) contribute no
 *       text, so inline-emphasised prose stays contiguous.
 *   - dialogue: every top-level dialogue interior, joined by '\n'. The newline keeps each utterance
 *       independent for sentence-/run-based rules while costing ONE kernel pass for the whole stream.
 *   - ruby: every 《reading》, joined by '\n' (same independence trick).
 *
 * The dialogue STACK is driven from prose characters exactly as in semanticTokens.ts, so Aozora's
 * ［＃「対象」に傍点］ (whose 「対象」 lives inside an annotation token, never a text token) cannot be
 * mistaken for a quote. All offsets are tracked per UTF-16 unit (astral chars occupy two units with
 * consecutive offsets), matching `TextDocument.positionAt`.
 *
 * Relative import (not `#/…`) on purpose: this runs on Node's native test loader, which rejects `#/`.
 */
import type { Range } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { tokenize } from '../../shared/compiler/tokenizer.ts';

/**
 * One clean text run plus its back-map. `srcMap` has length `text.length`: `srcMap[k]` is the
 * absolute source UTF-16 offset that `text[k]` came from. A hit `[start, end)` maps to the source
 * span from the START of `text[start]` to the END of `text[end - 1]` (`srcMap[end-1] + 1`, since each
 * UTF-16 unit is one source unit wide) — anchoring on the last INCLUDED character keeps a hit that
 * ends at a removed-markup boundary (ruby / collapsed dialogue) from bleeding across the gap.
 */
export interface Stream {
  readonly text: string;
  readonly srcMap: readonly number[];
}

/** The three lint streams of a document. */
export interface Streams {
  readonly narration: Stream;
  readonly dialogue: Stream;
  readonly ruby: Stream;
}

/** The narration placeholder for a collapsed dialogue interior. U+3007 〇 is classified as neither
 *  kanji nor kana (see tokenizer.ts `isKanji`), so it cannot be miswalked as a ruby base nor trip a
 *  width/kanji/space rule. */
const PLACEHOLDER = '〇';

/** Grows one stream's `text` + `srcMap` in lockstep; flushable into a '\n'-joined parent stream. */
class Buf {
  text = '';
  readonly src: number[] = [];

  push(ch: string, at: number): void {
    this.text += ch;
    this.src.push(at);
  }

  /** Append `other` after a '\n' separator (mapped just past the previous unit); clears `other`. */
  joinFrom(other: Buf): void {
    if (other.text === '') {
      return;
    }
    if (this.text !== '') {
      this.text += '\n';
      this.src.push((this.src[this.src.length - 1] ?? -1) + 1);
    }
    for (let k = 0; k < other.text.length; k++) {
      this.text += other.text.charAt(k);
      this.src.push(other.src[k] ?? 0);
    }
    other.text = '';
    other.src.length = 0;
  }

  /** Freeze into a {@link Stream} (one source offset per UTF-16 unit of `text`). */
  freeze(): Stream {
    return { text: this.text, srcMap: [...this.src] };
  }
}

export function extractStreams(src: string): Streams {
  const narration = new Buf();
  const dialogue = new Buf();
  const ruby = new Buf();

  // Dialogue nesting, by expected closer. Only the TOP-LEVEL span is collapsed in narration; nested
  // corners are literal characters of the utterance.
  const stack: ('」' | '』')[] = [];
  // The current top-level utterance being accumulated (flushed into `dialogue` when it closes).
  const utterance = new Buf();
  let placeheld = false; // has the single 〇 for the current top-level interior been emitted yet?

  /** Route one interior character to the utterance, emitting narration's single 〇 on the first one. */
  const toUtterance = (ch: string, at: number): void => {
    if (!placeheld) {
      narration.push(PLACEHOLDER, at);
      placeheld = true;
    }
    utterance.push(ch, at);
  };

  /** Append prose text [srcStart, …) — text-token text or a ruby base — honouring the dialogue stack. */
  const appendProse = (text: string, srcStart: number): void => {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      const at = srcStart + i;
      const opener = ch === '「' || ch === '『' ? ch : undefined;
      if (opener !== undefined) {
        const closer = opener === '「' ? '」' : '』';
        if (stack.length === 0) {
          narration.push(ch, at); // top-level opening corner kept in place
          placeheld = false; // a fresh interior begins; its 〇 is emitted lazily
        } else {
          toUtterance(ch, at); // nested corner is part of the utterance
        }
        stack.push(closer);
        continue;
      }
      if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          narration.push(ch, at); // top-level closing corner kept in place
          dialogue.joinFrom(utterance); // emit the finished utterance
        } else {
          toUtterance(ch, at); // nested closer is part of the utterance
        }
        continue;
      }
      if (stack.length === 0) {
        narration.push(ch, at);
      } else {
        toUtterance(ch, at);
      }
    }
  };

  let offset = 0; // source UTF-16 offset of the current token's `raw`
  for (const token of tokenize(src)) {
    switch (token.kind) {
      case 'text':
        appendProse(token.text, offset);
        break;
      case 'rubyExplicit':
        // raw = ｜ base 《 reading 》 — base flows into prose at offset+1; reading -> ruby stream.
        appendProse(token.base, offset + 1);
        ruby.joinFrom(readingBuf(token.reading, offset + 1 + token.base.length + 1));
        break;
      case 'rubyImplicit':
        // raw = base 《 reading 》 — base at offset; reading after 《.
        appendProse(token.base, offset);
        ruby.joinFrom(readingBuf(token.reading, offset + token.base.length + 1));
        break;
      // pageBreak / emphasis* / comment contribute no prose; they only advance `offset`.
    }
    offset += token.raw.length;
  }

  // EOF: flush any still-open utterance so its text is still linted (an unmatched 「 leaves narration
  // as 「〇 — the no-unmatched-pair rule, run on the narration stream, is what flags that).
  dialogue.joinFrom(utterance);

  return {
    narration: narration.freeze(),
    dialogue: dialogue.freeze(),
    ruby: ruby.freeze(),
  };
}

/** A one-shot {@link Buf} holding a ruby reading, ready to be '\n'-joined into the ruby stream. */
function readingBuf(reading: string, srcStart: number): Buf {
  const buf = new Buf();
  for (let i = 0; i < reading.length; i++) {
    buf.push(reading.charAt(i), srcStart + i);
  }
  return buf;
}

/**
 * Maps a half-open `[startIndex, endIndex)` hit in `stream.text` (e.g. a `TextlintMessage.range` or a
 * pre-scan pair) back to a source {@link Range}: from the start of `text[startIndex]` to the end of
 * the last included unit `text[endIndex - 1]`. Reads ONLY `srcMap`; indices clamp into range so a
 * malformed/empty hit can never throw (an empty stream maps to the document start).
 */
export function mapRange(
  stream: Stream,
  doc: TextDocument,
  startIndex: number,
  endIndex: number,
): Range {
  const map = stream.srcMap;
  if (map.length === 0) {
    return { start: doc.positionAt(0), end: doc.positionAt(0) };
  }
  const s = Math.min(Math.max(startIndex, 0), map.length - 1);
  const lastIncluded = Math.min(Math.max(endIndex - 1, s), map.length - 1);
  const startOffset = map[s] ?? 0;
  const endOffset = (map[lastIncluded] ?? 0) + 1;
  return { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) };
}

/**
 * Maps a FIX range `[start, end)` to a source {@link Range}. Unlike {@link mapRange} (which always
 * covers at least one character — right for a diagnostic squiggle), this PRESERVES an empty range as
 * a zero-width INSERT point: `start === end` returns the position at the start of `text[start]` (or
 * just past the last unit when inserting at EOF), so an inserted indent / 。 lands BEFORE that
 * character — never overwriting a line's first character nor eating a trailing newline. A non-empty
 * range maps exactly like `mapRange` (the included characters only).
 */
export function mapFixRange(
  stream: Stream,
  doc: TextDocument,
  startIndex: number,
  endIndex: number,
): Range {
  const map = stream.srcMap;
  if (map.length === 0) {
    return { start: doc.positionAt(0), end: doc.positionAt(0) };
  }
  if (endIndex <= startIndex) {
    const s = Math.max(startIndex, 0);
    const at = s < map.length ? (map[s] ?? 0) : (map[map.length - 1] ?? -1) + 1;
    const pos = doc.positionAt(at);
    return { start: pos, end: pos };
  }
  return mapRange(stream, doc, startIndex, endIndex);
}
