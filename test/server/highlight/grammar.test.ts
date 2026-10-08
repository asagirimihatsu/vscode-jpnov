/**
 * The generated grammar colours what the semantic tokens colour: over the corpus, each line gets
 * the same runs of colour from the grammar's rules, applied the TextMate way, and from
 * buildSemanticTokens. The grammar keeps no state, so the known differences stay out of the
 * corpus: a 《reading》 with no base (the scanner reports it, and the corpus drops such a line),
 * a ｜ with no reading and the dialogue corners outside an annotation, which it greys and the
 * semantic layer leaves as text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateGrammar } from '../../../scripts/gen-grammar.ts';
import { SEMANTIC_LEGEND } from '../../../src/server/semanticTokens.ts';
import {
  BLOCK_FROM,
  BLOCK_TO,
  CONNECTOR_HA,
  CONNECTOR_NI,
  EMPHASIS_VARIANTS,
  GAIJI,
  HEADING_LITERALS,
  INDENT,
  INDENT_MAX,
  LEFT_LONG,
  LEFT_RUBY,
  LEFT_SHORT,
  PAGE_BREAK,
  SPAN_END,
  TCY,
  VALUE_NAMES,
  annotation,
  indentAnnotation,
  valueAnnotation,
} from '../../../src/shared/ast/notation.ts';
import { scan } from '../../../src/shared/ast/scan.ts';
import { blockOf, gaijiOf, innerOf } from '../../shared/ast/_shape.ts';

import { buildSemanticTokens, decode, doc } from './tokens.ts';

/** A run of one colour: its text and the LSP token type, null for the default colour. */
type Run = [text: string, colour: string | null];

const grammar = generateGrammar();
const rules = Object.values(grammar.repository)
  .flatMap((r) => r.patterns)
  .map((p) => ({ re: new RegExp(p.match, 'g'), captures: p.captures }));

/** `runs` with the empty ones dropped and the neighbours of one colour joined. */
function joined(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const [text, colour] of runs) {
    const last = out[out.length - 1];
    if (text === '') {
      continue;
    }
    if (last?.[1] === colour) {
      last[0] += text;
    } else {
      out.push([text, colour]);
    }
  }
  return out;
}

/** What the grammar paints: at each step the rule matching earliest wins, the first on a tie. */
function painted(line: string): Run[] {
  const runs: Run[] = [];
  let pos = 0;
  while (pos < line.length) {
    let best: { m: RegExpExecArray; captures: Record<string, { name: string }> } | null = null;
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const m = rule.re.exec(line);
      if (m !== null && (best === null || m.index < best.m.index)) {
        best = { m, captures: rule.captures };
      }
    }
    if (best === null) {
      runs.push([line.slice(pos), null]);
      break;
    }
    assert.notEqual(best.m[0], '', `empty match at ${String(best.m.index)} of ${line}`);
    runs.push([line.slice(pos, best.m.index), null]);
    for (let k = 1; k < best.m.length; k += 1) {
      const scope = best.captures[String(k)]?.name;
      runs.push([best.m[k] ?? '', scope === undefined ? null : (scope.split('.')[0] ?? null)]);
    }
    pos = best.m.index + best.m[0].length;
  }
  return joined(runs);
}

/** What the semantic tokens paint, the gaps between tokens in the default colour. */
function tokens(line: string): Run[] {
  const runs: Run[] = [];
  let pos = 0;
  for (const tok of decode(buildSemanticTokens(doc(line), undefined).data)) {
    runs.push([line.slice(pos, tok.char), null], [line.slice(tok.char, tok.char + tok.len), SEMANTIC_LEGEND.tokenTypes[tok.type] ?? null]);
    pos = tok.char + tok.len;
  }
  runs.push([line.slice(pos), null]);
  return joined(runs);
}

const postfix = (rest: string): string => annotation(`「対象」${rest}`);

/** Every command word in every form, read or not: each with each left side and each connector. */
function forms(): string[] {
  const out: string[] = [];
  const words = [...Object.keys(EMPHASIS_VARIANTS), ...HEADING_LITERALS, TCY, INDENT, PAGE_BREAK, innerOf(indentAnnotation(3)), 'ママ'];
  for (const word of words) {
    for (const left of ['', LEFT_SHORT, LEFT_LONG]) {
      out.push(annotation(`${left}${word}`), annotation(`${left}${word}${SPAN_END}`), annotation(`${BLOCK_FROM}${left}${word}`), annotation(`${BLOCK_TO}${left}${word}${SPAN_END}`));
      for (const connector of ['', CONNECTOR_NI, CONNECTOR_HA, 'の', CONNECTOR_NI + LEFT_LONG]) {
        out.push(postfix(`${connector}${left}${word}`));
      }
    }
  }
  return out;
}

/** 字下げ counts around the maximum, with leading zeros, and the spellings that are not read. */
function indents(): string[] {
  const out: string[] = [];
  for (let n = 0; n <= INDENT_MAX + 20; n += 1) {
    for (const zeros of ['', '０', '０００']) {
      const single = annotation(`${zeros}${innerOf(indentAnnotation(n))}`);
      out.push(single, blockOf(single));
    }
  }
  out.push(annotation(`${'０'.repeat(400)}${INDENT}`), annotation(`${'９'.repeat(400)}${INDENT}`), annotation(`3${INDENT}`), blockOf(annotation(`${innerOf(indentAnnotation(3))}、折り返して${innerOf(indentAnnotation(2))}`)));
  return out;
}

const EDGES: readonly string[] = [
  ...Object.values(VALUE_NAMES).map(valueAnnotation),
  valueAnnotation('作品名'),
  valueAnnotation(''),
  valueAnnotation('a」b'),
  postfix(`${LEFT_LONG}「よみ」${LEFT_RUBY}`),
  postfix(`${LEFT_LONG}「」${LEFT_RUBY}`),
  postfix(`${LEFT_LONG}「よ「み」${LEFT_RUBY}`),
  postfix(`${LEFT_LONG}「よ」み」${LEFT_RUBY}`),
  postfix(LEFT_RUBY),
  postfix(`${CONNECTOR_NI}「よみ」${LEFT_RUBY}`),
  annotation(`「」${CONNECTOR_NI}傍点`),
  annotation(`「対「象」${CONNECTOR_NI}傍点`),
  annotation(`${PAGE_BREAK}${SPAN_END}`),
  annotation(`${BLOCK_FROM}${PAGE_BREAK}`),
  annotation(''),
  ...Object.entries(GAIJI).flatMap(([inner, char]) => [gaijiOf(char), annotation(inner)]),
  `※${annotation('外字、1-1-1')}`,
];

const UNCLOSED: readonly string[] = ['［＃', '［＃改ページ', `［＃${innerOf(postfix('に傍点'))}`, '本文［＃３字下げ', '［＃改ページ］［＃'];

const RUBY_LINES: readonly string[] = ['山《［＃改ページ］》', '山《a《b》', '｜山田《やまだ》', '山田《やまだ》', '｜山田［＃「山田」に傍点］《やまだ》'];

/** Each annotation alone, inside prose and inside an explicit ruby base, less the lines whose reading lost its base. */
const corpus: readonly string[] = [
  ...[...forms(), ...indents(), ...EDGES].flatMap((a) => [a, `本文${a}本文`, `｜山田${a}《やまだ》`]),
  ...UNCLOSED,
  ...RUBY_LINES,
].filter((line) => !scan(line).issues.some((issue) => issue.kind === 'rubyBaseMissing'));

test('the grammar paints every line of the corpus as the semantic tokens do', () => {
  assert.ok(corpus.length > 1000, `corpus of ${String(corpus.length)} lines`);
  for (const line of corpus) {
    assert.deepEqual(painted(line), tokens(line), line);
  }
});
