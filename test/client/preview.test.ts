/**
 * Integration test for the live preview's webview hardening + render plumbing.
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

  const d = doc('file:///proj/src/a.jpnov', 'novel-jp', 'これは本文です。');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  // open() renders asynchronously (awaits sendRequest); let microtasks drain.
  await new Promise((r) => setTimeout(r, 0));
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

  const d = doc('file:///proj/src/a.jpnov', 'novel-jp', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };

  preview.open(true);
  await new Promise((r) => setTimeout(r, 0));

  const html = firstPanel().webview.html;
  assert.match(html, /Preview failed/);
  assert.match(html, /compiler exploded/);
  assert.match(html, /Content-Security-Policy/);
});

test('opening with no active editor shows the empty-state shell', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  state.activeEditor = undefined;

  preview.open(true);
  await new Promise((r) => setTimeout(r, 0));

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

test('render bakes the top-most cursor line into the scroll script', async () => {
  const preview = new Preview(fakeClient(SERVER_HTML) as never);
  const d = doc('file:///proj/src/a.jpnov', 'novel-jp', 'x');
  state.textDocuments.push(d);
  state.activeEditor = { document: d, viewColumn: 1 };
  // Two cursors; the earliest (line 4) wins, not selections[0] (line 9).
  state.visibleEditors.push({
    document: d,
    selections: [{ active: { line: 9 } }, { active: { line: 4 } }],
  });

  preview.open(true);
  await new Promise((r) => setTimeout(r, 0));

  assert.match(firstPanel().webview.html, /reveal\(4\)/);
});

test('a cursor move posts a reveal for the top-most (earliest) cursor line', async () => {
  const { panel } = await openPreviewWith(SERVER_HTML);
  const ed = {
    document: doc('file:///proj/src/a.jpnov', 'novel-jp', 'x'),
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
