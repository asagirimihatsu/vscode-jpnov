/**
 * Character samples the tests share: the combining kana marks, the characters no output can
 * carry, and values that show nothing.
 */

/** The combining 濁点 and 半濁点: what a decomposed (NFD) kana carries after its base. */
export const D = '\u3099';
export const H = '\u309A';

/** One of each range no output can carry: the C0 controls, and the two noncharacters. */
export const UNSHOWN = ['\u0007', '\u0000', '\u001F', '\uFFFE', '\uFFFF'] as const;
export const BEL = UNSHOWN[0];

/** Values of which nothing shows: half-width and full-width space, a character no output
 *  carries, and a mix. */
export const BLANKS = [' ', '　', '\u0007', ' \uFFFE　'] as const;

/** 辻 with an ideographic variation selector: one character of two code points. */
export const TSUJI = '辻\u{E0100}';

/**
 * One cluster each, of several code points: the selector, an emoji under its presentation
 * selector, a mark that composes nothing, a half-width kana and its mark, a ZWJ family, a flag, a
 * decomposed Latin letter.
 */
export const CLUSTERS = [TSUJI, '\u2764\uFE0F', `あ${D}`, '\uFF76\uFF9E', '\u{1F468}\u200D\u{1F469}\u200D\u{1F466}', '\u{1F1EF}\u{1F1F5}', 'e\u0301'] as const;
