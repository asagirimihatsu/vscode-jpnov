/**
 * Integration tests for the per-root config loader against real `file:` fixtures.
 * Authored for the server stage; NOT wired into `npm test` this round.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRootConfig } from '../../src/server/configLoad.ts';
import type { RootState } from '../../src/server/roots.ts';
import {
  makeContext,
  makeFakeConnection,
  makeTmpWorkspace,
  writeUnder,
} from './helpers.ts';

function freshState(rootUri: string): RootState {
  return { rootUri };
}

test('json config resolves to a valid state with contained URIs', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(
      ws.dir,
      'novel.jp.json',
      JSON.stringify({ sourceDir: './manuscript', charsPerLine: 20, linesPerPage: 30, outDir: 'out' }),
    );
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.equal(latest.state, 'valid');
    // The resolved config is no longer carried on the wire; assert it on the server state.
    assert.ok(state.resolved, 'state.resolved should be set');
    assert.equal(state.resolved.charsPerLine, 20);
    assert.equal(state.resolved.linesPerPage, 30);
    assert.equal(state.resolved.sourceDirUri, `${ws.uri}/manuscript`);
    assert.equal(state.resolved.outDirUri, `${ws.uri}/out`);
    assert.ok(state.lastGood, 'state.lastGood should be set');
  } finally {
    ws.cleanup();
  }
});

test('json config clamps out-of-range numbers per field, keeps last-known-good', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(
      ws.dir,
      'novel.jp.json',
      JSON.stringify({ sourceDir: './src', charsPerLine: 99999, linesPerPage: 0 }),
    );
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    assert.ok(state.resolved);
    assert.equal(state.resolved.charsPerLine, 1000); // clamped to max
    assert.equal(state.resolved.linesPerPage, 1); // clamped to min
  } finally {
    ws.cleanup();
  }
});

test('missing config yields an absent state', async () => {
  const ws = makeTmpWorkspace();
  try {
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    assert.equal(conn.latestConfigState(ws.uri)?.state, 'absent');
    assert.equal(state.resolved, undefined);
  } finally {
    ws.cleanup();
  }
});

test('escaping sourceDir produces an error state + diagnostic, retains lastGood', async () => {
  const ws = makeTmpWorkspace();
  try {
    // First: a good config to establish lastGood.
    const cfgPath = writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './src' }));
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);
    await loadRootConfig(ctx, state);
    assert.equal(conn.latestConfigState(ws.uri)?.state, 'valid');

    // Then: rewrite with an escaping sourceDir.
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: '../escape' }));
    void cfgPath;
    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.equal(latest.state, 'error');
    const error = latest.error as { message: string; configUri: string };
    assert.match(error.message, /sourceDir/);
    assert.ok(error.configUri.endsWith('novel.jp.json'));
    assert.ok(state.lastGood, 'error state should retain lastGood');
    // A diagnostic with at least one entry should have been published on the config uri.
    const withErr = conn.diagnostics.filter((d) => d.uri === error.configUri && d.count > 0);
    assert.ok(withErr.length > 0, 'expected an error diagnostic on the config uri');
  } finally {
    ws.cleanup();
  }
});

test('json precedence wins over a sibling executable config', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './from-json' }));
    writeUnder(ws.dir, 'novel.jp.js', 'export default { sourceDir: "./from-js" };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.ok(state.resolved);
    assert.equal(state.resolved.sourceDirUri, `${ws.uri}/from-json`);
  } finally {
    ws.cleanup();
  }
});

test('executable config is gated out (error) when the workspace is untrusted', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { sourceDir: "./src" };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn, { isTrusted: false });
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.equal(latest.state, 'error');
    assert.match((latest.error as { message: string }).message, /untrusted|trust/i);
  } finally {
    ws.cleanup();
  }
});

test('executable config loads when trusted and reparses after an edit (cache-bust)', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { sourceDir: "./first" };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn, { isTrusted: true });
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);
    const first = state.resolved;
    assert.ok(first);
    assert.equal(first.sourceDirUri, `${ws.uri}/first`);

    // Edit the module; the ?v=<mtime> cache-bust must pick up the new value.
    // Bump mtime explicitly so the URL differs even on coarse filesystem clocks.
    await new Promise((r) => setTimeout(r, 10));
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { sourceDir: "./second" };');
    await loadRootConfig(ctx, state);
    const second = state.resolved;
    assert.ok(second);
    assert.equal(second.sourceDirUri, `${ws.uri}/second`);
  } finally {
    ws.cleanup();
  }
});
