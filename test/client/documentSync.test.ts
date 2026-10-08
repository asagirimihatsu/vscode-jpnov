/**
 * The request middleware orders a document request behind the open the client sends for that
 * document: the start's own didOpen for a visible document is written after a request that only
 * waited for the start. vscode-free (the middleware sees documents only through `uri`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { documentSync } from '../../src/client/documentSync.ts';

const URI = 'file:///proj/src/a.jpnov';
const document = { uri: { toString: () => URI } } as never;

test('a request for a document goes out after the open of that document', async () => {
  const sync = documentSync();
  const order: string[] = [];
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });

  // The open the start sends: written once the start resolves.
  void sync.didOpen(document, () => started.then(() => {
    order.push('didOpen');
  }));
  const request = sync.sendRequest('jpnov/renderFile', { uri: URI }, undefined, () => {
    order.push('renderFile');
    return Promise.resolve('html');
  });
  await Promise.resolve();
  assert.equal(order.length, 0, 'the request waits for the open');

  start();
  assert.equal(await request, 'html');
  assert.deepEqual(order, ['didOpen', 'renderFile']);
});

test('a request that names no document, or a closed one, goes out at once', async () => {
  const sync = documentSync();
  void sync.didOpen(document, () => new Promise(() => undefined)); // an open that never lands
  void sync.didClose(document, () => Promise.resolve());
  const sent: unknown[] = [];
  const next = (_type: unknown, param?: unknown): Promise<void> => {
    sent.push(param);
    return Promise.resolve();
  };
  await sync.sendRequest('jpnov/listBooks', { projectDirs: {} }, undefined, next);
  await sync.sendRequest('jpnov/renderFile', { uri: URI }, undefined, next);
  assert.deepEqual(sent, [{ projectDirs: {} }, { uri: URI }]);
});
