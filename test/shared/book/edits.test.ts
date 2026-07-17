import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendChapters,
  chapterLines,
  metaRows,
  moveChapterTo,
  removeChapter,
  upsertMeta,
} from '../../../src/shared/book/edits.ts';
import { parseJpbook } from '../../../src/shared/book/jpbook.ts';

/** Applies LSP-style replaces to `text` (offsets computed per line) — the test's oracle. */
function apply(text: string, replaces: readonly { start: { line: number; character: number }; end: { line: number; character: number }; newText: string }[]): string {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  const abs = (p: { line: number; character: number }): number => (offsets[p.line] ?? text.length) + p.character;
  const sorted = [...replaces].sort((a, b) => abs(b.start) - abs(a.start));
  let out = text;
  for (const r of sorted) {
    out = out.slice(0, abs(r.start)) + r.newText + out.slice(abs(r.end));
  }
  return out;
}

// --- upsertMeta ---------------------------------------------------------------

test('upsertMeta rewrites an existing key in place (line position and neighbours untouched)', () => {
  const text = '---\ntitle: 一\nheader: 柱\n---\na.jpnov\n';
  const out = apply(text, [upsertMeta(text, 'title', '二')]);
  assert.equal(out, '---\ntitle: 二\nheader: 柱\n---\na.jpnov\n');
});

test('upsertMeta rewrites the WINNING (first) occurrence and normalizes a full-width colon', () => {
  const text = '---\ntitle：古い\ntitle: 負け\n---\n';
  const out = apply(text, [upsertMeta(text, 'title', '新しい')]);
  assert.equal(out, '---\ntitle: 新しい\ntitle: 負け\n---\n');
});

test('upsertMeta appends an absent key before the closing fence (no reordering)', () => {
  const text = '---\nheader: 柱\n---\na.jpnov\n';
  const out = apply(text, [upsertMeta(text, 'pageNumber', 'none')]);
  assert.equal(out, '---\nheader: 柱\npageNumber: none\n---\na.jpnov\n');
});

test('upsertMeta creates the front matter when the file has none', () => {
  const text = 'a.jpnov\n';
  const out = apply(text, [upsertMeta(text, 'title', '第一巻')]);
  assert.equal(out, '---\ntitle: 第一巻\n---\na.jpnov\n');
  assert.deepEqual(parseJpbook(out).meta, { title: '第一巻' });
});

test('upsertMeta creates the block even in an empty document', () => {
  const out = apply('', [upsertMeta('', 'header', '柱')]);
  assert.equal(out, '---\nheader: 柱\n---\n');
});

test('upsertMeta appends inside an UNTERMINATED block (still metadata territory)', () => {
  const text = '---\ntitle: t';
  const out = apply(text, [upsertMeta(text, 'header', '柱')]);
  assert.equal(out, '---\ntitle: t\nheader: 柱');
  assert.deepEqual(parseJpbook(out).meta, { title: 't', header: '柱' });
});

test('upsertMeta keeps an explicitly-default or empty value (upsert never deletes)', () => {
  const text = '---\npageNumber: left\n---\n';
  const out = apply(text, [upsertMeta(text, 'pageNumber', 'right')]);
  assert.equal(out, '---\npageNumber: right\n---\n');
  const cleared = apply(out, [upsertMeta(out, 'header', '')]);
  assert.equal(cleared, '---\npageNumber: right\nheader:\n---\n');
});

test('upsertMeta sanitizes pasted newlines and edge whitespace out of the value', () => {
  const out = apply('', [upsertMeta('', 'title', '  一\n二  ')]);
  assert.equal(out, '---\ntitle: 一 二\n---\n');
});

test('upsertMeta follows a CRLF document', () => {
  const text = '---\r\ntitle: t\r\n---\r\n';
  const out = apply(text, [upsertMeta(text, 'header', '柱')]);
  assert.equal(out, '---\r\ntitle: t\r\nheader: 柱\r\n---\r\n');
});

// --- appendChapters -------------------------------------------------------------

test('appendChapters appends at EOF and skips already-listed paths', () => {
  const text = '---\ntitle: t\n---\na.jpnov\n';
  const edit = appendChapters(text, ['a.jpnov', 'ch/b.jpnov', 'c.jpnov']);
  assert.ok(edit);
  assert.equal(apply(text, [edit]), '---\ntitle: t\n---\na.jpnov\nch/b.jpnov\nc.jpnov\n');
});

test('appendChapters returns null when everything is already listed', () => {
  assert.equal(appendChapters('a.jpnov\n', ['a.jpnov']), null);
});

test('appendChapters handles a document without a trailing newline', () => {
  const edit = appendChapters('a.jpnov', ['b.jpnov']);
  assert.ok(edit);
  assert.equal(apply('a.jpnov', [edit]), 'a.jpnov\nb.jpnov');
});

// --- removeChapter ---------------------------------------------------------------

test('removeChapter deletes the whole line, trailing newline included', () => {
  const text = 'a.jpnov\nb.jpnov\nc.jpnov\n';
  const edit = removeChapter(text, 1);
  assert.ok(edit);
  assert.equal(apply(text, [edit]), 'a.jpnov\nc.jpnov\n');
});

test('removeChapter of the final line swallows the PRECEDING newline', () => {
  const text = 'a.jpnov\nb.jpnov';
  const edit = removeChapter(text, 1);
  assert.ok(edit);
  assert.equal(apply(text, [edit]), 'a.jpnov');
});

test('removeChapter refuses non-chapter lines', () => {
  const text = '---\ntitle: t\n---\na.jpnov\n';
  assert.equal(removeChapter(text, 1), null);
  assert.equal(removeChapter(text, 0), null);
});

// --- moveChapterTo ----------------------------------------------------------------

test('moveChapterTo moves a chapter before another; blanks and metadata stay put', () => {
  const text = '---\ntitle: t\n---\na.jpnov\n\nb.jpnov\nc.jpnov\n';
  const edits = moveChapterTo(text, 6, 3); // c before a
  assert.ok(edits);
  assert.equal(apply(text, edits), '---\ntitle: t\n---\nc.jpnov\na.jpnov\n\nb.jpnov\n');
});

test('moveChapterTo(null) moves a chapter after the last one', () => {
  const text = 'a.jpnov\nb.jpnov\nc.jpnov\n';
  const edits = moveChapterTo(text, 0, null);
  assert.ok(edits);
  assert.equal(apply(text, edits), 'b.jpnov\nc.jpnov\na.jpnov\n');
});

test('moveChapterTo returns null for no-ops and non-chapters', () => {
  const text = 'a.jpnov\nb.jpnov\n';
  assert.equal(moveChapterTo(text, 0, 0), null);
  assert.equal(moveChapterTo(text, 0, 1), null); // already directly above
  assert.equal(moveChapterTo(text, 1, null), null); // already last
  assert.equal(moveChapterTo(text, 5, 0), null);
});

// --- panel projections ---------------------------------------------------------

test('chapterLines and metaRows project the panel model in fixed order', () => {
  const text = '---\nheader: 柱\n---\na.jpnov\nnote.md\nb.jpnov\n';
  const parsed = parseJpbook(text);
  assert.deepEqual(chapterLines(parsed.lines), [3, 5]);
  assert.deepEqual(metaRows(text), [
    { key: 'title', value: undefined },
    { key: 'header', value: '柱' },
    { key: 'pageNumber', value: undefined },
    { key: 'pageNumberFormat', value: undefined },
  ]);
});
