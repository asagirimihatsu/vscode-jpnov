/**
 * Unit test for the pure `buildForest` tree-shaping helper behind the Books panel.
 *
 * `bookTree.ts` is vscode-free and imports `#/shared/protocol.ts` type-only (erased at runtime), so
 * this runs directly under `node --test` — unlike its test/client siblings it needs no vscode mock
 * and no resolution shim:
 *   node --test "test/client/bookTree.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildForest } from '../../src/client/bookTree.ts';
import type { BookEntry } from '../../src/shared/protocol.ts';

/** A BookEntry where only `rootUri`/`outRel` matter to `buildForest`. */
const entry = (rootUri: string, outRel: string): BookEntry => ({
  uri: `${rootUri}/src/${outRel}.filelist`,
  rootUri,
  fileRel: `${outRel}.filelist`,
  outRel,
});

test('buildForest groups books into a per-root folder hierarchy by outRel', () => {
  const root = 'file:///ws';
  const forest = buildForest([entry(root, 'a/b'), entry(root, 'a/c'), entry(root, 'top')]);

  assert.equal(forest.size, 1);
  const dir = forest.get(root);
  assert.ok(dir);
  // Top level: one folder `a` plus the bare leaf `top`.
  assert.deepEqual([...dir.dirs.keys()], ['a']);
  assert.deepEqual(dir.books.map((b) => b.outRel), ['top']);
  const a = dir.dirs.get('a');
  assert.ok(a);
  assert.equal(a.dirs.size, 0);
  assert.deepEqual(a.books.map((b) => b.outRel).sort(), ['a/b', 'a/c']);
});

test('buildForest nests deep outRel paths with the leaf at the bottom, no stray middles', () => {
  const root = 'file:///ws';
  const forest = buildForest([entry(root, 'a/b/c')]);

  const b = forest.get(root)?.dirs.get('a')?.dirs.get('b');
  assert.ok(b);
  assert.deepEqual(b.books.map((x) => x.outRel), ['a/b/c']);
  // The book is a leaf only at the bottom; intermediate dirs hold no books.
  assert.equal(forest.get(root)?.books.length, 0);
  assert.equal(forest.get(root)?.dirs.get('a')?.books.length, 0);
});

test('buildForest keeps roots separate', () => {
  const r1 = 'file:///w1';
  const r2 = 'file:///w2';
  const forest = buildForest([entry(r1, 'x'), entry(r2, 'y/z')]);

  assert.deepEqual([...forest.keys()].sort(), [r1, r2]);
  assert.deepEqual(forest.get(r1)?.books.map((b) => b.outRel), ['x']);
  assert.deepEqual(forest.get(r2)?.dirs.get('y')?.books.map((b) => b.outRel), ['y/z']);
});
