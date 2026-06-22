/**
 * Integration test for the aggregated status-bar item.
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
} from './_vscodeMock.ts';

// Install the vscode mock ONCE, bound to a single shared state, BEFORE importing the
// module under test. Per-test isolation comes from resetting `state` in beforeEach.
const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { StatusBar } = await import('../../src/client/statusBar.ts');

beforeEach(() => {
  resetMockState(state);
});

function only() {
  const [item, ...extra] = state.statusItems;
  assert.equal(extra.length, 0, 'no extra status items');
  assert.ok(item, 'exactly one status item is created');
  return item;
}

test('all-valid roots show the book icon, no error color, no command', () => {
  const sb = new StatusBar();
  sb.update('file:///a', 'valid');
  sb.update('file:///b', 'valid');

  const item = only();
  assert.equal(item.shown, true);
  assert.equal(item.text, '$(book) Japanese Novel');
  assert.equal(item.color, undefined);
  assert.equal(item.backgroundColor, undefined);
  assert.equal(item.command, undefined);
});

test('any error root wins: red-cross text, error color, and opens that config', () => {
  const sb = new StatusBar();
  sb.update('file:///workspace/alpha', 'valid');
  sb.update('file:///workspace/beta', 'error', {
    code: 'path.escapesRoot',
    args: ['sourceDir'],
    configUri: 'file:///workspace/beta/novel.jp.json',
  });

  const item = only();
  assert.equal(item.shown, true);
  // B13 dropped the per-root name from the text; the brand + icon identify the source,
  // and the offending root is still listed in the tooltip / opened by the click command.
  assert.equal(item.text, '$(error) Japanese Novel: config error');
  // errorForeground themecolor applied.
  assert.equal((item.color as { id: string }).id, 'statusBarItem.errorForeground');
  assert.equal(
    (item.backgroundColor as { id: string }).id,
    'statusBarItem.errorBackground',
  );
  // command opens the offending config uri.
  const cmd = item.command as { command: string; arguments: { toString(): string }[] };
  assert.equal(cmd.command, 'vscode.open');
  const [arg] = cmd.arguments;
  assert.ok(arg);
  assert.equal(arg.toString(), 'file:///workspace/beta/novel.jp.json');
});

test('tooltip lists every failing root with its rendered message', () => {
  const sb = new StatusBar();
  sb.update('file:///w/one', 'error', {
    code: 'config.loadFailed',
    args: ['bad number'],
    configUri: 'file:///w/one/novel.jp.json',
  });
  sb.update('file:///w/two', 'error', {
    code: 'config.execNeedsTrust',
    args: ['ts'],
    configUri: 'file:///w/two/novel.jp.ts',
  });

  const item = only();
  const tip = (item.tooltip as { value: string }).value;
  assert.match(tip, /one/);
  assert.match(tip, /bad number/); // rendered from config.loadFailed's arg
  assert.match(tip, /two/);
  assert.match(tip, /untrusted/); // rendered from config.execNeedsTrust
});

test('removing the only valid root hides the item', () => {
  const sb = new StatusBar();
  sb.update('file:///solo', 'valid');
  assert.equal(only().shown, true);

  sb.update('file:///solo', 'removed');
  assert.equal(only().shown, false);
});

test('absent-only roots keep the item hidden', () => {
  const sb = new StatusBar();
  sb.update('file:///x', 'absent');
  assert.equal(only().shown, false);
});

test('clearing an error back to valid drops the red cross', () => {
  const sb = new StatusBar();
  sb.update('file:///r', 'error', {
    code: 'config.loadFailed',
    args: ['boom'],
    configUri: 'file:///r/novel.jp.json',
  });
  assert.equal(only().text, '$(error) Japanese Novel: config error');

  sb.update('file:///r', 'valid');
  const item = only();
  assert.equal(item.text, '$(book) Japanese Novel');
  assert.equal(item.color, undefined);
});
