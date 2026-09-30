/**
 * The cells of a line while it is being resolved: what a corner-target postfix is matched
 * against and rewrites, and what becomes the line's content.
 */
import { composeKana, composedChars } from '../chars.ts';
import type { ComposedChar } from '../chars.ts';

import type { CharsOrigin, CommentInline, Inline, Mark, Marks, Ruby, Span, SyntaxNode, Tcy } from './nodes.ts';
import { CHANNELS } from './notation.ts';
import type { Channel } from './notation.ts';

/** Where a run of display characters came from, shared by the pieces it is cut into. */
interface Source {
  /** Source offset of the text the characters were composed from. */
  readonly start: number;
  /** A substituted value: every piece maps to this one span. */
  readonly fixed: Span | null;
  /** The display characters with their source ranges, when composing changed the text. */
  readonly chars: readonly ComposedChar[] | null;
}

/** A run of per-cell characters. */
export interface CharsCell {
  readonly kind: 'chars';
  readonly source: Source;
  readonly origin: CharsOrigin;
  readonly text: string;
  /** Display offset of `text` within its source's display text. */
  readonly from: number;
  readonly marks: Marks;
}

export type Cell = CharsCell | Ruby | Tcy | CommentInline;

/** The cell of `raw` as `node` shows it, kana composed; null when it shows nothing. */
export function charsCell(node: SyntaxNode, raw: string, origin: CharsOrigin, marks: Marks): CharsCell | null {
  const text = composeKana(raw);
  if (text === '') {
    return null;
  }
  const fixed = origin === 'value' ? node.span : null;
  const chars = fixed !== null || text === raw ? null : composedChars(raw);
  return { kind: 'chars', source: { start: node.span.start, fixed, chars }, origin, text, from: 0, marks };
}

/** The source offset of display offset `at` of `source`. */
function sourceAt(source: Source, at: number): number {
  if (source.chars === null) {
    return source.start + at;
  }
  let shown = 0;
  for (const ch of source.chars) {
    if (shown >= at) {
      return source.start + ch.start;
    }
    shown += ch.text.length;
  }
  return source.start + (source.chars[source.chars.length - 1]?.end ?? 0);
}

export function spanOf(cell: Cell): Span {
  if (cell.kind !== 'chars') {
    return cell.span;
  }
  return cell.source.fixed ?? {
    start: sourceAt(cell.source, cell.from),
    end: sourceAt(cell.source, cell.from + cell.text.length),
  };
}

/** The text a postfix target is matched against; '' for a zero-width cell. */
export function textOf(cell: Cell): string {
  switch (cell.kind) {
    case 'chars':
    case 'tcy':
      return cell.text;
    case 'ruby':
      return cell.base;
    case 'comment':
      return '';
  }
}

/** True iff `text` may be cut at `at`: never between the halves of a surrogate pair. */
function isCharBoundary(text: string, at: number): boolean {
  const high = text.charCodeAt(at - 1);
  const low = text.charCodeAt(at);
  return !(high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff);
}

function cut(cell: CharsCell, at: number): [CharsCell, CharsCell] {
  return [
    { ...cell, text: cell.text.slice(0, at) },
    { ...cell, text: cell.text.slice(at), from: cell.from + at },
  ];
}

/**
 * The LAST occurrence of `target` in the cells' concatenated text, as an inclusive index range
 * of WHOLE cells — a character run is cut where the match starts and ends; a match cutting into
 * a ruby or a 縦中横 cell is none. Only that last occurrence is tested (the spec's forward
 * references sit next to their target).
 */
export function matchTarget(cells: Cell[], target: string): { first: number; last: number } | null {
  // Read back from the end, each stretch as long as all read before it: the last occurrence is
  // met first, long before the head of a long line.
  let text = '';
  let from = cells.length; // cells[from..] are read
  let pos = -1;
  while (pos === -1 && from > 0) {
    const want = Math.max(target.length, text.length, 64);
    let stretch = '';
    while (from > 0 && stretch.length < want) {
      from -= 1;
      const cell = cells[from];
      stretch = (cell === undefined ? '' : textOf(cell)) + stretch;
    }
    text = stretch + text;
    pos = text.lastIndexOf(target);
  }
  if (pos === -1) {
    return null;
  }
  const bounds: { start: number; end: number; index: number }[] = [];
  let at = 0;
  for (let index = from; index < cells.length; index += 1) {
    const cell = cells[index];
    const t = cell === undefined ? '' : textOf(cell);
    if (t !== '') {
      bounds.push({ start: at, end: at + t.length, index });
      at += t.length;
    }
  }
  const end = pos + target.length;
  const head = bounds.find((b) => b.start <= pos && pos < b.end);
  const tail = bounds.find((b) => b.start < end && end <= b.end);
  const headCell = head === undefined ? undefined : cells[head.index];
  const tailCell = tail === undefined ? undefined : cells[tail.index];
  if (head === undefined || tail === undefined || headCell === undefined || tailCell === undefined) {
    return null;
  }
  const headAt = pos - head.start;
  const tailAt = end - tail.start;
  if (headAt !== 0 && (headCell.kind !== 'chars' || !isCharBoundary(headCell.text, headAt))) {
    return null;
  }
  if (end !== tail.end && (tailCell.kind !== 'chars' || !isCharBoundary(tailCell.text, tailAt))) {
    return null;
  }
  let first = head.index;
  let last = tail.index;
  if (end !== tail.end && tailCell.kind === 'chars') {
    cells.splice(last, 1, ...cut(tailCell, tailAt));
  }
  const cutHead = cells[first];
  if (headAt !== 0 && cutHead?.kind === 'chars') {
    cells.splice(first, 1, ...cut(cutHead, headAt));
    first += 1;
    last += 1;
  }
  return { first, last };
}

/** `marks` with `channel` set to `mark`, or cleared when `mark` is undefined. */
export function withMark(marks: Marks, channel: Channel, mark: Mark | undefined): Marks {
  const out: Partial<Record<Channel, Mark>> = {};
  for (const ch of CHANNELS) {
    const m = ch === channel ? mark : marks[ch];
    if (m !== undefined) {
      out[ch] = m;
    }
  }
  return out;
}

/** `marks`, each channel it leaves off taken from the first of `cells` that sets it. */
export function withMarksOf(marks: Marks, cells: readonly Cell[]): Marks {
  let out = marks;
  for (const cell of cells) {
    if (cell.kind !== 'comment') {
      for (const ch of CHANNELS) {
        if (out[ch] === undefined && cell.marks[ch] !== undefined) {
          out = withMark(out, ch, cell.marks[ch]);
        }
      }
    }
  }
  return out;
}

function sameMarks(a: Marks, b: Marks): boolean {
  return a === b || CHANNELS.every((ch) => a[ch]?.variant === b[ch]?.variant && a[ch]?.left === b[ch]?.left);
}

/**
 * Where each character of `cell` was written, when kana were composed in its source; null when
 * each sits at its span start plus its offset. `from` counts the display text, so the walk adds
 * up display lengths.
 */
function startsOf(cell: CharsCell): number[] | null {
  const { source } = cell;
  if (source.chars === null) {
    return null;
  }
  const starts: number[] = [];
  const end = cell.from + cell.text.length;
  let shown = 0;
  for (const ch of source.chars) {
    if (shown >= end) {
      break;
    }
    if (shown >= cell.from) {
      starts.push(source.start + ch.start);
    }
    shown += ch.text.length;
  }
  return starts;
}

/** The cells as content: adjacent pieces of one source with equal marks rejoin into one run. */
export function contentOf(cells: readonly Cell[]): Inline[] {
  const runs: Cell[] = [];
  for (const cell of cells) {
    const run = runs[runs.length - 1];
    if (
      cell.kind === 'chars' &&
      run?.kind === 'chars' &&
      run.source === cell.source &&
      run.from + run.text.length === cell.from &&
      sameMarks(run.marks, cell.marks)
    ) {
      runs[runs.length - 1] = { ...run, text: run.text + cell.text };
    } else {
      runs.push(cell);
    }
  }
  return runs.map((run): Inline => {
    if (run.kind !== 'chars') {
      return run;
    }
    // `starts` goes last: spread mid-literal, V8 builds every run on its slow path once one has it.
    const starts = startsOf(run);
    return { kind: 'chars', text: run.text, span: spanOf(run), origin: run.origin, marks: run.marks, ...(starts === null ? {} : { starts }) };
  });
}
