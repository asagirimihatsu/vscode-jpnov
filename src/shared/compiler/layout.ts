/**
 * Build-time pagination engine: flows a book's token stream into an explicit
 * page → line DOM skeleton (`<div class="page"><div class="line">…`). Unlike the
 * continuous preview, the build output is paginated IN the compiler so printed pages are
 * WYSIWYG and future features (page numbers, line numbers, 原稿用紙 grid) have real
 * elements to hang off. Pure + vscode-free.
 *
 * Line breaking is a simple hard wrap at `charsPerLine` cells (full-width char = 1 cell,
 * a ruby unit = its base char count and is atomic, emphasis adds no cells, comments are
 * zero-width). 禁則処理 is gated by the `avoidLineBreaks` flag and folded into {@link wrapRow}
 * as a leftward nudge of each break point (追い出し only). ［＃改ページ］ forces a new page.
 */
import { emphasisClass } from './emphasis.ts';
import { escapeComment, escapeHtml } from './escape.ts';
import type { Token } from './tokenizer.ts';

/** One laid-out glyph group: a char (1 cell) or a ruby unit (base char count, atomic). */
interface Unit {
  cells: number;
  html: string;
  /** Plain text for postfix-emphasis matching; '' for zero-width units (comments). */
  text: string;
  /** The emphasis CSS class on this unit (e.g. `emph-fs`), or undefined for none. */
  emph: string | undefined;
}

/** A source row: a line of units, or a forced page break. */
export type Row =
  | {
      readonly kind: 'line';
      readonly srcLine: number;
      readonly units: Unit[];
    }
  | { readonly kind: 'pagebreak' };

/** A laid-out display line — one column on the page. */
export interface DisplayLine {
  readonly srcLine: number;
  readonly units: readonly Unit[];
}

/** Marks the units overlapping the LAST occurrence of `target` with `variant`'s class. */
function applyPostfix(units: Unit[], target: string, variant: string, raw: string): void {
  const emph = emphasisClass(variant);
  if (emph !== null && target !== '') {
    let text = '';
    const ranges: { start: number; end: number; unit: Unit }[] = [];
    for (const u of units) {
      if (u.text === '') {
        continue;
      }
      const start = text.length;
      text += u.text;
      ranges.push({ start, end: text.length, unit: u });
    }
    const pos = text.lastIndexOf(target);
    if (pos !== -1) {
      const matchEnd = pos + target.length;
      for (const r of ranges) {
        if (r.start < matchEnd && r.end > pos) {
          r.unit.emph = emph;
        }
      }
      return;
    }
  }
  // Target not found (or not a dot variant) => degrade to a comment (verbatim inner).
  units.push({
    cells: 0,
    html: `<!--${escapeComment(raw.slice(2, -1))}-->`,
    text: '',
    emph: undefined,
  });
}

/** Builds the rows (lines + page breaks) for ONE file's token stream. */
export function buildRows(tokens: readonly Token[]): Row[] {
  const rows: Row[] = [];
  let cur: Unit[] = [];
  let srcLine = 0;
  let isPageBreak = false;
  let activeEmph: string | undefined;

  const endLine = (isFlush: boolean): void => {
    if (isPageBreak) {
      if (cur.length > 0) {
        rows.push({ kind: 'line', srcLine, units: cur });
      }
      rows.push({ kind: 'pagebreak' });
    } else if (cur.length > 0 || !isFlush) {
      // On a real '\n' an empty line is a genuine blank column (kept); at end-of-input
      // a trailing empty line is just the final newline artifact (dropped).
      rows.push({ kind: 'line', srcLine, units: cur });
    }
    cur = [];
    isPageBreak = false;
  };

  for (const token of tokens) {
    switch (token.kind) {
      case 'text': {
        const parts = token.text.split('\n');
        for (let idx = 0; idx < parts.length; idx += 1) {
          if (idx > 0) {
            endLine(false);
            srcLine += 1;
          }
          for (const ch of parts[idx] ?? '') {
            cur.push({ cells: 1, html: escapeHtml(ch), text: ch, emph: activeEmph });
          }
        }
        break;
      }
      case 'rubyExplicit':
      case 'rubyImplicit':
        cur.push({
          cells: Array.from(token.base).length,
          html: `<ruby>${escapeHtml(token.base)}<rt>${escapeHtml(token.reading)}</rt></ruby>`,
          text: token.base,
          emph: activeEmph,
        });
        break;
      case 'emphasisPostfix':
        applyPostfix(cur, token.target, token.variant, token.raw);
        break;
      case 'emphasisSpanStart':
        activeEmph = emphasisClass(token.variant) ?? activeEmph;
        break;
      case 'emphasisSpanEnd':
        activeEmph = undefined;
        break;
      case 'comment':
        cur.push({
          cells: 0,
          html: `<!--${escapeComment(token.inner)}-->`,
          text: '',
          emph: undefined,
        });
        break;
      case 'brokenAnnotation': {
        // Unclosed ［＃… (swallowed to its line end): visible literal text, so the preview/build
        // never silently drop prose — the editor diagnostic is the error surface. raw never
        // contains a line break, so no endLine handling is needed here.
        for (const ch of token.raw) {
          cur.push({ cells: 1, html: escapeHtml(ch), text: ch, emph: activeEmph });
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
  endLine(true);
  return rows;
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
 * is atomic (never split) and an over-wide unit gets its own line. When `avoidLineBreaks` is
 * on, 禁則処理 nudges each break point LEFTWARD so a line never ENDS on an opening bracket
 * (「『【（) nor STARTS with a closing/punctuation char (」』】）、。！？) — 追い出し only.
 * The leftward walk re-tests the new boundary, so cascades and the resulting reflow fall out
 * naturally; the `> start` guard never empties a line, which also leaves a lone-char row as-is.
 */
function wrapRow(
  row: Extract<Row, { kind: 'line' }>,
  charsPerLine: number,
  avoidLineBreaks: boolean,
): DisplayLine[] {
  const { srcLine, units } = row;
  if (units.length === 0) {
    return [{ srcLine, units: [] }];
  }
  const lines: DisplayLine[] = [];
  let start = 0; // first unit index of the line being built
  let cells = 0;
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u === undefined) {
      continue;
    }
    if (u.cells > 0 && i > start && cells + u.cells > charsPerLine) {
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
      lines.push({ srcLine, units: units.slice(start, brk) });
      start = brk;
      cells = 0;
      for (let j = brk; j < i; j += 1) {
        cells += units[j]?.cells ?? 0;
      }
    }
    cells += u.cells;
  }
  lines.push({ srcLine, units: units.slice(start) });
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

function emitLine(line: DisplayLine, used?: Set<string>, anchor = true): string {
  let html = '';
  let open: string | undefined;
  for (const u of line.units) {
    if (u.emph !== open) {
      if (open !== undefined) {
        html += '</span>';
      }
      open = u.emph;
      if (open !== undefined) {
        if (used) {
          used.add(open);
        }
        html += `<span class="${open}">`;
      }
    }
    html += u.html;
  }
  if (open !== undefined) {
    html += '</span>';
  }
  // `anchor` lets the continuous preview suppress data-line on a source line's wrapped
  // continuation columns (first-display-line-only); the paginated build keeps the default
  // (anchor=true → every line), so its output is unchanged.
  const dataLine =
    anchor && line.srcLine >= 0 ? ` data-line="${String(line.srcLine)}"` : '';
  return `<div class="line"${dataLine}>${html}</div>`;
}

/**
 * Renders paginated pages into the `<div class="book">…</div>` body fragment. When a `used`
 * sink is passed, every emphasis class emitted is recorded into it so the caller can emit
 * only those rules (on-demand CSS).
 */
export function pagesToHtml(
  pages: readonly DisplayLine[][],
  used?: Set<string>,
): string {
  const body = pages
    .map((page, pi) => {
      const lines = page.map((line) => emitLine(line, used)).join('');
      return `<div class="page" data-page="${String(pi)}">${lines}</div>`;
    })
    .join('');
  return `<div class="book">${body}</div>`;
}

/**
 * Renders ONE file's rows as a CONTINUOUS line flow for the live preview (no pagination):
 * each line row is hard-wrapped via {@link wrapRow} into `<div class="line">` columns, sharing
 * the exact same line-break + 禁則 + ruby/emphasis/comment engine the book build uses — so the
 * preview agrees with the printed page. A ［＃改ページ］ becomes a visible `<hr class="pagebreak">`
 * shown BETWEEN content; a leading, trailing, or doubled break collapses to nothing (mirroring
 * the build's empty-page elision) so no stray rule appears. Only the FIRST display line of each
 * source line carries a `data-line` anchor (1:1 with source lines, so the cursor-follow scroller
 * lands on the line's head). When a `used` sink is passed, every emphasis class emitted is
 * recorded so the caller can emit only those rules (on-demand CSS). Pure + vscode-free.
 */
export function flowToHtml(
  rows: readonly Row[],
  charsPerLine: number,
  avoidLineBreaks: boolean,
  used?: Set<string>,
): string {
  const parts: string[] = [];
  let prevSrcLine = -1;
  let pendingBreak = false;
  let anyLine = false;
  for (const row of rows) {
    if (row.kind === 'pagebreak') {
      // Defer page breaks: only materialized once a following line exists, so leading /
      // trailing / consecutive ［＃改ページ］ never leave a dangling <hr>.
      if (anyLine) {
        pendingBreak = true;
      }
      continue;
    }
    for (const line of wrapRow(row, charsPerLine, avoidLineBreaks)) {
      if (pendingBreak) {
        parts.push('<hr class="pagebreak">');
        pendingBreak = false;
      }
      const anchor = line.srcLine >= 0 && line.srcLine !== prevSrcLine;
      prevSrcLine = line.srcLine;
      parts.push(emitLine(line, used, anchor));
      anyLine = true;
    }
  }
  return `<div class="book">${parts.join('')}</div>`;
}
