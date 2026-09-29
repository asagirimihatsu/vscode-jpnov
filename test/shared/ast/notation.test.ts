/**
 * The notation's spellers and tables: what a speller composes must read back as what it was
 * composed from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SpanOpenerNode } from '../../../src/shared/ast/nodes.ts';
import {
  EMPHASIS_VARIANTS,
  HEADING_LITERALS,
  VALUE_DEFAULTS,
  VALUE_NAMES,
  closingAnnotations,
  headingLevelOf,
  headingLiteralOf,
  indentAnnotation,
  tcyAnnotation,
  valueAnnotation,
  valueOf,
  variantStyle,
} from '../../../src/shared/ast/notation.ts';
import { parse } from '../../../src/shared/ast/parse.ts';

import { at, issuesOf, nodeOf, pairsOf } from './_shape.ts';

test('indentAnnotation spells full-width digits, the only form the scanner reads', () => {
  assert.equal(indentAnnotation(3), '［＃３字下げ］');
  assert.equal(indentAnnotation(12), '［＃１２字下げ］');
  for (const n of [0, 1, 9, 10, 40, 100]) {
    assert.equal(nodeOf(indentAnnotation(n), 'indent').amount, n);
  }
});

test('the default of a value: a text value reads as its name, a count as 0, any other name as itself', () => {
  assert.deepEqual(VALUE_DEFAULTS, {
    title: VALUE_NAMES.title,
    author: VALUE_NAMES.author,
    totalPages: '0',
    sheets: '0',
    page: '0',
  });
  for (const key of Object.keys(VALUE_NAMES) as (keyof typeof VALUE_NAMES)[]) {
    assert.equal(valueOf(VALUE_NAMES[key], undefined), VALUE_DEFAULTS[key]);
  }
  // A name comes from the document: one that names an Object.prototype member is a name too.
  for (const name of ['13', '発行日', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(valueOf(name, undefined), name);
  }
});

test('valueOf: the supplied value, else the default; an empty value is a value', () => {
  const values = new Map([[VALUE_NAMES.title, '作品名'], [VALUE_NAMES.author, '']]);
  assert.equal(valueOf(VALUE_NAMES.title, values), '作品名');
  assert.equal(valueOf(VALUE_NAMES.author, values), '');
  assert.equal(valueOf(VALUE_NAMES.page, values), VALUE_DEFAULTS.page);
  assert.equal(valueOf(VALUE_NAMES.totalPages, undefined), VALUE_DEFAULTS.totalPages);
  assert.equal(valueOf('発行日', values), '発行日');
});

test('valueAnnotation reads back as the value field of its name', () => {
  assert.equal(valueAnnotation('タイトル'), '［＃ここに「タイトル」の値を表示］');
  assert.equal(nodeOf(valueAnnotation('発行日'), 'valueField').name.text, '発行日');
});

test('tcyAnnotation reads back as the 縦中横 of its target', () => {
  assert.equal(tcyAnnotation('!?'), '［＃「!?」は縦中横］');
  assert.equal(nodeOf(tcyAnnotation('12'), 'tcyPostfix').target.text, '12');
});

test('the heading literals and their levels are inverses', () => {
  assert.deepEqual(HEADING_LITERALS.map(headingLevelOf), [1, 2, 3]);
  assert.deepEqual(([1, 2, 3] as const).map(headingLiteralOf), [...HEADING_LITERALS]);
  assert.equal(headingLevelOf('見出し'), null);
});

test('variantStyle resolves a spelling to its table key, side and channel, per form', () => {
  assert.deepEqual(variantStyle('傍点'), { variant: '傍点', left: false, channel: 'emph', prefix: 0 });
  assert.deepEqual(variantStyle('左に波線', 'span'), { variant: '波線', left: true, channel: 'line', prefix: 2 });
  assert.deepEqual(variantStyle('の左に×傍点', 'postfix'), { variant: '×傍点', left: true, channel: 'emph', prefix: 3 });
  assert.equal(variantStyle('toString'), null); // a name of the table, not of Object
  for (const name of Object.keys(EMPHASIS_VARIANTS)) {
    assert.equal(variantStyle(name)?.variant, name);
  }
});

test('variantStyle: the left prefix is bound to its form, and taken by 傍点/傍線 alone', () => {
  // The Aozora spec fixes the spelling by form: a span never carries の左に, a postfix never
  // carries bare 左に.
  assert.equal(variantStyle('の左に傍点', 'span'), null);
  assert.equal(variantStyle('左に傍点', 'postfix'), null);
  assert.equal(variantStyle('左に波線', 'postfix'), null);
  // 'none' (a block form; a postfix whose connector was taken) takes neither — にの左に傍点 dies
  // here: the connector and the direction prefix are mutually exclusive.
  assert.equal(variantStyle('の左に傍点'), null);
  assert.equal(variantStyle('左に傍点'), null);
  // 太字/斜体 have no side.
  assert.equal(variantStyle('左に太字', 'span'), null);
  assert.equal(variantStyle('の左に斜体', 'postfix'), null);
  for (const unknown of ['', 'なぞ傍点', '傍', 'ページ', '左に']) {
    assert.equal(variantStyle(unknown, 'span'), null, JSON.stringify(unknown));
  }
});

/** The one opener `src` leaves open (each source below opens exactly one channel). */
const openerOf = (src: string): SpanOpenerNode => {
  const openers = parse(src).openAtEnd;
  assert.equal(openers.length, 1);
  const first = openers[0];
  assert.ok(first);
  return first;
};

test('openAtEnd: the survivors in channel order; a re-open supersedes; an end clears', () => {
  const six =
    '［＃ここから２字下げ］\n［＃ここから太字］\n［＃ここから斜体］\n［＃ここから中見出し］\n［＃左に傍点］［＃傍線］一';
  assert.deepEqual(
    parse(six).openAtEnd.map((node) => node.text),
    ['［＃ここから２字下げ］', '［＃ここから太字］', '［＃ここから斜体］', '［＃ここから中見出し］', '［＃左に傍点］', '［＃傍線］'],
  );
  assert.equal(openerOf('［＃傍点］一［＃白ゴマ傍点］二').text, '［＃白ゴマ傍点］');
  assert.deepEqual(parse('［＃太字］一［＃太字終わり］').openAtEnd, []);
  assert.deepEqual(parse('［＃縦中横］12').openAtEnd, []); // line-local: closed with its line
  // What is open at the end is what the span findings call unterminated.
  assert.deepEqual(
    issuesOf(six, 'unterminatedSpan').map((issue) => issue.span),
    parse(six).openAtEnd.map((node) => node.span),
  );
});

test('closingAnnotations: the forms the channel has, whichever form opened the span', () => {
  const cases: readonly [opener: string, forms: { block?: string; inline?: string }][] = [
    ['［＃ここから２字下げ］', { block: '［＃ここで字下げ終わり］' }],
    ['［＃太字］', { block: '［＃ここで太字終わり］', inline: '［＃太字終わり］' }],
    ['［＃ここから斜体］', { block: '［＃ここで斜体終わり］', inline: '［＃斜体終わり］' }],
    ['［＃中見出し］', { block: '［＃ここで中見出し終わり］', inline: '［＃中見出し終わり］' }],
    ['［＃ここから小見出し］', { block: '［＃ここで小見出し終わり］', inline: '［＃小見出し終わり］' }],
    ['［＃左に傍点］', { inline: '［＃左に傍点終わり］' }],
    ['［＃波線］', { inline: '［＃波線終わり］' }],
  ];
  for (const [opener, forms] of cases) {
    assert.deepEqual(closingAnnotations(openerOf(opener)), forms);
    // Self-consistency: each form reads back as the end that pairs this opener.
    for (const text of Object.values(forms)) {
      const src = `${opener}\n${text}`;
      assert.deepEqual(issuesOf(src, 'unterminatedSpan', 'danglingSpanEnd'), []);
      assert.deepEqual(pairsOf(src), [[opener, at(src, text)], [text, at(src, opener)]]);
    }
  }
});
