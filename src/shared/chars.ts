/**
 * The character tables every layer shares: the CJK ideograph and kana blocks, and the kana
 * composition. A leaf: it imports nothing, the AST layer stands on it.
 */

/** A CJK ideograph: Ext A + Unified (U+3400–9FFF), Compatibility (U+F900–FAFF), SIP (U+20000–2FFFF). */
export function isCjkIdeograph(cp: number): boolean {
  return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2ffff);
}

/** Hiragana block (U+3041..U+3096); the small ヶ is intentionally NOT hiragana. */
export function isHiragana(cp: number): boolean {
  return cp >= 0x3041 && cp <= 0x3096;
}

/** Katakana (U+30A1..U+30FA) plus the prolonged-sound mark ー (U+30FC); ヶ (U+30F6) counts as kanji. */
export function isKatakana(cp: number): boolean {
  if (cp === 0x30f6) {
    return false;
  }
  return (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc;
}

/** Combining 濁点 (U+3099) and 半濁点 (U+309A): what a decomposed (NFD) kana carries after its base. */
const COMBINING_KANA_MARK = /[\u3099\u309A]/;

/** Whether `cp` is a combining 濁点/半濁点 (the second code point of an NFD kana). */
export function isCombiningKanaMark(cp: number): boolean {
  return cp === 0x3099 || cp === 0x309a;
}

/**
 * `text` with every adjacent kana + combining 濁点/半濁点 pair composed (か + U+3099 -> が). NFC is
 * asked about the PAIR alone: whole-text NFC would also fold the CJK compatibility ideographs
 * personal names rely on (神 U+FA19 -> U+795E), which Shift JIS holds as distinct cells. A pair
 * Unicode does not compose (あ + U+3099) and a mark after anything but a kana stay as they came.
 */
export function composeKana(text: string): string {
  if (!COMBINING_KANA_MARK.test(text)) {
    return text;
  }
  return composedChars(text).map((ch) => ch.text).join('');
}

/** One display character and the UTF-16 range of `text` it came from. */
export interface ComposedChar {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The characters of `text` as {@link composeKana} joins them, each with its range in `text`: a
 * composed kana covers its kana and the mark, any other character itself.
 */
export function composedChars(text: string): ComposedChar[] {
  const out: ComposedChar[] = [];
  let at = 0;
  for (const ch of text) {
    const start = at;
    at += ch.length;
    const prev = out[out.length - 1];
    if (prev !== undefined && isCombiningKanaMark(ch.codePointAt(0) ?? 0)) {
      const base = prev.text.codePointAt(0) ?? 0;
      if (base >= 0x3041 && base <= 0x30ff) {
        const composed = (prev.text + ch).normalize('NFC');
        if (composed.length === 1) {
          out[out.length - 1] = { text: composed, start: prev.start, end: at };
          continue;
        }
      }
    }
    out.push({ text: ch, start, end: at });
  }
  return out;
}
