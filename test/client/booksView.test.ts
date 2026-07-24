/**
 * Integration test for the Books panel's WebviewView provider: the CSP-hardened shell it
 * resolves, the `state` / `detail` it pushes, and the messages it dispatches back to the
 * `jpbook.*` commands. We drive the provider against a fake LanguageClient and a fake
 * WebviewView, then assert on `webview.html`, `webview.posted`, and `state.executedCommands`.
 *
 * NOT wired into `npm test` (test/client is authored-only). Run with the vscode resolution
 * shim present (see test/client/README.md):
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildVscode,
  createFakeWebviewView,
  createMockState,
  doc,
  resetMockState,
  Uri,
  FileType,
} from './_vscodeMock.ts';

const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { BooksViewProvider } = await import('../../src/client/book/view.ts');
const { ListBooksRequest, BuildRequest } = await import('../../src/shared/protocol.ts');

beforeEach(() => {
  resetMockState(state);
});

/** Drain microtasks so fire-and-forget posts settle. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** A BookEntry with the fields the provider reads. */
function entry(rootUri: string, outRel: string, title?: string) {
  return { uri: `${rootUri}/src/${outRel}.jpbook`, rootUri, fileRel: `${outRel}.jpbook`, outRel, title };
}

/** A fake LanguageClient: answers listBooks with `books`, records the build params. */
function fakeClient(books: unknown[], buildResult?: unknown) {
  const calls: { build: { books?: string[]; format?: string } | null } = { build: null };
  return {
    calls,
    sendRequest(type: string, params: unknown): Promise<unknown> {
      if (type === ListBooksRequest) {
        return Promise.resolve({ books });
      }
      if (type === BuildRequest) {
        calls.build = params as { books?: string[]; format?: string };
        return Promise.resolve(buildResult ?? { ok: true, artifacts: [] });
      }
      return Promise.resolve({});
    },
  };
}

type MsgList = { type?: string; [k: string]: unknown }[];

function posts(view: { webview: { posted: unknown[] } }): MsgList {
  return view.webview.posted as MsgList;
}
function lastState(view: { webview: { posted: unknown[] } }): { type?: string; [k: string]: unknown } {
  const all = posts(view).filter((m) => m.type === 'state');
  const st = all[all.length - 1];
  assert.ok(st, 'expected a state message');
  return st;
}
function firstDetail(view: { webview: { posted: unknown[] } }): { type?: string; [k: string]: unknown } {
  const d = posts(view).find((m) => m.type === 'detail');
  assert.ok(d, 'expected a detail message');
  return d;
}

/** Construct + refresh + resolve + ready. Sets one workspace folder when there are books. */
async function setup(books: ReturnType<typeof entry>[], buildResult?: unknown) {
  const client = fakeClient(books, buildResult);
  const provider = new BooksViewProvider(client as never);
  await provider.refresh(); // populate books, default-checked
  const first = books[0];
  if (first !== undefined) {
    state.workspaceFolders = [{ uri: Uri.parse(first.rootUri), name: 'ws', index: 0 }];
  }
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  await tick();
  return { provider, view, client };
}

// --- shell / hardening ------------------------------------------------------

test('resolveWebviewView renders a CSP-hardened shell with the app root', () => {
  const provider = new BooksViewProvider(fakeClient([]) as never);
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  const html = view.webview.html;
  assert.match(html, /<meta http-equiv="Content-Security-Policy"/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /<div id="app">/);
  assert.deepEqual(view.webview.options, { enableScripts: true });
});

test('the inline style and script carry the CSP nonce', () => {
  const provider = new BooksViewProvider(fakeClient([]) as never);
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  const html = view.webview.html;
  const styleNonce = /<style nonce="([^"]+)"/.exec(html);
  const scriptNonce = /<script nonce="([^"]+)"/.exec(html);
  const cspStyle = /style-src 'nonce-([^']+)'/.exec(html);
  const cspScript = /script-src 'nonce-([^']+)'/.exec(html);
  assert.ok(styleNonce && scriptNonce && cspStyle && cspScript);
  assert.equal(styleNonce[1], cspStyle[1]);
  assert.equal(scriptNonce[1], cspScript[1]);
});

test('the embedded CSS / CLIENT_JS template bodies contain no stray backtick', () => {
  // A raw backtick anywhere in these two template literals (even inside a comment) closes the
  // template early and turns the rest into broken TS — a footgun hit three times during dev.
  const src = readFileSync(fileURLToPath(new URL('../../src/client/book/webviewHtml.ts', import.meta.url)), 'utf8');
  const bt = String.fromCharCode(96);
  for (const marker of ['const CSS = ', 'const CLIENT_JS = ']) {
    const open = src.indexOf(marker + bt);
    assert.ok(open >= 0, `located ${marker}`);
    const start = open + (marker + bt).length;
    const close = src.indexOf(bt + ';', start);
    assert.ok(close > start, `located the close of ${marker}`);
    assert.equal(src.slice(start, close).includes(bt), false, `${marker}body must not contain a backtick`);
  }
});

// --- state ------------------------------------------------------------------

test('the ready handshake posts the book list, all books checked by default', async () => {
  const root = 'file:///ws';
  const { view } = await setup([entry(root, 'vol1', 'Volume One'), entry(root, 'part1/vol2')]);
  const st = lastState(view);
  assert.equal(st.noFolder, false);
  const groups = st.groups as { rootLabel: string | null; books: { title: string; fileRel: string; checked: boolean }[] }[];
  const books = groups.flatMap((g) => g.books);
  assert.equal(books.length, 2);
  assert.ok(books.every((b) => b.checked));
  // single root -> flat (no section label); title falls back to the outRel last segment.
  const firstGroup = groups[0];
  assert.ok(firstGroup);
  assert.equal(firstGroup.rootLabel, null);
  const vol2 = books.find((b) => b.fileRel === 'part1/vol2.jpbook');
  assert.ok(vol2);
  assert.equal(vol2.title, 'vol2');
  assert.ok(books.find((b) => b.title === 'Volume One'));
});

test('multiple roots produce per-root labeled groups', async () => {
  const { view } = await setup([entry('file:///w1', 'x'), entry('file:///w2', 'y')]);
  const st = lastState(view);
  const groups = st.groups as { rootLabel: string | null }[];
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.rootLabel));
});

test('state posted before the first enumeration is flagged loading', async () => {
  // Resolve + ready WITHOUT a prior refresh() (server still starting): the panel must show a
  // loading placeholder, not the misleading "no books yet" welcome.
  const provider = new BooksViewProvider(fakeClient([]) as never);
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  await tick();
  assert.equal(lastState(view).loading, true);
});

test('a toggle updates the selection without re-posting state', async () => {
  const root = 'file:///ws';
  const { view } = await setup([entry(root, 'a'), entry(root, 'b')]);
  const before = posts(view).filter((m) => m.type === 'state').length;
  view.webview.receive({ type: 'toggle', uri: `${root}/src/b.jpbook`, checked: false });
  await tick();
  const after = posts(view).filter((m) => m.type === 'state').length;
  assert.equal(after, before, 'a per-row toggle does not echo state (keeps focus)');
});

test('selectAll / deselectAll re-post the full selection', async () => {
  const root = 'file:///ws';
  const { view } = await setup([entry(root, 'a'), entry(root, 'b')]);
  view.webview.receive({ type: 'deselectAll' });
  await tick();
  const cleared = lastState(view).groups as { books: { checked: boolean }[] }[];
  assert.ok(cleared.flatMap((g) => g.books).every((b) => !b.checked));
  view.webview.receive({ type: 'selectAll' });
  await tick();
  const all = lastState(view).groups as { books: { checked: boolean }[] }[];
  assert.ok(all.flatMap((g) => g.books).every((b) => b.checked));
});

// --- build ------------------------------------------------------------------

test('build sends only the checked books, in the chosen format', async () => {
  const root = 'file:///ws';
  const { view, client } = await setup([entry(root, 'a'), entry(root, 'b')]);
  view.webview.receive({ type: 'toggle', uri: `${root}/src/b.jpbook`, checked: false });
  await tick();
  view.webview.receive({ type: 'build', format: 'html' });
  await tick();
  assert.ok(client.calls.build);
  assert.deepEqual(client.calls.build.books, [`${root}/src/a.jpbook`]);
  assert.equal(client.calls.build.format, 'html');
});

test('build with an empty selection nudges and sends no request', async () => {
  const root = 'file:///ws';
  const { view, client } = await setup([entry(root, 'a')]);
  view.webview.receive({ type: 'deselectAll' });
  await tick();
  view.webview.receive({ type: 'build', format: 'txt' });
  await tick();
  assert.equal(client.calls.build, null);
  assert.ok(state.infoMessages.some((m) => /no books selected/i.test(m)));
});

// --- detail -----------------------------------------------------------------

test('openDetail posts chapters (missing flagged) and the five metadata rows', async () => {
  const root = 'file:///ws';
  const bookUri = `${root}/src/a.jpbook`;
  state.textDocuments.push(doc(bookUri, 'jpbook', '---\ntitle: A\n---\nch1.jpnov\nsub/ch2.jpnov\n'));
  state.fsEntries.set('file:///ws/ch1.jpnov', FileType.File); // ch1 exists; ch2 does not
  const { view } = await setup([entry(root, 'a', 'A')]);
  view.webview.receive({ type: 'openDetail', uri: bookUri });
  await tick();
  const detail = firstDetail(view) as {
    uri: string;
    title: string;
    chapters: { name: string; folder: string; missing: boolean; line: number }[];
    meta: { key: string; value: string; note: string }[];
  };
  assert.equal(detail.uri, bookUri);
  assert.equal(detail.chapters.length, 2);
  const ch1 = detail.chapters.find((c) => c.name === 'ch1.jpnov');
  assert.ok(ch1);
  assert.equal(ch1.missing, false);
  const ch2 = detail.chapters.find((c) => c.name === 'ch2.jpnov');
  assert.ok(ch2);
  assert.equal(ch2.missing, true);
  assert.equal(ch2.folder, 'sub');
  assert.equal(detail.meta.length, 5);
  // A set value carries no status note; the note is separate from the value (rendered by the label).
  const titleRow = detail.meta.find((m) => m.key === 'title');
  assert.ok(titleRow);
  assert.equal(titleRow.value, 'A');
  assert.equal(titleRow.note, '');
  // An absent no-default key (divider) has an empty value and a "(not set)" note.
  const dividerRow = detail.meta.find((m) => m.key === 'divider');
  assert.ok(dividerRow);
  assert.equal(dividerRow.value, '');
  assert.equal(dividerRow.note, '(not set)');
});

// --- edit dispatch (reuses manage.ts via executeCommand) --------------------

test('editMeta dispatches jpbook.editMeta with the entry, key, and current value', async () => {
  const root = 'file:///ws';
  const bookUri = `${root}/src/a.jpbook`;
  state.textDocuments.push(doc(bookUri, 'jpbook', '---\nheader: My Header\n---\nch1.jpnov\n'));
  const { view } = await setup([entry(root, 'a')]);
  view.webview.receive({ type: 'editMeta', uri: bookUri, metaKey: 'header' });
  await tick();
  const call = state.executedCommands.find((c) => c.command === 'jpbook.editMeta');
  assert.ok(call);
  const node = call.args[0] as { kind: string; metaKey: string; value: string; entry: { uri: string } };
  assert.equal(node.kind, 'meta');
  assert.equal(node.metaKey, 'header');
  assert.equal(node.value, 'My Header');
  assert.equal(node.entry.uri, bookUri);
});

test('an unknown metaKey is ignored (no dispatch)', async () => {
  const root = 'file:///ws';
  const bookUri = `${root}/src/a.jpbook`;
  state.textDocuments.push(doc(bookUri, 'jpbook', 'ch1.jpnov\n'));
  const { view } = await setup([entry(root, 'a')]);
  view.webview.receive({ type: 'editMeta', uri: bookUri, metaKey: 'bogus' });
  await tick();
  assert.equal(state.executedCommands.find((c) => c.command === 'jpbook.editMeta'), undefined);
});

test('chapter actions dispatch the matching jpbook command carrying the line', async () => {
  const root = 'file:///ws';
  const bookUri = `${root}/src/a.jpbook`;
  const { view } = await setup([entry(root, 'a')]);
  view.webview.receive({ type: 'moveChapter', uri: bookUri, line: 4, dir: -1 });
  view.webview.receive({ type: 'moveChapter', uri: bookUri, line: 4, dir: 1 });
  view.webview.receive({ type: 'removeChapter', uri: bookUri, line: 4 });
  view.webview.receive({ type: 'addChapters', uri: bookUri });
  await tick();
  const cmds = state.executedCommands.map((c) => c.command);
  assert.ok(cmds.includes('jpbook.moveChapterUp'));
  assert.ok(cmds.includes('jpbook.moveChapterDown'));
  assert.ok(cmds.includes('jpbook.removeChapter'));
  assert.ok(cmds.includes('jpbook.addChapters'));
  const rm = state.executedCommands.find((c) => c.command === 'jpbook.removeChapter');
  assert.ok(rm);
  const node = rm.args[0] as { kind: string; line: number; entry: { uri: string } };
  assert.equal(node.kind, 'chapter');
  assert.equal(node.line, 4);
  assert.equal(node.entry.uri, bookUri);
});

test('openFile opens the given uri', async () => {
  const root = 'file:///ws';
  const { view } = await setup([entry(root, 'a')]);
  view.webview.receive({ type: 'openFile', uri: 'file:///ws/ch1.jpnov' });
  await tick();
  const open = state.executedCommands.find((c) => c.command === 'vscode.open');
  assert.ok(open);
});

// --- empty states -----------------------------------------------------------

test('no workspace folder posts the no-folder empty state', async () => {
  const { view } = await setup([]);
  assert.equal(lastState(view).noFolder, true);
});

test('a folder with no books posts an empty (non-noFolder) list', async () => {
  state.workspaceFolders = [{ uri: Uri.parse('file:///ws'), name: 'ws', index: 0 }];
  const provider = new BooksViewProvider(fakeClient([]) as never);
  await provider.refresh();
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  await tick();
  const st = lastState(view);
  assert.equal(st.noFolder, false);
  assert.equal((st.groups as unknown[]).length, 0);
});

test('welcome actions run the create-book / open-folder / guide commands', async () => {
  const { view } = await setup([]);
  view.webview.receive({ type: 'welcome', action: 'createBook' });
  view.webview.receive({ type: 'welcome', action: 'openFolder' });
  view.webview.receive({ type: 'welcome', action: 'openGuide' });
  await tick();
  const cmds = state.executedCommands.map((c) => c.command);
  assert.ok(cmds.includes('workbench.action.files.newUntitledFile'));
  assert.ok(cmds.includes('workbench.action.files.openFolder'));
  assert.ok(cmds.includes('jpnov.openGuide'));
});

// --- lifecycle --------------------------------------------------------------

test('a refresh whose open book vanished returns the webview to the list', async () => {
  const root = 'file:///ws';
  const bookUri = `${root}/src/a.jpbook`;
  state.textDocuments.push(doc(bookUri, 'jpbook', 'ch1.jpnov\n'));
  const client = fakeClient([entry(root, 'a')]);
  const provider = new BooksViewProvider(client as never);
  await provider.refresh();
  state.workspaceFolders = [{ uri: Uri.parse(root), name: 'ws', index: 0 }];
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view as never);
  view.webview.receive({ type: 'ready' });
  view.webview.receive({ type: 'openDetail', uri: bookUri });
  await tick();
  // The book disappears; a refresh should tell the webview to close the detail.
  client.calls.build = null;
  (client as unknown as { sendRequest: (t: string) => Promise<unknown> }).sendRequest = (t: string) =>
    t === ListBooksRequest ? Promise.resolve({ books: [] }) : Promise.resolve({});
  await provider.refresh();
  await tick();
  assert.ok(posts(view).some((m) => m.type === 'closeDetail'));
});

test('dispose is idempotent and does not throw', async () => {
  const { provider } = await setup([entry('file:///ws', 'a')]);
  provider.dispose();
  provider.dispose();
});
