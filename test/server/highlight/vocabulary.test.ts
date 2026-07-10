/**
 * The per-root vocabulary store: replacement semantics (a pushed map IS the whole state),
 * wire normalization (the one home of "drop bad items, keep the rest"), longest-prefix
 * routing with empty-entry shadowing, recognizer memoization, and the refresh side of
 * `handleHighlightChanged` (forgetting it = "setting change does nothing until you edit").
 * Pure in-memory + a FakeConnection — runs inside plain `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHighlightStore,
  handleHighlightChanged,
} from '../../../src/server/highlight/vocabulary.ts';
import type { HighlightVocabularyMap } from '../../../src/shared/protocol.ts';
import { makeFakeConnection } from '../helpers.ts';

const ROOT_A = 'file:///ws/a';
const ROOT_B = 'file:///ws/b';

const vocab = (characters: string[], keywords: string[] = []) => ({ characters, keywords });

/** True iff the root's recognizer marks `name` as a character subject in `name + は`. */
function recognizes(store: ReturnType<typeof createHighlightStore>, docUri: string, name: string): boolean {
  const rec = store.recognizerFor(docUri);
  if (!rec) {
    return false;
  }
  return rec.recognize(`${name}は`).some((s) => s.kind === 'character');
}

test('seeding: apply(undefined) leaves no vocabulary anywhere', () => {
  const store = createHighlightStore();
  store.apply(undefined);
  assert.equal(store.recognizerFor(`${ROOT_A}/ch1.jpnov`), undefined);
});

test('per-root isolation: each root recognizes only its own cast', () => {
  const store = createHighlightStore();
  store.apply({
    [ROOT_A]: vocab(['朝霧　巳一']),
    [ROOT_B]: vocab(['境無']),
  });
  assert.ok(recognizes(store, `${ROOT_A}/ch1.jpnov`, '巳一'));
  assert.ok(!recognizes(store, `${ROOT_A}/ch1.jpnov`, '境無'));
  assert.ok(recognizes(store, `${ROOT_B}/ch1.jpnov`, '境無'));
  assert.ok(!recognizes(store, `${ROOT_B}/ch1.jpnov`, '巳一'));
});

test('replacement semantics: a root absent from the next push is cleared', () => {
  const store = createHighlightStore();
  store.apply({ [ROOT_A]: vocab(['巳一']), [ROOT_B]: vocab(['境無']) });
  assert.ok(recognizes(store, `${ROOT_B}/ch1.jpnov`, '境無'));

  store.apply({ [ROOT_A]: vocab(['巳一']) });
  assert.equal(store.recognizerFor(`${ROOT_B}/ch1.jpnov`), undefined, 'absent root = no vocabulary');
  assert.ok(recognizes(store, `${ROOT_A}/ch1.jpnov`, '巳一'), 'the surviving root is untouched');
});

test('normalization: empties, duplicates, non-strings, and non-array values are dropped, not fatal', () => {
  const store = createHighlightStore();
  store.apply({
    [ROOT_A]: {
      characters: ['', '巳一', '巳一', 42, null] as unknown as readonly string[],
      keywords: 'not-an-array' as unknown as readonly string[],
    },
  });
  const rec = store.recognizerFor(`${ROOT_A}/ch1.jpnov`);
  assert.ok(rec, 'the good item survives');
  assert.equal(rec.recognize('巳一は').filter((s) => s.kind === 'character').length, 1);

  // Nothing usable at all -> no recognizer (the fast path stays).
  store.apply({ [ROOT_A]: { characters: [''], keywords: [] } });
  assert.equal(store.recognizerFor(`${ROOT_A}/ch1.jpnov`), undefined);
});

test('invalidation: a fresh apply swaps recognizers — old words out, new words in', () => {
  const store = createHighlightStore();
  store.apply({ [ROOT_A]: vocab(['巳一']) });
  const before = store.recognizerFor(`${ROOT_A}/ch1.jpnov`);
  assert.ok(before);

  store.apply({ [ROOT_A]: vocab(['境無']) });
  const after = store.recognizerFor(`${ROOT_A}/ch1.jpnov`);
  assert.ok(after);
  assert.notEqual(after, before, 'the recognizer instance was rebuilt');
  assert.ok(recognizes(store, `${ROOT_A}/ch1.jpnov`, '境無'));
  assert.ok(!recognizes(store, `${ROOT_A}/ch1.jpnov`, '巳一'));
});

test('key normalization: a trailing-slash root key still routes its documents', () => {
  const store = createHighlightStore();
  store.apply({ [`${ROOT_A}/`]: vocab(['巳一']) });
  assert.ok(recognizes(store, `${ROOT_A}/ch1.jpnov`, '巳一'));
});

test('nested roots: longest prefix wins, and an empty child entry shadows its parent', () => {
  const store = createHighlightStore();
  store.apply({
    'file:///ws': vocab(['巳一']),
    'file:///ws/sub': vocab([], []),
    'file:///ws/deep': vocab(['境無']),
  });
  assert.ok(recognizes(store, 'file:///ws/ch1.jpnov', '巳一'), 'parent doc uses the parent vocab');
  assert.ok(recognizes(store, 'file:///ws/deep/ch1.jpnov', '境無'), 'deepest matching root wins');
  assert.equal(
    store.recognizerFor('file:///ws/sub/ch1.jpnov'),
    undefined,
    "the child's empty vocabulary shadows the parent's",
  );
});

test('memoization: the same entry hands out the same recognizer instance', () => {
  const store = createHighlightStore();
  store.apply({ [ROOT_A]: vocab(['巳一']) });
  const first = store.recognizerFor(`${ROOT_A}/ch1.jpnov`);
  const second = store.recognizerFor(`${ROOT_A}/ch2.jpnov`);
  assert.ok(first);
  assert.equal(second, first);
});

test('handleHighlightChanged applies the map AND asks the client to re-pull tokens', () => {
  const conn = makeFakeConnection();
  const store = createHighlightStore();
  const highlight: HighlightVocabularyMap = { [ROOT_A]: vocab(['巳一']) };

  handleHighlightChanged(conn.asConnection(), store, { highlight });

  assert.equal(conn.semanticTokenRefreshes(), 1, 'exactly one semanticTokens.refresh');
  assert.ok(recognizes(store, `${ROOT_A}/ch1.jpnov`, '巳一'), 'the snapshot was applied');
});
