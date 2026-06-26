/**
 * Document-level tokenizer for Aozora-Bunko-annotated text. Pure + vscode-free.
 *
 * The only annotation delimiter is the full-width ［＃ ... ］; corner brackets 「」 are
 * dialogue and are never comments. Ruby uses its own delimiters 《 》 with an optional
 * explicit base marker ｜. This is the single entry point that both the per-file
 * renderer and the book renderer build on, so it handles cross-line spans (傍点 span
 * start/end emit independent tokens in stream order; the renderer pairs them).
 *
 * Lenient recovery: an unmatched ［＃ (no closing ］) or an unmatched 《 (no closing 》)
 * is emitted literally as text rather than swallowing the rest of the document.
 */

import { emphasisClass } from './emphasis.ts';

export type TokenKind =
  | 'text'
  | 'rubyExplicit'
  | 'rubyImplicit'
  | 'emphasisPostfix'
  | 'emphasisSpanStart'
  | 'emphasisSpanEnd'
  | 'comment'
  | 'pageBreak';

interface TokenBase {
  readonly kind: TokenKind;
  /** Source text this token was produced from (verbatim slice). */
  readonly raw: string;
}

export interface TextToken extends TokenBase {
  readonly kind: 'text';
  readonly text: string;
}

export interface RubyExplicitToken extends TokenBase {
  readonly kind: 'rubyExplicit';
  readonly base: string;
  readonly reading: string;
}

export interface RubyImplicitToken extends TokenBase {
  readonly kind: 'rubyImplicit';
  readonly base: string;
  readonly reading: string;
}

export interface EmphasisPostfixToken extends TokenBase {
  readonly kind: 'emphasisPostfix';
  readonly target: string;
  readonly variant: string;
}

export interface EmphasisSpanStartToken extends TokenBase {
  readonly kind: 'emphasisSpanStart';
  readonly variant: string;
}

export interface EmphasisSpanEndToken extends TokenBase {
  readonly kind: 'emphasisSpanEnd';
  readonly variant: string;
}

export interface CommentToken extends TokenBase {
  readonly kind: 'comment';
  /** Inner text of ［＃ ... ］, emitted verbatim into an HTML comment by the renderer. */
  readonly inner: string;
}

export interface PageBreakToken extends TokenBase {
  readonly kind: 'pageBreak';
}

export type Token =
  | TextToken
  | RubyExplicitToken
  | RubyImplicitToken
  | EmphasisPostfixToken
  | EmphasisSpanStartToken
  | EmphasisSpanEndToken
  | CommentToken
  | PageBreakToken;

// Full-width annotation/ruby markers (see codepoints in the locked spec).
const OPEN_BRACKET = '［'; // ［
const HASH = '＃'; // ＃
const CLOSE_BRACKET = '］'; // ］
const RUBY_OPEN = '《'; // 《
const RUBY_CLOSE = '》'; // 》
const BASE_MARK = '｜'; // ｜
const CORNER_OPEN = '「'; // 「
const CORNER_CLOSE = '」'; // 」
const PAGE_BREAK = '改ページ';
const SPAN_END_SUFFIX = '終わり';

/**
 * Classifies the inner text of a ［＃ ... ］ annotation (already extracted, never
 * re-scanned) into the appropriate annotation token. The `raw` is the full bracketed
 * source slice including ［＃ and ］.
 */
function classifyAnnotation(inner: string, raw: string): Token {
  if (inner === PAGE_BREAK) {
    return { kind: 'pageBreak', raw };
  }

  // Postfix emphasis: ［＃「対象」に傍点］ / ［＃「対象」の左に傍点］.
  if (inner.startsWith(CORNER_OPEN)) {
    const close = inner.indexOf(CORNER_CLOSE, CORNER_OPEN.length);
    if (close !== -1) {
      const target = inner.slice(CORNER_OPEN.length, close);
      let variant = inner.slice(close + CORNER_CLOSE.length);
      // Strip a single connector (に for the plain form, の for の左に…).
      if (variant.startsWith('に') || variant.startsWith('の')) {
        variant = variant.slice(1);
      }
      if (target !== '' && emphasisClass(variant) !== null) {
        return { kind: 'emphasisPostfix', raw, target, variant };
      }
    }
    // Unknown target/variant => fall through to a comment.
    return { kind: 'comment', raw, inner };
  }

  // Span end: ［＃傍点終わり］ (must check before span-start so the suffix is seen).
  if (inner.endsWith(SPAN_END_SUFFIX)) {
    const variant = inner.slice(0, inner.length - SPAN_END_SUFFIX.length);
    if (emphasisClass(variant) !== null) {
      return { kind: 'emphasisSpanEnd', raw, variant };
    }
  }

  // Span start: ［＃傍点］.
  if (emphasisClass(inner) !== null) {
    return { kind: 'emphasisSpanStart', raw, variant: inner };
  }

  // Everything else (incl. the 傍線 line family) becomes a comment.
  return { kind: 'comment', raw, inner };
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let textBuf = '';
  // Index into textBuf where the most recent explicit ｜ base marker sits, or -1.
  let baseMark = -1;

  const flushText = (): void => {
    if (textBuf !== '') {
      tokens.push({ kind: 'text', raw: textBuf, text: textBuf });
      textBuf = '';
    }
    baseMark = -1;
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    // charAt returns '' past the end (never undefined); all markers are BMP.
    const ch = src.charAt(i);

    // Annotation opener ［＃.
    if (ch === OPEN_BRACKET && src.charAt(i + 1) === HASH) {
      const close = src.indexOf(CLOSE_BRACKET, i + 2);
      if (close === -1) {
        // Unmatched ［＃ — emit ［ literally and keep scanning (lenient recovery).
        textBuf += ch;
        baseMark = -1;
        i += 1;
        continue;
      }
      const inner = src.slice(i + 2, close);
      const raw = src.slice(i, close + 1);
      flushText();
      tokens.push(classifyAnnotation(inner, raw));
      i = close + 1;
      continue;
    }

    // Explicit ruby base marker ｜ — record its index, but KEEP it in textBuf so a ｜
    // that never forms a valid ruby survives as literal text. It is sliced out only on
    // a successful explicit-base match below.
    if (ch === BASE_MARK) {
      baseMark = textBuf.length;
      textBuf += ch;
      i += 1;
      continue;
    }

    // Ruby reading 《 ... 》.
    if (ch === RUBY_OPEN) {
      const close = src.indexOf(RUBY_CLOSE, i + 1);
      if (close === -1) {
        // Unmatched 《 — literal.
        textBuf += ch;
        i += 1;
        continue;
      }
      const reading = src.slice(i + 1, close);
      const rubyRaw = src.slice(i, close + 1);

      if (reading === '') {
        // Empty 《》 => literal text, no <ruby>. Any pending ｜ stays literal in textBuf.
        textBuf += rubyRaw;
        baseMark = -1;
        i = close + 1;
        continue;
      }

      if (baseMark >= 0) {
        // Explicit base: from just AFTER the ｜ marker up to 《 (baseMark indexes the ｜).
        const base = textBuf.slice(baseMark + 1);
        const before = textBuf.slice(0, baseMark);
        if (base === '') {
          // ｜《reading》 with nothing between => the ｜ stays literal in textBuf; emit
          // the 《reading》 run literally too.
          textBuf += rubyRaw;
          baseMark = -1;
          i = close + 1;
          continue;
        }
        if (before !== '') {
          tokens.push({ kind: 'text', raw: before, text: before });
        }
        const explicitRaw = BASE_MARK + base + rubyRaw;
        tokens.push({ kind: 'rubyExplicit', raw: explicitRaw, base, reading });
        textBuf = '';
        baseMark = -1;
        i = close + 1;
        continue;
      }

      // Implicit base: walk back over one character class.
      const { base, rest } = detectImplicitBase(textBuf);
      if (base === '') {
        // No base char precedes => leave 《reading》 as literal text.
        textBuf += rubyRaw;
        i = close + 1;
        continue;
      }
      if (rest !== '') {
        tokens.push({ kind: 'text', raw: rest, text: rest });
      }
      tokens.push({ kind: 'rubyImplicit', raw: base + rubyRaw, base, reading });
      textBuf = '';
      i = close + 1;
      continue;
    }

    // Ordinary character (includes 「」 dialogue, newlines, spaces).
    textBuf += ch;
    i += 1;
  }

  flushText();
  return tokens;
}

// ---------------------------------------------------------------------------
// Implicit ruby-base detection
// ---------------------------------------------------------------------------

/**
 * Given the text immediately before a 《reading》 with no explicit ｜ marker, walk back over
 * a MAXIMAL run of ONE character class, stopping at a class change, space, punctuation, or ［.
 *
 * There are FOUR symmetric character classes:
 *   - Kanji 漢字   — CJK ideographs, including the iteration/abbreviation marks 々〆ヶ.
 *   - Hiragana 平仮名.
 *   - Katakana 片仮名 — including the prolonged-sound mark ー (U+30FC).
 *   - Alnum        — ASCII *and* full-width Latin letters / digits (treated as one class).
 *
 * The class of the LAST character before 《 fixes the run; the walk-back then extends left
 * while characters stay in that same class. Anything else (a different class, whitespace,
 * punctuation, the annotation opener ［, etc.) terminates the base.
 */
type CharClass = 'kanji' | 'hiragana' | 'katakana' | 'alnum' | null;

/** Kanji: CJK Unified Ideographs (+ Ext A) plus the marks 々(U+3005) 〆(U+3006) ヶ(U+30F6). */
function isKanji(cp: number): boolean {
  return (
    cp === 0x3005 ||
    cp === 0x3006 ||
    cp === 0x30f6 ||
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x20000 && cp <= 0x2ffff) // SIP (Ext B..F)
  );
}

/** Hiragana block (U+3041..U+3096); the small ヶ is intentionally NOT hiragana. */
export function isHiragana(cp: number): boolean {
  return cp >= 0x3041 && cp <= 0x3096;
}

/** Katakana (U+30A1..U+30FA) plus the prolonged-sound mark ー (U+30FC). */
export function isKatakana(cp: number): boolean {
  // ヶ (U+30F6) is classed as kanji above, so exclude it here.
  if (cp === 0x30f6) {
    return false;
  }
  return (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc;
}

/** ASCII and full-width Latin letters + digits, as a single class. */
function isAlnum(cp: number): boolean {
  return (
    (cp >= 0x30 && cp <= 0x39) || // 0-9
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) || // a-z
    (cp >= 0xff10 && cp <= 0xff19) || // ０-９
    (cp >= 0xff21 && cp <= 0xff3a) || // Ａ-Ｚ
    (cp >= 0xff41 && cp <= 0xff5a) // ａ-ｚ
  );
}

function classify(cp: number): CharClass {
  if (isKanji(cp)) {
    return 'kanji';
  }
  if (isHiragana(cp)) {
    return 'hiragana';
  }
  if (isKatakana(cp)) {
    return 'katakana';
  }
  if (isAlnum(cp)) {
    return 'alnum';
  }
  return null;
}

/** Class of a single code-point string (`''` and multi-cp inputs => null). */
function classOf(ch: string | undefined): CharClass {
  if (ch === undefined) {
    return null;
  }
  const cp = ch.codePointAt(0);
  if (cp === undefined) {
    return null;
  }
  return classify(cp);
}

export function detectImplicitBase(textBefore: string): { base: string; rest: string } {
  // Work in code points so astral kanji (SIP) are handled as single units.
  const chars = Array.from(textBefore);
  const lastClass = classOf(chars[chars.length - 1]);
  if (lastClass === null) {
    // Empty, or a trailing char that is not a ruby-base character (space,
    // punctuation, ］, …): there is no implicit base.
    return { base: '', rest: textBefore };
  }

  let start = chars.length;
  while (start > 0 && classOf(chars[start - 1]) === lastClass) {
    start -= 1;
  }

  return {
    base: chars.slice(start).join(''),
    rest: chars.slice(0, start).join(''),
  };
}
