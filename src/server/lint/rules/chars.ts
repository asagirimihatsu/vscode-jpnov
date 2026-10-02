/**
 * Character-hygiene rules and the ruby-reading kana rule. The hygiene scans run on the prose view
 * (地の文 and セリフ alike; annotation interiors stay the raw shiftJisSafe rule's job), except
 * noNfd and noControlChar, which scan every source slice of the line: a ruby reading, an
 * annotation target or a comment is composed, and loses its control characters, in every output
 * too. Every fix replaces or deletes characters in place; noControlChar withholds its fix for a
 * ruby base or reading it would empty.
 *
 * Relative imports only (native test loader); vscode-free.
 */
import { composeKana, isCjkIdeograph, isCombiningKanaMark, isUnshown } from '../../../shared/chars.ts';

import { rubyKanaScan } from '../prescan.ts';
import type { PreScan } from '../prescan.ts';
import type { LineRule, LintLine, RuleContext, SourceSlice } from '../types.ts';

import { viewScan } from './adapt.ts';

/** 半角カナ (U+FF61–FF9F: half-width kana, its punctuation and ﾞﾟ): a run normalizes to the
 *  full-width form; NFKC composes ｶ+ﾞ into ガ in one go. */
const hankakuKanaScan: PreScan = (text) => {
  const out: { start: number; end: number; fix: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.charCodeAt(i);
    if (cp < 0xff61 || cp > 0xff9f) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text.charCodeAt(i) >= 0xff61 && text.charCodeAt(i) <= 0xff9f) {
      i += 1;
    }
    out.push({ start, end: i, fix: text.slice(start, i).normalize('NFKC') });
  }
  return out;
};

/** Decomposed (NFD) kana anywhere on the line — prose, ruby readings, annotation targets and
 *  keywords alike. The REPORT covers the combining 濁点/半濁点 mark alone (so the raw shiftJisSafe
 *  finding over the same mark de-duplicates against it); the FIX replaces the kana and its mark
 *  by their composition, through the same {@link composeKana} the `.txt` codec runs. A mark that
 *  composes with nothing is flagged without a fix. */
export function nfdRule(ctx: RuleContext): LineRule {
  return {
    line(line: LintLine): void {
      for (const slice of line.source) {
        const { text, srcStart } = slice;
        for (let i = 0; i < text.length; i += 1) {
          if (!isCombiningKanaMark(text.charCodeAt(i))) {
            continue;
          }
          const composed = i > 0 ? composeKana(text.slice(i - 1, i + 1)) : '';
          ctx.report(
            { start: srcStart + i, end: srcStart + i + 1 },
            composed.length === 1 ? { fix: { replace: { slice, start: i - 1, end: i + 1 }, text: composed } } : undefined,
          );
        }
      }
    },
  };
}

/** ゼロ幅スペース (U+200B): a run is deleted outright. */
const zeroWidthScan: PreScan = (text) => {
  const out: { start: number; end: number; fix: string }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== '\u200b') {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text.charAt(i) === '\u200b') {
      i += 1;
    }
    out.push({ start, end: i, fix: '' });
  }
  return out;
};

/** A character noControlChar reports: C0 except tab, U+007F–009F, U+FFFE and U+FFFF. */
export function isControlChar(cp: number): boolean {
  return cp !== 0x09 && (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || isUnshown(cp));
}

/** True when `slice` holds nothing but control characters and U+200B, so deleting them leaves
 *  nothing shown. */
function wouldEmpty(slice: SourceSlice): boolean {
  for (let i = 0; i < slice.text.length; i += 1) {
    const cp = slice.text.charCodeAt(i);
    if (!isControlChar(cp) && cp !== 0x200b) {
      return false;
    }
  }
  return true;
}

/** 制御文字 (C0/C1 except \t — terminators never reach a line) and the noncharacters U+FFFE and
 *  U+FFFF, anywhere on the line — prose, ruby readings, annotations and comments alike, since no
 *  output carries the ones `dropUnshown` drops. Each one is deleted, unless the deletes would
 *  empty a ruby base or a ruby reading (the stranded ｜《…》 or 《》 would print literally). */
export function controlCharRule(ctx: RuleContext): LineRule {
  return {
    line(line: LintLine): void {
      let emptied: SourceSlice[] | undefined;
      for (const slice of line.source) {
        const { text, srcStart } = slice;
        for (let i = 0; i < text.length; i += 1) {
          if (!isControlChar(text.charCodeAt(i))) {
            continue;
          }
          const at = srcStart + i;
          emptied ??= [...line.pieces.filter((p) => p.rubyBase), ...line.rubies].filter(wouldEmpty);
          const withheld = emptied.some((s) => s.srcStart <= at && at < s.srcStart + s.text.length);
          ctx.report(
            { start: at, end: at + 1 },
            withheld ? undefined : { fix: { replace: { slice, start: i, end: i + 1 }, text: '' } },
          );
        }
      }
    },
  };
}

/** Kana or a CJK ideograph. */
const isJa = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x3040 && cp <= 0x30ff) || isCjkIdeograph(cp);
};

const isAlpha = (ch: string): boolean => /[A-Za-zＡ-Ｚａ-ｚ]/.test(ch);

/** Letters an IME legitimately leaves between Japanese characters (the stock rule's allow list):
 *  the vowels + n in either width, and any capital (Ｘ座標, A案). */
const NATURAL_ALPHA = new Set(['a', 'i', 'u', 'e', 'o', 'n', 'ａ', 'ｉ', 'ｕ', 'ｅ', 'ｏ', 'ｎ']);

/** 不自然なアルファベット: one letter sandwiched between Japanese characters — the shape of an
 *  IME slip (見るr) — unless it is on the allow list or a capital. */
const unnaturalAlphabetScan: PreScan = (text) => {
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (!isAlpha(ch) || isAlpha(text.charAt(i - 1)) || isAlpha(text.charAt(i + 1))) {
      continue;
    }
    if (NATURAL_ALPHA.has(ch) || /[A-ZＡ-Ｚ]/.test(ch)) {
      continue;
    }
    if (isJa(text.charAt(i - 1)) && isJa(text.charAt(i + 1))) {
      out.push({ start: i, end: i + 1 });
    }
  }
  return out;
};

export const hankakuKanaRule = viewScan(hankakuKanaScan, 'prose');
export const zeroWidthRule = viewScan(zeroWidthScan, 'prose');
export const unnaturalAlphabetRule = viewScan(unnaturalAlphabetScan, 'prose');

/** ルビの読みの仮名種: each reading must be entirely the chosen kana type. */
export function rubyKanaRule(ctx: RuleContext): LineRule {
  return {
    line(line: LintLine): void {
      for (const ruby of line.rubies) {
        for (const hit of rubyKanaScan(ruby.text, ctx.options)) {
          ctx.report({ start: ruby.srcStart + hit.start, end: ruby.srcStart + hit.end });
        }
      }
    },
  };
}
