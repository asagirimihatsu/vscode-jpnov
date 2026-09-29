/**
 * 自動縦中横 (`jpnov.layout.autoTcy`): every half-width pair gets the spec's forward-reference
 * postfix — `!?` reads as `!?［＃「!?」は縦中横］`
 * (https://www.aozora.gr.jp/annotation/etc.html#tatechu_yoko) — inserted as a synthetic node.
 *
 * A pair is a maximal [!?] run of exactly 2 in body text. It stays as typed in a ruby — a base, a
 * reading, what a left ruby takes as its base — in a 《…》 that made no ruby, in an annotation, and
 * where it is 縦中横 already (inside a span, or followed by its own postfix).
 *
 * Pure + vscode-free.
 */
import type { Part, Span, Syntax, SyntaxLine, SyntaxNode, ValueLookup } from './nodes.ts';
import { CONNECTOR_HA, CORNER_CLOSE, CORNER_OPEN, TCY, annotation } from './notation.ts';
import { bindingsOf } from './resolve.ts';

/** A maximal run of half-width !/? of length exactly 2 (lookarounds reject longer runs). */
const PAIR = /(?<![!?])[!?]{2}(?![!?])/g;

/**
 * The pairs of `line` in source order: those of its body text, less a pair at the very end of
 * its node that the postfix after it names.
 */
function pairsOf(line: SyntaxLine): Part[] {
  const pairs: Part[] = [];
  let inSpan = false; // inside a manual ［＃縦中横］ … (終わり or line end)
  let inBase = false; // inside a ｜ base (its text is a ruby base, not body text)

  for (const [at, node] of line.syntax.entries()) {
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
          const next = line.syntax[at + 1];
          const covered = next?.kind === 'tcyPostfix' ? next.target.text : null;
          PAIR.lastIndex = 0;
          for (let m = PAIR.exec(node.text); m !== null; m = PAIR.exec(node.text)) {
            const end = m.index + m[0].length;
            if (covered === m[0] && end === node.text.length) {
              continue;
            }
            pairs.push({ span: { start: node.span.start + m.index, end: node.span.start + end }, text: m[0] });
          }
        }
        break;
      default:
        break;
    }
  }
  return pairs;
}

/** `pairs` less those wholly inside one of `spans`; both in source order, the spans by start. */
function outside(pairs: readonly Part[], spans: readonly Span[]): Part[] {
  let next = 0; // spans[next..] start after the pair
  let reach = -1; // the furthest end among spans[..next]
  return pairs.filter((pair) => {
    for (let span = spans[next]; span !== undefined && span.start <= pair.span.start; span = spans[next]) {
      reach = Math.max(reach, span.end);
      next += 1;
    }
    return reach < pair.span.end;
  });
}

/**
 * `line` with each of `pairs` wrapped: its node cut after the pair, the annotation put there.
 * Every node it does not cut is the line's own: a binding is looked up by its node.
 */
function wrap(line: SyntaxLine, pairs: readonly Part[]): SyntaxLine {
  if (pairs.length === 0) {
    return line;
  }
  const syntax: SyntaxNode[] = [];
  let next = 0; // pairs[next..] are still to wrap

  for (const node of line.syntax) {
    const { start, end } = node.span;
    let from = start; // the node is cut up to here
    for (let pair = pairs[next]; pair !== undefined && pair.span.end <= end; pair = pairs[next]) {
      const to = pair.span.end;
      const point = { start: to, end: to };
      syntax.push(
        { kind: 'text', span: { start: from, end: to }, text: node.text.slice(from - start, to - start) },
        {
          kind: 'tcyPostfix',
          span: point,
          text: annotation(`${CORNER_OPEN}${pair.text}${CORNER_CLOSE}${CONNECTOR_HA}${TCY}`),
          synthetic: true,
          parts: [],
          target: { span: point, text: pair.text },
        },
      );
      from = to;
      next += 1;
    }
    if (from === start) {
      syntax.push(node);
    } else if (from < end) {
      syntax.push({ kind: 'text', span: { start: from, end }, text: node.text.slice(from - start) });
    }
  }
  return { ...line, syntax };
}

/**
 * `line` with its pairs wrapped; `baseless` are the 《…》 of the line that made no ruby. A pair
 * inside what a left ruby takes as its base stays as typed if that ruby still binds with the
 * other pairs wrapped: a wrapped pair is one cell, and an annotation that cuts into it takes no
 * effect.
 */
function wrapLine(line: SyntaxLine, baseless: readonly Span[], values: ValueLookup | undefined): SyntaxLine {
  const pairs = outside(pairsOf(line), baseless);
  if (pairs.length === 0) {
    return line;
  }
  const written = line.syntax.filter((node) => node.kind === 'rubyLeftPostfix');
  if (written.length === 0) {
    return wrap(line, pairs);
  }
  const typed = bindingsOf(line, values);
  let rubies = written
    .flatMap((node) => {
      const base = typed.get(node);
      return base === undefined ? [] : [{ node, base }];
    })
    .sort((a, b) => a.base.start - b.base.start);
  for (;;) {
    const rest = outside(pairs, rubies.map(({ base }) => base));
    const wrapped = wrap(line, rest);
    // Nothing wrapped: the rubies bind as typed. Nothing kept: no pair depends on them.
    if (rest.length === 0 || rest.length === pairs.length) {
      return wrapped;
    }
    const bound = bindingsOf(wrapped, values);
    const stillBound = rubies.filter(({ node }) => bound.has(node));
    if (stillBound.length === rubies.length) {
      return wrapped;
    }
    rubies = stillBound;
  }
}

/** `doc` with every pair wrapped; `values` are those the manuscript is resolved with. */
export function autoTcy(doc: Syntax, values?: ValueLookup): Syntax {
  const baseless = doc.issues.flatMap((issue) => (issue.kind === 'rubyBaseMissing' ? [issue.span] : []));
  let next = 0; // baseless[next..] sit on the lines still to come
  return {
    lines: doc.lines.map((line) => {
      const from = next;
      for (let span = baseless[next]; span !== undefined && span.start < line.span.end; span = baseless[next]) {
        next += 1;
      }
      return wrapLine(line, baseless.slice(from, next), values);
    }),
    issues: doc.issues,
  };
}
