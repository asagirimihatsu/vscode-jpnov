/**
 * Unit tests for the guided new-book wizard (`jpbook.createBook` / create.ts) against the
 * mocked `vscode`: the folder → title → chapters prompt chain, the written `.jpbook`,
 * the non-overwrite guards, and the post-create detail reveal on BooksViewProvider.
 *
 * Runs in CI via `npm run test:integration`; directly (see test/client/README.md):
 *   node --import ./test/register.mjs --test --experimental-test-module-mocks "test/client/bookCreate.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildVscode, createFakeWebviewView, createMockState, doc, resetMockState, Uri, FileType } from './_vscodeMock.ts';

const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { createBook } = await import('../../src/client/book/create.ts');
const { BooksViewProvider } = await import('../../src/client/book/view.ts');
const { ListBooksRequest } = await import('../../src/shared/protocol.ts');

const ROOT = 'file:///ws';

function seedFolder(): void {
  state.workspaceFolders = [{ uri: Uri.parse(ROOT), name: 'ws', index: 0 }];
}

beforeEach(() => {
  resetMockState(state);
});

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// --- the wizard ---------------------------------------------------------------

test('title + picked chapters write the composed .jpbook at the folder root', async () => {
  seedFolder();
  state.inputBoxQueue.push('My Book');
  state.findFilesResults.set(ROOT, [Uri.parse(`${ROOT}/ch1.jpnov`), Uri.parse(`${ROOT}/sub/ch2.jpnov`)]);
  state.quickPickQueue.push([{ label: 'ch1.jpnov', rel: 'ch1.jpnov' }]);

  await createBook(undefined);

  assert.deepEqual(state.errorMessages, []);
  assert.deepEqual(state.writtenFiles, [
    { uri: `${ROOT}/My Book.jpbook`, content: '---\ntitle: My Book\n---\nch1.jpnov\n' },
  ]);
  // The shared picker keeps its add-chapters look, plus the wizard-only ignoreFocusOut.
  assert.deepEqual(state.quickPickCalls[0]?.options, {
    canPickMany: true,
    matchOnDescription: true,
    placeHolder: 'Select chapter files to add',
    ignoreFocusOut: true,
  });
});

test('a dismissed title prompt writes nothing', async () => {
  seedFolder();
  // Empty inputBoxQueue -> showInputBox resolves undefined (Esc).
  await createBook(undefined);

  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.quickPickCalls, []);
  assert.deepEqual(state.errorMessages, []);
});

test('a dismissed chapter picker aborts the whole wizard', async () => {
  seedFolder();
  state.inputBoxQueue.push('My Book');
  state.findFilesResults.set(ROOT, [Uri.parse(`${ROOT}/ch1.jpnov`)]);
  // Empty quickPickQueue -> showQuickPick resolves undefined (Esc).
  await createBook(undefined);

  assert.equal(state.quickPickCalls.length, 1);
  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.errorMessages, []);
});

test('confirming the picker with nothing ticked writes an empty-bodied book', async () => {
  seedFolder();
  state.inputBoxQueue.push('X');
  state.findFilesResults.set(ROOT, [Uri.parse(`${ROOT}/ch1.jpnov`)]);
  state.quickPickQueue.push([]);

  await createBook(undefined);

  assert.deepEqual(state.writtenFiles, [{ uri: `${ROOT}/X.jpbook`, content: '---\ntitle: X\n---\n' }]);
});

test('no .jpnov candidates skips the picker and writes an empty-bodied book', async () => {
  seedFolder();
  state.inputBoxQueue.push('X');

  await createBook(undefined);

  assert.deepEqual(state.quickPickCalls, []);
  assert.deepEqual(state.writtenFiles, [{ uri: `${ROOT}/X.jpbook`, content: '---\ntitle: X\n---\n' }]);
});

test('an existing target aborts before writing', async () => {
  seedFolder();
  state.fsEntries.set(`${ROOT}/X.jpbook`, FileType.File);
  state.inputBoxQueue.push('X');

  await createBook(undefined);

  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.errorMessages, ['Japanese Novel: X.jpbook already exists; creation was cancelled.']);
});

test('a title that reduces to nothing usable aborts with a toast', async () => {
  seedFolder();
  state.inputBoxQueue.push('***');

  await createBook(undefined);

  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.errorMessages, ['Japanese Novel: this title cannot be used as a file name.']);
});

test('no open folder errors out before any prompt', async () => {
  await createBook(undefined);

  assert.deepEqual(state.inputBoxCalls, []);
  assert.deepEqual(state.writtenFiles, []);
  assert.deepEqual(state.errorMessages, ['Japanese Novel: open a folder first, then create a book.']);
});

test('multi-root goes through the folder pick and writes into the chosen root', async () => {
  const root2 = 'file:///second';
  state.workspaceFolders = [
    { uri: Uri.parse(ROOT), name: 'ws', index: 0 },
    { uri: Uri.parse(root2), name: 'second', index: 1 },
  ];
  state.workspaceFolderPickResult = { uri: Uri.parse(root2) };
  state.inputBoxQueue.push('Y');

  await createBook(undefined);

  assert.deepEqual(state.writtenFiles, [{ uri: `${root2}/Y.jpbook`, content: '---\ntitle: Y\n---\n' }]);
});

test('multi-root with the folder pick dismissed writes nothing', async () => {
  state.workspaceFolders = [
    { uri: Uri.parse(ROOT), name: 'ws', index: 0 },
    { uri: Uri.parse('file:///second'), name: 'second', index: 1 },
  ];
  state.workspaceFolderPickResult = undefined;

  await createBook(undefined);

  assert.deepEqual(state.inputBoxCalls, []);
  assert.deepEqual(state.writtenFiles, []);
});

test('the title validator rejects empty, unusable, and taken titles', async () => {
  seedFolder();
  state.fsEntries.set(`${ROOT}/taken.jpbook`, FileType.File);
  state.inputBoxQueue.push('fresh');
  await createBook(undefined);

  // The mock never invokes validateInput; probe the recorded validator directly.
  const options = state.inputBoxCalls[0]?.options as
    | { validateInput?: (value: string) => Promise<string | null> }
    | undefined;
  const validate = options?.validateInput;
  assert.ok(validate, 'the title prompt must carry a validator');
  assert.equal(await validate(''), 'Enter a title');
  assert.equal(await validate('***'), 'This title cannot be used as a file name');
  assert.equal(await validate('taken'), 'taken.jpbook already exists in this folder');
  assert.equal(await validate('another'), null);
});

// --- revealNewBook ------------------------------------------------------------

/** A fake LanguageClient answering listBooks with `books`. */
function fakeClient(books: unknown[]): { sendRequest(type: string): Promise<unknown> } {
  return {
    sendRequest(type: string): Promise<unknown> {
      return Promise.resolve(type === ListBooksRequest ? { books } : {});
    },
  };
}

test('revealNewBook focuses the view and opens the detail of a non-ASCII book', async () => {
  seedFolder();
  const bookUri = `${ROOT}/本.jpbook`;
  state.textDocuments.push(doc(bookUri, 'jpbook', '---\ntitle: 本\n---\nch1.jpnov\n'));
  const books = [{ uri: bookUri, rootUri: ROOT, fileRel: '本.jpbook', outRel: '本' }];
  const provider = new BooksViewProvider(fakeClient(books) as never, Uri.parse('file:///ext') as never);
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  await tick();

  await provider.revealNewBook(Uri.parse(ROOT) as never, '本.jpbook');
  await tick();

  assert.ok(state.executedCommands.some((c) => c.command === 'jpnov.books.focus'));
  const posted = view.webview.posted as { type?: string; uri?: string; reveal?: boolean }[];
  // The reveal-flagged push is what the webview accepts on its list screen; a plain
  // re-push would be dropped as a stale race.
  const detail = posted.find((m) => m.type === 'detail' && m.reveal === true);
  assert.equal(detail?.uri, bookUri);
  // A newly discovered book defaults to checked in the pushed state.
  const states = posted.filter((m) => m.type === 'state') as { groups?: { books: { uri: string; checked: boolean }[] }[] }[];
  const last = states[states.length - 1];
  assert.equal(last?.groups?.[0]?.books[0]?.checked, true);
  // The view chrome follows: title = the book, context key hides the title-bar `+`.
  assert.equal((view as { title?: string }).title, '本');
  const ctx = state.executedCommands
    .filter((c) => c.command === 'setContext' && c.args[0] === 'jpnov.booksDetail')
    .map((c) => c.args[1]);
  assert.equal(ctx.at(-1), true);
});

test('revealNewBook re-finds the book when the stored name is NFD-normalized', async () => {
  seedFolder();
  const nfdName = 'ガイド.jpbook'.normalize('NFD');
  const bookUri = `${ROOT}/${nfdName}`;
  state.textDocuments.push(doc(bookUri, 'jpbook', ''));
  const books = [{ uri: bookUri, rootUri: ROOT, fileRel: nfdName, outRel: 'ガイド'.normalize('NFD') }];
  const provider = new BooksViewProvider(fakeClient(books) as never, Uri.parse('file:///ext') as never);
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  await tick();

  await provider.revealNewBook(Uri.parse(ROOT) as never, 'ガイド.jpbook');
  await tick();

  const posted = view.webview.posted as { type?: string; uri?: string; reveal?: boolean }[];
  const detail = posted.find((m) => m.type === 'detail' && m.reveal === true);
  assert.equal(detail?.uri, bookUri);
});
