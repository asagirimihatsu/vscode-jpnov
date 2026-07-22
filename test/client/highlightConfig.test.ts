/**
 * The client-side highlight snapshot: every folder unconditionally in the map (empty
 * arrays included — the map defines the target roots), keys verbatim, values verbatim
 * (the SERVER normalizes; the client must not).
 *
 * NOT wired into `npm test` (test/client is authored-only). Run with a `vscode`
 * resolution shim present (see test/client/README.md):
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVscode,
  createMockState,
  resetMockState,
  Uri,
} from './_vscodeMock.ts';

const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { buildHighlightSnapshot } = await import('../../src/client/highlightConfig.ts');

beforeEach(() => {
  resetMockState(state);
});

function addFolder(uri: string, index: number): void {
  state.workspaceFolders ??= [];
  state.workspaceFolders.push({ uri: Uri.parse(uri), name: `f${String(index)}`, index });
}

test('every folder lands in the map, empty arrays included', () => {
  addFolder('file:///ws/a', 0);
  addFolder('file:///ws/b', 1);
  state.scopedConfig.set('file:///ws/a|jpnov.editor.highlight.characters', ['朝霧　巳一']);

  const map = buildHighlightSnapshot();
  assert.deepEqual(Object.keys(map).sort(), ['file:///ws/a', 'file:///ws/b']);
  assert.deepEqual(map['file:///ws/a'], { characters: ['朝霧　巳一'], keywords: [] });
  assert.deepEqual(map['file:///ws/b'], { characters: [], keywords: [] });
});

test('keys are the folder URIs verbatim', () => {
  addFolder('file:///ws/a', 0);
  const map = buildHighlightSnapshot();
  assert.deepEqual(Object.keys(map), ['file:///ws/a']);
});

test('values pass through raw — no client-side normalization', () => {
  addFolder('file:///ws/a', 0);
  state.scopedConfig.set('file:///ws/a|jpnov.editor.highlight.characters', ['', '巳一', '巳一']);
  state.scopedConfig.set('file:///ws/a|jpnov.editor.highlight.keywords', ['黒剣']);

  const map = buildHighlightSnapshot();
  assert.deepEqual(map['file:///ws/a'], {
    characters: ['', '巳一', '巳一'], // duplicates and empties survive to the server
    keywords: ['黒剣'],
  });
});

test('no workspace folders: an empty map', () => {
  assert.deepEqual(buildHighlightSnapshot(), {});
});
