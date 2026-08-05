/**
 * Unit tests for the Books panel's management commands (manage.ts), driven through the
 * registered `jpbook.*` handlers against the mocked `vscode`. Covers the QuickPick add-
 * chapters flow end to end (candidate enumeration → pick → the applied `.jpbook` edit)
 * and `createFile`'s chapter mode (prompt → write → append → open).
 *
 * Runs in CI via `npm run test:integration`; directly (see test/client/README.md):
 *   node --import ./test/register.mjs --test --experimental-test-module-mocks "test/client/bookManage.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildVscode, createMockState, doc, FileType, resetMockState, Uri } from './_vscodeMock.ts';

const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { createFile, registerBookCommands } = await import('../../src/client/book/manage.ts');

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

// --- createFile (chapter mode: invoked with a book node) ----------------------

async function runCreateChapter(): Promise<void> {
  await createFile(undefined, bookNode());
}

test('createFile with a book node parks the .jpnov suffix after the caret', async () => {
  seed('', []);
  // Empty inputBoxQueue -> showInputBox resolves undefined (Esc): nothing happens.
  await runCreateChapter();

  const options = state.inputBoxCalls[0]?.options;
  assert.ok(options, 'expected one input box');
  assert.equal(options.prompt, 'File name of the new chapter');
  assert.equal(options.value, '.jpnov');
  assert.deepEqual(options.valueSelection, [0, 0]);
  assert.equal(options.ignoreFocusOut, true);
  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.appliedEdits, []);
});

test('the chapter validator rejects empty, unusable, and taken paths', async () => {
  seed('', []);
  state.fsEntries.set(`${ROOT}/taken.jpnov`, FileType.File);
  state.inputBoxQueue.push('fresh');
  await runCreateChapter();

  // The mock never invokes validateInput; probe the recorded validator directly.
  const validate = state.inputBoxCalls[0]?.options?.validateInput;
  assert.ok(validate, 'the chapter prompt must carry a validator');
  assert.equal(await validate('.jpnov'), 'Enter a file name');
  assert.equal(await validate('../ch.jpnov'), 'This file name cannot be used');
  assert.equal(await validate('/abs.jpnov'), 'This file name cannot be used');
  assert.equal(await validate('a*b.jpnov'), 'This file name cannot be used');
  assert.equal(await validate('taken.jpnov'), 'taken.jpnov already exists');
  assert.equal(await validate('another.jpnov'), null);
});

test('createFile with a book node writes the chapter, appends it root-relative, and opens it', async () => {
  seed('ichi.jpnov\n', []);
  // Backslash separator and a missing suffix: both normalized on accept.
  state.inputBoxQueue.push('src\\my-chapter');
  await runCreateChapter();

  assert.deepEqual(state.errorMessages, []);
  assert.deepEqual(state.createdDirs, [`${ROOT}/src`]);
  assert.deepEqual(state.writtenFiles, [{ uri: `${ROOT}/src/my-chapter.jpnov`, content: '' }]);
  const edit = state.appliedEdits[0];
  assert.ok(edit, 'expected the appended chapter to be applied');
  assert.equal(edit.uri, BOOK);
  assert.match(edit.newText, /src\/my-chapter\.jpnov/);
  assert.deepEqual(
    state.executedCommands.filter((c) => c.command === 'vscode.open').map((c) => String(c.args[0])),
    [`${ROOT}/src/my-chapter.jpnov`],
  );
});

test('createFile for an already-listed missing chapter skips the append and opens it', async () => {
  seed('src/lost.jpnov\n', []);
  state.inputBoxQueue.push('src/lost.jpnov');
  await runCreateChapter();

  assert.deepEqual(state.errorMessages, []);
  assert.deepEqual(state.writtenFiles, [{ uri: `${ROOT}/src/lost.jpnov`, content: '' }]);
  assert.deepEqual(state.appliedEdits, []);
  assert.equal(state.executedCommands.filter((c) => c.command === 'vscode.open').length, 1);
});

test('createFile never overwrites an existing chapter file', async () => {
  seed('', []);
  state.fsEntries.set(`${ROOT}/taken.jpnov`, FileType.File);
  state.inputBoxQueue.push('taken');
  await runCreateChapter();

  assert.deepEqual(state.errorMessages, ['Japanese Novel: taken.jpnov already exists; creation was cancelled.']);
  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.appliedEdits, []);
});
