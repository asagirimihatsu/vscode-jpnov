/**
 * Test scaffolding for the server tests: a fake LSP `Connection` that records outgoing
 * notifications/diagnostics (plus semanticTokens.refresh calls), plus tmp workspace
 * helpers. Suites under `test/server/highlight/**` run inside plain `npm test`; the
 * fs-heavy build + jpbook suites run in `npm run test:integration`.
 */
import { rm, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Connection } from 'vscode-languageserver/node';

import { selectRules } from '../../src/shared/lint/select.ts';
import { createHighlightStore } from '../../src/server/highlight/vocabulary.ts';
import { createWorkspaceRoots } from '../../src/server/roots.ts';
import type { ServerContext } from '../../src/server/roots.ts';

export interface RecordedNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface RecordedDiagnostics {
  readonly uri: string;
  readonly count: number;
}

export interface FakeConnection {
  readonly notifications: RecordedNotification[];
  readonly diagnostics: RecordedDiagnostics[];
  /** How many times the server asked the client to re-pull semantic tokens. */
  semanticTokenRefreshes(): number;
  /** Cast to the real Connection for injection into a ServerContext. */
  asConnection(): Connection;
}

export function makeFakeConnection(): FakeConnection {
  const notifications: RecordedNotification[] = [];
  const diagnostics: RecordedDiagnostics[] = [];

  let refreshCount = 0;

  const impl = {
    notifications,
    diagnostics,
    languages: {
      semanticTokens: {
        refresh(): Promise<void> {
          refreshCount += 1;
          return Promise.resolve();
        },
      },
    },
    semanticTokenRefreshes(): number {
      return refreshCount;
    },
    sendNotification(method: string, params: unknown): Promise<void> {
      notifications.push({ method, params });
      return Promise.resolve();
    },
    sendDiagnostics(params: { uri: string; diagnostics: unknown[] }): Promise<void> {
      diagnostics.push({ uri: params.uri, count: params.diagnostics.length });
      return Promise.resolve();
    },
    sendRequest(): Promise<unknown> {
      return Promise.resolve(undefined);
    },
    asConnection(): Connection {
      return impl as unknown as Connection;
    },
  };

  return impl;
}

export function makeContext(conn: FakeConnection): ServerContext {
  return {
    connection: conn.asConnection(),
    lintSelection: selectRules({}),
    highlight: createHighlightStore(),
    roots: createWorkspaceRoots(),
  };
}

/** Creates an isolated tmp workspace directory; returns its fs path + file:// uri. */
export async function makeTmpWorkspace(): Promise<{
  dir: string;
  uri: string;
  [Symbol.asyncDispose](): Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'jpnov-server-'));
  const uri = pathToFileURL(dir).href.replace(/\/$/, '');
  return {
    dir,
    uri,
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Writes a file under `dir`, creating parent directories as needed. */
export async function writeUnder(dir: string, rel: string, content: string): Promise<string> {
  const full = join(dir, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
  return full;
}
