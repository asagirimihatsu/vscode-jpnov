import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initConfig,
  isDataFormat,
  loadModuleConfig,
  matchConfig,
  parseDataConfig,
  FILE_TYPE_FILE,
} from '../../../src/shared/config/parser.ts';
import { DEFAULT } from '../../../src/shared/config/types.ts';

const fixture = (name: string): string =>
  new URL(`../../../test-fixtures/${name}`, import.meta.url).href;

test('isDataFormat distinguishes executable formats from data formats', () => {
  for (const f of ['js', 'cjs', 'mjs', 'ts'] as const) {
    assert.equal(isDataFormat(f), false);
  }
  assert.equal(isDataFormat('json'), true);
});

// A regular file is the numeric mask `1` (vscode's FileType.File) — no vscode import.
function wrapEntries(names: string[]): [string, number][] {
  return names.map((name) => [name, FILE_TYPE_FILE] as [string, number]);
}

test('matchConfig honors json > js > ts > mjs > cjs', () => {
  assert.deepEqual(
    matchConfig(
      wrapEntries([
        'novel.jp.json',
        'novel.jp.js',
        'novel.jp.ts',
        'novel.jp.mjs',
        'novel.jp.cjs',
      ]),
      FILE_TYPE_FILE,
    ),
    { filename: 'novel.jp.json', format: 'json' },
  );
  assert.deepEqual(matchConfig(wrapEntries(['novel.jp.ts', 'novel.jp.js']), FILE_TYPE_FILE), {
    filename: 'novel.jp.js',
    format: 'js',
  });
  assert.deepEqual(matchConfig(wrapEntries(['novel.jp.mjs', 'novel.jp.cjs']), FILE_TYPE_FILE), {
    filename: 'novel.jp.mjs',
    format: 'mjs',
  });
  assert.deepEqual(matchConfig(wrapEntries(['novel.jp.ts']), FILE_TYPE_FILE), {
    filename: 'novel.jp.ts',
    format: 'ts',
  });
  assert.equal(matchConfig(wrapEntries(['unrelated.txt']), FILE_TYPE_FILE), null);
  assert.equal(matchConfig(wrapEntries([]), FILE_TYPE_FILE), null);
});

test('matchConfig skips entries that do not match the allow mask (e.g. directories)', () => {
  const DIR = 2;
  // A directory named like a config (mask bit 2) is ignored when only files (1) allowed.
  assert.equal(matchConfig([['novel.jp.json', DIR]], FILE_TYPE_FILE), null);
});

test('parseDataConfig parses JSON with the renamed numeric fields', () => {
  const bytes = new TextEncoder().encode('{"charsPerLine":43,"linesPerPage":40}');
  assert.deepEqual(parseDataConfig(bytes), {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: 43,
    linesPerPage: 40,
    outDir: DEFAULT.outDir,
  });
});

test('parseDataConfig throws on malformed JSON', () => {
  const invalidBytes = new TextEncoder().encode('{ not valid json');
  assert.throws(() => parseDataConfig(invalidBytes));
});

test('initConfig clamps out-of-range numerics to [1..1000] per field', () => {
  assert.deepEqual(initConfig({ charsPerLine: 0, linesPerPage: 99999 }), {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: 1,
    linesPerPage: 1000,
    outDir: DEFAULT.outDir,
  });
});

test('initConfig falls back per field on invalid numerics, keeping good ones', () => {
  assert.deepEqual(initConfig({ charsPerLine: 'nope', linesPerPage: 12.5, sourceDir: '' }), {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: DEFAULT.charsPerLine,
    linesPerPage: DEFAULT.linesPerPage,
    outDir: DEFAULT.outDir,
  });
});

test('initConfig accepts a custom sourceDir and outDir', () => {
  assert.deepEqual(initConfig({ sourceDir: './manuscript', outDir: 'build' }), {
    sourceDir: './manuscript',
    charsPerLine: DEFAULT.charsPerLine,
    linesPerPage: DEFAULT.linesPerPage,
    outDir: 'build',
  });
});

test('initConfig returns a fresh DEFAULT for null / non-object input', () => {
  assert.deepEqual(initConfig(null), { ...DEFAULT });
  assert.deepEqual(initConfig(42), { ...DEFAULT });
});

test('initConfig reads a boolean avoidLineBreaks and ignores non-boolean', () => {
  assert.deepEqual(initConfig({ avoidLineBreaks: true }), {
    ...DEFAULT,
    avoidLineBreaks: true,
  });
  // Non-boolean is dropped (off) — and stays absent so it never bloats the wire payload.
  assert.deepEqual(initConfig({ avoidLineBreaks: 'yes' }), { ...DEFAULT });
});

test('initConfig keeps characters and keywords, deduping each first-seen', () => {
  const c = initConfig({
    characters: ['朝霧　巳一', 'Arill Stains', '朝霧　巳一'],
    keywords: ['黒剣', '境無', '黒剣'],
  });
  assert.deepEqual(c.characters, ['朝霧　巳一', 'Arill Stains']);
  assert.deepEqual(c.keywords, ['黒剣', '境無']);
});

test('initConfig drops empty / non-string list items, omitting an emptied list', () => {
  const c = initConfig({ characters: ['巳一', '', 42, null], keywords: [] });
  assert.deepEqual(c.characters, ['巳一']);
  assert.equal(c.keywords, undefined);
});

test('initConfig: a non-array or all-invalid characters/keywords becomes undefined', () => {
  assert.equal(initConfig({ characters: 'oops' }).characters, undefined);
  assert.equal(initConfig({ keywords: [123, null] }).keywords, undefined);
  assert.equal(initConfig({}).characters, undefined);
  assert.equal(initConfig({}).keywords, undefined);
});

test('loadModuleConfig prefers the default export, else the namespace', () => {
  assert.deepEqual(loadModuleConfig({ default: { charsPerLine: 41, linesPerPage: 18 }, charsPerLine: 42 }), {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: 41,
    linesPerPage: 18,
    outDir: DEFAULT.outDir,
  });
  assert.deepEqual(loadModuleConfig({ charsPerLine: 42, linesPerPage: 38 }), {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: 42,
    linesPerPage: 38,
    outDir: DEFAULT.outDir,
  });
});

test('loadModuleConfig imports mjs / cjs / js / ts configs via dynamic import', async () => {
  for (const name of ['ok.mjs', 'ok.cjs', 'ok.js', 'ok.ts'] as const) {
    const url = fixture(name);
    const mod = (await import(url)) as Record<string, unknown>;
    assert.deepEqual(loadModuleConfig(mod), {
      sourceDir: './src',
      charsPerLine: 40,
      linesPerPage: 34,
      outDir: DEFAULT.outDir,
    });
  }
});
