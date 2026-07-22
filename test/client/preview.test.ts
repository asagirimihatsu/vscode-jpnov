/**
 * Integration test for the live preview's webview hardening + render plumbing, plus
 * window-reload revival: `adopt()` re-wiring a workbench-restored panel and
 * re-rendering from the persisted `{uri, line}` webview state.
 *
 * The interesting, load-bearing client logic here is turning the SERVER's standalone
 * preview document into a webview-safe one: a strict CSP `<meta>` plus a per-render
 * nonce on the inline `<style>`. We drive `open()` against a mocked active editor and a
 * fake LanguageClient, then assert on the resulting `webview.html`.
 *
 * NOT wired into `npm test` (test/client is authored-only). Run with a `vscode`
 * resolution shim present (see test/client/README.md):
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVscode,
  createFakePanel,
  createMockState,
  doc,
  resetMockState,
} from './_vscodeMock.ts';

// Install the vscode mock ONCE, bound to a single shared state, BEFORE importing the
// module under test (see _vscodeMock.resetMockState for the why).
const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { Preview } = await import('../../src/client/preview.ts');

beforeEach(() => {
  resetMockState(state);
});

/** A fake LanguageClient: only `sendRequest` is used by the preview. */
function fakeClient(html: string): { sendRequest: () => Promise<{ html: string }> } {
  return { sendRequest: () => Promise.resolve({ html }) };
}

/** Drain pending microtasks/timers so fire-and-forget renders settle. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const SERVER_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{color:red}</style></head><body><p>本文</p></body></html>';

/** The single panel the preview is expected to have created. */
function firstPanel() {
  const [panel] = state.panels;
  assert.ok(panel, 'a webview panel was created');
  return panel;
}

async function openPreviewWith(html: string) {
  // The constructor type is LanguageClient; the runtime only needs sendRequest.
  const preview = new Preview(fakeClient(html) as never);

  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'これは本文です。');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  // open() renders asynchronously (awaits sendRequest); let microtasks drain.
  await tick();
  return { preview, panel: firstPanel() };
}

test('open() creates a single webview panel and renders the active .jpnov', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  assert.equal(state.panels.length, 1);
  assert.equal(panel.viewType, 'jpnov.preview');
  assert.match(panel.webview.html, /本文/);
});

test('hardened html injects a Content-Security-Policy meta with default-src none', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /<meta http-equiv="Content-Security-Policy"/i);
  assert.match(html, /default-src 'none'/);
  // scripts are allowed ONLY via a per-render nonce (the cursor-follow scroller).
  assert.match(html, /script-src 'nonce-[^']+'/);
});

test('the inline <style> carries a nonce that matches the CSP style-src', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;

  const styleNonce = /<style[^>]*\snonce="([^"]+)"/i.exec(html);
  assert.ok(styleNonce, 'inline <style> has a nonce attribute');
  const cspNonce = /style-src 'nonce-([^']+)'/.exec(html);
  assert.ok(cspNonce, 'CSP names a style nonce');
  assert.equal(styleNonce[1], cspNonce[1], 'style nonce equals CSP nonce');
});

test('CSP allows the webview cspSource for styles/img/font', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /style-src [^;]*vscode-webview:\/\/test/);
  assert.match(html, /img-src [^;]*vscode-webview:\/\/test/);
});

test('the original document body survives hardening', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  assert.match(panel.webview.html, /<p>本文<\/p>/);
});

test('a server render error is surfaced inside a hardened shell, not thrown', async () => {
  const failing = {
    sendRequest: () => Promise.reject(new Error('compiler exploded')),
  };
  const preview = new Preview(failing as never);

  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  await tick();

  const html = firstPanel().webview.html;
  assert.match(html, /Preview failed/);
  assert.match(html, /compiler exploded/);
  assert.match(html, /Content-Security-Policy/);
});

test('opening with no active editor shows the empty-state shell', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  state.activeEditor = undefined;

  preview.open(true);
  await tick();

  const html = firstPanel().webview.html;
  assert.match(html, /Open a \.jpnov file to preview/);
  assert.match(html, /Content-Security-Policy/);
});

test('dispose() tears down the panel', async () => {
  const { preview, panel } = await openPreviewWith(SERVER_HTML);
  preview.dispose();
  assert.equal(panel.disposed, true);
});

test('a nonce-matched cursor-follow script is injected before </body>', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  const scriptNonce = /<script nonce="([^"]+)">/i.exec(html);
  assert.ok(scriptNonce, 'a nonced <script> is injected');
  const cspNonce = /script-src 'nonce-([^']+)'/.exec(html);
  assert.ok(cspNonce, 'CSP names a script nonce');
  assert.equal(scriptNonce[1], cspNonce[1], 'script nonce equals CSP script nonce');
  // The scroller targets [data-line] anchors and is injected at the end of <body>.
  assert.match(html, /querySelectorAll\('\[data-line\]'\)/);
  assert.match(html, /<p>本文<\/p><script /);
});

test('reveal parks the anchor column at the golden ratio via relative scrollBy', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /window\.scrollBy\(/);
  assert.match(html, /window\.innerWidth\*0\.618/);
  assert.doesNotMatch(html, /scrollIntoView/);
});

test('the injected script re-reveals on resize (vh-driven layout settles after load)', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /addEventListener\('resize'/);
  assert.match(html, /cancelAnimationFrame\(raf\)/);
});

test('cursor reveals glide with a short chase; re-asserts and reduced motion stay instant', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /reveal\(m\.line,1\)/);
  assert.match(html, /anim=requestAnimationFrame\(step\)/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /requestAnimationFrame\(function\(\)\{reveal\(cur\);\}\)/);
});

test('the injected script positions synchronously and defeats history scroll restoration', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /history\.scrollRestoration='manual'/);
  // The call directly after the reveal() definition is the parse-time positioning.
  assert.match(html, /\}reveal\(cur\);window\.addEventListener\('message'/);
  assert.match(html, /addEventListener\('load'/);
});

test('render bakes the top-most cursor line into the scroll script', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };
  // Two cursors; the earliest (line 4) wins, not selections[0] (line 9).
  state.visibleEditors.push({
    document: d,
    selections: [{ active: { line: 9 } }, { active: { line: 4 } }],
  });

  preview.open(true);
  await tick();

  assert.match(firstPanel().webview.html, /var cur=4;/);
});

test('a cursor move posts a reveal for the top-most (earliest) cursor line', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const ed = {
    document: doc('file:///proj/src/a.jpnov', 'jpnov', 'x'),
    selections: [{ active: { line: 7 } }, { active: { line: 3 } }],
  };
  state.onDidChangeSelection.fire({ textEditor: ed, selections: ed.selections });

  const reveal = panel.webview.posted.find(
    (m): m is { type: string; line: number } =>
      typeof m === 'object' &&
      m !== null &&
      (m as { type?: unknown }).type === 'reveal',
  );
  assert.ok(reveal, 'a reveal message was posted on cursor move');
  assert.equal(reveal.line, 3, 'follows the earliest cursor, not selections[0]');
});

test('an edit re-render while the editor is momentarily invisible keeps the last line', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };
  state.visibleEditors.push({ document: d, selections: [{ active: { line: 6 } }] });

  preview.open(true);
  await tick();
  assert.match(firstPanel().webview.html, /var cur=6;/);

  // Save-with-mutation transient: the editor blinks out of visibleTextEditors, an edit lands.
  state.visibleEditors.length = 0;
  state.onDidChangeDoc.fire({ document: d });
  await new Promise((r) => setTimeout(r, 150));
  assert.match(firstPanel().webview.html, /var cur=6;/);
});

test('a cursor-move reveal updates the line a later render falls back to', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML); // no visibleTextEditors entry
  const ed = {
    document: doc('file:///proj/src/a.jpnov', 'jpnov', 'x'),
    selections: [{ active: { line: 9 } }],
  };
  state.onDidChangeSelection.fire({ textEditor: ed, selections: ed.selections });

  state.onDidChangeDoc.fire({ document: ed.document });
  await new Promise((r) => setTimeout(r, 150));
  assert.match(panel.webview.html, /var cur=9;/);
});

// --- window-reload revival (adopt) -----------------------------------------

/** Adopt a workbench-restored fake panel, as extension.ts's serializer glue does. */
function adoptWith(
  client: { sendRequest: () => Promise<{ html: string }> },
  state_: unknown,
) {
  const preview = new Preview(client as never);
  const panel = createFakePanel();
  preview.adopt(panel as never, state_);
  return { preview, panel };
}

test('rendered html persists {uri, line} via setState for the next reload', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const html = panel.webview.html;
  assert.match(html, /acquireVsCodeApi\(\)/);
  assert.ok(
    html.includes('setState({uri:"file:///proj/src/a.jpnov",line:line})'),
    'setState carries the previewed uri',
  );
});

test('adopt() with persisted state renders that document and bakes its cursor line', async () => {
  state.textDocuments.push(doc('file:///proj/src/a.jpnov', 'jpnov', '本文です。'));

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/src/a.jpnov',
    line: 5,
  });
  await tick();

  assert.deepEqual(state.openedDocs, ['file:///proj/src/a.jpnov']);
  assert.match(panel.webview.html, /本文/);
  // No editor is visible, so the persisted line drives the initial scroll.
  assert.match(panel.webview.html, /var cur=5;/);
});

test('adopt() prefers the active previewable editor over stale persisted state', async () => {
  const active = doc('file:///proj/src/b.jpnov', 'jpnov', 'アクティブ');
  state.textDocuments.push(active);
  state.activeEditor = { document: active, viewColumn: 1 };

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/src/a.jpnov',
    line: 9,
  });
  await tick();

  assert.equal(state.openedDocs.length, 0, 'the stale uri is never loaded');
  assert.equal(panel.title, 'b.jpnov — Preview');
  // A different document's persisted line must not leak into this render.
  assert.match(panel.webview.html, /var cur=0;/);
});

test('adopt() with the active editor matching the persisted uri restores its line', async () => {
  const active = doc('file:///proj/src/a.jpnov', 'jpnov', '本文');
  state.textDocuments.push(active);
  state.activeEditor = { document: active, viewColumn: 1 };
  // No visibleTextEditors entry: startup editor restoration hasn't resolved yet.

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/src/a.jpnov',
    line: 7,
  });
  await tick();

  assert.match(panel.webview.html, /var cur=7;/);
});

test('adopt() with no state and no editor shows the empty-state shell (pre-fix sessions)', async () => {
  const { panel } = adoptWith(fakeClient(SERVER_HTML), undefined);

  // Synchronous first paint — the day-one migration path must never stay blank.
  assert.match(panel.webview.html, /Open a \.jpnov file to preview/);
  assert.match(panel.webview.html, /Content-Security-Policy/);
  await tick();
  assert.match(panel.webview.html, /Open a \.jpnov file to preview/);
});

test('adopt() tolerates garbage state shapes without throwing', async () => {
  for (const garbage of [42, 'x', ['file:///a.jpnov'], { uri: 99, line: 'y' }]) {
    resetMockState(state);
    const { panel } = adoptWith(fakeClient(SERVER_HTML), garbage);
    await tick();
    assert.match(panel.webview.html, /Open a \.jpnov file to preview/);
  }
});

test('adopt() paints the loading shell synchronously before the restored render lands', () => {
  state.textDocuments.push(doc('file:///proj/src/a.jpnov', 'jpnov', 'x'));

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/src/a.jpnov',
  });

  // Asserted BEFORE draining microtasks: a wedged server start must never leave blank.
  assert.match(panel.webview.html, /Loading preview/);
  assert.match(panel.webview.html, /class="spinner"/);
  assert.match(panel.webview.html, /Content-Security-Policy/);
});

test('adopt() paints the loading shell synchronously in the active-editor branch too', () => {
  const active = doc('file:///proj/src/b.jpnov', 'jpnov', 'x');
  state.textDocuments.push(active);
  state.activeEditor = { document: active, viewColumn: 1 };

  const { panel } = adoptWith(fakeClient(SERVER_HTML), undefined);

  // The server is cold right after a reload; the wait shows a spinner, not a blank tab.
  assert.match(panel.webview.html, /Loading preview/);
  assert.match(panel.webview.html, /class="spinner"/);
});

test('adopt() falls back to the empty-state shell when the persisted file is gone', async () => {
  state.unopenableDocs.add('file:///proj/src/gone.jpnov');

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/src/gone.jpnov',
    line: 2,
  });
  await tick();

  assert.match(panel.webview.html, /Open a \.jpnov file to preview/);
  assert.equal(panel.disposed, false, 'the panel stays; only its content degrades');

  // The adopted panel is fully live: focusing a previewable editor re-renders it.
  state.onDidChangeActiveEditor.fire({
    document: doc('file:///proj/src/c.jpnov', 'jpnov', 'x'),
  });
  await tick();
  assert.match(panel.webview.html, /本文/);
});

test('adopt() rejects a persisted doc that is no longer previewable', async () => {
  state.textDocuments.push(doc('file:///proj/notes.txt', 'plaintext', 'x'));

  const { panel } = adoptWith(fakeClient(SERVER_HTML), {
    uri: 'file:///proj/notes.txt',
  });
  await tick();

  assert.match(panel.webview.html, /Open a \.jpnov file to preview/);
});

test('adopt() while a live panel exists disposes the incoming panel', async () => {
  const { preview, panel } = await openPreviewWith(SERVER_HTML);

  const revived = createFakePanel();
  preview.adopt(revived as never, { uri: 'file:///proj/src/a.jpnov' });
  await tick();

  assert.equal(revived.disposed, true, 'the redundant revival is closed');
  assert.equal(panel.disposed, false, 'the live panel is untouched');
  assert.match(panel.webview.html, /本文/);
});

test('open() after adoption reveals the adopted panel instead of creating a second one', async () => {
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  const { preview } = adoptWith(fakeClient(SERVER_HTML), undefined);
  await tick();

  preview.open(true);
  await tick();

  assert.equal(state.panels.length, 0, 'createWebviewPanel is never called');
});

test('adoption wires the live-update listeners (edit re-render + cursor reveal)', async () => {
  let renders = 0;
  const counting = {
    sendRequest: () => {
      renders++;
      return Promise.resolve({ html: SERVER_HTML });
    },
  };
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', '一');
  state.textDocuments.push(d);

  const { panel } = adoptWith(counting, { uri: 'file:///proj/src/a.jpnov', line: 0 });
  await tick();
  assert.equal(renders, 1);

  // An edit to the shown document re-renders — after the 120ms typing debounce settles.
  state.onDidChangeDoc.fire({ document: d });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(renders, 2);

  // ...and a cursor move posts a reveal for the shown document.
  const ed = { document: d, selections: [{ active: { line: 8 } }] };
  state.onDidChangeSelection.fire({ textEditor: ed, selections: ed.selections });
  const reveal = panel.webview.posted.find(
    (m): m is { type: string; line: number } =>
      typeof m === 'object' &&
      m !== null &&
      (m as { type?: unknown }).type === 'reveal',
  );
  assert.ok(reveal, 'a reveal message was posted');
  assert.equal(reveal.line, 8);
});

test('adopt() re-enables scripts on the revived webview', () => {
  const { panel } = adoptWith(fakeClient(SERVER_HTML), undefined);
  assert.deepEqual(panel.webview.options, { enableScripts: true });
});

test('a render resolving after the panel closed writes nothing and does not throw', async () => {
  // Definitely assigned: open() below calls sendRequest synchronously.
  let resolveRender!: (r: { html: string }) => void;
  const deferred = {
    sendRequest: () =>
      new Promise<{ html: string }>((res) => {
        resolveRender = res;
      }),
  };
  const preview = new Preview(deferred as never);
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  const panel = firstPanel();
  assert.equal(panel.webview.html, '', 'render still in flight');

  panel.dispose(); // the user closes the tab mid-render
  resolveRender({ html: SERVER_HTML });
  await tick();

  assert.equal(panel.webview.html, '', 'no write to a disposed panel');
});

test('renderDocument ships the settings snapshot on the renderFile request', async () => {
  state.config['jpnov.layout.charsPerLine'] = 24;
  state.config['jpnov.preview.edgeLine'] = 'red';
  let captured: unknown;
  const capturing = {
    sendRequest: (_type: unknown, params: unknown) => {
      captured = params;
      return Promise.resolve({ html: SERVER_HTML });
    },
  };
  const preview = new Preview(capturing as never);
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', '一');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  await tick();

  const params = captured as { settings?: unknown };
  // Overrides read from the store; untouched keys fall back to the product defaults.
  assert.deepEqual(params.settings, {
    charsPerLine: 24,
    linesPerPage: 34,
    kinsoku: 'normal',
    autoTcy: 'punctuationPairs',
    lineNumbers: true,
    edgeLine: 'red',
  });
});

test('refresh() re-renders the shown document with fresh settings', async () => {
  let renders = 0;
  const counting = {
    sendRequest: () => {
      renders += 1;
      return Promise.resolve({ html: SERVER_HTML });
    },
  };
  const preview = new Preview(counting as never);
  const d = doc('file:///proj/src/a.jpnov', 'jpnov', '一');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  await tick();
  assert.equal(renders, 1);

  preview.refresh();
  await tick();
  assert.equal(renders, 2);
});

test('refresh() with nothing shown is a no-op', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  preview.refresh(); // must not throw and must not create a panel
  await tick();
  assert.equal(state.panels.length, 0);
});
