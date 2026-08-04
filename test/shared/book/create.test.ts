import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newBookText, sanitizeBookStem } from '../../../src/shared/book/create.ts';
import { chapterLines } from '../../../src/shared/book/edits.ts';
import { parseJpbook } from '../../../src/shared/book/jpbook.ts';

// --- sanitizeBookStem ---------------------------------------------------------

test('sanitizeBookStem drops the path-hostile character set', () => {
  assert.equal(sanitizeBookStem('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
});

test('sanitizeBookStem drops control characters', () => {
  const title = `a${String.fromCharCode(0)}b${String.fromCharCode(31)}c${String.fromCharCode(127)}d`;
  assert.equal(sanitizeBookStem(title), 'abcd');
});

test('sanitizeBookStem trims leading/trailing dots and whitespace, incl. U+3000', () => {
  assert.equal(sanitizeBookStem('　.作品名　第一巻.　'), '作品名　第一巻');
});

test('sanitizeBookStem keeps interior spaces and dots', () => {
  assert.equal(sanitizeBookStem('vol 1.2'), 'vol 1.2');
});

test('sanitizeBookStem leaves an ordinary Japanese title untouched', () => {
  assert.equal(sanitizeBookStem('作品名　第一巻'), '作品名　第一巻');
});

test('sanitizeBookStem returns the empty string when nothing usable remains', () => {
  assert.equal(sanitizeBookStem('***'), '');
  assert.equal(sanitizeBookStem('...'), '');
  assert.equal(sanitizeBookStem('　　'), '');
});

// --- newBookText --------------------------------------------------------------

test('newBookText composes front matter + chapters with a trailing newline', () => {
  assert.equal(
    newBookText('My Book', ['ch1.jpnov', 'sub/ch2.jpnov']),
    '---\ntitle: My Book\n---\nch1.jpnov\nsub/ch2.jpnov\n',
  );
});

test('newBookText with no chapters is a bare front-matter block', () => {
  assert.equal(newBookText('X', []), '---\ntitle: X\n---\n');
});

test('newBookText single-lines a pasted multi-line title', () => {
  assert.equal(newBookText('a\nb', []), '---\ntitle: a b\n---\n');
});

test('newBookText round-trips through parseJpbook', () => {
  const parsed = parseJpbook(newBookText('作品名　第一巻', ['a.jpnov', 'b.jpnov']));
  assert.deepEqual(parsed.meta, { title: '作品名　第一巻' });
  const lines = chapterLines(parsed.lines);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => parsed.lines[l]?.value), ['a.jpnov', 'b.jpnov']);
});
