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
