/**
 * Build-time pagination engine: flows a book's token stream into an explicit
 * page → line DOM skeleton (`<div class="page"><div class="line">…`). Unlike the
 * continuous preview, the build output is paginated IN the compiler so printed pages are
 * WYSIWYG and the page furniture (page numbers, line numbers, 原稿用紙 grid) has real
 * elements to hang off. Pure + vscode-free.
 *
 * Line breaking is a simple hard wrap at `charsPerLine` cells (full-width char = 1 cell,
 * a ruby unit = its TRUE advance — the base char count, or the longest reading's extent in
 * whole cells when that is longer — and is atomic, a 縦中横 cell = ALWAYS 1 cell however many
 * chars it combines, emphasis adds no cells, comments are zero-width). 禁則処理 is gated by
 * the `avoidLineBreaks` flag and folded into {@link wrapRow} as a leftward nudge of each break
 * point (追い出し only). ［＃改ページ］ forces a new page.
 */
import type { BuildChrome, PageNumberPosition } from './chrome.ts';
import { resolveStyle } from './emphasis.ts';
import { escapeComment, escapeHtml } from './escape.ts';
import { tokenize, type Token } from './tokenizer.ts';

/**
 * One laid-out glyph group: a char (1 cell), a ruby unit (base char count, atomic), or a
 * 縦中横 cell (ALWAYS 1 cell however many half-width chars it combines, atomic).
 */
interface Unit {
  cells: number;
  html: string;
  /** Plain text for postfix-emphasis matching; '' for zero-width units (comments). */
  text: string;
  /**
   * Space-separated on-demand stylesheet classes baked inside `html` (tcy / rr / lr / br /
   * rh-N) — not channels (invisible to unitKey); emitLine collects them into `used` so css.ts
   * emits each rule only when actually present (zero dead rules).
   */
  cssClass?: string | undefined;
  /**
   * Structured readings for a ruby unit — `html` is regenerated from this when a 左ルビ later
   * attaches a left reading, so the pre-baked html never needs re-parsing.
   */
  ruby?: { base: string; right?: string | undefined; left?: string | undefined } | undefined;
  // Four INDEPENDENT presentation channels. Field name == emphasis.ts Channel, so a resolved
  // style is applied by `unit[style.channel] = style.className`. undefined = that channel off
  // (explicit `| undefined` so snapshots may write the off state under exactOptionalPropertyTypes).
  /** 傍点: `emph-<slug>` / `-l`. */
  emph?: string | undefined;
  /** 傍線: `dec-<slug>` / `-l`. */
  line?: string | undefined;
  /** 太字: `b`. */
  weight?: string | undefined;
  /** 斜体: `i`. */
  style?: string | undefined;
}

/** A source row: a line of units (+ optional 字下げ), or a forced page break. */
export type Row =
  | {
      readonly kind: 'line';
      readonly srcLine: number;
      readonly units: Unit[];
      readonly indent?: number;
    }
  | { readonly kind: 'pagebreak' };

/** A laid-out display line — one column on the page. `indent` = 字下げ cells (already clamped). */
export interface DisplayLine {
  readonly srcLine: number;
  readonly units: readonly Unit[];
  readonly indent?: number;
}

/**
 * The LAST occurrence of `target` in the units' concatenated text, required to cover WHOLE
 * units — only a match cutting into an atomic ruby/tcy unit is rejected (plain text is
 * per-char), and only the lastIndexOf hit is tested (the spec's forward references sit
 * adjacent to their target). Shared by every corner-target postfix so binding semantics never
 * diverge; returns the inclusive unit-index range, or null (absent / unaligned).
 */
function matchTarget(
  units: readonly Unit[],
  target: string,
): { first: number; last: number } | null {
  let text = '';
  const bounds: { start: number; end: number; index: number }[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u === undefined || u.text === '') {
      continue;
    }
    bounds.push({ start: text.length, end: text.length + u.text.length, index: i });
    text += u.text;
  }
  const pos = text.lastIndexOf(target);
  if (pos === -1) {
    return null;
  }
  const matchEnd = pos + target.length;
  const first = bounds.find((b) => b.start === pos);
  const last = bounds.find((b) => b.end === matchEnd);
  if (first === undefined || last === undefined) {
    return null; // the match cuts into an atomic unit — not aligned
  }
  return { first: first.index, last: last.index };
}

/** The annotation-degrade comment unit (verbatim inner), shared by every postfix applier. */
function commentUnit(raw: string): Unit {
  return { cells: 0, html: `<!--${escapeComment(raw.slice(2, -1))}-->`, text: '' };
}

/**
 * JIS ルビ掛け allowance: a reading may hang over adjacent glyphs by half a ruby glyph
 * (0.25em) per side — 2 quarters total — before the box has to grow. Half of JLREQ's kana
 * allowance (https://www.w3.org/TR/jlreq/ §3.3), applied uniformly so hanging over kanji
 * stays unobtrusive.
 */
const RUBY_OVERHANG_QUARTERS = 2;

/**
 * A ruby unit's advance in WHOLE cells: max of the base run and each reading at the 0.5em lane
 * size (full-width glyph = 2 quarter-em, half-width ≈ 1, so a rotated Latin reading is not
 * over-counted), minus an optional ルビ掛け `overhang` allowance per reading. Cells, `rh-N`
 * and the lane distribution all derive from this ONE number, so grid and paint never disagree.
 */
function rubyCells(
  r: { base: string; right?: string | undefined; left?: string | undefined },
  overhang = 0,
): number {
  const advance = (s: string | undefined): number => {
    let quarters = 0;
    for (const ch of s ?? '') {
      quarters += /[\x20-\x7e]/.test(ch) ? 1 : 2;
    }
    return Math.ceil(Math.max(0, quarters - overhang) / 4);
  };
  return Math.max(Array.from(r.base).length, advance(r.right), advance(r.left));
}

/**
 * Justification units for a ruby-lane run (a reading or a base): one `<span>` per CJK glyph,
 * one per half-width word (spaces only separate). The lanes' flex space-around then reproduces
 * native `ruby-align: space-around` — kana stretch across the box, a Latin word centres on it.
 */
function readingSpans(reading: string): string {
  const units: string[] = [];
  let word = '';
  for (const ch of reading) {
    if (ch === ' ' || ch === '　') {
      if (word !== '') {
        units.push(word);
        word = '';
      }
    } else if (/[\x21-\x7e]/.test(ch)) {
      word += ch; // a rotated half-width word must not split
    } else {
      if (word !== '') {
        units.push(word);
        word = '';
      }
      units.push(ch);
    }
  }
  if (word !== '') {
    units.push(word);
  }
  return units.map((u) => `<span>${escapeHtml(u)}</span>`).join('');
}

/**
 * The HTML for a ruby unit — EVERY ruby renders through the custom lanes (rr/lr/br): Chrome
 * has no working double-sided ruby (`ruby-position` on an `<rt>` is ignored; a second `<rt>`
 * stacks under the base) and native's fractional advance breaks the whole-cell grid. The
 * semantic `<ruby>`/`<rt>` tags stay; base and readings are {@link readingSpans} units and a
 * reading longer than the base adds the on-demand `rh-N` stretch class.
 */
function rubyHtml(
  r: { base: string; right?: string | undefined; left?: string | undefined },
  cells: number,
): string {
  const right = r.right === undefined ? '' : `<rt>${readingSpans(r.right)}</rt>`;
  const left = r.left === undefined ? '' : `<rt class="rt-l">${readingSpans(r.left)}</rt>`;
  return `<ruby class="${rubyLane(r, cells).cssClass}">${readingSpans(r.base)}${right}${left}</ruby>`;
}

/**
 * The stylesheet face of a ruby at the DECIDED advance: its side class (rr/lr/br) plus `rh-N`
 * when the box outgrows the base. Shared by {@link rubyHtml}, buildRows and
 * {@link applyLeftRuby} so class attribute, used-sink and cell accounting never drift apart.
 */
function rubyLane(
  r: { base: string; right?: string | undefined; left?: string | undefined },
  cells: number,
): { cssClass: string } {
  const stretch = cells > Array.from(r.base).length ? ` rh-${String(cells)}` : '';
  const side = r.left === undefined ? 'rr' : r.right === undefined ? 'lr' : 'br';
  return { cssClass: side + stretch };
}

/**
 * Attaches a LEFT reading to the boundary-aligned last occurrence of `target`: exactly one
 * ruby unit whose base matches → 両側 (the left reading joins it); plain text units only →
 * merged into one left-ruby unit. Anything mixed would silently destroy an inner reading/cell,
 * so it degrades + warns; reading lengths follow the same {@link rubyCells} accounting.
 */
function applyLeftRuby(
  units: Unit[],
  target: string,
  reading: string,
  raw: string,
  miss?: () => void,
): void {
  if (target !== '' && reading !== '') {
    const m = matchTarget(units, target);
    if (m !== null) {
      const real = units.slice(m.first, m.last + 1).filter((u) => u.text !== '');
      const single = real.length === 1 ? real[0] : undefined;
      // `target` is a non-empty string, so a matching chain proves single AND its ruby exist.
      if (single?.ruby?.base === target) {
        single.ruby = { ...single.ruby, left: reading };
        const cells = rubyCells(single.ruby); // safe; the settle pass may tighten at line end
        single.cells = cells; // a long reading stretches the box — the grid follows
        single.html = rubyHtml(single.ruby, cells);
        single.cssClass = rubyLane(single.ruby, cells).cssClass;
        return;
      }
      if (real.every((u) => u.ruby === undefined && u.cssClass === undefined)) {
        const first = units[m.first];
        const ruby = { base: target, left: reading };
        const cells = rubyCells(ruby);
        const merged: Unit = {
          cells,
          html: rubyHtml(ruby, cells),
          text: target,
          emph: first?.emph,
          line: first?.line,
          weight: first?.weight,
          style: first?.style,
          cssClass: rubyLane(ruby, cells).cssClass,
          ruby,
        };
        const kept = units.slice(m.first, m.last + 1).filter((u) => u.text === '');
        units.splice(m.first, m.last - m.first + 1, merged, ...kept);
        return;
      }
    }
    miss?.();
  }
  units.push(commentUnit(raw));
}

/**
 * Merges the boundary-aligned last occurrence of `target` into ONE combined upright cell
 * (縦中横): cells is always 1, `text` keeps the run so later postfixes still match, channels
 * are inherited from the first replaced unit, zero-width units re-insert after the cell.
 * Whole-unit coverage of a ruby REPLACES it (手動縦中横 > ルビ); an unresolved target degrades
 * + reports like applyPostfix.
 */
function applyTcyPostfix(units: Unit[], target: string, raw: string, miss?: () => void): void {
  if (target !== '') {
    const m = matchTarget(units, target);
    if (m !== null) {
      const first = units[m.first];
      const merged: Unit = {
        cells: 1,
        html: `<span class="tcy">${escapeHtml(target)}</span>`,
        text: target,
        emph: first?.emph,
        line: first?.line,
        weight: first?.weight,
        style: first?.style,
        cssClass: 'tcy',
      };
      const kept = units.slice(m.first, m.last + 1).filter((u) => u.text === '');
      units.splice(m.first, m.last - m.first + 1, merged, ...kept);
      return;
    }
    miss?.();
  }
  units.push(commentUnit(raw));
}

/**
 * Marks the units covering the LAST occurrence of `target` with `variant`'s style class. The
 * match must ALIGN to unit boundaries ({@link matchTarget}); an unresolved target (absent from
 * the line, or cutting into an atomic ruby/tcy unit) applies nothing, degrades the annotation to
 * a comment and reports through `miss` — the editor's `syntax.postfixTargetMissing` Warning.
 */
function applyPostfix(
  units: Unit[],
  target: string,
  variant: string,
  raw: string,
  miss?: () => void,
): void {
  const style = resolveStyle(variant, 'postfix');
  if (style !== null && target !== '') {
    const m = matchTarget(units, target);
    if (m !== null) {
      for (let i = m.first; i <= m.last; i += 1) {
        const u = units[i];
        if (u !== undefined && u.text !== '') {
          // Same-channel OVERWRITE (an atomic remove+add); other channels stack alongside.
          u[style.channel] = style.className;
        }
      }
      return;
    }
    miss?.();
  }
  // Target unresolved (or unknown variant) => degrade to a comment (verbatim inner).
  units.push(commentUnit(raw));
}

/**
 * Builds the rows (lines + page breaks) for ONE file's token stream. The optional `issues`
 * sink collects the token indices of unresolved corner-target postfixes — the render's own
 * failure list, mapped back to source spans by {@link findPostfixTargetIssues} so the Warnings
 * can never disagree with what was applied. Render callers pass nothing (zero cost).
 */
export function buildRows(tokens: readonly Token[], issues?: number[]): Row[] {
  const rows: Row[] = [];
  let cur: Unit[] = [];
  let srcLine = 0;
  let isPageBreak = false;
  // Four independent decoration channels. Keys == emphasis.ts Channel.
  const active: {
    emph?: string | undefined;
    line?: string | undefined;
    weight?: string | undefined;
    style?: string | undefined;
  } = {};
  let activeIndent = 0; // block 字下げ in effect, carried ACROSS lines
  let curIndent = 0; // indent for the line under construction (line start = activeIndent)
  let lineSuppressed = false; // a block directive token appeared on THIS line

  // Snapshot the four active channels onto a new unit — one stable hidden class for all real units.
  const mk = (cells: number, html: string, text: string): Unit => ({
    cells,
    html,
    text,
    emph: active.emph,
    line: active.line,
    weight: active.weight,
    style: active.style,
  });

  // 縦中横 span accumulator (LINE-local): body text goes into the buffer and flushes as ONE
  // 1-cell combined unit. No nesting — a ruby token contributes its raw literally, other
  // annotations keep their normal handling.
  let tcyBuf: string | null = null;
  const flushTcy = (): void => {
    if (tcyBuf !== null) {
      if (tcyBuf !== '') {
        const u = mk(1, `<span class="tcy">${escapeHtml(tcyBuf)}</span>`, tcyBuf);
        u.cssClass = 'tcy';
        cur.push(u);
      }
      tcyBuf = null;
    }
  };

  // JIS ルビ掛け settle pass (row complete): tighten each ruby back toward its on-grid base
  // width when both flow neighbours tolerate the ≤0.25em/side hang — no ruby/傍点/傍線 of
  // their own (shared lanes); a row edge tolerates it too. The centre-anchored lanes render
  // the hang by themselves, so only cells/class/html need re-deriving.
  const settleRubyOverhang = (): void => {
    const tolerant = (from: number, step: number): boolean => {
      for (let k = from + step; k >= 0 && k < cur.length; k += step) {
        const n = cur[k];
        if (n === undefined || n.text === '') {
          continue; // zero-width (comments): look past them
        }
        return n.ruby === undefined && n.emph === undefined && n.line === undefined;
      }
      return true; // row edge
    };
    for (let i = 0; i < cur.length; i += 1) {
      const u = cur[i];
      if (u?.ruby === undefined) {
        continue;
      }
      const tight = rubyCells(u.ruby, RUBY_OVERHANG_QUARTERS);
      if (tight < u.cells && tolerant(i, -1) && tolerant(i, 1)) {
        u.cells = tight;
        u.cssClass = rubyLane(u.ruby, tight).cssClass;
        u.html = rubyHtml(u.ruby, tight);
      }
    }
  };

  const endLine = (isFlush: boolean): void => {
    settleRubyOverhang();
    const hasReal = cur.some((u) => u.cells > 0);
    if (isPageBreak) {
      if (cur.length > 0) {
        rows.push({ kind: 'line', srcLine, units: cur, indent: curIndent });
      }
      rows.push({ kind: 'pagebreak' });
    } else if (lineSuppressed && !hasReal) {
      // A block-directive-only line (no real text) paints NO column. A plain comment-only line
      // never sets lineSuppressed, so it still falls through and keeps its blank column.
    } else if (cur.length > 0 || !isFlush) {
      // On a real '\n' an empty line is a genuine blank column (kept); at end-of-input
      // a trailing empty line is just the final newline artifact (dropped).
      rows.push({ kind: 'line', srcLine, units: cur, indent: curIndent });
    }
    cur = [];
    isPageBreak = false;
    lineSuppressed = false;
    curIndent = activeIndent; // next line inherits the block indent (0 if none)
  };

  for (let ti = 0; ti < tokens.length; ti += 1) {
    const token = tokens[ti];
    if (token === undefined) {
      continue;
    }
    switch (token.kind) {
      case 'text': {
        const parts = token.text.split('\n');
        for (let idx = 0; idx < parts.length; idx += 1) {
          if (idx > 0) {
            flushTcy(); // an open ［＃縦中横］ auto-closes at its line end (line-local)
            endLine(false);
            srcLine += 1;
          }
          const part = parts[idx] ?? '';
          if (tcyBuf !== null) {
            tcyBuf += part;
          } else {
            for (const ch of part) {
              cur.push(mk(1, escapeHtml(ch), ch));
            }
          }
        }
        break;
      }
      case 'rubyExplicit':
      case 'rubyImplicit': {
        if (tcyBuf !== null) {
          tcyBuf += token.raw; // no nesting inside 縦中横 — the ruby markup stays literal
          break;
        }
        const ruby = { base: token.base, right: token.reading };
        const cells = rubyCells(ruby); // safe whole-cell advance; the settle pass may tighten
        const u = mk(cells, '', token.base);
        u.ruby = ruby;
        u.cssClass = rubyLane(ruby, cells).cssClass; // rr (+ rh-N); 左ルビ may upgrade to br
        u.html = rubyHtml(u.ruby, cells);
        cur.push(u);
        break;
      }
      case 'rubyLeftPostfix':
        applyLeftRuby(
          cur,
          token.target,
          token.reading,
          token.raw,
          issues === undefined ? undefined : () => issues.push(ti),
        );
        break;
      case 'emphasisPostfix':
        applyPostfix(
          cur,
          token.target,
          token.variant,
          token.raw,
          issues === undefined ? undefined : () => issues.push(ti),
        );
        break;
      case 'tcyPostfix':
        applyTcyPostfix(
          cur,
          token.target,
          token.raw,
          issues === undefined ? undefined : () => issues.push(ti),
        );
        break;
      case 'tcySpanStart':
        // A redundant start inside an open span is a no-op (already combining).
        tcyBuf ??= '';
        break;
      case 'tcySpanEnd':
        flushTcy(); // dangling (no open span) is a render no-op; the diagnostics warn
        break;
      case 'emphasisSpanStart': {
        const d = resolveStyle(token.variant, 'span');
        if (d !== null) {
          active[d.channel] = d.className; // same-channel overwrite; other channels untouched
        }
        if (token.block === true) {
          lineSuppressed = true; // ［＃ここから太字/斜体］ own-line directive
        }
        break;
      }
      case 'emphasisSpanEnd': {
        const d = resolveStyle(token.variant, 'span');
        if (d !== null) {
          active[d.channel] = undefined; // clear ONLY this channel (lenient within a channel)
        }
        if (token.block === true) {
          lineSuppressed = true;
        }
        break;
      }
      case 'indent':
        // Tokenizer guarantees line-head; applies to THIS logical line only.
        curIndent = token.amount;
        break;
      case 'indentBlockStart':
        // Affects SUBSEQUENT lines; a same-line text keeps the pre-block indent.
        activeIndent = token.amount;
        lineSuppressed = true;
        break;
      case 'indentBlockEnd':
        activeIndent = 0; // dangling end (no open block) is a no-op: already 0
        lineSuppressed = true;
        break;
      case 'comment':
        cur.push({ cells: 0, html: `<!--${escapeComment(token.inner)}-->`, text: '' });
        break;
      case 'brokenAnnotation': {
        // Unclosed ［＃… (swallowed to its line end): visible literal text, so the preview/build
        // never silently drop prose — the editor diagnostic is the error surface. raw never
        // contains a line break, so no endLine handling is needed here.
        if (tcyBuf !== null) {
          tcyBuf += token.raw; // literal text joins the combined cell like any other prose
          break;
        }
        for (const ch of token.raw) {
          cur.push(mk(1, escapeHtml(ch), ch));
        }
        break;
      }
      case 'pageBreak':
        isPageBreak = true;
        break;
      default: {
        const exhaustive: never = token;
        throw new Error(`buildRows: unhandled token ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  flushTcy(); // an open ［＃縦中横］ at end of input closes with its line
  endLine(true);
  return rows;
}

/** An unresolved corner-target postfix as absolute source offsets, with its target text. */
export interface PostfixTargetIssue {
  readonly start: number;
  readonly end: number;
  readonly target: string;
}

/**
 * Source spans of every corner-target postfix whose target could not be resolved (absent, or
 * not unit-aligned) — derived by RUNNING {@link buildRows} itself, offsets recovered by
 * accumulating `raw.length` like findBrokenAnnotations.
 */
export function findPostfixTargetIssues(src: string): PostfixTargetIssue[] {
  const tokens = tokenize(src);
  const misses: number[] = [];
  buildRows(tokens, misses);
  if (misses.length === 0) {
    return [];
  }
  const failed = new Set(misses);
  const out: PostfixTargetIssue[] = [];
  let offset = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t !== undefined) {
      if (
        failed.has(i) &&
        (t.kind === 'emphasisPostfix' || t.kind === 'tcyPostfix' || t.kind === 'rubyLeftPostfix')
      ) {
        out.push({ start: offset, end: offset + t.raw.length, target: t.target });
      }
      offset += t.raw.length;
    }
  }
  return out;
}

/**
 * Single chars forbidden at line END (追い出し: push down to next line) — 行末禁則.
 * Opening brackets per JIS X 4051 / common Japanese novel typesetting.
 */
const KINSOKU_OPEN = new Set('「『（〔［｛〈《【〘〖｟');
/**
 * Single chars forbidden at line START (pull the preceding char down) — 行頭禁則.
 * Closing brackets, punctuation, small kana, and prolonged-sound / iteration marks
 * per JIS X 4051 / common Japanese novel typesetting.
 */
const KINSOKU_CLOSE = new Set(
  '」』）〕］｝〉》】〙〗｠' + // 閉じ括弧
    '、。，．・：；！？' + // 区切り・終止符号
    'ぁぃぅぇぉっゃゅょゎゕゖ' + // 小書き平仮名
    'ァィゥェォッャュョヮヵヶ' + // 小書き片仮名
    'ーゝゞヽヾ々〻', // 長音符・繰り返し記号
);

/** A unit is a forbidden single char iff it is real (cells>0), one char, and in `set`. */
function inSet(u: Unit | undefined, set: Set<string>): boolean {
  return u !== undefined && u.cells > 0 && u.text.length === 1 && set.has(u.text);
}

/** Index of the last real (cells>0) unit in `units[start..before)`, or -1 if none. */
function lastReal(units: readonly Unit[], start: number, before: number): number {
  for (let i = before - 1; i >= start; i -= 1) {
    if ((units[i]?.cells ?? 0) > 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Hard-wraps one line row's units into display lines of at most `charsPerLine` cells. A unit
 * is atomic (never split) and an over-wide unit gets its own line. A 字下げ row narrows the
 * budget to `charsPerLine − N_eff` (N_eff = indent clamped to keep ≥1 content cell) and stamps
 * the SAME N_eff onto every display line — the first AND each wrapped continuation are indented
 * alike, and class / CSS padding / wrap budget all derive from this one value so the column can
 * never overflow. When `avoidLineBreaks` is on, 禁則処理 nudges each break point LEFTWARD so a
 * line never ENDS on an opening bracket (「『【（) nor STARTS with a closing/punctuation char
 * (」』】）、。！？) — 追い出し only. The leftward walk re-tests the new boundary, so cascades
 * and the resulting reflow fall out naturally; the `> start` guard never empties a line, which
 * also leaves a lone-char row as-is. (禁則 walks unit text only — the indent is CSS padding,
 * not a unit, so the two never interact.)
 */
function wrapRow(
  row: Extract<Row, { kind: 'line' }>,
  charsPerLine: number,
  avoidLineBreaks: boolean,
): DisplayLine[] {
  const { srcLine, units } = row;
  const indent = Math.min(row.indent ?? 0, charsPerLine - 1); // N_eff: keep >=1 content cell
  const budget = charsPerLine - indent;
  if (units.length === 0) {
    return [{ srcLine, units: [], indent }];
  }
  const lines: DisplayLine[] = [];
  let start = 0; // first unit index of the line being built
  let cells = 0;
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u === undefined) {
      continue;
    }
    if (u.cells > 0 && i > start && cells + u.cells > budget) {
      let brk = i; // break BEFORE units[brk]
      if (avoidLineBreaks) {
        // Find the last acceptable break point
        while (
          brk > start + 1 &&
          (inSet(units[brk], KINSOKU_CLOSE) ||
            inSet(units[lastReal(units, start, brk)], KINSOKU_OPEN))
        ) {
          brk -= 1;
        }
      }
      lines.push({ srcLine, units: units.slice(start, brk), indent });
      start = brk;
      cells = 0;
      for (let j = brk; j < i; j += 1) {
        cells += units[j]?.cells ?? 0;
      }
    }
    cells += u.cells;
  }
  lines.push({ srcLine, units: units.slice(start), indent });
  return lines;
}

/** Flows rows into pages of at most `linesPerPage` lines; a pagebreak forces a new page. */
export function paginate(
  rows: readonly Row[],
  charsPerLine: number,
  linesPerPage: number,
  avoidLineBreaks: boolean,
): DisplayLine[][] {
  const pages: DisplayLine[][] = [];
  let page: DisplayLine[] = [];

  const flushPage = (): void => {
    if (page.length > 0) {
      pages.push(page);
      page = [];
    }
  };

  for (const row of rows) {
    if (row.kind === 'pagebreak') {
      flushPage();
      continue;
    }
    const lines = wrapRow(row, charsPerLine, avoidLineBreaks);
    for (const line of lines) {
      if (page.length >= linesPerPage) {
        pages.push(page);
        page = [];
      }
      page.push(line);
    }
  }
  flushPage();
  return pages;
}

/**
 * The four channels in a FIXED order → a deterministic class attribute that doubles as the
 * adjacent-merge key. '' = no decoration (the common case — no allocation, no `<span>`).
 */
function unitKey(u: Unit): string {
  if (
    u.emph === undefined &&
    u.line === undefined &&
    u.weight === undefined &&
    u.style === undefined
  ) {
    return '';
  }
  let k = '';
  if (u.emph !== undefined) {
    k = u.emph;
  }
  if (u.line !== undefined) {
    k = k === '' ? u.line : `${k} ${u.line}`;
  }
  if (u.weight !== undefined) {
    k = k === '' ? u.weight : `${k} ${u.weight}`;
  }
  if (u.style !== undefined) {
    k = k === '' ? u.style : `${k} ${u.style}`;
  }
  return k; // e.g. "emph-fs dec-solid-l b"
}

function emitLine(line: DisplayLine, used?: Set<string>, anchor = true, head = ''): string {
  let html = '';
  let open = ''; // '' sentinel (a real key is never '')
  for (const u of line.units) {
    if (used && u.cssClass !== undefined) {
      for (const c of u.cssClass.split(' ')) {
        used.add(c); // on-demand stylesheet classes baked inside u.html (tcy / rr / lr / br / rh-N)
      }
    }
    const key = unitKey(u);
    if (key !== open) {
      if (open !== '') {
        html += '</span>';
      }
      open = key;
      if (open !== '') {
        if (used) {
          for (const c of open.split(' ')) {
            used.add(c);
          }
        }
        html += `<span class="${open}">`;
      }
    }
    html += u.html;
  }
  if (open !== '') {
    html += '</span>';
  }
  const ind = line.indent ?? 0;
  const indentClass = ind > 0 ? ` indent-${String(ind)}` : '';
  if (used && ind > 0) {
    used.add(`indent-${String(ind)}`);
  }
  // `anchor` lets the continuous preview suppress data-line on a source line's wrapped
  // continuation columns (first-display-line-only); the paginated build keeps the default
  // (anchor=true → every line), so its output is unchanged. `head` is out-of-flow line
  // furniture (the preview's number span) emitted before the column content.
  const dataLine =
    anchor && line.srcLine >= 0 ? ` data-line="${String(line.srcLine)}"` : '';
  return `<div class="line${indentClass}"${dataLine}>${head}${html}</div>`;
}

/** The folio's physical side on page `pi` (0-based), or null for no folio. */
function folioSide(pos: PageNumberPosition, pi: number): 'r' | 'l' | null {
  if (pos === 'none') {
    return null;
  }
  const odd = pi % 2 === 0; // display page = pi + 1, so an even index is an odd page
  switch (pos) {
    case 'rightThenLeft':
      return odd ? 'r' : 'l';
    case 'leftThenRight':
      return odd ? 'l' : 'r';
    case 'alwaysRight':
      return 'r';
    case 'alwaysLeft':
      return 'l';
  }
}

/** One page's absolutely-positioned furniture (header + folio), emitted after its lines. */
function pageFurniture(chrome: BuildChrome, pi: number, totalPage: number): string {
  let out = '';
  if (chrome.header !== '') {
    out += `<div class="hd">${escapeHtml(chrome.header)}</div>`;
  }
  const side = folioSide(chrome.pageNumberPosition, pi);
  if (side !== null) {
    // Escape the author's template FIRST, then substitute the plain-integer counts —
    // `{`/`}` survive escaping, so the placeholders live through it, while any markup in
    // the template is neutralized. Unknown `{foo}` stays literal. A blank template never
    // reaches here (renderBook normalizes it to pageNumberPosition 'none').
    const text = escapeHtml(chrome.pageNumberTemplate)
      .replaceAll('{page}', String(pi + 1))
      .replaceAll('{totalPage}', String(totalPage));
    out += `<div class="pn ${side}">${text}</div>`;
  }
  return out;
}

/**
 * Renders paginated pages into the `<div class="book">…</div>` body fragment, each page
 * carrying its chrome furniture AFTER the lines (so line-adjacency is preserved for
 * anything matching consecutive `.line`s). When a `used` sink is passed, every emphasis
 * class emitted is recorded into it so the caller can emit only those rules (on-demand CSS).
 */
export function pagesToHtml(
  pages: readonly DisplayLine[][],
  used: Set<string> | undefined,
  chrome: BuildChrome,
): string {
  const totalPage = pages.length;
  const body = pages
    .map((page, pi) => {
      const lines = page.map((line) => emitLine(line, used)).join('');
      return `<div class="page" data-page="${String(pi)}">${lines}${pageFurniture(chrome, pi, totalPage)}</div>`;
    })
    .join('');
  return `<div class="book">${body}</div>`;
}

/**
 * Renders ONE file's rows as a CONTINUOUS line flow for the live preview (no pagination):
 * each line row is hard-wrapped via {@link wrapRow} into `<div class="line">` columns, sharing
 * the exact same line-break + 禁則 + ruby/emphasis/comment engine the book build uses — so the
 * preview agrees with the printed page. When `lineNumbers` is on, every display column opens
 * with an out-of-flow `<span class="ln">N</span>` head-margin number that restarts at 1 after
 * each materialized break marker — computed HERE, not with CSS counters, because a
 * counter-reset on a sibling `.pagebreak` does not reset following siblings in Chromium
 * (the build's per-page reset sits on an ANCESTOR `.page`, which is reliable, so only this
 * continuous flow needs the JS fallback). The columns are grouped into `<div class="segment">`
 * blocks — one per run of lines between breaks, the build page's preview analogue, giving the
 * edge-rule frame a per-segment anchor so the 枠 closes independently on each side of a break.
 * A ［＃改ページ］ becomes a visible, labelled `<div class="pagebreak">` marker emitted
 * BETWEEN segments as a direct `.book` child (outside every frame); segments open lazily on
 * their first line, so a leading, trailing, or doubled break collapses to nothing (mirroring
 * the build's empty-page elision) — no stray marker, no empty segment. Only the FIRST display line of each
 * source line carries a `data-line` anchor (1:1 with source lines, so the cursor-follow scroller
 * lands on the line's head). When a `used` sink is passed, every emphasis class emitted is
 * recorded so the caller can emit only those rules (on-demand CSS). Pure + vscode-free.
 */
export function flowToHtml(
  rows: readonly Row[],
  charsPerLine: number,
  avoidLineBreaks: boolean,
  used?: Set<string>,
  lineNumbers = false,
): string {
  const parts: string[] = [];
  let prevSrcLine = -1;
  let pendingBreak = false;
  let segmentOpen = false;
  let lineNo = 0;
  for (const row of rows) {
    if (row.kind === 'pagebreak') {
      // Defer page breaks: only materialized once a following line exists, so leading /
      // trailing / consecutive ［＃改ページ］ never leave a dangling marker.
      if (segmentOpen) {
        pendingBreak = true;
      }
      continue;
    }
    for (const line of wrapRow(row, charsPerLine, avoidLineBreaks)) {
      if (pendingBreak) {
        // The seam: close the segment and drop the marker BETWEEN segments — the shared
        // opener below reopens for this very line, so the marker never sits inside a
        // frame and the numbering restarts with the segment it opens.
        parts.push(
          '</div>',
          '<div class="pagebreak"><span class="pb-label">改ページ</span></div>',
        );
        segmentOpen = false;
        pendingBreak = false;
        lineNo = 0;
      }
      if (!segmentOpen) {
        // Segments open lazily on their first line (never on a break), so an empty
        // segment is structurally impossible.
        parts.push('<div class="segment">');
        segmentOpen = true;
      }
      lineNo += 1;
      const anchor = line.srcLine >= 0 && line.srcLine !== prevSrcLine;
      prevSrcLine = line.srcLine;
      // The number span is absolutely positioned (out of the text flow), so it neither
      // consumes cells nor disturbs the pre-formatted column content it precedes.
      const head = lineNumbers ? `<span class="ln">${String(lineNo)}</span>` : '';
      parts.push(emitLine(line, used, anchor, head));
    }
  }
  if (segmentOpen) {
    parts.push('</div>');
  }
  return `<div class="book">${parts.join('')}</div>`;
}
