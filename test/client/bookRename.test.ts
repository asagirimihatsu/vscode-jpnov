import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFsPath, planBookEdits, type FileRename } from '../../src/client/book/rename.ts';

const ROOT = '/ws/novel';
const R = (oldPath: string, newPath: string): FileRename => ({ oldPath, newPath });

test('a file rename rewrites exactly the path span (whitespace preserved)', () => {
  const plan = planBookEdits(ROOT, '　a.jpnov  \nb.jpnov', [R('/ws/novel/a.jpnov', '/ws/novel/z.jpnov')]);
  assert.deepEqual(plan, {
    edits: [{ line: 0, startChar: 1, endChar: 8, newText: 'z.jpnov' }],
    unrepresentable: [],
  });
});

test('a move into a subfolder rewrites to the deeper relative path', () => {
  const plan = planBookEdits(ROOT, 'a.jpnov', [R('/ws/novel/a.jpnov', '/ws/novel/ch/a.jpnov')]);
  assert.equal(plan.edits[0]?.newText, 'ch/a.jpnov');
});

test('a folder rename matches by prefix and rewrites every entry under it', () => {
  const plan = planBookEdits(ROOT, 'ch/01.jpnov\nother.jpnov\nch/02.jpnov', [
    R('/ws/novel/ch', '/ws/novel/chapters'),
  ]);
  assert.deepEqual(plan.edits.map((e) => [e.line, e.newText]), [
    [0, 'chapters/01.jpnov'],
    [2, 'chapters/02.jpnov'],
  ]);
});

test('prefix matching is segment-exact: renaming ch never touches chx/', () => {
  const plan = planBookEdits(ROOT, 'chx/a.jpnov', [R('/ws/novel/ch', '/ws/novel/chapters')]);
  assert.deepEqual(plan.edits, []);
});

test('moving the .jpbook itself never touches its entries (root-relative by design)', () => {
  // The reported regression: a book moved into books/ used to invalidate every path.
  const plan = planBookEdits(ROOT, 'ch/01.jpnov\nch/02.jpnov', [
    R('/ws/novel/vol1.jpbook', '/ws/novel/books/vol1.jpbook'),
  ]);
  assert.deepEqual(plan, { edits: [], unrepresentable: [] });
});

test('a move OUT of the workspace folder is unrepresentable, never rewritten', () => {
  const plan = planBookEdits(ROOT, 'a.jpnov\nb.jpnov', [R('/ws/novel/a.jpnov', '/elsewhere/a.jpnov')]);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.unrepresentable, ['a.jpnov']);
});

test('duplicate lines follow the rename along with the ok line', () => {
  const plan = planBookEdits(ROOT, 'a.jpnov\na.jpnov', [R('/ws/novel/a.jpnov', '/ws/novel/b.jpnov')]);
  assert.deepEqual(plan.edits.map((e) => e.line), [0, 1]);
});

test('front-matter and error lines are never rewritten', () => {
  const text = '---\ntitle: a.jpnov\n---\nnote.md\na.jpnov';
  const plan = planBookEdits(ROOT, text, [R('/ws/novel/a.jpnov', '/ws/novel/b.jpnov')]);
  assert.deepEqual(plan.edits, [{ line: 4, startChar: 0, endChar: 7, newText: 'b.jpnov' }]);
});

test('a ./-style entry still matches; the rewrite canonicalizes it', () => {
  const plan = planBookEdits(ROOT, './a.jpnov', [R('/ws/novel/a.jpnov', '/ws/novel/b.jpnov')]);
  assert.equal(plan.edits[0]?.newText, 'b.jpnov');
});

test('a rename onto a non-.jpnov name is still written (diagnostics flag the line after)', () => {
  const plan = planBookEdits(ROOT, 'a.jpnov', [R('/ws/novel/a.jpnov', '/ws/novel/a.txt')]);
  assert.equal(plan.edits[0]?.newText, 'a.txt');
});

test('several renames in one event apply together; other roots plan empty', () => {
  const renames = [
    R('/ws/novel/a.jpnov', '/ws/novel/x.jpnov'),
    R('/ws/novel/sub', '/ws/novel/part1'),
  ];
  const plan = planBookEdits(ROOT, 'a.jpnov\nsub/b.jpnov', renames);
  assert.deepEqual(plan.edits.map((e) => e.newText), ['x.jpnov', 'part1/b.jpnov']);

  const untouched = planBookEdits('/ws/other', 'c.jpnov', renames);
  assert.deepEqual(untouched, { edits: [], unrepresentable: [] });
});

test('CRLF lines keep the span clear of the \\r', () => {
  const plan = planBookEdits(ROOT, 'a.jpnov\r\n', [R('/ws/novel/a.jpnov', '/ws/novel/b.jpnov')]);
  assert.deepEqual(plan.edits, [{ line: 0, startChar: 0, endChar: 7, newText: 'b.jpnov' }]);
});

test('normalizeFsPath flips Windows separators only', () => {
  assert.equal(normalizeFsPath('C:\\ws\\novel\\a.jpnov'), 'C:/ws/novel/a.jpnov');
  assert.equal(normalizeFsPath('/ws/novel/a.jpnov'), '/ws/novel/a.jpnov');
});
