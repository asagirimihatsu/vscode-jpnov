/**
 * 自動縦中横 (`jpnov.layout.autoTcy`): every half-width pair gets the spec's forward-reference
 * postfix — `!?` reads as `!?［＃「!?」は縦中横］`
 * (https://www.aozora.gr.jp/annotation/etc.html#tatechu_yoko) — inserted as a synthetic node.
 *
 * A pair is a maximal [!?] run of exactly 2 in body text: never in a ruby base, a reading or an
 * annotation, nor where it is 縦中横 already (inside a span, or followed by its own postfix).
 *
 * Pure + vscode-free.
 */
import { append } from './lists.ts';
import type { Syntax, SyntaxLine, SyntaxNode, TextNode } from './nodes.ts';
import { CONNECTOR_HA, CORNER_CLOSE, CORNER_OPEN, TCY, annotation } from './notation.ts';

/** A maximal run of half-width !/? of length exactly 2 (lookarounds reject longer runs). */
const PAIR = /(?<![!?])[!?]{2}(?![!?])/g;

/**
 * The line's nodes with every pair wrapped. `literal(at)` says `at` lies inside a 《…》 that made
 * no ruby, where the annotation is inserted as text (#131).
 */
function wrapLine(line: SyntaxLine, literal: (at: number) => boolean): readonly SyntaxNode[] {
  let out: SyntaxNode[] | null = null; // created on the first insertion
  let inSpan = false; // inside a manual ［＃縦中横］ … (終わり or line end)
  let inBase = false; // inside a ｜ base (its text is a ruby base, not body text)

  for (const [i, node] of line.syntax.entries()) {
    let pieces: SyntaxNode[] | null = null;
    switch (node.kind) {
      case 'tcySpanStart':
        inSpan = true;
        break;
      case 'tcySpanEnd':
        inSpan = false;
        break;
      case 'rubyMark':
        inBase = true;
        break;
      case 'rubyReading':
        inBase = false;
        break;
      case 'text':
        if (node.rubyBase !== true && !inBase && !inSpan) {
          const next = line.syntax[i + 1];
          pieces = wrapText(node, next?.kind === 'tcyPostfix' ? next.target.text : null, literal);
        }
        break;
      default:
        break;
    }
    if (pieces !== null) {
      out ??= line.syntax.slice(0, i);
      append(out, pieces);
    } else {
      out?.push(node);
    }
  }
  return out ?? line.syntax;
}

/**
 * `node` cut after each pair, the annotation inserted at every cut; null when it holds no pair. A
 * pair at the very end that the following postfix (`covered`) names is left.
 */
function wrapText(node: TextNode, covered: string | null, literal: (at: number) => boolean): SyntaxNode[] | null {
  let pieces: SyntaxNode[] | null = null;
  let from = 0;
  for (const m of node.text.matchAll(PAIR)) {
    const pair = m[0];
    const end = m.index + pair.length;
    if (covered === pair && end === node.text.length) {
      continue;
    }
    const at = node.span.start + end;
    const point = { start: at, end: at };
    const text = annotation(`${CORNER_OPEN}${pair}${CORNER_CLOSE}${CONNECTOR_HA}${TCY}`);
    pieces ??= [];
    pieces.push(
      { kind: 'text', span: { start: node.span.start + from, end: at }, text: node.text.slice(from, end) },
      literal(at)
        ? { kind: 'text', span: point, text, synthetic: true }
        : { kind: 'tcyPostfix', span: point, text, synthetic: true, parts: [], target: { span: point, text: pair } },
    );
    from = end;
  }
  if (pieces !== null && from < node.text.length) {
    pieces.push({ kind: 'text', span: { start: node.span.start + from, end: node.span.end }, text: node.text.slice(from) });
  }
  return pieces;
}

/** `doc` with every pair wrapped. */
export function autoTcy(doc: Syntax): Syntax {
  const readings = doc.issues.filter((issue) => issue.kind === 'rubyBaseMissing').map((issue) => issue.span);
  const literal = (at: number): boolean => readings.some((span) => span.start < at && at < span.end);
  return {
    lines: doc.lines.map((line) => {
      const syntax = wrapLine(line, literal);
      return syntax === line.syntax ? line : { ...line, syntax };
    }),
    issues: doc.issues,
  };
}
