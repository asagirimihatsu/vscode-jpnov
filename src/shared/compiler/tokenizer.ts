/**
 * Document-level tokenizer for Aozora-Bunko-annotated text. Pure + vscode-free.
 *
 * The only annotation delimiter is the full-width ［＃ ... ］; corner brackets 「」 are
 * dialogue and are never comments. Ruby uses its own delimiters 《 》 with an optional
 * explicit base marker ｜. This is the single entry point that both the per-file
 * renderer and the book renderer build on, so it handles cross-line spans (傍点 span
 * start/end emit independent tokens in stream order; the renderer pairs them).
 *
 * Delimiter pairing is LINE-BOUNDED — ［＃…］ and 《…》 never pair across a line break, so
 * broken markup only ever affects its own source line:
 *   - An unclosed ［＃ (no ］ before the line break) becomes ONE `brokenAnnotation` token
 *     swallowing ［＃ up to the line end — never the '\n', nor the '\r' of a '\r\n'. It is
 *     a compile ERROR: {@link findBrokenAnnotations} hands the exact spans to the editor
 *     diagnostics, while the layout renders the raw as visible literal text.
 *   - An unmatched 《 (no 》 on its line) stays lenient: literal text, no error. A pending
 *     ｜ base marker is cleared at a line break, so it never pairs with a later-line 《…》.
 *   - A standalone ］ or 》 is ordinary text.
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
  | 'brokenAnnotation'
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

/**
 * An unclosed ［＃ (no ］ before its line break), swallowed to the line end. There is no inner —
 * `raw` (＝ ［＃… up to but never including the line break) IS the payload: the layout renders it
 * as visible literal text, and {@link findBrokenAnnotations} surfaces it as a compile error.
 */
export interface BrokenAnnotationToken extends TokenBase {
  readonly kind: 'brokenAnnotation';
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
  | BrokenAnnotationToken
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

/**
 * Offset just past the last line-content char at/after `from`: the next '\n' (backing off over
 * the '\r' of a '\r\n' terminator) or the end of input. Bounds every delimiter pairing to the
 * current line. The annotation branch slices with it (`from` is past ［＃, so the back-off can
 * never step before the marker); the ruby branch only compares against it.
 */
function endOfLine(src: string, from: number): number {
  const nl = src.indexOf('\n', from);
  const end = nl === -1 ? src.length : nl;
  return src.charAt(end - 1) === '\r' ? end - 1 : end;
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
      const lineEnd = endOfLine(src, i + 2);
      const close = src.indexOf(CLOSE_BRACKET, i + 2);
      if (close === -1 || close >= lineEnd) {
        // No ］ before the line break — the broken annotation swallows ［＃ up to (never past)
        // the end of THIS line; findBrokenAnnotations() reports the span as a compile error.
        flushText();
        tokens.push({ kind: 'brokenAnnotation', raw: src.slice(i, lineEnd) });
        i = lineEnd;
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
      if (close === -1 || close >= endOfLine(src, i + 1)) {
        // No 》 on this line — literal (a reading never spans lines; lenient, no error).
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
    if (ch === '\n') {
      // A pending ｜ explicit-base marker never survives a line break (ruby is line-local).
      baseMark = -1;
    }
    textBuf += ch;
    i += 1;
  }

  flushText();
  return tokens;
}

// ---------------------------------------------------------------------------
// Broken-annotation spans (compile errors)
// ---------------------------------------------------------------------------

/** A broken (unclosed) ［＃ annotation as absolute source UTF-16 offsets `[start, end)`. */
export interface BrokenAnnotation {
  readonly start: number;
  readonly end: number;
}

/**
 * Source spans of every unclosed ［＃, in document order — the single "what is broken" answer the
 * editor diagnostics consume, re-derived from {@link tokenize} itself so it can never disagree
 * with what the renderer shows. Offsets are recovered by accumulating `raw.length` (the
 * concatenation of all raws IS the source), the same convention every token consumer uses.
 */
export function findBrokenAnnotations(src: string): BrokenAnnotation[] {
  const spans: BrokenAnnotation[] = [];
  let offset = 0;
  for (const token of tokenize(src)) {
    if (token.kind === 'brokenAnnotation') {
      spans.push({ start: offset, end: offset + token.raw.length });
    }
    offset += token.raw.length;
  }
  return spans;
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
