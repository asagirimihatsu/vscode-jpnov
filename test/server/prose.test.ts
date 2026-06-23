/**
 * Half-width-space detection in `.jpnov` prose. Pure + sync (no `#/` value imports), so this runs
 * directly on Node's native test loader like the highlight tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findHalfWidthSpaces } from '../../src/server/prose.ts';

/** `line:start-end` for each span, sorted — compact, order-independent assertions. */
const spans = (text: string): string[] =>
  findHalfWidthSpaces(text)
    .map((s) => `${String(s.line)}:${String(s.startChar)}-${String(s.endChar)}`)
    .sort();

test('flags a leading half-width run (a would-be full-width indent)', () => {
  assert.deepEqual(spans(' 　ようこそ'), ['0:0-1']); // one half space, then the real full-width indent
  assert.deepEqual(spans('   彼は走った'), ['0:0-3']); // a three-space run is a single span
});

test('flags a half-width space sandwiched between Japanese characters', () => {
  assert.deepEqual(spans('彼 は走った'), ['0:1-2']);
  assert.deepEqual(spans('「こんにちは 世界」'), ['0:6-7']);
});

test('does not flag a half-width space touching ASCII (Western names, code)', () => {
  assert.deepEqual(spans('Arill Stains'), []); // space between Latin words is fine
  assert.deepEqual(spans('彼 said'), []); // non-ASCII before, ASCII after → ambiguous, skip
  assert.deepEqual(spans('said 彼'), []); // ASCII before, non-ASCII after → skip
});

test('never flags a full-width space', () => {
  assert.deepEqual(spans('　ようこそ'), []); // leading full-width indent
  assert.deepEqual(spans('彼　は走った'), []); // full-width between kanji
});

test('does not flag a trailing half-width space (no following character)', () => {
  assert.deepEqual(spans('彼は '), []);
});

test('flags both a leading run and an interior run on one line', () => {
  assert.deepEqual(spans(' 彼 は'), ['0:0-1', '0:2-3']);
});

test('strips a trailing CR so columns are correct on CRLF files', () => {
  assert.deepEqual(spans(' 彼\r\n彼 は'), ['0:0-1', '1:1-2']);
});

test('reports correct line indices across multiple lines', () => {
  assert.deepEqual(spans('彼は走った\n 二行目\n問題 なし'), ['1:0-1', '2:2-3']);
});
