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

test('json config parses to a valid state carrying the highlighting vocabulary', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(
      ws.dir,
      'novel.jp.json',
      JSON.stringify({ characters: ['朝霧　巳一'], keywords: ['黒剣'] }),
    );
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.equal(latest.state, 'valid');
    // The parsed config is not carried on the wire; assert it on the server state.
    assert.deepEqual(state.resolved, { characters: ['朝霧　巳一'], keywords: ['黒剣'] });
    assert.ok(state.lastGood, 'state.lastGood should be set');
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

test('migrated path keys in an old config are silently ignored (no error, no diagnostic)', async () => {
  const ws = makeTmpWorkspace();
  try {
    // An old novel.jp.json still carrying the migrated keys — even hostile values like an
    // escaping sourceDir are just unknown keys now; the config stays valid.
    writeUnder(
      ws.dir,
      'novel.jp.json',
      JSON.stringify({ sourceDir: '../escape', outDir: '/abs', avoidLineBreaks: true }),
    );
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    assert.equal(conn.latestConfigState(ws.uri)?.state, 'valid');
    assert.deepEqual(state.resolved, {});
    assert.ok(
      !conn.diagnostics.some((d) => d.count > 0),
      'no diagnostic for migrated keys',
    );
  } finally {
    ws.cleanup();
  }
});

test('json precedence wins over a sibling executable config', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ keywords: ['from-json'] }));
    writeUnder(ws.dir, 'novel.jp.js', 'export default { keywords: ["from-js"] };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.deepEqual(state.resolved, { keywords: ['from-json'] });
  } finally {
    ws.cleanup();
  }
});

test('executable config is gated out (error) when the workspace is untrusted', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { keywords: ["黒剣"] };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn, { isTrusted: false });
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);

    const latest = conn.latestConfigState(ws.uri);
    assert.ok(latest);
    assert.equal(latest.state, 'error');
    assert.equal((latest.error as { code: string }).code, 'config.execNeedsTrust');
    assert.deepEqual((latest.error as { args: unknown[] }).args, ['mjs']);
  } finally {
    ws.cleanup();
  }
});

test('executable config loads when trusted and reparses after an edit (cache-bust)', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { keywords: ["first"] };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn, { isTrusted: true });
    const state = freshState(ws.uri);

    await loadRootConfig(ctx, state);
    assert.deepEqual(state.resolved, { keywords: ['first'] });

    // Edit the module; the ?v=<mtime> cache-bust must pick up the new value.
    // Bump mtime explicitly so the URL differs even on coarse filesystem clocks.
    await new Promise((r) => setTimeout(r, 10));
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { keywords: ["second"] };');
    await loadRootConfig(ctx, state);
    assert.deepEqual(state.resolved, { keywords: ['second'] });
  } finally {
    ws.cleanup();
  }
});
