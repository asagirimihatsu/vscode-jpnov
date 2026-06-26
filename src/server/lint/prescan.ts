/**
 * Pure, kuromoji-free pre-scanners — the non-kernel half of the rule set. Each takes a stream's
 * clean text (plus the rule's resolved options) and returns half-open `[start, end)` UTF-16 spans
 * into THAT text; the driver (`kernel.ts`) maps them to source via `mapRange`, so no scanner computes
 * a source position itself.
 *
 * Relative imports only (native test loader).
 */
import { isHiragana, isKatakana } from '../../shared/compiler/tokenizer.ts';
import type { ActiveRule } from '../../shared/lint/select.ts';

/** A pre-scan: clean text + the rule's resolved options -> the spans to flag (UTF-16 offsets). */
export type PreScan = (
  text: string,
  options: ActiveRule['options'],
) => readonly { readonly start: number; readonly end: number; readonly fix?: string }[];

/** The three minus glyphs (ASCII, full-width, true minus) the prose may use as a sign. */
const MINUS = new Set(['-', '－', '−']);

/** True for an ASCII or full-width digit. */
function isDigit(ch: string | undefined): boolean {
  if (ch === undefined) {
    return false;
  }
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0xff10 && cp <= 0xff19);
}

/** Flags a minus sign that is not immediately followed by a digit (so it reads as a stray dash). */
export const minusPositionScan: PreScan = (text) => {
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (MINUS.has(text.charAt(i)) && !isDigit(text[i + 1])) {
      out.push({ start: i, end: i + 1 });
    }
  }
  return out;
};

const EM_DASH = '—'; // — the single em dash novels avoid
const DOUBLE_DASH = '――'; // ―― 二倍ダッシュ (the replacement)

/** Flags a maximal run of em dashes (—); the fix replaces the WHOLE run with one 二倍ダッシュ (――),
 *  so `—` and a stray `——` both normalize cleanly without leaving a dangling dash. */
export const noEmDashScan: PreScan = (text) => {
  const out: { start: number; end: number; fix: string }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== EM_DASH) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text.charAt(i) === EM_DASH) {
      i += 1;
    }
    out.push({ start, end: i, fix: DOUBLE_DASH });
  }
  return out;
};

const FULL_WIDTH_SPACE = '　'; //

/** True for any non-ASCII code unit (kana, kanji, full-width punctuation). */
function isNonAscii(ch: string | undefined): boolean {
  return ch !== undefined && (ch.codePointAt(0) ?? 0) > 0x7f;
}

/**
 * Flags a run of half-width spaces sandwiched between two full-width (non-ASCII) characters; the fix
 * REPLACES the run with a single full-width space (　) — never deletes it. A run touching ASCII or a
 * line edge is left alone (Western text; paragraph indentation is generalNovelStyle's job).
 */
export const fullWidthSpaceScan: PreScan = (text) => {
  const out: { start: number; end: number; fix: string }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== ' ') {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text.charAt(i) === ' ') {
      i += 1;
    }
    if (isNonAscii(text[start - 1]) && isNonAscii(text[i])) {
      out.push({ start, end: i, fix: FULL_WIDTH_SPACE });
    }
  }
  return out;
};

const PROLONGED_SOUND = 0x30fc; // ー — neutral; allowed inside a hiragana OR katakana reading

/** True when every code point of `reading` is the chosen kana type (＋ the prolonged-sound mark ー). */
function isAllKana(reading: string, mode: string): boolean {
  const cps = Array.from(reading, (c) => c.codePointAt(0) ?? 0);
  if (mode === 'hiragana') {
    return cps.every((cp) => isHiragana(cp) || cp === PROLONGED_SOUND);
  }
  if (mode === 'katakana') {
    return cps.every((cp) => isKatakana(cp)); // isKatakana already includes ー
  }
  return true; // unknown mode -> nothing to enforce
}

/**
 * Flags each `\n`-delimited ruby reading that is not entirely the kana type chosen in the setting
 * (`{ mode: 'hiragana' | 'katakana' }`). Requiring all-hiragana or all-katakana also rejects
 * half-width kana and decomposed (NFD) characters, so this one drop-down subsumes the old ruby trio.
 */
export const rubyKanaScan: PreScan = (text, options) => {
  const mode = typeof options === 'object' && 'mode' in options ? options.mode : undefined;
  if (mode === undefined) {
    return [];
  }
  const out: { start: number; end: number }[] = [];
  let segStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text.charAt(i) !== '\n') {
      continue;
    }
    if (i > segStart && !isAllKana(text.slice(segStart, i), mode)) {
      out.push({ start: segStart, end: i });
    }
    segStart = i + 1;
  }
  return out;
};
