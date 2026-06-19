/**
 * Per-root state tracking for the Japanese Novel language server. A "root" is a workspace
 * folder; each root may carry one `novel.jp.*` config. This module owns the
 * `Map<rootUri, RootState>`, scans/parses a root's config on add, registers a watch
 * on `novel.jp.*` for that root, pushes `jpnov/configState`, and tears everything
 * down on remove.
 *
 * vscode-free: only `import type` of the language-server types is used; the runtime
 * `Connection` is injected via {@link ServerContext}.
 */
import {
  DidChangeWatchedFilesNotification,
  WatchKind,
} from 'vscode-languageserver/node';
import type {
  Connection,
  DidChangeWatchedFilesRegistrationOptions,
  Disposable,
} from 'vscode-languageserver/node';

import type { ResolvedConfig } from '#/shared/config/types.ts';

import { loadRootConfig } from './configLoad.ts';

/**
 * Mutable, process-wide server state threaded through every server module. It is a
 * single object shared by reference, so writes (e.g. `ctx.lastKnownTrust = true`) are
 * visible everywhere.
 */
export interface ServerContext {
  readonly connection: Connection;
  /** Keyed by normalized root URI (no trailing slash). */
  readonly roots: Map<string, RootState>;
  /** The fixed config stem the server watches/matches per root (`"novel.jp"`). */
  readonly configBaseName: string;
  /** Latest workspace-trust state; gates executable-config import(). */
  lastKnownTrust: boolean;
}

/**
 * What the server remembers about a single root between reparses. The optional fields
 * are explicitly `| undefined` because they are reset to `undefined` in place (the
 * config vanishing, an error clearing `resolved`) under `exactOptionalPropertyTypes`.
 */
export interface RootState {
  /** The root folder URI (no trailing slash); identical to the map key. */
  readonly rootUri: string;
  /** URI of the matched config file, when one currently exists. */
  configUri?: string | undefined;
  /** Last successful resolution (drives `valid` state). */
  resolved?: ResolvedConfig | undefined;
  /** Last-known-good resolution, retained across errors. */
  lastGood?: ResolvedConfig | undefined;
  /** Disposable for the per-root `novel.jp.*` watch registration. */
  watcherDisposable?: Disposable | undefined;
}

/** Strips a single trailing slash so root URIs compare/hash consistently. */
export function normalizeRootUri(uri: string): string {
  return uri.endsWith('/') ? uri.slice(0, -1) : uri;
}

/**
 * Registers a client-side file watch on `novel.jp.*` relative to `rootUri`. Returns a
 * `Disposable` that unregisters the watch, or `undefined` if registration failed (the
 * server still functions; it simply will not auto-reparse that root on config edits).
 */
async function registerConfigWatch(
  ctx: ServerContext,
  rootUri: string,
): Promise<Disposable | undefined> {
  const options: DidChangeWatchedFilesRegistrationOptions = {
    watchers: [
      {
        globPattern: {
          baseUri: rootUri,
          pattern: `${ctx.configBaseName}.*`,
        },
        kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
      },
    ],
  };
  try {
    return await ctx.connection.client.register(
      DidChangeWatchedFilesNotification.type,
      options,
    );
  } catch {
    return undefined;
  }
}

/**
 * Adds a root: creates its {@link RootState}, registers the `novel.jp.*` watch, and
 * performs the initial config scan/parse (which pushes the first `jpnov/configState`).
 * Re-adding an existing root is a no-op refresh of its config.
 */
export async function addRoot(ctx: ServerContext, rawUri: string): Promise<void> {
  const rootUri = normalizeRootUri(rawUri);

  let state = ctx.roots.get(rootUri);
  if (!state) {
    state = { rootUri };
    ctx.roots.set(rootUri, state);
  }
  state.watcherDisposable ??= await registerConfigWatch(ctx, rootUri);

  await loadRootConfig(ctx, state);
}

/**
 * Removes a root: disposes its watch and forgets its state, then pushes a `removed`
 * config-state so the client restores the original language ids under it.
 */
export async function removeRoot(ctx: ServerContext, rawUri: string): Promise<void> {
  const rootUri = normalizeRootUri(rawUri);
  const state = ctx.roots.get(rootUri);
  if (state?.watcherDisposable) {
    state.watcherDisposable.dispose();
  }
  ctx.roots.delete(rootUri);

  await ctx.connection.sendNotification('jpnov/configState', {
    root: rootUri,
    state: 'removed',
  });
}

/**
 * Re-parses every currently tracked root (used on `false -> true` trust transitions,
 * so executable configs that were previously gated out can now load).
 */
export async function reparseAllRoots(ctx: ServerContext): Promise<void> {
  await Promise.all(
    [...ctx.roots.values()].map((state) => loadRootConfig(ctx, state)),
  );
}

/**
 * Finds the tracked root that owns `fileUri` (the longest root-prefix match). Used to
 * route a watched-file change to the right root for reparse.
 */
export function rootForUri(ctx: ServerContext, fileUri: string): RootState | undefined {
  let best: RootState | undefined;
  for (const state of ctx.roots.values()) {
    const prefix = `${state.rootUri}/`;
    if (fileUri === state.rootUri || fileUri.startsWith(prefix)) {
      if (!best || state.rootUri.length > best.rootUri.length) {
        best = state;
      }
    }
  }
  return best;
}
