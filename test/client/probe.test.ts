/**
 * The startup probe: settings-presence (workspace/folder level only — NEVER user level)
 * and root-level filename matching, per workspace folder.
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

test('a non-file named *.filelist is no signal (directory or symlink)', async () => {
  // Strict FileType.File: matches server-side discovery, where a Dirent that is a
  // directory or a symlink is never a book either.
  state.readDirectoryResults.set(FOLDER_URI, [
    ['x.filelist', 2], // directory
    ['link.filelist', 65], // File | SymbolicLink
  ]);
  assert.equal(await folderIsNovelProject(folder() as never), false);
});

test('an unreadable root is skipped, not fatal', async () => {
  state.readDirectoryResults.set(FOLDER_URI, 'error');
  assert.equal(await folderIsNovelProject(folder() as never), false);
});
