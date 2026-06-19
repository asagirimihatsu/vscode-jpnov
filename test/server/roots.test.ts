/**
 * Integration tests for root add/remove + trust-driven reparse.
 * Authored for the server stage; NOT wired into `npm test` this round.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addRoot,
  reparseAllRoots,
  removeRoot,
  rootForUri,
} from '../../src/server/roots.ts';
import {
  makeContext,
  makeFakeConnection,
  makeTmpWorkspace,
  writeUnder,
} from './helpers.ts';

test('addRoot registers a watcher and pushes the initial config state', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './src' }));
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);

    await addRoot(ctx, ws.uri);

    assert.ok(ctx.roots.has(ws.uri), 'root tracked');
    assert.equal(conn.registeredWatchers.length, 1, 'one watcher registered');
    assert.equal(conn.latestConfigState(ws.uri)?.state, 'valid');
  } finally {
    ws.cleanup();
  }
});

test('addRoot normalizes a trailing-slash uri to the same key', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './src' }));
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);

    await addRoot(ctx, `${ws.uri}/`);

    assert.ok(ctx.roots.has(ws.uri), 'tracked under the slash-stripped key');
    assert.equal(ctx.roots.size, 1);
  } finally {
    ws.cleanup();
  }
});

test('removeRoot disposes the watcher and pushes a removed state', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './src' }));
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    await addRoot(ctx, ws.uri);

    await removeRoot(ctx, ws.uri);

    assert.equal(ctx.roots.has(ws.uri), false, 'root forgotten');
    assert.equal(conn.registeredWatchers[0]?.disposed, true, 'watcher disposed');
    assert.equal(conn.latestConfigState(ws.uri)?.state, 'removed');
  } finally {
    ws.cleanup();
  }
});

test('rootForUri matches a file under the root (longest-prefix)', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.json', JSON.stringify({ sourceDir: './src' }));
    const conn = makeFakeConnection();
    const ctx = makeContext(conn);
    await addRoot(ctx, ws.uri);

    const hit = rootForUri(ctx, `${ws.uri}/src/chapter1.txt`);
    assert.equal(hit?.rootUri, ws.uri);
    const miss = rootForUri(ctx, 'file:///somewhere/else/x.txt');
    assert.equal(miss, undefined);
  } finally {
    ws.cleanup();
  }
});

test('false->true trust reparse turns a gated executable config valid', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'novel.jp.mjs', 'export default { sourceDir: "./src" };');
    const conn = makeFakeConnection();
    const ctx = makeContext(conn, { isTrusted: false });
    await addRoot(ctx, ws.uri);
    assert.equal(conn.latestConfigState(ws.uri)?.state, 'error');

    // Simulate the server's workspaceTrustChanged false->true path.
    ctx.lastKnownTrust = true;
    await reparseAllRoots(ctx);

    assert.equal(conn.latestConfigState(ws.uri)?.state, 'valid');
  } finally {
    ws.cleanup();
  }
});
