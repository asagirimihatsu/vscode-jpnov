/**
 * `jpnov.layout.avoidLineBreaks` (boolean) was hard-cut to the `jpnov.layout.kinsoku` enum —
 * old values are NOT migrated, so any surviving spelling of the retired identifier is a bug
 * (a stale schema key, resolver branch, or test fixture). Fails on the first hit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url); // repo root, from test/shared/config/
const SELF = 'test/shared/config/kinsoku-deadword.test.ts';
const SKIP = new Set(['node_modules', 'dist', 'out', '.git', '.vscode-test']);
const EXTS = ['.ts', '.js', '.json', '.md', '.css'];

function* walk(rel: string): Generator<string> {
  for (const entry of readdirSync(fileURLToPath(new URL(rel, ROOT)), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const path = rel + entry.name;
    if (entry.isDirectory()) {
      yield* walk(`${path}/`);
    } else if (EXTS.some((ext) => entry.name.endsWith(ext))) {
      yield path;
    }
  }
}

test('the retired `avoidLineBreaks` identifier appears nowhere in the repo', () => {
  const hits = [...walk('')].filter(
    (rel) =>
      rel !== SELF && readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8').includes('avoidLineBreaks'),
  );
  assert.deepEqual(hits, []);
});
