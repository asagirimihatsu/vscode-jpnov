import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completeFilelistLine,
  filelistOutRel,
  parseFilelist,
  type CompletionEntry,
  type FilelistLineKind,
} from '../../../src/shared/book/filelist.ts';

const kinds = (text: string): FilelistLineKind[] => parseFilelist(text).map((l) => l.kind);
const E = (name: string, isDir = false): CompletionEntry => ({ name, isDir });

// --- parseFilelist ---------------------------------------------------------

test('parseFilelist returns ordered ok lines with exact ranges', () => {
  assert.deepEqual(parseFilelist('a.jpnov\nb.jpnov'), [
    { line: 0, range: { startChar: 0, endChar: 7 }, raw: 'a.jpnov', value: 'a.jpnov', kind: 'ok' },
    { line: 1, range: { startChar: 0, endChar: 7 }, raw: 'b.jpnov', value: 'b.jpnov', kind: 'ok' },
  ]);
});

test('parseFilelist skips blank / whitespace-only / full-width-space-only lines (zero-width range)', () => {
  const got = parseFilelist('a.jpnov\n\n   \n　　\nb.jpnov');
  assert.deepEqual(got.map((l) => l.kind), ['ok', 'blank', 'blank', 'blank', 'ok']);
  for (const l of got.filter((x) => x.kind === 'blank')) {
    assert.deepEqual(l.range, { startChar: 0, endChar: 0 });
    assert.equal(l.value, '');
  }
});

test('parseFilelist is CRLF-safe: strips trailing \\r, range excludes it', () => {
  const got = parseFilelist('a.jpnov\r\nb.jpnov\r\n');
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { line: 0, range: { startChar: 0, endChar: 7 }, raw: 'a.jpnov', value: 'a.jpnov', kind: 'ok' });
  assert.equal(got[1]?.value, 'b.jpnov');
  assert.equal(got[2]?.kind, 'blank');
});

test('parseFilelist trims edges (incl. full-width) but preserves interior whitespace', () => {
  const got = parseFilelist('  chapter one.jpnov  \n　a b.jpnov');
  assert.deepEqual(got[0], {
    line: 0,
    range: { startChar: 2, endChar: 19 },
    raw: '  chapter one.jpnov  ',
    value: 'chapter one.jpnov',
    kind: 'ok',
  });
  assert.deepEqual(got[1], {
    line: 1,
    range: { startChar: 1, endChar: 10 },
    raw: '　a b.jpnov',
    value: 'a b.jpnov',
    kind: 'ok',
  });
});

test('parseFilelist allows subdir paths', () => {
  assert.deepEqual(parseFilelist('chapters/01.jpnov'), [
    { line: 0, range: { startChar: 0, endChar: 17 }, raw: 'chapters/01.jpnov', value: 'chapters/01.jpnov', kind: 'ok' },
  ]);
});

test('parseFilelist rejects backslash with an error carrying the path range', () => {
  const l = parseFilelist('sub\\a.jpnov')[0];
  assert.ok(l);
  assert.ok(typeof l.kind === 'object' && l.kind.error.includes('\\'), 'backslash is an error');
  assert.deepEqual(l.range, { startChar: 0, endChar: 11 });
});

test('parseFilelist rejects non-.jpnov entries', () => {
  const l = parseFilelist('note.md')[0];
  assert.ok(l);
  assert.ok(typeof l.kind === 'object' && l.kind.error.includes('.jpnov'));
});

test('parseFilelist marks later exact repeats as duplicate; first stays ok', () => {
  assert.deepEqual(kinds('a.jpnov\nb.jpnov\na.jpnov'), ['ok', 'ok', 'duplicate']);
});

// --- filelistOutRel --------------------------------------------------------

test('filelistOutRel: flat name maps to its stem', () => {
  assert.equal(filelistOutRel('volume01.filelist'), 'volume01');
});

test('filelistOutRel: index collapses to the parent directory', () => {
  assert.equal(filelistOutRel('volume01/index.filelist'), 'volume01');
  assert.equal(filelistOutRel('part1/vol2/index.filelist'), 'part1/vol2');
});

test('filelistOutRel: nested segments path-join (mirror the source tree)', () => {
  assert.equal(filelistOutRel('part1/vol2.filelist'), 'part1/vol2');
  assert.equal(filelistOutRel('a/b/c.filelist'), 'a/b/c');
  assert.equal(filelistOutRel('part1\\vol2.filelist'), 'part1/vol2');
  assert.equal(filelistOutRel('01-volume/01-volume/index.filelist'), '01-volume/01-volume');
});

test('filelistOutRel: root-level index keeps index (no parent)', () => {
  assert.equal(filelistOutRel('index.filelist'), 'index');
});

test('filelistOutRel collision: index form and flat form produce the same path', () => {
  assert.equal(filelistOutRel('volume01/index.filelist'), filelistOutRel('volume01.filelist'));
});

// --- completeFilelistLine --------------------------------------------------

test('completeFilelistLine filters by segment; hides dotfiles, .filelist, non-.jpnov', () => {
  const got = completeFilelistLine('ch', [
    E('chapter1.jpnov'),
    E('chapter2.jpnov'),
    E('notes.md'),
    E('.hidden.jpnov'),
    E('index.filelist'),
    E('sub', true),
  ]);
  assert.deepEqual(got, [
    { label: 'chapter1.jpnov', insertText: 'chapter1.jpnov', kind: 'file', replace: { startChar: 0, endChar: 2 } },
    { label: 'chapter2.jpnov', insertText: 'chapter2.jpnov', kind: 'file', replace: { startChar: 0, endChar: 2 } },
  ]);
});

test('completeFilelistLine drills into directories with a trailing slash', () => {
  const dir = completeFilelistLine('', [E('sub', true), E('a.jpnov')]).find((c) => c.kind === 'folder');
  assert.equal(dir?.insertText, 'sub/');
});

test('completeFilelistLine replace range is the segment after the last slash', () => {
  assert.deepEqual(completeFilelistLine('chapters/ch', [E('chapter1.jpnov')]), [
    { label: 'chapter1.jpnov', insertText: 'chapter1.jpnov', kind: 'file', replace: { startChar: 9, endChar: 11 } },
  ]);
});

test('completeFilelistLine matches case-insensitively but inserts the on-disk casing', () => {
  const got = completeFilelistLine('CH', [E('Chapter1.jpnov')]);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.insertText, 'Chapter1.jpnov');
});

test('completeFilelistLine excludes leading whitespace from the replace range', () => {
  const got = completeFilelistLine('  ch', [E('chapter1.jpnov')]);
  assert.deepEqual(got[0]?.replace, { startChar: 2, endChar: 4 });
});

test('completeFilelistLine respects the cap', () => {
  const many = Array.from({ length: 10 }, (_, i) => E(`f${String(i)}.jpnov`));
  assert.equal(completeFilelistLine('f', many, 3).length, 3);
});
