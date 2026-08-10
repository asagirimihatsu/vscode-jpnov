/**
 * Unit tests for the PDF output wait. `waitForOutput` is driven directly with a fake child
 * process (a bare EventEmitter), so no browser is involved:
 *   node --test "test/client/pdf.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { waitForOutput } from '../../src/client/pdf.ts';

const fakeChild = (): ChildProcess => new EventEmitter() as unknown as ChildProcess;

/** A path whose stat always fails, standing in for output the browser never writes. */
const NEVER = join(tmpdir(), 'jpnov-pdftest-nowhere', 'never.pdf');

test('resolves once the output file exists with a stable size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jpnov-pdftest-'));
  try {
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, 'x'.repeat(64));
    await waitForOutput(pdfPath, fakeChild(), 5_000, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects at the deadline when no output ever appears', async () => {
  const started = Date.now();
  await assert.rejects(waitForOutput(NEVER, fakeChild(), 500, undefined), /produced no PDF output/);
  assert.ok(Date.now() - started < 5_000, 'the deadline must fire near timeoutMs');
});

test('rejects as cancelled when the signal aborts mid-wait', async () => {
  const abort = new AbortController();
  setTimeout(() => {
    abort.abort();
  }, 50);
  await assert.rejects(waitForOutput(NEVER, fakeChild(), 5_000, abort.signal), /cancelled/);
});

test('rejects immediately on an already-aborted signal', async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(waitForOutput(NEVER, fakeChild(), 5_000, abort.signal), /cancelled/);
});

test('rejects when the browser exits before writing anything', async () => {
  const child = fakeChild();
  setTimeout(() => {
    child.emit('exit', 1, null);
  }, 50);
  await assert.rejects(waitForOutput(NEVER, child, 5_000, undefined), /exited before writing/);
});

test('rejects when the browser fails to spawn', async () => {
  const child = fakeChild();
  setTimeout(() => {
    child.emit('error', new Error('spawn ENOENT'));
  }, 50);
  await assert.rejects(waitForOutput(NEVER, child, 5_000, undefined), /spawn ENOENT/);
});
