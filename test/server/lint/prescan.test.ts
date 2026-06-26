/**
 * Edge-case unit tests for the pure pre-scanners (the end-to-end behaviour is covered by
 * kernel.test.ts; here we pin the tricky boundaries directly on the functions).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fullWidthSpaceScan,
  minusPositionScan,
  noEmDashScan,
  rubyKanaScan,
} from '../../../src/server/lint/prescan.ts';
import type { PreScan } from '../../../src/server/lint/prescan.ts';
import type { ActiveRule } from '../../../src/shared/lint/select.ts';

/** The substrings a scanner flags within `text` (boolean rules pass `true`; enums pass `{ mode }`). */
const flagged = (scan: PreScan, text: string, options: ActiveRule['options'] = true): string[] =>
  scan(text, options).map((s) => text.slice(s.start, s.end));

test('rubyKana hiragana mode: katakana / mixed / non-kana readings fail (ー stays neutral)', () => {
  // ruby stream joins readings with '\n'
  assert.deepEqual(flagged(rubyKanaScan, 'らーめん\nみはつ', { mode: 'hiragana' }), []);
  assert.deepEqual(flagged(rubyKanaScan, 'カード\nかード\nabc', { mode: 'hiragana' }), [
    'カード',
    'かード',
    'abc',
  ]);
});

test('rubyKana katakana mode: hiragana readings fail (ー stays neutral)', () => {
  assert.deepEqual(flagged(rubyKanaScan, 'カード\nミハツ', { mode: 'katakana' }), []);
  assert.deepEqual(flagged(rubyKanaScan, 'らーめん\nみはつ', { mode: 'katakana' }), ['らーめん', 'みはつ']);
});

test('noEmDash: an em-dash run (single or double) is one span fixed to ――', () => {
  assert.deepEqual(noEmDashScan('彼は—と', true), [{ start: 2, end: 3, fix: '――' }]);
  assert.deepEqual(noEmDashScan('彼は——と', true), [{ start: 2, end: 4, fix: '――' }]); // run together
  assert.deepEqual(flagged(noEmDashScan, '―だけ'), []); // ― (U+2015) is the target form, not flagged
});

test('fullWidthSpace: a half-width space between full-width chars is fixed to 　 (run collapses)', () => {
  assert.deepEqual(fullWidthSpaceScan('あ いう', true), [{ start: 1, end: 2, fix: '　' }]);
  assert.deepEqual(fullWidthSpaceScan('あ  い', true), [{ start: 1, end: 3, fix: '　' }]); // run -> one
  assert.deepEqual(flagged(fullWidthSpaceScan, 'A B'), []); // ASCII neighbours -> not flagged
  assert.deepEqual(flagged(fullWidthSpaceScan, 'あ B'), []); // mixed -> not flagged
});

test('minusPosition: only a minus immediately before a digit is allowed', () => {
  assert.deepEqual(flagged(minusPositionScan, '気温は－5度'), []); // － before 5
  assert.deepEqual(flagged(minusPositionScan, '気温は－５度'), []); // full-width digit
  assert.deepEqual(flagged(minusPositionScan, 'ダッシュ－だ'), ['－']); // not before a digit
  assert.deepEqual(flagged(minusPositionScan, '末尾-'), ['-']); // at end of string
});
