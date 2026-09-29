/**
 * The structural findings of the AST: what is reported, over which span, in which order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Held, Issue } from '../../../src/shared/ast/nodes.ts';
import { VALUE_NAMES, valueAnnotation, valueOf } from '../../../src/shared/ast/notation.ts';
import { parse } from '../../../src/shared/ast/parse.ts';

import { at, boundOf, heldOf, issuesOf, pairsOf } from './_shape.ts';
import { D } from '../_kana.ts';

// --------------------------------------------------------------- unclosed ［＃

test('an unclosed ［＃ is reported over the broken annotation, never its terminator', () => {
  const unclosed = (src: string): Issue[] => issuesOf(src, 'unclosedAnnotation');
  assert.deepEqual(unclosed('本［＃こわれ'), [{ kind: 'unclosedAnnotation', span: { start: 1, end: 6 } }]);
  assert.deepEqual(unclosed('closed［＃注］ok'), []);
  assert.deepEqual(unclosed('a［＃x\nb［＃y'), [
    { kind: 'unclosedAnnotation', span: { start: 1, end: 4 } },
    { kind: 'unclosedAnnotation', span: { start: 6, end: 9 } },
  ]);
  assert.deepEqual(unclosed('［＃注\r\n次'), [{ kind: 'unclosedAnnotation', span: { start: 0, end: 3 } }]);
  assert.deepEqual(unclosed('［＃注\r次'), [{ kind: 'unclosedAnnotation', span: { start: 0, end: 3 } }]);
});

// --------------------------------------------------------------- spans

const spans = (src: string): Issue[] => issuesOf(src, 'unterminatedSpan', 'danglingSpanEnd');

test('a span open at the end of input is reported over its start', () => {
  const src = '［＃ここから２字下げ］\nA';
  assert.deepEqual(spans(src), [{ kind: 'unterminatedSpan', span: at(src, '［＃ここから２字下げ］'), block: true }]);
  // `block` is the annotation's own form: it picks the message.
  assert.deepEqual(spans('［＃太字］A'), [{ kind: 'unterminatedSpan', span: { start: 0, end: 5 }, block: false }]);
  assert.deepEqual(spans('［＃大見出し］A'), [{ kind: 'unterminatedSpan', span: { start: 0, end: 7 }, block: false }]);
});

test('an end with nothing open in its channel is reported over itself', () => {
  const src = 'A\n［＃ここで字下げ終わり］';
  assert.deepEqual(spans(src), [{ kind: 'danglingSpanEnd', span: at(src, '［＃ここで字下げ終わり］'), block: true }]);
  assert.deepEqual(spans('A［＃傍点終わり］'), [{ kind: 'danglingSpanEnd', span: { start: 1, end: 9 }, block: false }]);
  // Only a SECOND end of the same channel dangles.
  const twice = '［＃ここから太字］\nA\n［＃ここで太字終わり］\n［＃ここで太字終わり］';
  assert.deepEqual(spans(twice), [{ kind: 'danglingSpanEnd', span: at(twice, '［＃ここで太字終わり］', 1), block: true }]);
});

test('balanced pairs are clean: channels overlap freely, a re-open replaces its slot', () => {
  for (const src of [
    '［＃ここから太字］\nA\n［＃ここで太字終わり］',
    '［＃ここから２字下げ］\n［＃ここから太字］\nA\n［＃ここで太字終わり］\n［＃ここで字下げ終わり］',
    '［＃ここから２字下げ］\n［＃ここから４字下げ］\nA\n［＃ここで字下げ終わり］', // last-wins
    // Mixed forms pair: the end clears the channel whichever form it takes.
    '［＃太字］A［＃ここで太字終わり］',
    '［＃ここから太字］\nA\n［＃太字終わり］',
    '［＃傍点］A［＃傍点終わり］',
    // Channels pair, not variants; the left side is the same channel.
    '［＃傍点］A［＃白ゴマ傍点終わり］',
    '［＃左に傍点］A［＃傍点終わり］',
    // The three 見出し levels share ONE channel.
    '［＃ここから大見出し］\nA\n［＃ここで大見出し終わり］',
    '［＃ここから２字下げ］\n［＃ここから大見出し］\nA\n［＃ここで大見出し終わり］\n［＃ここで字下げ終わり］',
    '［＃ここから大見出し］\n［＃ここから中見出し］\nA\n［＃ここで小見出し終わり］',
    // 縦中横 is line-local and has findings of its own.
    '［＃縦中横］12［＃縦中横終わり］',
  ]) {
    assert.deepEqual(spans(src), [], JSON.stringify(src));
  }
});

test('another channel neither closes a span nor is closed by it; the findings come in source order', () => {
  assert.deepEqual(spans('［＃傍点］A［＃傍線終わり］'), [
    { kind: 'unterminatedSpan', span: { start: 0, end: 5 }, block: false },
    { kind: 'danglingSpanEnd', span: { start: 6, end: 14 }, block: false },
  ]);
  assert.deepEqual(spans('［＃ここから大見出し］\nA'), [{ kind: 'unterminatedSpan', span: { start: 0, end: 11 }, block: true }]);
  assert.deepEqual(spans('A\n［＃ここで大見出し終わり］'), [{ kind: 'danglingSpanEnd', span: { start: 2, end: 15 }, block: true }]);
});

test('a start and its end name each other; an unpaired one names nothing', () => {
  const src = '［＃傍点］あ［＃ここから太字］\nい［＃丸傍点終わり］う［＃傍線終わり］';
  assert.deepEqual(pairsOf(src), [
    ['［＃傍点］', at(src, '［＃丸傍点終わり］')], // the same channel, whatever the variant
    ['［＃ここから太字］', null],
    ['［＃丸傍点終わり］', at(src, '［＃傍点］')],
    ['［＃傍線終わり］', null],
  ]);
});

// --------------------------------------------------------------- 縦中横

const tcy = (src: string): Issue[] => issuesOf(src, 'unterminatedTcy', 'danglingTcyEnd');

const spanned = (content: string): string => `［＃縦中横］${content}［＃縦中横終わり］`;

const held = (src: string, values?: ReadonlyMap<string, string>): (Held | null)[] => heldOf(src, values);

test('縦中横: a span with no 終わり before its line end is reported over its start', () => {
  assert.deepEqual(tcy('序［＃縦中横］12\n次'), [{ kind: 'unterminatedTcy', span: { start: 1, end: 7 } }]);
  assert.deepEqual(tcy('［＃縦中横］12'), [{ kind: 'unterminatedTcy', span: { start: 0, end: 6 } }]); // the end of input closes it too
});

test('縦中横: a dangling 終わり is reported; a balanced pair is clean', () => {
  assert.deepEqual(tcy('AB［＃縦中横終わり］'), [{ kind: 'danglingTcyEnd', span: { start: 2, end: 11 } }]);
  assert.deepEqual(tcy('令和［＃縦中横］12［＃縦中横終わり］年'), []);
});

test('縦中横: a span holds what its cell shows, over where that was written', () => {
  assert.deepEqual(held(spanned('1234')), [{ text: '1234', span: { start: 6, end: 10 } }]);
  assert.deepEqual(held(spanned('')), [{ text: '', span: { start: 6, end: 6 } }]);
  // Ruby markup joins the cell as typed; a comment adds nothing but sits inside the range.
  assert.deepEqual(held(spanned('漢《かん》')), [{ text: '漢《かん》', span: { start: 6, end: 11 } }]);
  assert.deepEqual(held(spanned('｜1［＃x］2《いち》')), [{ text: '｜12《いち》', span: { start: 6, end: 17 } }]);
  // A start inside an open span opens nothing.
  assert.deepEqual(held('［＃縦中横］12［＃縦中横］34［＃縦中横終わり］'), [{ text: '1234', span: { start: 6, end: 16 } }, null]);
});

test('縦中横: a value field is held as what it shows', () => {
  for (const name of [...Object.values(VALUE_NAMES), '13', '発行日']) {
    const shown = valueOf(name, undefined);
    assert.deepEqual(held(spanned(valueAnnotation(name))).map((h) => h?.text), [shown], name);
  }
  const pages = spanned(valueAnnotation(VALUE_NAMES.totalPages));
  assert.deepEqual(held(pages, new Map([[VALUE_NAMES.totalPages, '1234']])), [
    { text: '1234', span: at(pages, valueAnnotation(VALUE_NAMES.totalPages)) },
  ]);
});

test('縦中横: a terminator is neither held nor inside the range', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const src = `［＃縦中横］1234${eol}次`;
    assert.deepEqual(held(src), [{ text: '1234', span: { start: 6, end: 10 } }], JSON.stringify(eol));
    assert.deepEqual(tcy(src), [{ kind: 'unterminatedTcy', span: { start: 0, end: 6 } }], JSON.stringify(eol));
  }
});

test('縦中横: the held text is composed, its range stays in source offsets', () => {
  assert.deepEqual(held(spanned(`か${D}きく`)), [{ text: 'がきく', span: { start: 6, end: 6 + `か${D}きく`.length } }]);
  assert.deepEqual(held(spanned(`か［＃x］${D}きく`)).map((h) => h?.text), ['がきく']); // a comment inside splits nothing
});

// --------------------------------------------------------------- ruby

const missing = (start: number, end: number, reading: string): Issue => ({ kind: 'rubyBaseMissing', span: { start, end }, reading });
const empty = (start: number, end: number): Issue => ({ kind: 'rubyReadingEmpty', span: { start, end } });

/** `[source, expected findings]` — offsets are UTF-16 code units (every character here is BMP). */
const RUBY_CASES: readonly [string, Issue[]][] = [
  // No base character before the reading: line start, punctuation, a space, another ruby.
  ['《ごう》', [missing(0, 4, 'ごう')]],
  ['　行くぞ。《ごう》', [missing(5, 9, 'ごう')]],
  ['行く　《ごう》', [missing(3, 7, 'ごう')]],
  ['漢字《かんじ》《かんじ》', [missing(7, 12, 'かんじ')]],
  // Without a ｜, an annotation ends the text before it and a value field is not a base.
  ['山田［＃「山田」に傍点］《やまだ》', [missing(12, 17, 'やまだ')]],
  ['［＃ここに「タイトル」の値を表示］《たいとる》', [missing(17, 23, 'たいとる')]],
  // A ｜ with nothing visible before its 《 reports from the ｜ (the last ｜ wins); a ｜ never
  // survives a line break.
  ['｜《よみ》', [missing(0, 5, 'よみ')]],
  ['あ｜《よみ》', [missing(1, 6, 'よみ')]],
  ['｜｜《よみ》', [missing(1, 6, 'よみ')]],
  ['｜［＃メモ］《よみ》', [missing(0, 10, 'よみ')]],
  ['｜［＃傍点］《よみ》', [missing(0, 10, 'よみ')]],
  ['｜［＃縦中横］12［＃縦中横終わり］《じゅうに》', [missing(18, 24, 'じゅうに')]],
  ['｜語\n《ルビ》', [missing(3, 7, 'ルビ')]],
  ['｜語\r《ルビ》', [missing(3, 7, 'ルビ')]],
  // Document order; a terminator is never inside; inside 縦中横 the run is literal as well.
  ['。《あ》\n｜《い》', [missing(1, 4, 'あ'), missing(5, 9, 'い')]],
  ['《よみ》\r\n次', [missing(0, 4, 'よみ')]],
  ['あ。\r\n《よみ》', [missing(4, 8, 'よみ')]],
  ['［＃縦中横］《１》［＃縦中横終わり］', [missing(6, 9, '１')]],
  // An empty 《》 is a reading that never came: reported over the 《》 wherever it sits.
  ['《》', [empty(0, 2)]],
  ['漢字《》です', [empty(2, 4)]],
  ['｜漢字《》', [empty(3, 5)]],
  ['《》《ab》', [empty(0, 2), missing(2, 6, 'ab')]],
  // The first 》 closes; a 》 is not a base.
  ['》《ab》', [missing(1, 5, 'ab')]],
  ['《a《b》', [missing(0, 5, 'a《b')]],
  // Valid rubies (a ｜ base may hold annotations) and an unclosed 《 are clean.
  ['漢字《かんじ》', []],
  ['｜お茶の間《おちゃのま》', []],
  ['｜あ。《よみ》', []],
  ['漢字《か｜んじ》', []],
  ['立《た》ち', []],
  ['｜山田［＃「山田」に傍点］《やまだ》', []],
  ['｜［＃ここに「タイトル」の値を表示］《たいとる》', []],
  ['《ひらき', []],
];

test('every 《…》 that made no ruby is reported: no base, or no reading', () => {
  for (const [src, expected] of RUBY_CASES) {
    assert.deepEqual(issuesOf(src, 'rubyBaseMissing', 'rubyReadingEmpty'), expected, JSON.stringify(src));
  }
});

// --------------------------------------------------------------- postfix targets

const missed = (src: string): Issue[] => issuesOf(src, 'postfixTargetMissing');

test('a postfix that binds nothing is reported over its target, and names no span', () => {
  const src = '別の文［＃「無」に傍点］';
  assert.deepEqual(missed(src), [{ kind: 'postfixTargetMissing', span: at(src, '無'), target: '無' }]);
  assert.deepEqual(boundOf(src), [null]);
});

test('a target cutting into a cell, or on another line, is a miss; an aligned one binds', () => {
  // 字 sits inside the ruby 漢字, and a cell is atomic; the whole ruby is a target.
  const inside = '漢字《かんじ》［＃「字」に傍点］';
  assert.deepEqual(missed(inside), [{ kind: 'postfixTargetMissing', span: at(inside, '字', 1), target: '字' }]);
  assert.deepEqual(missed('漢字《かんじ》［＃「漢字」に傍点］'), []);
  // A run of characters is cut wherever the match falls.
  assert.deepEqual(missed('文字［＃「字」に傍点］'), []);
  // Binding is line-local.
  const above = '対象\n［＃「対象」に傍点］';
  assert.deepEqual(missed(above), [{ kind: 'postfixTargetMissing', span: at(above, '対象', 1), target: '対象' }]);
  // Every corner-target postfix reports alike.
  const tcy = 'あ［＃「99」は縦中横］';
  assert.deepEqual(missed(tcy), [{ kind: 'postfixTargetMissing', span: at(tcy, '99'), target: '99' }]);
});

test('a postfix that binds names what it bound to, markup of the target included', () => {
  const plain = 'これは山田です［＃「山田」に傍点］';
  assert.deepEqual(boundOf(plain), [at(plain, '山田')]);
  const ruby = '彼は山田《やまだ》さん［＃「山田さん」に傍点］';
  assert.deepEqual(boundOf(ruby), [at(ruby, '山田《やまだ》さん')]);
  // The LAST occurrence is the one: a forward reference sits next to its target.
  const twice = '山田と山田［＃「山田」は太字］';
  assert.deepEqual(boundOf(twice), [at(twice, '山田', 1)]);
  // A decomposed kana binds to its composed twin, over both of its units.
  const nfd = `た${D}め［＃「だめ」に傍点］`;
  assert.deepEqual(boundOf(nfd), [at(nfd, `た${D}め`)]);
});

test('a miss after a value field is left unreported in a compile without values', () => {
  const field = valueAnnotation(VALUE_NAMES.title);
  const targets = (src: string): unknown[] => missed(src).map((i) => (i.kind === 'postfixTargetMissing' ? i.target : null));
  // Targeting the REAL value builds correctly, so a warning here would flag working markup.
  assert.deepEqual(targets(`${field}［＃「作品名」は大見出し］`), []);
  // …scoped: a value field excuses neither an earlier postfix nor a later line.
  assert.deepEqual(targets(`です［＃「ですす」に傍点］${field}`), ['ですす']);
  assert.deepEqual(targets(`${field}\nです［＃「ですす」に傍点］`), ['ですす']);
  assert.deepEqual(targets('です［＃「ですす」に傍点］'), ['ですす']);
  // …and judged when the postfix is met, even if it binds later: inside a ｜ base.
  assert.deepEqual(targets(`｜山田［＃「無」に傍点］${field}《よみ》`), ['無']);
  // With the values in hand, a miss is a miss.
  const valued = parse(`${field}［＃「無」に傍点］`, new Map([[VALUE_NAMES.title, '作品名']]));
  assert.deepEqual(valued.issues.map((i) => i.kind), ['postfixTargetMissing']);
});

// --------------------------------------------------------------- order

test('the findings come in source order, whenever they were met', () => {
  // An open span is known at its line end, one open at the end of input only there.
  const src = '［＃太字］［＃縦中横］12［＃「無」に傍点］\n《よみ》［＃こわれ';
  assert.deepEqual(issuesOf(src).map((issue) => [issue.kind, issue.span]), [
    ['unterminatedSpan', at(src, '［＃太字］')],
    ['unterminatedTcy', at(src, '［＃縦中横］')],
    ['postfixTargetMissing', at(src, '無')],
    ['rubyBaseMissing', at(src, '《よみ》')],
    ['unclosedAnnotation', at(src, '［＃こわれ')],
  ]);
});
