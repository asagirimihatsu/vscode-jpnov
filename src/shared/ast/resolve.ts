/**
 * The resolver: the syntax layer → the manuscript AST. One pass decides what the notation means:
 * each line's content in paint order, its state (字下げ, 見出し, 改ページ), which span start pairs
 * with which end, what each corner-target postfix bound to, and every structural finding.
 *
 * Recovery is lenient and total: a span open at the end of input runs to the end, a dangling end
 * does nothing, a postfix whose target is absent or cuts into an atomic cell takes no effect.
 * Content strings are display strings — kana composed, values substituted, the characters no
 * output can carry dropped — while the syntax nodes stay verbatim.
 *
 * Pure + vscode-free.
 */
import { displayText } from '../chars.ts';

import { charsCell, contentOf, matchTarget, spanOf, textOf, withMark, withMarksOf } from './cells.ts';
import type { Cell } from './cells.ts';
import { append } from './lists.ts';
import type {
  Ast,
  CharsOrigin,
  EmphasisPostfixNode,
  EmphasisSpanStartNode,
  HeadingLevel,
  Held,
  Issue,
  Line,
  Mark,
  Marks,
  PairedNode,
  PostfixNode,
  RubyMarkNode,
  RubyReadingNode,
  Span,
  SpanChannel,
  SpanCloserNode,
  SpanOpenerNode,
  Syntax,
  SyntaxLine,
  SyntaxNode,
  TcySpanEndNode,
  TcySpanStartNode,
  ValueFieldNode,
  ValueLookup,
} from './nodes.ts';
import { ANNOTATION_CLOSE, ANNOTATION_OPEN, spanChannel, valueOf } from './notation.ts';
import { bySource } from './span.ts';

/**
 * What carries from one line to the next. `open` holds one slot per channel, never a stack: a
 * start replaces a still-open start of its channel, an end clears the channel whatever its form,
 * and the channels overlap freely.
 */
interface Flow {
  marks: Marks;
  indent: number;
  heading: HeadingLevel | undefined;
  readonly open: Map<SpanChannel, SpanOpenerNode>;
}

/** What the pass collects beside the lines: the findings and the relations of {@link Ast}. */
interface Ledger {
  readonly issues: Issue[];
  readonly pairs: Map<PairedNode, Span>;
  readonly bound: Map<PostfixNode, Span>;
  readonly held: Map<TcySpanStartNode, Held>;
}

/** An explicit ｜ base under construction. */
interface OpenBase {
  /** Index of its first cell. */
  readonly start: number;
  readonly mark: RubyMarkNode;
  /** The postfixes met inside it: they bind once the base is one ruby, as if written after it. */
  readonly postfixes: { readonly node: PostfixNode; readonly judged: boolean }[];
}

/** A ［＃縦中横］ span under construction: its text becomes one cell. */
interface OpenTcy {
  readonly opener: TcySpanStartNode;
  text: string;
  readonly contentStart: number;
  contentEnd: number;
}

type LineState = Omit<Line, keyof SyntaxLine>;

/** True iff the annotation is a block form (ここから／ここで); the indent block has no other. */
function isBlockForm(node: SpanOpenerNode | SpanCloserNode): boolean {
  return node.kind === 'indentBlockStart' || node.kind === 'indentBlockEnd' || node.block === true;
}

/** The text between ［＃ and ］ of an annotation, verbatim. */
function innerOf(node: SyntaxNode): string {
  return node.text.slice(ANNOTATION_OPEN.length, node.text.length - ANNOTATION_CLOSE.length);
}

/** The mark a decoration sets on its channel. */
function markOf(node: EmphasisPostfixNode | EmphasisSpanStartNode): Mark {
  return { variant: node.variant, left: node.left };
}

/** `cells.splice(first, count, ...items)`, for any number of items. */
function replace(cells: Cell[], first: number, count: number, items: readonly Cell[]): void {
  const after = cells.splice(first).slice(count);
  append(cells, items);
  append(cells, after);
}

/** `a` and `b` pair: each is what the other relates to. */
function pair(pairs: Map<PairedNode, Span>, a: PairedNode, b: PairedNode): void {
  pairs.set(a, b.span);
  pairs.set(b, a.span);
}

class LineResolver {
  private readonly line: SyntaxLine;
  private readonly flow: Flow;
  private readonly ledger: Ledger;
  private readonly values: ValueLookup | undefined;

  private readonly cells: Cell[] = [];
  private indent: number;
  private heading: HeadingLevel | undefined;
  private pageBreak = false;
  private blockDirective = false;
  /** A value field came before: without values, whether a later postfix binds is unknowable. */
  private valueSeen = false;
  private base: OpenBase | null = null;
  private tcy: OpenTcy | null = null;

  constructor(line: SyntaxLine, flow: Flow, ledger: Ledger, values: ValueLookup | undefined) {
    this.line = line;
    this.flow = flow;
    this.ledger = ledger;
    this.values = values;
    this.indent = flow.indent;
    this.heading = flow.heading;
  }

  run(): LineState {
    for (const [at, node] of this.line.syntax.entries()) {
      if (!this.intoTcy(node)) {
        this.visit(node, at);
      }
    }
    this.closeTcy(null); // an open ［＃縦中横］ closes with its line
    return {
      content: contentOf(this.cells),
      indent: this.indent,
      ...(this.heading === undefined ? {} : { heading: this.heading }),
      pageBreak: this.pageBreak,
      blockDirective: this.blockDirective,
    };
  }

  /**
   * Nothing nests inside an open 縦中横: text, ruby markup and a broken ［＃ join the cell as
   * typed, a value field as what it shows. False when `node` does not join.
   */
  private intoTcy(node: SyntaxNode): boolean {
    const tcy = this.tcy;
    if (tcy === null) {
      return false;
    }
    switch (node.kind) {
      case 'text':
      case 'rubyMark':
      case 'rubyReading':
      case 'brokenAnnotation':
        tcy.text += node.text;
        break;
      case 'valueField':
        tcy.text += this.value(node);
        break;
      default:
        return false;
    }
    tcy.contentEnd = node.span.end;
    return true;
  }

  private visit(node: SyntaxNode, at: number): void {
    switch (node.kind) {
      case 'text':
        if (node.rubyBase !== true) {
          this.chars(node, node.text, 'prose');
        }
        break;
      case 'rubyMark':
        this.base = { start: this.cells.length, mark: node, postfixes: [] };
        break;
      case 'rubyReading':
        if (node.implicit) {
          this.implicitRuby(node, at);
        } else {
          this.explicitRuby(node);
        }
        break;
      case 'emphasisPostfix':
      case 'tcyPostfix':
      case 'headingPostfix':
      case 'rubyLeftPostfix':
        this.postfix(node);
        break;
      case 'indentBlockStart':
      case 'emphasisSpanStart':
      case 'headingSpanStart':
        this.openSpan(node);
        break;
      case 'indentBlockEnd':
      case 'emphasisSpanEnd':
      case 'headingSpanEnd':
        this.closeSpan(node);
        break;
      case 'tcySpanStart':
        // A start inside an open span changes nothing.
        this.tcy ??= { opener: node, text: '', contentStart: node.span.end, contentEnd: node.span.end };
        break;
      case 'tcySpanEnd':
        if (this.tcy === null) {
          this.ledger.issues.push({ kind: 'danglingTcyEnd', span: node.span });
        } else {
          this.closeTcy(node);
        }
        break;
      case 'indent':
        this.indent = node.amount;
        break;
      case 'pageBreak':
        this.pageBreak = true;
        break;
      case 'comment':
        this.cells.push({ kind: 'comment', inner: displayText(node.inner.text), span: node.span });
        break;
      case 'brokenAnnotation':
        this.chars(node, node.text, 'broken');
        break;
      case 'valueField':
        this.chars(node, this.value(node), 'value');
        break;
      default: {
        const exhaustive: never = node;
        throw new Error(`resolve: unhandled node ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private chars(node: SyntaxNode, raw: string, origin: CharsOrigin): void {
    const cell = charsCell(node, raw, origin, this.flow.marks);
    if (cell !== null) {
      this.cells.push(cell);
    }
  }

  private value(node: ValueFieldNode): string {
    this.valueSeen = true;
    return valueOf(node.name.text, this.values);
  }

  private implicitRuby(node: RubyReadingNode, at: number): void {
    this.cells.push({
      kind: 'ruby',
      base: displayText(this.line.syntax[at - 1]?.text ?? ''),
      right: displayText(node.reading.text),
      span: { start: node.base.start, end: node.span.end },
      marks: this.flow.marks,
    });
  }

  private explicitRuby(node: RubyReadingNode): void {
    const open = this.base;
    if (open === null) {
      throw new Error('resolve: a ruby reading without its ｜'); // the scanner pairs them on one line
    }
    this.base = null;
    const inside = this.cells.splice(open.start);
    const base = displayText(inside.map(textOf).join(''));
    if (base === '') {
      // Nothing visible (an empty value): the markup prints as typed.
      this.chars(open.mark, open.mark.text, 'markup');
      this.chars(node, node.text, 'markup');
    } else {
      this.cells.push({
        kind: 'ruby',
        base,
        right: displayText(node.reading.text),
        span: { start: open.mark.span.start, end: node.span.end },
        // The state at the 《, plus what a span closed inside the base had set.
        marks: withMarksOf(this.flow.marks, inside),
      });
    }
    append(this.cells, inside.filter((cell) => cell.kind === 'comment')); // zero-width cells survive
    for (const p of open.postfixes) {
      this.bind(p.node, p.judged);
    }
  }

  private postfix(node: PostfixNode): void {
    const judged = this.values !== undefined || !this.valueSeen;
    if (this.base !== null) {
      this.base.postfixes.push({ node, judged });
    } else {
      this.bind(node, judged);
    }
  }

  /** Binds a corner-target postfix to the cells built so far; a miss takes no effect. */
  private bind(node: PostfixNode, judged: boolean): void {
    const { cells } = this;
    const target = displayText(node.target.text);
    const m = matchTarget(cells, target);
    const first = m === null ? undefined : cells[m.first];
    const last = m === null ? undefined : cells[m.last];
    const miss = (): void => {
      if (judged) {
        this.ledger.issues.push({ kind: 'postfixTargetMissing', span: node.target.span, target: node.target.text });
      }
      cells.push({ kind: 'comment', inner: displayText(innerOf(node)), span: node.span });
    };
    if (m === null || first === undefined || last === undefined) {
      miss();
      return;
    }
    const span = { start: spanOf(first).start, end: spanOf(last).end };
    const range = cells.slice(m.first, m.last + 1);
    const kept = range.filter((cell) => cell.kind === 'comment');
    const marks = first.kind === 'comment' ? {} : first.marks;
    switch (node.kind) {
      case 'emphasisPostfix':
        for (let i = m.first; i <= m.last; i += 1) {
          const cell = cells[i];
          if (cell !== undefined && cell.kind !== 'comment') {
            cells[i] = { ...cell, marks: withMark(cell.marks, node.channel, markOf(node)) };
          }
        }
        break;
      case 'tcyPostfix':
        // Whole coverage of a ruby REPLACES it (手動縦中横 > ルビ).
        replace(cells, m.first, range.length, [{ kind: 'tcy', text: target, span, marks }, ...kept]);
        break;
      case 'rubyLeftPostfix': {
        const real = range.filter((cell) => cell.kind !== 'comment');
        const single = real.length === 1 ? real[0] : undefined;
        const left = displayText(node.reading.text);
        if (single?.kind === 'ruby') {
          cells[cells.indexOf(single, m.first)] = { ...single, left }; // 両側ルビ
        } else if (real.every((cell) => cell.kind === 'chars')) {
          replace(cells, m.first, range.length, [{ kind: 'ruby', base: target, left, span, marks }, ...kept]);
        } else {
          miss(); // a reading or a cell inside would be silently destroyed
          return;
        }
        break;
      }
      case 'headingPostfix':
        this.heading = node.level;
        break;
    }
    this.ledger.bound.set(node, span);
  }

  private openSpan(node: SpanOpenerNode): void {
    const { flow } = this;
    flow.open.set(spanChannel(node), node);
    switch (node.kind) {
      case 'indentBlockStart':
        flow.indent = node.amount; // the following lines; this one keeps its indent
        break;
      case 'emphasisSpanStart':
        flow.marks = withMark(flow.marks, node.channel, markOf(node));
        break;
      case 'headingSpanStart':
        // One slot for the three levels: a re-open is a level change. The inline form marks
        // THIS line too; the block form the following ones only.
        flow.heading = node.level;
        if (node.block !== true) {
          this.heading = node.level;
        }
        break;
    }
    this.blockDirective ||= isBlockForm(node);
  }

  private closeSpan(node: SpanCloserNode): void {
    const { flow, ledger } = this;
    const channel = spanChannel(node);
    const opener = flow.open.get(channel);
    if (opener === undefined) {
      ledger.issues.push({ kind: 'danglingSpanEnd', span: node.span, block: isBlockForm(node) });
    } else {
      flow.open.delete(channel);
      pair(ledger.pairs, opener, node);
    }
    switch (node.kind) {
      case 'indentBlockEnd':
        flow.indent = 0;
        break;
      case 'emphasisSpanEnd':
        flow.marks = withMark(flow.marks, node.channel, undefined);
        break;
      case 'headingSpanEnd':
        flow.heading = undefined; // the line carrying the end stays a heading
        break;
    }
    this.blockDirective ||= isBlockForm(node);
  }

  /** Flushes the open 縦中横 as one cell; `closer` is null when the line end closes it. */
  private closeTcy(closer: TcySpanEndNode | null): void {
    const tcy = this.tcy;
    if (tcy === null) {
      return;
    }
    this.tcy = null;
    if (closer === null) {
      this.ledger.issues.push({ kind: 'unterminatedTcy', span: tcy.opener.span });
    } else {
      pair(this.ledger.pairs, tcy.opener, closer);
    }
    const text = displayText(tcy.text);
    this.ledger.held.set(tcy.opener, { text, span: { start: tcy.contentStart, end: tcy.contentEnd } });
    if (text !== '') {
      this.cells.push({
        kind: 'tcy',
        text,
        span: { start: tcy.contentStart, end: tcy.contentEnd },
        marks: this.flow.marks,
      });
    }
  }
}

/**
 * Resolves `doc`. `values` supplies the ［＃ここに「…」の値を表示］ values by name (see
 * {@link valueOf}). Without them, a postfix written after a value field is bound to the value's
 * default but its miss is not reported: the real value is unknown.
 */
export function resolve(doc: Syntax, values?: ValueLookup): Ast {
  const flow: Flow = { marks: {}, indent: 0, heading: undefined, open: new Map() };
  const ledger: Ledger = { issues: [...doc.issues], pairs: new Map(), bound: new Map(), held: new Map() };

  const lines = doc.lines.map((line): Line => ({ ...line, ...new LineResolver(line, flow, ledger, values).run() }));

  // What is still open runs to the end of input.
  const openAtEnd = [...flow.open.values()].sort(bySource);
  for (const opener of openAtEnd) {
    ledger.issues.push({ kind: 'unterminatedSpan', span: opener.span, block: isBlockForm(opener) });
  }

  return { lines, issues: ledger.issues.sort(bySource), openAtEnd, pairs: ledger.pairs, bound: ledger.bound, held: ledger.held };
}
