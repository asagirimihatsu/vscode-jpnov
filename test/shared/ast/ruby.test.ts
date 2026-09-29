import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nodesOf, shape } from './_shape.ts';
import { D, H } from '../_kana.ts';

/** The base a reading written right after `textBefore` takes, and what precedes it. */
function implicitBase(textBefore: string): { base: string; rest: string } {
  const base = nodesOf(`${textBefore}《よみ》`).find((node) => node.kind === 'text' && node.rubyBase === true)?.text ?? '';
  return { base, rest: textBefore.slice(0, textBefore.length - base.length) };
}

test('the implicit base walks back over a maximal Kanji run', () => {
  assert.deepEqual(implicitBase('前置き漢字'), { base: '漢字', rest: '前置き' });
});

test('the implicit base treats the five spec marks 仝々〆〇ヶ as Kanji', () => {
  assert.deepEqual(implicitBase('人々'), { base: '人々', rest: '' });
  assert.deepEqual(implicitBase('〆切'), { base: '〆切', rest: '' });
  // 三ヶ月: digits class breaks before ヶ月? 三 is kanji, ヶ kanji, 月 kanji => all one run.
  assert.deepEqual(implicitBase('三ヶ月'), { base: '三ヶ月', rest: '' });
  // 〇 (U+3007) is kanji per the spec's 「仝々〆〇ヶ」 list — a numeral like 一〇八 is ONE run.
  assert.deepEqual(implicitBase('一〇八'), { base: '一〇八', rest: '' });
  assert.deepEqual(implicitBase('〇'), { base: '〇', rest: '' });
  // 仝 (U+4EDD) sits inside the CJK unified block — covered by the range, pinned here.
  assert.deepEqual(implicitBase('仝'), { base: '仝', rest: '' });
});

test('〇 ruby forms a whole-run implicit base end-to-end', () => {
  assert.deepEqual(shape('一〇八《いちまるはち》'), ['base 一〇八', 'rubyReading 《いちまるはち》']);
  assert.deepEqual(shape('〇《まる》'), ['base 〇', 'rubyReading 《まる》']);
});

test('the implicit base includes Hiragana as its own class (pure-hiragana base)', () => {
  assert.deepEqual(implicitBase('あのひと'), { base: 'あのひと', rest: '' });
  // A preceding Kanji is a different class, so it is excluded from a hiragana base.
  assert.deepEqual(implicitBase('彼のひと'), { base: 'のひと', rest: '彼' });
});

test('the implicit base walks back over a Katakana run incl. the ー mark', () => {
  assert.deepEqual(implicitBase('東京タワー'), { base: 'タワー', rest: '東京' });
});

test('the implicit base treats ASCII + fullwidth alnum as one class', () => {
  assert.deepEqual(implicitBase('ABC'), { base: 'ABC', rest: '' });
  assert.deepEqual(implicitBase('Ｗｅｂ'), { base: 'Ｗｅｂ', rest: '' });
  assert.deepEqual(implicitBase('版2024'), { base: '2024', rest: '版' });
});

test('the implicit base stops at a class change', () => {
  // Hiragana then Kanji: only the trailing Kanji run is the base.
  assert.deepEqual(implicitBase('はしる人'), { base: '人', rest: 'はしる' });
});

test('the implicit base stops at space / punctuation / ［ and yields no base', () => {
  assert.deepEqual(implicitBase('漢字 '), { base: '', rest: '漢字 ' });
  assert.deepEqual(implicitBase('漢字、'), { base: '', rest: '漢字、' });
  assert.deepEqual(implicitBase('漢字］'), { base: '', rest: '漢字］' });
  assert.deepEqual(implicitBase(''), { base: '', rest: '' });
});

// --------------------------------------------------------- 欧文 range (Aozora rule, verified)

test('欧文: a half-width space ends the implicit base — multi-word bases require ｜', () => {
  // Aozora: multi-word Latin gets per-word rubies (「アルファベットの句や文にルビが付く場合は、
  // 単語ごとにルビを付けます」); one reading over several words must mark its start with ｜
  // (「複数のアルファベットの単語に、一つのまとまったルビが付く場合には、「｜」を用いて…」).
  assert.deepEqual(shape('Buffalo Bill《バッファロー・ビル》'), [
    'text Buffalo ',
    'base Bill',
    'rubyReading 《バッファロー・ビル》',
  ]);
  assert.deepEqual(shape('｜Au revoir《さらば》'), ['rubyMark ｜', 'text Au revoir', 'rubyReading 《さらば》']);
});

test('欧文: digits and letters (half- and full-width) form ONE alnum run', () => {
  assert.deepEqual(implicitBase('MP4'), { base: 'MP4', rest: '' });
  assert.deepEqual(shape('Ｗｅｂ《ウェブ》'), ['base Ｗｅｂ', 'rubyReading 《ウェブ》']);
});

test('片仮名: the 中黒 ・ is a 記号 and ends the run (whole-name rubies require ｜)', () => {
  assert.deepEqual(implicitBase('バッファロー・ビル'), {
    base: 'ビル',
    rest: 'バッファロー・',
  });
});

// --------------------------------------------------------- NFD kana (#125)

test('NFD: a combining mark that composes with the kana before it joins that kana\'s run', () => {
  assert.deepEqual(implicitBase(`カ${D}ラス`), { base: `カ${D}ラス`, rest: '' });
  assert.deepEqual(implicitBase(`王都カ${D}ラス`), { base: `カ${D}ラス`, rest: '王都' });
  assert.deepEqual(implicitBase(`聖剣か${D}`), { base: `か${D}`, rest: '聖剣' });
  assert.deepEqual(implicitBase(`は${H}`), { base: `は${H}`, rest: '' });
  assert.deepEqual(implicitBase(`ウ${D}`), { base: `ウ${D}`, rest: '' });
});

test('NFD: a mark that composes nothing is no base character, exactly as before', () => {
  const marks = [D, `あ${D}`, `ー${D}`, `カー${D}`, `ヶ${D}`, `々${D}`, `Ａ${D}`, `\uFF76${D}`, `か${D}${D}`, `が${D}`, `ゝ${D}`];
  for (const s of marks) {
    assert.deepEqual(implicitBase(s), { base: '', rest: s }, JSON.stringify(s));
  }
});

test('NFD: the implicit ruby keeps the source spelling — the content composes, the syntax never does', () => {
  assert.deepEqual(shape(`カ${D}ラス《か${D}らす》`), [`base カ${D}ラス`, `rubyReading 《か${D}らす》`]);
});

test('an astral kanji is one character of the run, never split', () => {
  assert.deepEqual(implicitBase('彼は𠮷'), { base: '𠮷', rest: '彼は' });
  assert.deepEqual(implicitBase('𠮷田'), { base: '𠮷田', rest: '' });
  assert.deepEqual(shape('彼は𠮷《よし》'), ['text 彼は', 'base 𠮷', 'rubyReading 《よし》']);
});
