/**
 * The `jpnov/build` request handler. For each targeted valid root it enumerates every
 * `*.filelist` under the root's `sourceDir`, reads the `.jpnov` files each one lists (in order,
 * resolved relative to the filelist's OWN directory), and emits one `.txt` (the concatenated
 * Aozora source via `concatBookText`) plus one `.html` (the paginated render via `renderBook`)
 * per filelist, returning the artifacts for the CLIENT to write. The output path is derived
 * from the filelist's name/location (`filelistOutRel`, mirroring the source tree); two distinct
 * filelists that derive the same path are a build error and neither is emitted.
 *
 * A build may be narrowed by {@link BuildParams.books} (a subset of `.filelist` URIs) and/or
 * {@link BuildParams.format} (only `.txt` or only `.html`). The companion {@link handleListBooks}
 * enumerates those same filelists as {@link BookEntry}s WITHOUT building, to populate the client's
 * Books selection panel.
 *
 * Filelist enumeration / file reads use `node:fs` on the `file:` scheme only (the server never
 * touches `vscode.fs`); the client owns artifact writes. Per-line diagnostics are computed by
 * the shared {@link diagnoseFilelist} (the same path the live editor uses) and published on each
 * `.filelist` URI, plus a file-level collision diagnostic when one applies.
 *
 * vscode-free: the runtime `Connection` is reached only through {@link ServerContext}.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { WorkDoneProgressReporter } from 'vscode-languageserver/node';

import { filelistOutRel, parseFilelist } from '#/shared/book/filelist.ts';
import { concatBookText, renderBook } from '#/shared/compiler/document.ts';
import type { BookInput } from '#/shared/compiler/document.ts';
import { resolveContained } from '#/shared/config/validate.ts';
import type { ResolvedConfig } from '#/shared/config/types.ts';
import type {
  BookEntry,
  BuildArtifact,
  BuildError,
  BuildFormat,
  BuildParams,
  BuildResult,
  ListBooksParams,
  ListBooksResult,
} from '#/shared/protocol.ts';

import { fileLevelError } from './diagnostics.ts';
import { diagnoseFilelist } from './filelist.ts';
import { childUri, isFileScheme } from './fsUri.ts';
import { normalizeRootUri } from './roots.ts';
import type { RootState, ServerContext } from './roots.ts';

const UTF8 = new TextDecoder('utf-8');

/** A `*.filelist` discovered under a root's sourceDir. */
interface DiscoveredFilelist {
  /** Path relative to sourceDir (POSIX separators), e.g. `"part1/vol2.filelist"`. */
  readonly fileRel: string;
  /** Absolute URI of the `.filelist` file (diagnostics target). */
  readonly uri: string;
  /** Absolute URI of the directory holding it (the base for resolving its entries). */
  readonly dirUri: string;
}

/**
 * How one build is narrowed. Fields are required-but-`| undefined` (not optional) on purpose:
 * under `exactOptionalPropertyTypes` that lets `handleBuild` forward `params.format` (a
 * `BuildFormat | undefined`) straight through without an omit-when-undefined dance.
 */
interface BuildSelection {
  /** When set, only filelists whose URI is in the set are built; `undefined` = every book. */
  readonly books: ReadonlySet<string> | undefined;
  /** When set, emit only that kind; `undefined` = BOTH `.txt` and `.html`. */
  readonly format: BuildFormat | undefined;
}

function joinRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/**
 * Recursively walks `sourceDirUri` collecting every `*.filelist` file. `file:` scheme only —
 * virtual-fs source trees cannot be enumerated, so such roots simply yield no books. Results
 * are sorted by `fileRel` for deterministic output and stable collision reporting.
 */
async function discoverFilelists(sourceDirUri: string): Promise<DiscoveredFilelist[]> {
  if (!isFileScheme(sourceDirUri)) {
    return [];
  }
  const found: DiscoveredFilelist[] = [];

  async function walk(dirUri: string, dirRel: string): Promise<void> {
    let dirents;
    try {
      dirents = await readdir(fileURLToPath(dirUri), { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.filelist')) {
        found.push({
          fileRel: joinRel(dirRel, dirent.name),
          uri: childUri(dirUri, dirent.name),
          dirUri,
        });
      } else if (dirent.isDirectory()) {
        await walk(childUri(dirUri, dirent.name), joinRel(dirRel, dirent.name));
      }
    }
  }

  await walk(sourceDirUri, '');
  found.sort((a, b) => (a.fileRel < b.fileRel ? -1 : a.fileRel > b.fileRel ? 1 : 0));
  return found;
}

/**
 * Reads the `ok` entries of one `.filelist` in order (skipping blank/duplicate/error lines),
 * each resolved relative to the filelist's directory and decoded UTF-8, into the shape
 * {@link renderBook} consumes. Throws on the first escaping/unreadable/missing entry so the
 * caller can convert it into a per-book build error (the diagnostic is published separately).
 */
async function readFilelistFiles(fl: DiscoveredFilelist, text: string): Promise<BookInput> {
  const files: { name: string; src: string }[] = [];
  for (const pl of parseFilelist(text)) {
    if (pl.kind !== 'ok') {
      continue;
    }
    const resolved = resolveContained(fl.dirUri, pl.value, 'filelist entry');
    if (!resolved.ok) {
      throw new Error(resolved.reason);
    }
    if (!isFileScheme(resolved.abs)) {
      throw new Error(`cannot read "${pl.value}": book files require a file:// workspace`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(fileURLToPath(resolved.abs));
    } catch (cause) {
      const why = (cause as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'file not found'
        : cause instanceof Error
          ? cause.message
          : String(cause);
      throw new Error(`cannot read "${pl.value}": ${why}`);
    }
    files.push({ name: pl.value, src: UTF8.decode(bytes) });
  }
  return { files };
}

/**
 * Builds the filelists under one valid root, accumulating artifacts + per-book errors.
 * `selection.books` (when set) restricts WHICH filelists are built, but the output-path
 * collision map is still computed over ALL of them — a selected book that collides with an
 * UNSELECTED one still errors, so a later full build can never silently clobber it.
 */
async function buildRoot(
  ctx: ServerContext,
  config: ResolvedConfig,
  selection: BuildSelection,
  artifacts: BuildArtifact[],
  errors: BuildError[],
): Promise<void> {
  const filelists = await discoverFilelists(config.sourceDirUri);

  // Derive each filelist's output path ONCE, then group by it to detect collisions across the
  // whole root up front.
  const derived = filelists.map((fl) => ({ fl, outRel: filelistOutRel(fl.fileRel) }));
  const byOutRel = new Map<string, DiscoveredFilelist[]>();
  for (const { fl, outRel } of derived) {
    const group = byOutRel.get(outRel);
    if (group) {
      group.push(fl);
    } else {
      byOutRel.set(outRel, [fl]);
    }
  }

  for (const { fl, outRel } of derived) {
    // Subset build: skip filelists outside the requested set entirely (no read, no diagnostics).
    if (selection.books && !selection.books.has(fl.uri)) {
      continue;
    }
    const bytes = await readFile(fileURLToPath(fl.uri)).catch(() => null as Buffer | null);
    if (bytes === null) {
      // Disappeared mid-build; skip silently rather than error on a non-existent file.
      continue;
    }
    const text = UTF8.decode(bytes);

    // Per-line diagnostics (same path the live editor uses); published on the .filelist URI.
    const lineDiags = await diagnoseFilelist(fl.uri, text);
    const colliding = (byOutRel.get(outRel) ?? []).filter((other) => other !== fl);

    if (colliding.length > 0) {
      const message = `output path "${outRel}" is claimed by multiple filelists: ${[fl.fileRel, ...colliding.map((c) => c.fileRel)].sort().join(', ')}`;
      void ctx.connection.sendDiagnostics({
        uri: fl.uri,
        diagnostics: [...lineDiags, fileLevelError(message)],
      });
      errors.push({ book: fl.fileRel, message });
      continue;
    }

    let input: BookInput;
    try {
      input = await readFilelistFiles(fl, text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      void ctx.connection.sendDiagnostics({ uri: fl.uri, diagnostics: lineDiags });
      errors.push({ book: fl.fileRel, message });
      continue;
    }

    void ctx.connection.sendDiagnostics({ uri: fl.uri, diagnostics: lineDiags });

    // Emit only the requested kind(s); `format` absent => BOTH. renderBook (the paginator) is
    // the expensive step, so a txt-only build skips it entirely.
    if (selection.format !== 'html') {
      artifacts.push({ path: childUri(config.outDirUri, `${outRel}.txt`), content: concatBookText(input) });
    }
    if (selection.format !== 'txt') {
      const html = renderBook({
        books: [input],
        charsPerLine: config.charsPerLine,
        linesPerPage: config.linesPerPage,
        avoidLineBreaks: config.avoidLineBreaks ?? false,
      });
      artifacts.push({ path: childUri(config.outDirUri, `${outRel}.html`), content: html });
    }
  }
}

/** Selects the roots to build: a single named root, or every currently-valid root. */
function targetRoots(ctx: ServerContext, root?: string): RootState[] {
  if (root !== undefined) {
    const state = ctx.roots.get(normalizeRootUri(root));
    return state?.resolved ? [state] : [];
  }
  return [...ctx.roots.values()].filter((s) => s.resolved !== undefined);
}

/**
 * Handles `jpnov/build`. Omitting `root` builds every valid root. Reports coarse
 * `$/progress` via the supplied work-done reporter (one tick per root). The result is
 * `ok` when no build-level errors were collected; per-book errors are surfaced in
 * `errors[]` and as diagnostics on each offending `.filelist`.
 */
export async function handleBuild(
  ctx: ServerContext,
  params: BuildParams,
  progress?: WorkDoneProgressReporter,
): Promise<BuildResult> {
  const roots = targetRoots(ctx, params.root);
  const artifacts: BuildArtifact[] = [];
  const errors: BuildError[] = [];

  // `books` ABSENT => build every discovered book; PRESENT (even empty `[]`, which is truthy)
  // => restrict to exactly that set, so an empty selection legitimately builds nothing.
  const selection: BuildSelection = {
    books: params.books ? new Set(params.books) : undefined,
    format: params.format,
  };

  progress?.begin('Japanese Novel: Building', 0, undefined, false);

  let done = 0;
  for (const state of roots) {
    const config = state.resolved;
    if (config) {
      try {
        await buildRoot(ctx, config, selection, artifacts, errors);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        errors.push({ book: state.rootUri, message });
      }
    }
    done += 1;
    if (roots.length > 0) {
      progress?.report(Math.round((done / roots.length) * 100));
    }
  }

  progress?.done();

  const result: BuildResult = { ok: errors.length === 0, artifacts, errors };
  return result;
}

/**
 * Handles `jpnov/listBooks`: enumerates every `*.filelist` under each targeted valid root as a
 * {@link BookEntry} for the client's Books panel. PURE discovery — no file reads, no diagnostics,
 * and no output-path collision check (those belong to an actual build). A root whose config failed
 * to resolve simply contributes no books.
 */
export async function handleListBooks(
  ctx: ServerContext,
  params: ListBooksParams,
): Promise<ListBooksResult> {
  const books: BookEntry[] = [];
  for (const state of targetRoots(ctx, params.root)) {
    const config = state.resolved;
    if (!config) {
      continue;
    }
    for (const fl of await discoverFilelists(config.sourceDirUri)) {
      books.push({
        uri: fl.uri,
        rootUri: state.rootUri,
        fileRel: fl.fileRel,
        outRel: filelistOutRel(fl.fileRel),
      });
    }
  }
  return { books };
}
