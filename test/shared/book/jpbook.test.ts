import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completeEntryLine,
  completeMetaLine,
  composeBookChrome,
  jpbookOutRel,
  metaRegionOf,
  parseJpbook,
  type CompletionEntry,
  type JpbookLineKind,
} from '../../../src/shared/book/jpbook.ts';

const kinds = (text: string): JpbookLineKind[] => parseJpbook(text).lines.map((l) => l.kind);
const E = (name: string, isDir = false): CompletionEntry => ({ name, isDir });

// --- parseJpbook: chapter lines ---------------------------------------------

test('parseJpbook returns ordered ok lines with exact ranges', () => {
  assert.deepEqual(parseJpbook('a.jpnov\nb.jpnov').lines, [
    { line: 0, range: { startChar: 0, endChar: 7 }, raw: 'a.jpnov', value: 'a.jpnov', kind: 'ok' },
    { line: 1, range: { startChar: 0, endChar: 7 }, raw: 'b.jpnov', value: 'b.jpnov', kind: 'ok' },
  ]);
});

test('parseJpbook skips blank / whitespace-only / full-width-space-only lines (zero-width range)', () => {
  const got = parseJpbook('a.jpnov\n\n   \n　　\nb.jpnov').lines;
  assert.deepEqual(got.map((l) => l.kind), ['ok', 'blank', 'blank', 'blank', 'ok']);
  for (const l of got.filter((x) => x.kind === 'blank')) {
    assert.deepEqual(l.range, { startChar: 0, endChar: 0 });
    assert.equal(l.value, '');
  }
});

test('parseJpbook is CRLF-safe: strips trailing \\r, range excludes it', () => {
  const got = parseJpbook('a.jpnov\r\nb.jpnov\r\n').lines;
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { line: 0, range: { startChar: 0, endChar: 7 }, raw: 'a.jpnov', value: 'a.jpnov', kind: 'ok' });
  assert.equal(got[1]?.value, 'b.jpnov');
  assert.equal(got[2]?.kind, 'blank');
});

test('parseJpbook trims edges (incl. full-width) but preserves interior whitespace', () => {
  const got = parseJpbook('  chapter one.jpnov  \n　a b.jpnov').lines;
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

test('parseJpbook allows subdir paths', () => {
  assert.deepEqual(parseJpbook('chapters/01.jpnov').lines, [
    { line: 0, range: { startChar: 0, endChar: 17 }, raw: 'chapters/01.jpnov', value: 'chapters/01.jpnov', kind: 'ok' },
  ]);
});

test('parseJpbook rejects backslash with an error carrying the path range', () => {
  const l = parseJpbook('sub\\a.jpnov').lines[0];
  assert.ok(l);
  assert.deepEqual(l.kind, { error: { code: 'jpbook.backslashSeparator', args: ['sub\\a.jpnov'] } });
  assert.deepEqual(l.range, { startChar: 0, endChar: 11 });
});

test('parseJpbook rejects non-.jpnov entries', () => {
  const l = parseJpbook('note.md').lines[0];
  assert.ok(l);
  assert.deepEqual(l.kind, { error: { code: 'jpbook.notJpnov', args: ['note.md'] } });
});

test('parseJpbook marks later exact repeats as duplicate; first stays ok', () => {
  assert.deepEqual(kinds('a.jpnov\nb.jpnov\na.jpnov'), ['ok', 'ok', 'duplicate']);
});

// --- parseJpbook: front matter ----------------------------------------------

test('parseJpbook with no front matter yields an empty meta', () => {
  assert.deepEqual(parseJpbook('a.jpnov').meta, {});
});

test('parseJpbook collects fenced metadata and still parses the body', () => {
  const got = parseJpbook('---\ntitle: 夜霧の姫　第一巻\nheader: 夜霧の姫　一\n---\na.jpnov');
  assert.deepEqual(got.lines.map((l) => l.kind), ['fence', 'meta', 'meta', 'fence', 'ok']);
  assert.deepEqual(got.meta, { title: '夜霧の姫　第一巻', header: '夜霧の姫　一' });
});

test('parseJpbook accepts every recognized key and validates the enum', () => {
  const got = parseJpbook(
    '---\ntitle: t\nheader: h\npageNumber: left\npageNumberFormat: {page}\n---\n',
  );
  assert.deepEqual(got.meta, {
    title: 't',
    header: 'h',
    pageNumber: 'left',
    pageNumberFormat: '{page}',
  });
});

test('parseJpbook accepts a full-width colon separator', () => {
  const got = parseJpbook('---\ntitle：第一巻\n---\n');
  assert.deepEqual(got.meta, { title: '第一巻' });
  assert.equal(got.lines[1]?.kind, 'meta');
});

test('parseJpbook: an empty value is kept (explicitly blank)', () => {
  assert.deepEqual(parseJpbook('---\nheader:\n---\n').meta, { header: '' });
});

test('parseJpbook: blank lines inside the front matter are skipped', () => {
  assert.deepEqual(kinds('---\n\ntitle: t\n\n---\n'), ['fence', 'blank', 'meta', 'blank', 'fence', 'blank']);
});

test('parseJpbook warns on an unknown key (with the known-key list) and ignores it', () => {
  const got = parseJpbook('---\nauthor: 誰か\n---\n');
  assert.deepEqual(got.meta, {});
  assert.deepEqual(got.lines[1]?.kind, {
    warning: {
      code: 'jpbook.metaUnknownKey',
      args: ['author', 'title, header, pageNumber, pageNumberFormat'],
    },
  });
});

test('parseJpbook warns on a duplicate key; the first value wins', () => {
  const got = parseJpbook('---\ntitle: 一\ntitle: 二\n---\n');
  assert.deepEqual(got.meta, { title: '一' });
  assert.deepEqual(got.lines[2]?.kind, { warning: { code: 'jpbook.metaDuplicateKey', args: ['title'] } });
});

test('parseJpbook warns on an invalid pageNumber value and leaves it unset', () => {
  const got = parseJpbook('---\npageNumber: middle\n---\n');
  assert.deepEqual(got.meta, {});
  assert.deepEqual(got.lines[1]?.kind, {
    warning: {
      code: 'jpbook.metaBadEnum',
      args: ['pageNumber', 'middle', 'right, left, rightLeft, leftRight, none'],
    },
  });
});

test('parseJpbook errors on a colon-less (or key-less) metadata line', () => {
  assert.deepEqual(parseJpbook('---\njust text\n---\n').lines[1]?.kind, {
    error: { code: 'jpbook.metaNotKeyValue', args: ['just text'] },
  });
  assert.deepEqual(parseJpbook('---\n: no key\n---\n').lines[1]?.kind, {
    error: { code: 'jpbook.metaNotKeyValue', args: [': no key'] },
  });
});

test('parseJpbook: an unterminated block turns the opening fence into an error; meta still collects', () => {
  const got = parseJpbook('---\ntitle: t\na.jpnov');
  assert.deepEqual(got.lines[0]?.kind, { error: { code: 'jpbook.metaUnterminated', args: [] } });
  assert.equal(got.lines[1]?.kind, 'meta');
  // The path line is INSIDE the (unterminated) block, so it reads as a broken meta line.
  assert.deepEqual(got.lines[2]?.kind, { error: { code: 'jpbook.metaNotKeyValue', args: ['a.jpnov'] } });
  assert.deepEqual(got.meta, { title: 't' });
});

test('parseJpbook: front matter opens ONLY on the first non-blank line', () => {
  // Leading blanks are fine…
  assert.deepEqual(kinds('\n---\ntitle: t\n---\n'), ['blank', 'fence', 'meta', 'fence', 'blank']);
  // …but after a chapter line a --- is just an invalid path.
  assert.deepEqual(parseJpbook('a.jpnov\n---').lines[1]?.kind, {
    error: { code: 'jpbook.notJpnov', args: ['---'] },
  });
});

// --- metaRegionOf ------------------------------------------------------------

test('metaRegionOf: closed block, unterminated block, and no block', () => {
  assert.deepEqual(metaRegionOf(parseJpbook('---\ntitle: t\n---\na.jpnov').lines), { open: 0, close: 2 });
  assert.deepEqual(metaRegionOf(parseJpbook('\n---\ntitle: t').lines), { open: 1, close: null });
  assert.equal(metaRegionOf(parseJpbook('a.jpnov').lines), null);
  assert.equal(metaRegionOf(parseJpbook('').lines), null);
});

// --- composeBookChrome --------------------------------------------------------

const BASE = { lineNumbers: true, edgeLine: 'red' } as const;

test('composeBookChrome: absent keys fall back to the product defaults', () => {
  assert.deepEqual(composeBookChrome(BASE, {}), {
    lineNumbers: true,
    edgeLine: 'red',
    pageNumber: 'right',
    pageNumberFormat: '{page} / {totalPage}',
    header: '',
  });
});

test('composeBookChrome: front-matter values override the furniture, never the proofing base', () => {
  assert.deepEqual(
    composeBookChrome(BASE, {
      header: '第二巻',
      pageNumber: 'none',
      pageNumberFormat: '{page}',
    }),
    {
      lineNumbers: true,
      edgeLine: 'red',
      pageNumber: 'none',
      pageNumberFormat: '{page}',
      header: '第二巻',
    },
  );
});

test('composeBookChrome: an explicitly empty template is preserved (folio suppression)', () => {
  assert.equal(composeBookChrome(BASE, { pageNumberFormat: '' }).pageNumberFormat, '');
});

// --- jpbookOutRel --------------------------------------------------------

test('jpbookOutRel: flat name maps to its stem', () => {
  assert.equal(jpbookOutRel('volume01.jpbook'), 'volume01');
});

test('jpbookOutRel: index collapses to the parent directory', () => {
  assert.equal(jpbookOutRel('volume01/index.jpbook'), 'volume01');
  assert.equal(jpbookOutRel('part1/vol2/index.jpbook'), 'part1/vol2');
});

test('jpbookOutRel: nested segments path-join (mirror the source tree)', () => {
  assert.equal(jpbookOutRel('part1/vol2.jpbook'), 'part1/vol2');
  assert.equal(jpbookOutRel('a/b/c.jpbook'), 'a/b/c');
  assert.equal(jpbookOutRel('part1\\vol2.jpbook'), 'part1/vol2');
  assert.equal(jpbookOutRel('01-volume/01-volume/index.jpbook'), '01-volume/01-volume');
});

test('jpbookOutRel: root-level index keeps index (no parent)', () => {
  assert.equal(jpbookOutRel('index.jpbook'), 'index');
});

test('jpbookOutRel collision: index form and flat form produce the same path', () => {
  assert.equal(jpbookOutRel('volume01/index.jpbook'), jpbookOutRel('volume01.jpbook'));
});

// --- completeEntryLine --------------------------------------------------

test('completeEntryLine filters by segment; hides dotfiles, .jpbook, non-.jpnov', () => {
  const got = completeEntryLine('ch', [
    E('chapter1.jpnov'),
    E('chapter2.jpnov'),
    E('notes.md'),
    E('.hidden.jpnov'),
    E('index.jpbook'),
    E('sub', true),
  ]);
  assert.deepEqual(got, [
    { label: 'chapter1.jpnov', insertText: 'chapter1.jpnov', kind: 'file', replace: { startChar: 0, endChar: 2 } },
    { label: 'chapter2.jpnov', insertText: 'chapter2.jpnov', kind: 'file', replace: { startChar: 0, endChar: 2 } },
  ]);
});

test('completeEntryLine drills into directories with a trailing slash', () => {
  const dir = completeEntryLine('', [E('sub', true), E('a.jpnov')]).find((c) => c.kind === 'folder');
  assert.equal(dir?.insertText, 'sub/');
});

test('completeEntryLine replace range is the segment after the last slash', () => {
  assert.deepEqual(completeEntryLine('chapters/ch', [E('chapter1.jpnov')]), [
    { label: 'chapter1.jpnov', insertText: 'chapter1.jpnov', kind: 'file', replace: { startChar: 9, endChar: 11 } },
  ]);
});

test('completeEntryLine matches case-insensitively but inserts the on-disk casing', () => {
  const got = completeEntryLine('CH', [E('Chapter1.jpnov')]);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.insertText, 'Chapter1.jpnov');
});

test('completeEntryLine excludes leading whitespace from the replace range', () => {
  const got = completeEntryLine('  ch', [E('chapter1.jpnov')]);
  assert.deepEqual(got[0]?.replace, { startChar: 2, endChar: 4 });
});

test('completeEntryLine respects the cap', () => {
  const many = Array.from({ length: 10 }, (_, i) => E(`f${String(i)}.jpnov`));
  assert.equal(completeEntryLine('f', many, 3).length, 3);
});

// --- completeMetaLine --------------------------------------------------------

test('completeMetaLine offers every key on an empty line, inserted as "key: "', () => {
  const got = completeMetaLine('');
  assert.deepEqual(got.map((c) => c.label), ['title', 'header', 'pageNumber', 'pageNumberFormat']);
  const first = got[0];
  assert.ok(first);
  assert.equal(first.insertText, 'title: ');
  assert.equal(first.kind, 'key');
  assert.deepEqual(first.replace, { startChar: 0, endChar: 0 });
});

test('completeMetaLine filters keys by case-insensitive prefix, replacing the typed span', () => {
  const got = completeMetaLine('  PAGE');
  assert.deepEqual(got.map((c) => c.label), ['pageNumber', 'pageNumberFormat']);
  assert.deepEqual(got[0]?.replace, { startChar: 2, endChar: 6 });
});

test('completeMetaLine offers enum members after "pageNumber:"', () => {
  const got = completeMetaLine('pageNumber: le');
  assert.deepEqual(got.map((c) => c.label), ['left', 'leftRight']);
  const first = got[0];
  assert.ok(first);
  assert.equal(first.kind, 'value');
  assert.deepEqual(first.replace, { startChar: 12, endChar: 14 });
});

test('completeMetaLine offers nothing after the colon of a free-text key', () => {
  assert.deepEqual(completeMetaLine('title: 夜'), []);
  assert.deepEqual(completeMetaLine('header: '), []);
});
