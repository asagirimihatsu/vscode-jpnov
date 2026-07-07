/**
 * Document-level tokenizer for Aozora-Bunko-annotated text. Pure + vscode-free.
 *
 * The only annotation delimiter is the full-width ［＃ ... ］; corner brackets 「」 are
 * dialogue and are never comments. Ruby uses its own delimiters 《 》 with an optional
 * explicit base marker ｜. This is the single entry point that both the per-file
 * renderer and the book renderer build on, so it handles cross-line spans (style span
 * start/end and 字下げ block start/end emit independent tokens in stream order; the
 * renderer pairs them).
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

import { resolveStyle, type Channel } from './emphasis.ts';

export type TokenKind =
  | 'text'
  | 'rubyExplicit'
  | 'rubyImplicit'
  | 'emphasisPostfix'
  | 'emphasisSpanStart'
  | 'emphasisSpanEnd'
  | 'comment'
  | 'brokenAnnotation'
  | 'pageBreak'
  | 'indent'
  | 'indentBlockStart'
  | 'indentBlockEnd';

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
  /**
   * True iff this came from the BLOCK form ［＃ここから太字/斜体］ (own-line, 太字/斜体 only). The
   * inline form ［＃太字］ leaves it undefined. Drives empty-column suppression, directive
   * colouring of ここから, and block pairing ({@link findUnpairedBlocks}).
   */
  readonly block?: true;
}

export interface EmphasisSpanEndToken extends TokenBase {
  readonly kind: 'emphasisSpanEnd';
  readonly variant: string;
  /** True iff from ［＃ここで太字/斜体終わり］ (block form). See {@link EmphasisSpanStartToken.block}. */
  readonly block?: true;
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

/**
 * A single-line indent ［＃○字下げ］ — indents its own logical line by `amount` full-width cells.
 * LINE-HEAD only: the tokenizer emits this only when the ［ opens the line (see `atLineStart` in
 * {@link tokenize}); mid-line it degrades to a {@link CommentToken}, matching the tmLanguage `^`
 * anchor. `amount` is a non-negative int parsed from full-width digits ０-９ (see
 * {@link indentAmount}); the layout clamps it to the line width and treats 0 as no indent.
 */
export interface IndentToken extends TokenBase {
  readonly kind: 'indent';
  readonly amount: number;
}

/**
 * Block indent opener ［＃ここから○字下げ］ — indents every following logical line by `amount`
 * (incl. wrapped continuations) until the matching {@link IndentBlockEndToken}. Not line-head-gated.
 */
export interface IndentBlockStartToken extends TokenBase {
  readonly kind: 'indentBlockStart';
  readonly amount: number;
}

/**
 * Block indent closer ［＃ここで字下げ終わり］. A dangling one (no open block) is a layout no-op;
 * {@link findUnpairedBlocks} surfaces it as a Warning.
 */
export interface IndentBlockEndToken extends TokenBase {
  readonly kind: 'indentBlockEnd';
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
  | PageBreakToken
  | IndentToken
  | IndentBlockStartToken
  | IndentBlockEndToken;

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
const CONNECTOR_NI = 'に';
const CONNECTOR_HA = 'は';
const BLOCK_FROM = 'ここから';
const BLOCK_TO = 'ここで';
const INDENT_SUFFIX = '字下げ';
const BOLD = '太字';
const ITALIC = '斜体';

/**
 * The indent count in `s` = 「<digits>字下げ」, or null. Aozora writes it as FULL-WIDTH digits
 * ０-９ ONLY (locked spec). The count is UNBOUNDED here: the layout clamps N to the line width
 * (N_eff = min(N, charsPerLine−1)), so there is NO N-too-big degrade branch and hence no span
 * the grammar (`[０-９]+`) and this lexer could ever disagree on. A half-width digit, 漢数字, or
 * a missing 字下げ suffix yields null → the caller degrades to a comment. Leading zeros parse
 * numerically (００→0, ００３→3); 0 is a valid amount the layout renders as no indent.
 */
function indentAmount(s: string): number | null {
  if (!s.endsWith(INDENT_SUFFIX)) {
    return null;
  }
  const digits = s.slice(0, s.length - INDENT_SUFFIX.length);
  if (digits.length === 0) {
    return null;
  }
  let n = 0;
  for (let k = 0; k < digits.length; k += 1) {
    const cp = digits.charCodeAt(k);
    if (cp < 0xff10 || cp > 0xff19) {
      return null; // not a full-width digit (半角/漢数字 degrade to comment)
    }
    n = n * 10 + (cp - 0xff10);
  }
  return n;
}

/**
 * Connector matrix, kept literally consistent with tmLanguage rules 9/10 so both layers grey the
 * same inputs (zero-fight):
 *   - 傍点/傍線 (emph/line): connector に is OPTIONAL (grammar `(に)?`); a bare 「対象」傍点 or a
 *     の左に/左に-prefixed one (family=null) is accepted — preserves the current 傍点 behaviour.
 *   - 太字/斜体 (weight/style): connector は is REQUIRED (grammar `(は)`, NOT optional); a bare
 *     「対象」太字 (family=null) or a に-paired one → false → comment, matching the grammar.
 *   - Any cross-family pairing (は+傍点, に+太字) → false → comment.
 */
function connectorMatches(family: 'ni' | 'ha' | null, channel: Channel): boolean {
  if (channel === 'weight' || channel === 'style') {
    return family === 'ha'; // 太字/斜体 REQUIRE は
  }
  return family === 'ni' || family === null; // 傍点/傍線: に optional; の左に / bare (family=null) ok
}

/**
 * Classifies the inner text of a ［＃ ... ］ annotation (already extracted, never re-scanned)
 * into the appropriate annotation token. The `raw` is the full bracketed source slice including
 * ［＃ and ］; `atLineStart` is true iff the ［ opened its line (only the single-line 字下げ
 * branch reads it). Recognition is PURELY LITERAL and kept literally identical to the tmLanguage
 * patterns, so the grammar and this lexer never colour a span differently: whether a recognised
 * block actually pairs / an indent actually applies is decided later (layout /
 * {@link findUnpairedBlocks}), never by degrading a well-formed directive to a grey comment here.
 */
function classifyAnnotation(inner: string, raw: string, atLineStart: boolean): Token {
  if (inner === PAGE_BREAK) {
    return { kind: 'pageBreak', raw };
  }

  // Corner-target postfix ［＃「対象」に傍点／の左に傍線／は太字…］.
  if (inner.startsWith(CORNER_OPEN)) {
    return classifyPostfix(inner, raw);
  }

  // Block END ［＃ここで X終わり］ — BEFORE block-start and the short span-end (its 終わり overlaps).
  if (inner.startsWith(BLOCK_TO) && inner.endsWith(SPAN_END_SUFFIX)) {
    const mid = inner.slice(BLOCK_TO.length, inner.length - SPAN_END_SUFFIX.length);
    if (mid === INDENT_SUFFIX) {
      return { kind: 'indentBlockEnd', raw };
    }
    if (mid === BOLD || mid === ITALIC) {
      return { kind: 'emphasisSpanEnd', raw, variant: mid, block: true };
    }
    return { kind: 'comment', raw, inner }; // ここで傍点終わり etc. (傍点/傍線 have no block form)
  }

  // Block START ［＃ここから X］.
  if (inner.startsWith(BLOCK_FROM)) {
    const body = inner.slice(BLOCK_FROM.length);
    const amount = indentAmount(body);
    if (amount !== null) {
      return { kind: 'indentBlockStart', raw, amount };
    }
    if (body === BOLD || body === ITALIC) {
      return { kind: 'emphasisSpanStart', raw, variant: body, block: true };
    }
    return { kind: 'comment', raw, inner }; // ここから傍点 / ここから…折り返して… → grey
  }

  // Short (inline) span END ［＃傍点終わり／左に傍線終わり／太字終わり］.
  if (inner.endsWith(SPAN_END_SUFFIX)) {
    const variant = inner.slice(0, inner.length - SPAN_END_SUFFIX.length);
    if (resolveStyle(variant) !== null) {
      return { kind: 'emphasisSpanEnd', raw, variant };
    }
    return { kind: 'comment', raw, inner };
  }

  // Single-line indent ［＃○字下げ］ — LINE-HEAD only.
  const amount = indentAmount(inner);
  if (amount !== null) {
    return atLineStart
      ? { kind: 'indent', raw, amount }
      : { kind: 'comment', raw, inner };
  }

  // Short (inline) span START ［＃傍点／左に傍線／太字］.
  if (resolveStyle(inner) !== null) {
    return { kind: 'emphasisSpanStart', raw, variant: inner };
  }

  return { kind: 'comment', raw, inner };
}

/**
 * Corner-target postfix. Connector rules: strip a single に / は; の is NOT a connector (の左に is
 * a direction prefix handled whole by resolveStyle). に→emph/line, は→weight/style; a channel
 * mismatch (「対象」は傍点 etc.) or unknown variant degrades to a comment.
 */
function classifyPostfix(inner: string, raw: string): Token {
  const close = inner.indexOf(CORNER_CLOSE, CORNER_OPEN.length);
  if (close === -1) {
    return { kind: 'comment', raw, inner };
  }
  const target = inner.slice(CORNER_OPEN.length, close);
  let rest = inner.slice(close + CORNER_CLOSE.length);
  let family: 'ni' | 'ha' | null = null;
  if (rest.startsWith(CONNECTOR_HA)) {
    family = 'ha';
    rest = rest.slice(CONNECTOR_HA.length);
  } else if (rest.startsWith(CONNECTOR_NI)) {
    family = 'ni';
    rest = rest.slice(CONNECTOR_NI.length);
  }
  const style = resolveStyle(rest);
  if (target !== '' && style !== null && connectorMatches(family, style.channel)) {
    return { kind: 'emphasisPostfix', raw, target, variant: rest };
  }
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
      // Line-head test for the ［＃○字下げ］ directive: the ［ opens the line at BOF or just past
      // a line break. A lone '\r' counts too — VS Code and LSP both treat it as a line separator,
      // so the tmLanguage `^` matches after it; this must agree or the two layers would colour a
      // ［＃○字下げ］ after a bare '\r' differently. Only classifyAnnotation's single-line indent
      // branch reads it.
      const atLineStart =
        i === 0 || src.charAt(i - 1) === '\n' || src.charAt(i - 1) === '\r';
      const inner = src.slice(i + 2, close);
      const raw = src.slice(i, close + 1);
      flushText();
      tokens.push(classifyAnnotation(inner, raw, atLineStart));
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
// Unpaired block directives (Warning diagnostics)
// ---------------------------------------------------------------------------

/** An unpaired block directive as absolute source offsets. `kind` picks the message code. */
export interface UnpairedBlock {
  readonly start: number;
  readonly end: number;
  readonly kind: 'unterminated' | 'dangling';
}

type BlockChannel = 'indent' | 'weight' | 'style';

/** The block channel a token opens/closes, or null if it is not a block directive. */
function blockChannelOf(token: Token): BlockChannel | null {
  if (token.kind === 'indentBlockStart' || token.kind === 'indentBlockEnd') {
    return 'indent';
  }
  if (
    (token.kind === 'emphasisSpanStart' || token.kind === 'emphasisSpanEnd') &&
    token.block === true
  ) {
    const c = resolveStyle(token.variant)?.channel;
    return c === 'weight' || c === 'style' ? c : null;
  }
  return null;
}

/**
 * Source spans of every block directive left unpaired — unterminated ［＃ここから…］ (open at EOF)
 * and dangling ［＃ここで…終わり］ (no open block) — in document order, re-derived from
 * {@link tokenize} so the Warning diagnostics can never disagree with the render. Rendering itself
 * is always lenient (EOF auto-close, dangling no-op); this is the ONLY error surface for blocks, a
 * Warning (vs the unclosed-［＃ Error of {@link findBrokenAnnotations}).
 *
 * Pairing is one INDEPENDENT SINGLE SLOT per channel (indent / weight / style), NOT a stack:
 * blocks may overlap across channels (a 太字 block inside a 字下げ block is fine), and a
 * still-open same-channel start is simply superseded (the render is last-wins — e.g. ２字下げ
 * re-opened as ４字下げ is a legal amount change, not an unterminated block). Inline spans
 * (no `block` flag) never participate.
 */
export function findUnpairedBlocks(src: string): UnpairedBlock[] {
  const spans: UnpairedBlock[] = [];
  const open: Record<BlockChannel, { start: number; end: number } | undefined> = {
    indent: undefined,
    weight: undefined,
    style: undefined,
  };
  let offset = 0;
  for (const token of tokenize(src)) {
    const ch = blockChannelOf(token);
    if (ch !== null) {
      const span = { start: offset, end: offset + token.raw.length };
      const isStart = token.kind === 'indentBlockStart' || token.kind === 'emphasisSpanStart';
      if (isStart) {
        open[ch] = span; // replace: a still-open same-channel start is superseded (render is last-wins)
      } else if (open[ch] !== undefined) {
        open[ch] = undefined; // paired
      } else {
        spans.push({ ...span, kind: 'dangling' });
      }
    }
    offset += token.raw.length;
  }
  for (const ch of ['indent', 'weight', 'style'] as const) {
    const s = open[ch];
    if (s !== undefined) {
      spans.push({ start: s.start, end: s.end, kind: 'unterminated' });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
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
