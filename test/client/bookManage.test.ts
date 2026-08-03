/**
 * Unit tests for the Books panel's management commands (manage.ts), driven through the
 * registered `jpbook.*` handlers against the mocked `vscode`. Covers the QuickPick add-
 * chapters flow end to end: candidate enumeration → pick → the applied `.jpbook` edit.
 *
 * Runs in CI via `npm run test:integration`; directly (see test/client/README.md):
 *   node --import ./test/register.mjs --test --experimental-test-module-mocks "test/client/bookManage.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildVscode, createMockState, doc, resetMockState, Uri } from './_vscodeMock.ts';

const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { registerBookCommands } = await import('../../src/client/book/manage.ts');

const ROOT = 'file:///ws';
const BOOK = `${ROOT}/book.jpbook`;

function bookNode(): unknown {
  return { kind: 'book', entry: { uri: BOOK, rootUri: ROOT, fileRel: 'book.jpbook', outRel: 'book' } };
}

/** One folder at ROOT, the book document with `text`, and the folder's .jpnov sweep results. */
function seed(text: string, files: readonly string[]): void {
  state.workspaceFolders = [{ uri: Uri.parse(ROOT), name: 'ws', index: 0 }];
  state.textDocuments.push(doc(BOOK, 'jpbook', text));
  state.findFilesResults.set(ROOT, files.map((rel) => Uri.parse(`${ROOT}/${rel}`)));
}

async function runAddChapters(): Promise<void> {
  const handler = state.registeredCommands.get('jpbook.addChapters');
  assert.ok(handler, 'jpbook.addChapters must be registered');
  await handler(bookNode());
  assert.deepEqual(state.errorMessages, []);
}

beforeEach(() => {
  resetMockState(state);
  registerBookCommands();
});

test('addChapters offers unlisted .jpnov files sorted, split into label/description', async () => {
  seed('ichi.jpnov\n', ['zoku/ni.jpnov', 'ichi.jpnov', '第三章.jpnov']);
  state.quickPickQueue.push([{ label: '第三章.jpnov', rel: '第三章.jpnov' }]);
  await runAddChapters();

  const call = state.quickPickCalls[0];
  assert.ok(call, 'expected one QuickPick');
  assert.deepEqual(call.items, [
    { label: 'ni.jpnov', description: 'zoku', rel: 'zoku/ni.jpnov' },
    { label: '第三章.jpnov', rel: '第三章.jpnov' },
  ]);
  assert.deepEqual(call.options, {
    canPickMany: true,
    matchOnDescription: true,
    placeHolder: 'Select chapter files to add',
  });

  const edit = state.appliedEdits[0];
  assert.ok(edit, 'expected the appended chapter to be applied');
  assert.equal(edit.uri, BOOK);
  assert.match(edit.newText, /第三章\.jpnov/);
});

test('addChapters with no .jpnov files informs and never opens a picker', async () => {
  seed('', []);
  await runAddChapters();

  assert.deepEqual(state.quickPickCalls, []);
  assert.deepEqual(state.infoMessages, ['Japanese Novel: no .jpnov files found in this workspace folder.']);
  assert.deepEqual(state.appliedEdits, []);
});

test('addChapters with every candidate already listed informs and never opens a picker', async () => {
  seed('a.jpnov\nzoku/b.jpnov\n', ['a.jpnov', 'zoku/b.jpnov']);
  await runAddChapters();

  assert.deepEqual(state.quickPickCalls, []);
  assert.deepEqual(state.infoMessages, ['Japanese Novel: no chapter files left to add.']);
  assert.deepEqual(state.appliedEdits, []);
});

test('addChapters dismissed picker applies nothing', async () => {
  seed('', ['a.jpnov']);
  // Empty quickPickQueue -> showQuickPick resolves undefined (Esc).
  await runAddChapters();

  assert.equal(state.quickPickCalls.length, 1);
  assert.deepEqual(state.infoMessages, []);
  assert.deepEqual(state.appliedEdits, []);
});
