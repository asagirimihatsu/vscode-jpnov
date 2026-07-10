/**
 * The startup probe: settings-presence (workspace/folder level only — NEVER user level)
 * and root-level filename matching, per workspace folder.
 *
 * G1 GREP EXEMPTION: this file is the single allowed `novel.jp` literal in the source
 * tree — the last test pins that a leftover config file no longer starts the project,
 * so it must spell the old filename. It gets no exemption from the other dead-word gates.
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

const { folderIsNovelProject } = await import('../../src/client/probe.ts');

beforeEach(() => {
  resetMockState(state);
});

const FOLDER_URI = 'file:///ws/a';

function folder(): { uri: Uri; name: string; index: number } {
  return { uri: Uri.parse(FOLDER_URI), name: 'a', index: 0 };
}

test('a root-level *.filelist marks the folder as a novel project', async () => {
  state.readDirectoryResults.set(FOLDER_URI, [['volume1.filelist', 1]]);
  assert.equal(await folderIsNovelProject(folder() as never), true);
});

test('a workspace-level jpnov.* setting starts the project without any file', async () => {
  state.inspectResults.set(`${FOLDER_URI}|jpnov`, { workspaceValue: { highlight: {} } });
  state.readDirectoryResults.set(FOLDER_URI, []);
  assert.equal(await folderIsNovelProject(folder() as never), true);
});

test('a folder-level jpnov.* setting starts the project too', async () => {
  state.inspectResults.set(`${FOLDER_URI}|jpnov`, {
    workspaceFolderValue: { highlight: { characters: [] } },
  });
  state.readDirectoryResults.set(FOLDER_URI, []);
  assert.equal(await folderIsNovelProject(folder() as never), true);
});

test('a USER-level jpnov.* setting alone must not auto-start every window', async () => {
  state.inspectResults.set(`${FOLDER_URI}|jpnov`, { globalValue: { highlight: {} } });
  state.readDirectoryResults.set(FOLDER_URI, []);
  assert.equal(await folderIsNovelProject(folder() as never), false);
});

test('no settings, no matching filenames: not a novel project', async () => {
  state.readDirectoryResults.set(FOLDER_URI, [
    ['notes.md', 1],
    ['drafts', 2],
  ]);
  assert.equal(await folderIsNovelProject(folder() as never), false);
});

test('an unreadable root is skipped, not fatal', async () => {
  state.readDirectoryResults.set(FOLDER_URI, 'error');
  assert.equal(await folderIsNovelProject(folder() as never), false);
});

// The one regression pin carried by the deletion commit: novel.jp.* config files are no
// longer a project signal (the whole config pipeline is gone). This file holds the sole
// G1 grep exemption for the `novel.jp` literal — the fixture name below IS the assertion.
test('a leftover novel.jp.json no longer starts the project', async () => {
  state.readDirectoryResults.set(FOLDER_URI, [['novel.jp.json', 1]]);
  assert.equal(await folderIsNovelProject(folder() as never), false);
});
