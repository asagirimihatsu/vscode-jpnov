/**
 * Character-hygiene rules and the ruby-reading kana rule. The hygiene scans run on the prose
 * view (地の文 and セリフ alike; annotation interiors stay the raw shiftJisSafe rule's job), and
 * every fix is a context-free character substitution — safe to apply verbatim anywhere.
 *
 * Relative imports only (native test loader); vscode-free.
 */
import { isCjkIdeograph } from '../../../shared/chars.ts';

import { rubyKanaScan } from '../prescan.ts';
import type { PreScan } from '../prescan.ts';
import type { LineRule, LintLine, RuleContext } from '../types.ts';

import { viewFix, viewScan, viewSpan } from './adapt.ts';

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

/** Decomposed (NFD) kana: the REPORT covers the combining 濁点/半濁点 mark alone (so the raw
 *  shiftJisSafe finding over the same mark de-duplicates against it), while the FIX replaces the
 *  base+mark pair with its NFC composition. A pair NFC cannot compose is flagged without a fix. */
export function nfdRule(ctx: RuleContext): LineRule {
  return {
    line(line: LintLine): void {
      const v = line.prose();
      for (let i = 0; i < v.text.length; i += 1) {
        const cp = v.text.charCodeAt(i);
        if (cp !== 0x3099 && cp !== 0x309a) {
          continue;
        }
        const span = viewSpan(v, i, i + 1);
        const pair = i > 0 ? v.text.slice(i - 1, i + 1) : '';
        const composed = pair.normalize('NFC');
        const fix =
          pair !== '' && composed !== pair ? viewFix(v, i - 1, i + 1, composed) : undefined;
        ctx.report(span, fix === undefined ? undefined : { fix });
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

/** 制御文字 (C0/C1 except \t — terminators never reach a view): each one is deleted. */
const controlCharScan: PreScan = (text) => {
  const out: { start: number; end: number; fix: string }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const cp = text.charCodeAt(i);
    const isControl = cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
    if (isControl && cp !== 0x09) {
      out.push({ start: i, end: i + 1, fix: '' });
    }
  }
  return out;
};

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
export const controlCharRule = viewScan(controlCharScan, 'prose');
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
