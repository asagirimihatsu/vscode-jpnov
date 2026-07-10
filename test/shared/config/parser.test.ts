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

test('parseDataConfig parses JSON down to the highlighting vocabulary', () => {
  const bytes = new TextEncoder().encode('{"characters":["朝霧　巳一"]}');
  assert.deepEqual(parseDataConfig(bytes), { characters: ['朝霧　巳一'] });
});

test('parseDataConfig throws on malformed JSON', () => {
  const invalidBytes = new TextEncoder().encode('{ not valid json');
  assert.throws(() => parseDataConfig(invalidBytes));
});

test('initConfig silently ignores unknown keys, including every migrated field', () => {
  // sourceDir/outDir moved to jpnov.project.*, avoidLineBreaks and the grid to jpnov.layout.*;
  // a leftover key in an old novel.jp.* is dropped like any other unknown key — no error,
  // no passthrough, no deprecation notice (fully silent by design).
  assert.deepEqual(
    initConfig({
      sourceDir: './manuscript',
      outDir: 'build',
      avoidLineBreaks: true,
      charsPerLine: 43,
      linesPerPage: 40,
    }),
    {},
  );
});

test('initConfig returns an empty config for null / non-object input', () => {
  assert.deepEqual(initConfig(null), {});
  assert.deepEqual(initConfig(42), {});
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
  assert.deepEqual(
    loadModuleConfig({
      default: { keywords: ['from-default'] },
      keywords: ['from-ns'],
    }),
    { keywords: ['from-default'] },
  );
  assert.deepEqual(loadModuleConfig({ keywords: ['from-ns'] }), { keywords: ['from-ns'] });
});

test('loadModuleConfig imports mjs / cjs / js / ts configs via dynamic import', async () => {
  for (const name of ['ok.mjs', 'ok.cjs', 'ok.js', 'ok.ts'] as const) {
    const url = fixture(name);
    const mod = (await import(url)) as Record<string, unknown>;
    // Some fixtures still carry migrated keys (sourceDir/charsPerLine) — dropped silently.
    assert.deepEqual(loadModuleConfig(mod), { characters: ['朝霧　巳一'] });
  }
});
