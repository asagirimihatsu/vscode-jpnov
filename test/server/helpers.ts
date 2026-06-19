/**
 * Test scaffolding for the server integration tests: a fake LSP `Connection` that
 * records outgoing notifications/diagnostics and answers `jpnov/readFile`, plus tmp
 * workspace helpers. These tests run on real `file:` fixtures so the `node:fs` loader
 * and build paths are exercised end to end. NOT wired into `npm test` this round.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Connection } from 'vscode-languageserver/node';

import type { ServerContext } from '../../src/server/roots.ts';

export interface RecordedNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface RecordedDiagnostics {
  readonly uri: string;
  readonly count: number;
}

/** A disposable stub whose disposal is observable. */
export interface FakeDisposable {
  disposed: boolean;
  dispose(): void;
}

export interface FakeConnection {
  readonly notifications: RecordedNotification[];
  readonly diagnostics: RecordedDiagnostics[];
  /** Optional override for `jpnov/readFile` responses, keyed by uri. */
  readFileResponses: Map<string, string | null>;
  readonly registeredWatchers: FakeDisposable[];
  /** Cast to the real Connection for injection into a ServerContext. */
  asConnection(): Connection;
  /** All configState notifications seen so far, newest last. */
  configStates(): RecordedNotification[];
  /** The latest configState for a given root uri, or undefined. */
  latestConfigState(root: string): Record<string, unknown> | undefined;
}

export function makeFakeConnection(): FakeConnection {
  const notifications: RecordedNotification[] = [];
  const diagnostics: RecordedDiagnostics[] = [];
  const registeredWatchers: FakeDisposable[] = [];
  const readFileResponses = new Map<string, string | null>();

  const impl = {
    notifications,
    diagnostics,
    readFileResponses,
    registeredWatchers,
    sendNotification(method: string, params: unknown): Promise<void> {
      notifications.push({ method, params });
      return Promise.resolve();
    },
    sendDiagnostics(params: { uri: string; diagnostics: unknown[] }): Promise<void> {
      diagnostics.push({ uri: params.uri, count: params.diagnostics.length });
      return Promise.resolve();
    },
    sendRequest(method: string, params: unknown): Promise<unknown> {
      if (method === 'jpnov/readFile') {
        const uri = (params as { uri: string }).uri;
        const base64 = readFileResponses.has(uri)
          ? readFileResponses.get(uri) ?? null
          : null;
        return Promise.resolve({ base64 });
      }
      return Promise.resolve(undefined);
    },
    client: {
      register(): Promise<FakeDisposable> {
        const disp: FakeDisposable = {
          disposed: false,
          dispose() {
            this.disposed = true;
          },
        };
        registeredWatchers.push(disp);
        return Promise.resolve(disp);
      },
    },
    asConnection(): Connection {
      return impl as unknown as Connection;
    },
    configStates(): RecordedNotification[] {
      return notifications.filter((n) => n.method === 'jpnov/configState');
    },
    latestConfigState(root: string): Record<string, unknown> | undefined {
      for (let i = notifications.length - 1; i >= 0; i--) {
        const n = notifications[i];
        if (
          n?.method === 'jpnov/configState' &&
          (n.params as { root?: string }).root === root
        ) {
          return n.params as Record<string, unknown>;
        }
      }
      return undefined;
    },
  };

  return impl;
}

export function makeContext(
  conn: FakeConnection,
  opts?: { isTrusted?: boolean },
): ServerContext {
  return {
    connection: conn.asConnection(),
    roots: new Map(),
    configBaseName: 'novel.jp',
    lastKnownTrust: opts?.isTrusted ?? false,
  };
}

/** Creates an isolated tmp workspace directory; returns its fs path + file:// uri. */
export function makeTmpWorkspace(): {
  dir: string;
  uri: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'jpnov-server-'));
  const uri = pathToFileURL(dir).href.replace(/\/$/, '');
  return {
    dir,
    uri,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Writes a file under `dir`, creating parent directories as needed. */
export function writeUnder(dir: string, rel: string, content: string): string {
  const full = join(dir, ...rel.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}
