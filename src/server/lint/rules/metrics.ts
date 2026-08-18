/**
 * Threshold ("how much is too much") rules. All counts are in UTF-16 units of the VIEW text
 * except maxKanjiRun, which counts code points (an astral kanji is one kanji, not two).
 * Sentence rules measure the narration and dialogue views separately, so an utterance is one
 * sentence of its own and its 〇 sentinel costs the surrounding 地の文 exactly one unit.
 *
 * Relative imports only (native test loader); vscode-free.
 */
import { splitSentences } from '../sentences.ts';
import type { LineRule, LintLine, ProseView, RuleContext } from '../types.ts';

import { maxOf, viewSpan } from './adapt.ts';

/** Feeds every sentence of the line's narration AND dialogue views to `visit` — the one place
 *  the "an utterance is measured on its own" split lives, so sentence rules cannot diverge. */
function eachSentence(
  line: LintLine,
  visit: (view: ProseView, start: number, end: number) => void,
): void {
  for (const which of ['narration', 'dialogue'] as const) {
    const view = line[which]();
    for (const s of splitSentences(view)) {
      visit(view, s.start, s.end);
    }
  }
}

/** 一文の長さ: a sentence longer than `max` view units. */
export function sentenceLengthRule(ctx: RuleContext): LineRule {
  const max = maxOf(ctx);
  return {
    line(line: LintLine): void {
      eachSentence(line, (v, start, end) => {
        if (end - start > max) {
          ctx.report(viewSpan(v, start, end));
        }
      });
    },
  };
}

/** 読点の数: the (max+1)-th 、 of a sentence is reported (one finding per sentence). */
export function maxTenRule(ctx: RuleContext): LineRule {
  const max = maxOf(ctx);
  return {
    line(line: LintLine): void {
      eachSentence(line, (v, start, end) => {
        let count = 0;
        for (let k = start; k < end; k += 1) {
          if (v.text.charAt(k) === '、' && (count += 1) === max + 1) {
            ctx.report(viewSpan(v, k, k + 1));
            return;
          }
        }
      });
    },
  };
}

/** Kanji per max-kanji-continuous-len: CJK ideographs (ext blocks included) + 々〇〻. The 〇
 *  sentinel never appears in the prose view, so it cannot join two runs. */
function isKanjiCp(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ffff) ||
    cp === 0x3005 || // 々
    cp === 0x3007 || // 〇
    cp === 0x303b // 〻
  );
}

/** 漢字の連続: a run of more than `max` kanji CODE POINTS, counted across elided markup — the
 *  prose view keeps 聴覚視覚［＃太字］区分装置 adjacent, so the whole 8-kanji run is one hit. */
export function maxKanjiRunRule(ctx: RuleContext): LineRule {
  const max = maxOf(ctx);
  return {
    line(line: LintLine): void {
      const v = line.prose();
      let i = 0;
      while (i < v.text.length) {
        const cp = v.text.codePointAt(i) ?? 0;
        const width = cp > 0xffff ? 2 : 1;
        if (!isKanjiCp(cp)) {
          i += width;
          continue;
        }
        const a = i;
        let kanji = 0;
        while (i < v.text.length) {
          const c = v.text.codePointAt(i) ?? 0;
          if (!isKanjiCp(c)) {
            break;
          }
          kanji += 1;
          i += c > 0xffff ? 2 : 1;
        }
        if (kanji > max) {
          ctx.report(viewSpan(v, a, i));
        }
      }
    },
  };
}

/** アラビア数字の桁数: a digit run (either width) longer than `max` — the submission convention
 *  keeps Arabic numerals short (a long run reads poorly on a vertical grid). */
export function arabicDigitsRule(ctx: RuleContext): LineRule {
  const max = maxOf(ctx);
  const isDigit = (ch: string): boolean => /[0-9０-９]/.test(ch);
  return {
    line(line: LintLine): void {
      const v = line.prose();
      let i = 0;
      while (i < v.text.length) {
        if (!isDigit(v.text.charAt(i))) {
          i += 1;
          continue;
        }
        const a = i;
        while (i < v.text.length && isDigit(v.text.charAt(i))) {
          i += 1;
        }
        if (i - a > max) {
          ctx.report(viewSpan(v, a, i));
        }
      }
    },
  };
}
