/**
 * Unit tests for the chunk-boundary algorithm: seams may only land where a sentence has
 * provably ended (terminator / blank line before the newline, CRLF-aware), the ranges must
 * tile the text exactly, and the forced (max) seam must bound pathological sentences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chunkRanges } from '../../../src/server/lint/chunking.ts';

/** Asserts `ranges` tile `[0, text.length)` exactly, in order, with no gaps or overlaps. */
function assertTiling(text: string, ranges: readonly (readonly [number, number])[]): void {
  assert.ok(ranges.length > 0);
  assert.equal(ranges[0]?.[0], 0);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i]?.[0], ranges[i - 1]?.[1]);
  }
  assert.equal(ranges[ranges.length - 1]?.[1], text.length);
}

test('text at or under target -> one chunk', () => {
  const text = '短い。\n次。\n';
  assert.deepEqual(chunkRanges(text, 100, 200), [[0, text.length]]);
});

test('a newline after a non-terminator is NOT a seam (sentence continues across it)', () => {
  // Every line ends mid-sentence; only EOF closes the single chunk.
  const text = '文はまだ\n続いて\nいる\n'.repeat(4);
  const ranges = chunkRanges(text, 8, 10_000);
  assert.deepEqual(ranges, [[0, text.length]]);
});

test('a newline right after 。 is a seam once target is reached', () => {
  const line = 'これで終わる。\n'; // 8 units
  const text = line.repeat(4);
  const ranges = chunkRanges(text, line.length + 1, 10_000);
  assertTiling(text, ranges);
  assert.ok(ranges.length > 1);
  for (const [, end] of ranges.slice(0, -1)) {
    // Every committed seam sits just past a newline whose line ended with the terminator.
    assert.equal(text.charAt(end - 1), '\n');
    assert.equal(text.charAt(end - 2), '。');
  }
});

test('a blank line is a seam even without a terminator', () => {
  const text = 'つづく\nまだつづく\n\nあたらしい段落\n';
  const ranges = chunkRanges(text, 4, 10_000);
  assertTiling(text, ranges);
  // The seam lands just past the blank line's newline.
  const blankSeam = text.indexOf('\n\n') + 2;
  assert.ok(ranges.some(([, end]) => end === blankSeam));
});

test('CRLF: 。\\r\\n is a seam (CR is looked through)', () => {
  const line = '終わる。\r\n';
  const text = line.repeat(4);
  const ranges = chunkRanges(text, line.length + 1, 10_000);
  assertTiling(text, ranges);
  assert.ok(ranges.length > 1);
});

test('forced seam: a terminator-less run is committed at the first newline at or past max', () => {
  const line = 'とまらない\n'; // 6 units, never a safe seam
  const text = line.repeat(10);
  const ranges = chunkRanges(text, 6, 18);
  assertTiling(text, ranges);
  assert.ok(ranges.length > 1);
  for (const [start, end] of ranges.slice(0, -1)) {
    assert.ok(end - start >= 18, `forced chunk [${String(start)}, ${String(end)}) is under max`);
    assert.equal(text.charAt(end - 1), '\n'); // still only ever splits at a line end
  }
});

test('no newline at all -> single chunk regardless of size (documented residual)', () => {
  const text = 'あ'.repeat(100);
  assert.deepEqual(chunkRanges(text, 10, 20), [[0, text.length]]);
});

test('tiling holds on mixed real-ish prose', () => {
  const text = [
    '　地の文がある。読点、も、ある。\n',
    '「台詞がここにある」\n',
    '未終端の行\n',
    'が続いてから終わる。\n',
    '\n',
    '　次の段落。\n',
  ].join('').repeat(8);
  const ranges = chunkRanges(text, 40, 400);
  assertTiling(text, ranges);
});
