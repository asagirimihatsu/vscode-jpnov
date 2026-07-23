/**
 * Edge-case unit tests for the pure pre-scanners (the end-to-end behaviour is covered by
 * kernel.test.ts; here we pin the tricky boundaries directly on the functions).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dashScan,
  fullWidthSpaceScan,
  minusPositionScan,
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

const BAR = { mode: 'horizontalBar' } as const; // the shipped default: ― U+2015

const PARITY = { code: 'lint.common.dash.parity' };
const CHAR = { code: 'lint.common.dash', args: ['―'] };

test('dash: a run of the chosen glyph passes only at an even length', () => {
  assert.deepEqual(flagged(dashScan, '彼は――と', BAR), []);
  assert.deepEqual(flagged(dashScan, '彼は――――と', BAR), []); // longer even runs are the author's
  assert.deepEqual(dashScan('彼は―と', BAR), [{ start: 2, end: 3, fix: '――', message: PARITY }]);
  assert.deepEqual(dashScan('彼は―――と', BAR), [
    { start: 2, end: 5, fix: '――――', message: PARITY },
  ]);
});

test('dash: any other dash glyph is rewritten to the chosen one, length preserved', () => {
  assert.deepEqual(dashScan('彼は——と', BAR), [{ start: 2, end: 4, fix: '――', message: CHAR }]);
  assert.deepEqual(dashScan('彼は──と', BAR), [{ start: 2, end: 4, fix: '――', message: CHAR }]);
  assert.deepEqual(dashScan('彼は—―と', BAR), [{ start: 2, end: 4, fix: '――', message: CHAR }]);
  assert.deepEqual(dashScan('あ―い―う', BAR), [
    { start: 1, end: 2, fix: '――', message: PARITY },
    { start: 3, end: 4, fix: '――', message: PARITY },
  ]);
  // wrong glyph AND odd: the character message wins
  assert.deepEqual(dashScan('彼は—――と', BAR), [{ start: 2, end: 5, fix: '――――', message: CHAR }]);
});

test('dash: each mode judges by its own glyph; an unset mode checks nothing', () => {
  assert.deepEqual(flagged(dashScan, '彼は——と', { mode: 'emDash' }), []);
  assert.deepEqual(flagged(dashScan, '彼は──と', { mode: 'boxDrawing' }), []);
  assert.deepEqual(dashScan('彼は――と', { mode: 'emDash' }), [
    { start: 2, end: 4, fix: '——', message: { code: 'lint.common.dash', args: ['—'] } },
  ]);
  // 'off' never reaches a scanner (select.ts drops it), but an unknown mode must stay silent too
  assert.deepEqual(flagged(dashScan, '彼は―と', { mode: 'off' }), []);
  assert.deepEqual(flagged(dashScan, '彼は―と', true), []);
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
