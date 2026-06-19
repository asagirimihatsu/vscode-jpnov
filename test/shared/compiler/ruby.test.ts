import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImplicitBase } from '../../../src/shared/compiler/tokenizer.ts';

test('detectImplicitBase walks back over a maximal Kanji run', () => {
  assert.deepEqual(detectImplicitBase('前置き漢字'), { base: '漢字', rest: '前置き' });
});

test('detectImplicitBase treats 々〆ヶ as Kanji', () => {
  assert.deepEqual(detectImplicitBase('人々'), { base: '人々', rest: '' });
  assert.deepEqual(detectImplicitBase('〆切'), { base: '〆切', rest: '' });
  // 三ヶ月: digits class breaks before ヶ月? 三 is kanji, ヶ kanji, 月 kanji => all one run.
  assert.deepEqual(detectImplicitBase('三ヶ月'), { base: '三ヶ月', rest: '' });
});

test('detectImplicitBase includes Hiragana as its own class (pure-hiragana base)', () => {
  assert.deepEqual(detectImplicitBase('あのひと'), { base: 'あのひと', rest: '' });
  // A preceding Kanji is a different class, so it is excluded from a hiragana base.
  assert.deepEqual(detectImplicitBase('彼のひと'), { base: 'のひと', rest: '彼' });
});

test('detectImplicitBase walks back over a Katakana run incl. the ー mark', () => {
  assert.deepEqual(detectImplicitBase('東京タワー'), { base: 'タワー', rest: '東京' });
});

test('detectImplicitBase treats ASCII + fullwidth alnum as one class', () => {
  assert.deepEqual(detectImplicitBase('ABC'), { base: 'ABC', rest: '' });
  assert.deepEqual(detectImplicitBase('Ｗｅｂ'), { base: 'Ｗｅｂ', rest: '' });
  assert.deepEqual(detectImplicitBase('版2024'), { base: '2024', rest: '版' });
});

test('detectImplicitBase stops at a class change', () => {
  // Hiragana then Kanji: only the trailing Kanji run is the base.
  assert.deepEqual(detectImplicitBase('はしる人'), { base: '人', rest: 'はしる' });
});

test('detectImplicitBase stops at space / punctuation / ［ and yields no base', () => {
  assert.deepEqual(detectImplicitBase('漢字 '), { base: '', rest: '漢字 ' });
  assert.deepEqual(detectImplicitBase('漢字、'), { base: '', rest: '漢字、' });
  assert.deepEqual(detectImplicitBase('漢字］'), { base: '', rest: '漢字］' });
  assert.deepEqual(detectImplicitBase(''), { base: '', rest: '' });
});
