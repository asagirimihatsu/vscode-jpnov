/**
 * The config loader "seam": discover, read, and parse a root's `novel.jp.*` config
 * (characters/keywords only), then push the resulting `jpnov/configState` (and a
 * diagnostic on error).
 *
 * Byte access is scheme-aware: on `file:` we use `node:fs/promises`; on any other
 * scheme we ask the client over `jpnov/readFile` (CONFIG bytes only). JSON parses
 * from bytes anywhere; executable configs (js/ts/mjs/cjs) hard-require `file:` AND
 * workspace trust, and are loaded with a cache-busted dynamic `import()`.
 *
 * vscode-free: the runtime `Connection` is reached only through {@link ServerContext}.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FILE_TYPE_FILE, isDataFormat, matchConfig, parseDataConfig, loadModuleConfig } from '#/shared/config/parser.ts';
import { LocalizedError } from '#/shared/messages.ts';
import type { NovelConfigFormat, RawNovelConfig } from '#/shared/config/types.ts';
import type { ConfigStateParams, LocalizableMessage } from '#/shared/protocol.ts';
import type { ReadFileParams, ReadFileResult } from '#/shared/protocol.ts';

import { fileLevelError } from './diagnostics.ts';
import { childUri, isFileScheme } from './fsUri.ts';
import type { RootState, ServerContext } from './roots.ts';

/** The recognized config basenames, highest precedence first (json > js > ts > mjs > cjs). */
const CONFIG_CANDIDATES = ['json', 'js', 'ts', 'mjs', 'cjs'] as const;

/**
 * Reads config bytes for `uri`. `file:` URIs go through `node:fs`; everything else is
 * fetched from the client via `jpnov/readFile`. Returns `null` when the file does not
 * exist (ENOENT / null bridge response).
 */
async function readConfigBytes(
  ctx: ServerContext,
  uri: string,
): Promise<Uint8Array | null> {
  if (isFileScheme(uri)) {
    try {
      return await readFile(fileURLToPath(uri));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw cause;
    }
  }
  const result = await ctx.connection.sendRequest<ReadFileResult>(
    'jpnov/readFile',
    { uri } satisfies ReadFileParams,
  );
  if (result.base64 === null) {
    return null;
  }
  return Uint8Array.from(Buffer.from(result.base64, 'base64'));
}

/**
 * Locates the highest-precedence config under `rootUri`.
 *
 * `file:` roots are listed with `node:fs` and run through the shared {@link matchConfig}.
 * Non-`file:` roots cannot be enumerated over the bridge, so we probe candidate names by
 * precedence via `jpnov/readFile`; only data (json) configs are reachable there, which
 * matches the rule that executable configs hard-require `file:`.
 */
async function findConfig(
  ctx: ServerContext,
  rootUri: string,
): Promise<{ uri: string; format: NovelConfigFormat } | null> {
  if (isFileScheme(rootUri)) {
    let dirents;
    try {
      dirents = await readdir(fileURLToPath(rootUri), { withFileTypes: true });
    } catch {
      return null;
    }
    const entries: [string, number][] = dirents.map((d) => [
      d.name,
      d.isFile() ? FILE_TYPE_FILE : 0,
    ]);
    const matched = matchConfig(entries, FILE_TYPE_FILE);
    if (!matched) {
      return null;
    }
    return { uri: childUri(rootUri, matched.filename), format: matched.format };
  }

  for (const format of CONFIG_CANDIDATES) {
    if (!isDataFormat(format)) {
      continue; // executable configs are not reachable on non-file schemes
    }
    const uri = childUri(rootUri, `${ctx.configBaseName}.${format}`);
    const bytes = await readConfigBytes(ctx, uri);
    if (bytes !== null) {
      return { uri, format };
    }
  }
  return null;
}

/**
 * Loads an executable config (`js`/`ts`/`mjs`/`cjs`) via dynamic `import()`, cache-busted
 * with `?v=<mtime>` so an edited file is actually re-evaluated. Caller has already
 * verified `file:` scheme + workspace trust.
 */
async function importModuleConfig(uri: string): Promise<RawNovelConfig> {
  const fsPath = fileURLToPath(uri);
  const { mtimeMs } = await stat(fsPath);
  const importUrl = `${pathToFileURL(fsPath).href}?v=${String(mtimeMs)}`;
  const mod = (await import(importUrl)) as Record<string, unknown>;
  return loadModuleConfig(mod);
}

function clearConfigDiagnostics(ctx: ServerContext, configUri: string): void {
  // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
  void ctx.connection.sendDiagnostics({ uri: configUri, diagnostics: [] });
}

function pushConfigState(ctx: ServerContext, params: ConfigStateParams): void {
  // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
  void ctx.connection.sendNotification('jpnov/configState', params);
}

/**
 * The whole per-root pipeline: discover -> read -> parse -> publish.
 *
 * Mutates `state` (configUri / resolved / lastGood) and emits exactly one
 * `jpnov/configState` describing the outcome:
 * - no config found      -> `absent`
 * - parsed cleanly        -> `valid` (+ clears diagnostics, updates lastGood)
 * - any failure           -> `error` (+ diagnostic on the config uri, keeps lastGood)
 *
 * Never throws: all failure paths funnel into the `error` state.
 */
export async function loadRootConfig(
  ctx: ServerContext,
  state: RootState,
): Promise<void> {
  const rootUri = state.rootUri;

  let found: { uri: string; format: NovelConfigFormat } | null;
  try {
    found = await findConfig(ctx, rootUri);
  } catch {
    found = null;
  }

  if (!found) {
    if (state.configUri) {
      clearConfigDiagnostics(ctx, state.configUri);
    }
    state.configUri = undefined;
    state.resolved = undefined;
    pushConfigState(ctx, { root: rootUri, state: 'absent' });
    return;
  }

  const { uri: configUri, format } = found;
  state.configUri = configUri;

  try {
    let raw: RawNovelConfig;
    if (isDataFormat(format)) {
      const bytes = await readConfigBytes(ctx, configUri);
      if (bytes === null) {
        // Vanished between discovery and read: treat as absent.
        clearConfigDiagnostics(ctx, configUri);
        state.configUri = undefined;
        state.resolved = undefined;
        pushConfigState(ctx, { root: rootUri, state: 'absent' });
        return;
      }
      raw = parseDataConfig(bytes);
    } else {
      // Executable config: gated on file: scheme AND workspace trust.
      if (!isFileScheme(configUri)) {
        throw new LocalizedError({ code: 'config.execNeedsFileScheme', args: [format] });
      }
      if (!ctx.lastKnownTrust) {
        throw new LocalizedError({ code: 'config.execNeedsTrust', args: [format] });
      }
      raw = await importModuleConfig(configUri);
    }

    clearConfigDiagnostics(ctx, configUri);
    state.resolved = raw;
    state.lastGood = raw;
    pushConfigState(ctx, { root: rootUri, state: 'valid' });
  } catch (cause) {
    const message: LocalizableMessage = cause instanceof LocalizedError
      ? cause.localized
      : { code: 'config.loadFailed', args: [cause instanceof Error ? cause.message : String(cause)] };
    state.resolved = undefined;
    // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
    void ctx.connection.sendDiagnostics({ uri: configUri, diagnostics: [fileLevelError(message)] });
    pushConfigState(ctx, {
      root: rootUri,
      state: 'error',
      error: { ...message, configUri },
    });
  }
}
