import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFileInput } from '../../../src/shared/book/create.ts';

test('normalizeFileInput appends the suffix and normalizes separators', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['my-chapter', 'my-chapter.jpnov'],
    ['my-chapter.jpnov', 'my-chapter.jpnov'],
    ['src/my-chapter', 'src/my-chapter.jpnov'],
    ['src\\my-chapter', 'src/my-chapter.jpnov'],
    ['src//my-chapter', 'src/my-chapter.jpnov'],
    ['./src/./my-chapter/', 'src/my-chapter.jpnov'],
    ['第一章', '第一章.jpnov'],
    // The suffix is exact-case; any other spelling is part of the stem.
    ['x.JPNOV', 'x.JPNOV.jpnov'],
    ['  src/ch  ', 'src/ch.jpnov'],
  ];
  for (const [raw, rel] of cases) {
    assert.deepEqual(normalizeFileInput(raw, '.jpnov'), { ok: true, rel }, raw);
  }
});

test('normalizeFileInput handles the .jpbook suffix the same way', () => {
  assert.deepEqual(normalizeFileInput('作品名', '.jpbook'), { ok: true, rel: '作品名.jpbook' });
  assert.deepEqual(normalizeFileInput('books\\vol1.jpbook', '.jpbook'), { ok: true, rel: 'books/vol1.jpbook' });
  assert.deepEqual(normalizeFileInput('.jpbook', '.jpbook'), { ok: false, error: 'empty' });
});

test('normalizeFileInput normalizes decomposed input to NFC', () => {
  assert.deepEqual(normalizeFileInput('か\u3099', '.jpnov'), { ok: true, rel: 'が.jpnov' });
});

test('normalizeFileInput rejects unusable paths with a typed code', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['.jpnov', 'empty'],
    ['src/.jpnov', 'empty'],
    ['./', 'empty'],
    ['/abs/ch', 'absolute'],
    ['C:\\ch', 'absolute'],
    ['\\\\server\\ch', 'absolute'],
    ['~/ch', 'absolute'],
    ['file:ch', 'absolute'],
    ['../ch', 'escapes'],
    ['src/../ch', 'escapes'],
    ['a\u0000b', 'badName'],
    ['src/a*b', 'badName'],
    ['.hidden/ch', 'badName'],
    ['src/ch.', 'badName'],
    ['sp ace /ch', 'badName'],
  ];
  for (const [raw, error] of cases) {
    assert.deepEqual(normalizeFileInput(raw, '.jpnov'), { ok: false, error }, raw === '' ? '(empty)' : raw);
  }
});
