/**
 * The `jpnov/build` request handler. The request's `projectDirs` map (the client's per-folder
 * `jpnov.project.*` snapshot) defines the targeted roots; for each one it enumerates every
 * `*.jpbook` anywhere under the workspace folder root (skipping dot-folders, `node_modules`,
 * and the resolved output folder), reads the `.jpnov` files each one lists (in order, resolved
 * relative to the `.jpbook`'s OWN directory), and emits one `.txt` (the concatenated Aozora
 * source via `concatBookText`) plus one `.html` (the paginated render via `renderBook`) per
 * book, returning the artifacts for the CLIENT to write. The output path is derived from
 * the `.jpbook`'s name/location (`jpbookOutRel`, mirroring the tree under the folder root);
 * two distinct book files that derive the same path are a build error and neither is emitted.
 * Page furniture (柱/ノンブル) comes from each book's OWN front matter (`composeBookChrome`),
 * so one build renders per-volume headers; the settings snapshot carries only the shared
 * layout + proofing chrome.
 *
 * A build may be narrowed by {@link BuildParams.books} (a subset of `.jpbook` URIs) and/or
 * {@link BuildParams.format} (only `.txt` or only `.html`). The companion {@link handleListBooks}
 * enumerates those same book files as {@link BookEntry}s WITHOUT building, to populate the
 * client's Books selection panel.
 *
 * Book enumeration / file reads use `node:fs` on the `file:` scheme only (the server never
 * touches `vscode.fs`); the client owns artifact writes. Per-line diagnostics are computed by
 * the shared {@link diagnoseJpbook} (the same path the live editor uses) and published on each
 * `.jpbook` URI, plus a file-level collision diagnostic when one applies.
 *
 * vscode-free: the runtime `Connection` is reached only through {@link ServerContext}.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorkDoneProgressReporter } from 'vscode-languageserver/node';

import { composeBookChrome, jpbookOutRel, parseJpbook } from '#/shared/book/jpbook.ts';
import type { ParsedLine } from '#/shared/book/jpbook.ts';
import { concatBookText, renderBook } from '#/shared/compiler/document.ts';
import type { BookInput } from '#/shared/compiler/document.ts';
import { LocalizedError } from '#/shared/messages.ts';
import { resolveHtmlSettings } from '#/shared/config/settings.ts';
import { resolveContained } from '#/shared/config/validate.ts';
import { PROJECT_DEFAULT } from '#/shared/config/types.ts';
import type {
  BookEntry,
  BuildArtifact,
  BuildError,
  BuildFormat,
  BuildParams,
  BuildResult,
  HtmlSettings,
  ListBooksParams,
  ListBooksResult,
  LocalizableMessage,
  ProjectDirsMap,
} from '#/shared/protocol.ts';

import { fileLevelError } from './diagnostics.ts';
import { diagnoseJpbook } from './jpbook.ts';
import { childUri, isFileScheme, normalizeRootUri } from './fsUri.ts';
import type { ServerContext } from './roots.ts';

const UTF8 = new TextDecoder('utf-8');

/** A `*.jpbook` discovered under a workspace folder root. */
interface DiscoveredJpbook {
  /** Path relative to the workspace folder root (POSIX separators), e.g. `"part1/vol2.jpbook"`. */
  readonly fileRel: string;
  /** Absolute URI of the `.jpbook` file (diagnostics target). */
  readonly uri: string;
  /** Absolute URI of the directory holding it (the base for resolving its entries). */
  readonly dirUri: string;
}

/** One targeted root: its normalized URI plus the RESOLVED output dir URI. */
interface ProjectRoot {
  readonly rootUri: string;
  readonly outDirUri: string;
}

/**
 * How one build is narrowed. Fields are required-but-`| undefined` (not optional) on purpose:
 * under `exactOptionalPropertyTypes` that lets `handleBuild` forward `params.format` (a
 * `BuildFormat | undefined`) straight through without an omit-when-undefined dance.
 */
interface BuildSelection {
  /** When set, only book files whose URI is in the set are built; `undefined` = every book. */
  readonly books: ReadonlySet<string> | undefined;
  /** When set, emit only that kind; `undefined` = BOTH `.txt` and `.html`. */
  readonly format: BuildFormat | undefined;
  /** The re-resolved render settings the `.html` artifacts use (grid geometry + proofing chrome). */
  readonly settings: HtmlSettings;
}

function joinRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/**
 * Recursively walks the workspace folder root collecting every `*.jpbook` file. `file:`
 * scheme only — virtual-fs trees cannot be enumerated, so such roots simply yield no books.
 * Three fixed exclusions, deliberately NOT configurable ("your output folder, dot-folders,
 * and node_modules are never scanned"): dot-DIRECTORIES (dot-files still match), any
 * `node_modules` at any depth, and the resolved output dir. The outDir comparison happens in
 * DECODED fs-path space — `resolveContained` returns a re-encoded URL href while dirents are
 * raw bytes, so URI-string equality would miss any non-ASCII outDir (e.g. `出力`); running
 * both sides through `fileURLToPath` sidesteps every percent-encoding mismatch (and the walk
 * needs the fs path for `readdir` anyway). Symlinked dirents report neither file nor
 * directory under `withFileTypes`, so links are never followed (no cycle risk). Results are
 * sorted by `fileRel` for deterministic output and stable collision reporting.
 */
async function discoverJpbooks(rootUri: string, outDirUri: string): Promise<DiscoveredJpbook[]> {
  if (!isFileScheme(rootUri)) {
    return [];
  }
  const outDirPath = fileURLToPath(outDirUri);
  const found: DiscoveredJpbook[] = [];

  async function walk(dirUri: string, dirPath: string, dirRel: string): Promise<void> {
    let dirents;
    try {
      dirents = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.jpbook')) {
        found.push({
          fileRel: joinRel(dirRel, dirent.name),
          uri: childUri(dirUri, dirent.name),
          dirUri,
        });
      } else if (dirent.isDirectory()) {
        if (dirent.name.startsWith('.') || dirent.name === 'node_modules') {
          continue;
        }
        const childPath = join(dirPath, dirent.name);
        if (childPath === outDirPath) {
          continue;
        }
        await walk(childUri(dirUri, dirent.name), childPath, joinRel(dirRel, dirent.name));
      }
    }
  }

  await walk(rootUri, fileURLToPath(rootUri), '');
  found.sort((a, b) => (a.fileRel < b.fileRel ? -1 : a.fileRel > b.fileRel ? 1 : 0));
  return found;
}

/**
 * Reads the `ok` entries of one parsed `.jpbook` in order (skipping blank/front-matter/
 * duplicate/error lines), each resolved relative to the book file's directory and decoded
 * UTF-8, into the shape {@link renderBook} consumes. Throws on the first escaping/
 * unreadable/missing entry so the caller can convert it into a per-book build error (the
 * diagnostic is published separately).
 */
async function readBookFiles(fl: DiscoveredJpbook, lines: readonly ParsedLine[]): Promise<BookInput> {
  const files: { name: string; src: string }[] = [];
  for (const pl of lines) {
    if (pl.kind !== 'ok') {
      continue;
    }
    const resolved = resolveContained(fl.dirUri, pl.value, 'jpbookEntry');
    if (!resolved.ok) {
      throw new LocalizedError({ code: resolved.code, args: resolved.args });
    }
    if (!isFileScheme(resolved.abs)) {
      throw new LocalizedError({ code: 'book.entryNeedsFileScheme', args: [pl.value] });
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(fileURLToPath(resolved.abs));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new LocalizedError({ code: 'book.entryFileNotFound', args: [pl.value] });
      }
      const why = cause instanceof Error ? cause.message : String(cause);
      throw new LocalizedError({ code: 'book.entryReadFailed', args: [pl.value, why] });
    }
    files.push({ name: pl.value, src: UTF8.decode(bytes) });
  }
  return { files };
}

/** A thrown cause as a {@link LocalizableMessage}: a carried code, else raw text under `build.failed`. */
function toBuildMessage(cause: unknown): LocalizableMessage {
  if (cause instanceof LocalizedError) {
    return cause.localized;
  }
  return { code: 'build.failed', args: [cause instanceof Error ? cause.message : String(cause)] };
}

/**
 * Builds the book files under one targeted root, accumulating artifacts + per-book errors.
 * `selection.books` (when set) restricts WHICH books are built, but the output-path
 * collision map is still computed over ALL of them — a selected book that collides with an
 * UNSELECTED one still errors, so a later full build can never silently clobber it.
 */
async function buildRoot(
  ctx: ServerContext,
  target: ProjectRoot,
  selection: BuildSelection,
  artifacts: BuildArtifact[],
  errors: BuildError[],
): Promise<void> {
  const jpbooks = await discoverJpbooks(target.rootUri, target.outDirUri);

  // Derive each book's output path ONCE, then group by it to detect collisions across the
  // whole root up front.
  const derived = jpbooks.map((fl) => ({ fl, outRel: jpbookOutRel(fl.fileRel) }));
  const byOutRel = new Map<string, DiscoveredJpbook[]>();
  for (const { fl, outRel } of derived) {
    const group = byOutRel.get(outRel);
    if (group) {
      group.push(fl);
    } else {
      byOutRel.set(outRel, [fl]);
    }
  }

  for (const { fl, outRel } of derived) {
    // Subset build: skip books outside the requested set entirely (no read, no diagnostics).
    if (selection.books && !selection.books.has(fl.uri)) {
      continue;
    }
    const bytes = await readFile(fileURLToPath(fl.uri)).catch(() => null as Buffer | null);
    if (bytes === null) {
      // Disappeared mid-build; skip silently rather than error on a non-existent file.
      continue;
    }
    const parsed = parseJpbook(UTF8.decode(bytes));

    // Per-line diagnostics (same path the live editor uses); published on the .jpbook URI.
    const lineDiags = await diagnoseJpbook(fl.uri, parsed);
    const colliding = (byOutRel.get(outRel) ?? []).filter((other) => other !== fl);

    if (colliding.length > 0) {
      const list = [fl.fileRel, ...colliding.map((c) => c.fileRel)].sort().join(', ');
      const error = { code: 'build.outPathCollision' as const, args: [outRel, list] };
      // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
      void ctx.connection.sendDiagnostics({
        uri: fl.uri,
        diagnostics: [...lineDiags, fileLevelError(error)],
      });
      errors.push({ book: fl.fileRel, ...error });
      continue;
    }

    let input: BookInput;
    try {
      input = await readBookFiles(fl, parsed.lines);
    } catch (cause) {
      // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
      void ctx.connection.sendDiagnostics({ uri: fl.uri, diagnostics: lineDiags });
      errors.push({ book: fl.fileRel, ...toBuildMessage(cause) });
      continue;
    }

    // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
    void ctx.connection.sendDiagnostics({ uri: fl.uri, diagnostics: lineDiags });

    // Emit only the requested kind(s); `format` absent => BOTH. renderBook (the paginator) is
    // the expensive step, so a txt-only build skips it entirely.
    if (selection.format !== 'html') {
      artifacts.push({
        path: childUri(target.outDirUri, `${outRel}.txt`),
        content: concatBookText(input, selection.settings.autoTcy),
      });
    }
    if (selection.format !== 'txt') {
      // Grid geometry, 禁則, and 自動縦中横 come from the request's settings snapshot; the
      // page furniture is composed per book from its own front matter (this is what lets
      // one batch build carry a different 柱 per volume).
      const html = renderBook({
        books: [input],
        charsPerLine: selection.settings.charsPerLine,
        linesPerPage: selection.settings.linesPerPage,
        kinsoku: selection.settings.kinsoku,
        autoTcy: selection.settings.autoTcy,
        chrome: composeBookChrome(selection.settings, parsed.meta),
      });
      artifacts.push({ path: childUri(target.outDirUri, `${outRel}.html`), content: html });
    }
  }
}

/**
 * Resolves one configured project dir against its root: a contained relative path becomes
 * its absolute URI; anything invalid (empty / absolute / escaping / `.` …) silently falls
 * back to the default. The `'jpbookEntry'` label is a placeholder — a failed resolution
 * is discarded here, never rendered.
 */
function resolveProjectDir(rootUri: string, value: string, fallback: string): string {
  const resolved = resolveContained(rootUri, value, 'jpbookEntry');
  // The defaults are single-segment relative paths, so this join cannot escape the root.
  return resolved.ok ? resolved.abs : childUri(rootUri, fallback.replace(/^\.\//, ''));
}

/**
 * The roots a request targets: every `projectDirs` entry (narrowed to `root` when set),
 * each with its output dir resolved. The map is the SOLE source of buildable roots.
 */
function targetRoots(projectDirs: ProjectDirsMap, root?: string): ProjectRoot[] {
  const wanted = root === undefined ? undefined : normalizeRootUri(root);
  const targets: ProjectRoot[] = [];
  for (const [rawUri, dirs] of Object.entries(projectDirs)) {
    const rootUri = normalizeRootUri(rawUri);
    if (wanted !== undefined && rootUri !== wanted) {
      continue;
    }
    targets.push({
      rootUri,
      outDirUri: resolveProjectDir(rootUri, dirs.outDir, PROJECT_DEFAULT.outDir),
    });
  }
  return targets;
}

/**
 * Handles `jpnov/build`. Omitting `root` builds every root in `projectDirs`. Reports coarse
 * `$/progress` via the supplied work-done reporter (one tick per root). The result is
 * `ok` when no build-level errors were collected; per-book errors are surfaced in
 * `errors[]` and as diagnostics on each offending `.jpbook`.
 */
export async function handleBuild(
  ctx: ServerContext,
  params: BuildParams,
  progress?: WorkDoneProgressReporter,
): Promise<BuildResult> {
  const roots = targetRoots(params.projectDirs, params.root);
  const artifacts: BuildArtifact[] = [];
  const errors: BuildError[] = [];

  // `books` ABSENT => build every discovered book; PRESENT (even empty `[]`, which is truthy)
  // => restrict to exactly that set, so an empty selection legitimately builds nothing.
  // Settings are re-resolved once here (clamp + enum coercion of the untrusted payload)
  // and shared by every root in this build.
  const selection: BuildSelection = {
    books: params.books ? new Set(params.books) : undefined,
    format: params.format,
    settings: resolveHtmlSettings(params.settings),
  };

  // The server cannot localize a $/progress title (no vscode.l10n in the fork); the client shows
  // its own localized progress notification, so begin with no English label.
  progress?.begin('', 0, undefined, false);

  let done = 0;
  for (const target of roots) {
    try {
      await buildRoot(ctx, target, selection, artifacts, errors);
    } catch (cause) {
      errors.push({ book: target.rootUri, ...toBuildMessage(cause) });
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
 * Handles `jpnov/listBooks`: enumerates every `*.jpbook` under each targeted root as a
 * {@link BookEntry} for the client's Books panel. Each file is read ONCE for its
 * front-matter `title` (display metadata; an unreadable file simply lists untitled) — but
 * no diagnostics and no output-path collision check (those belong to an actual build).
 */
export async function handleListBooks(params: ListBooksParams): Promise<ListBooksResult> {
  const books: BookEntry[] = [];
  for (const target of targetRoots(params.projectDirs, params.root)) {
    for (const fl of await discoverJpbooks(target.rootUri, target.outDirUri)) {
      const bytes = await readFile(fileURLToPath(fl.uri)).catch(() => null as Buffer | null);
      const title = bytes === null ? undefined : parseJpbook(UTF8.decode(bytes)).meta.title;
      books.push({
        uri: fl.uri,
        rootUri: target.rootUri,
        fileRel: fl.fileRel,
        outRel: jpbookOutRel(fl.fileRel),
        ...(title !== undefined && title !== '' ? { title } : {}),
      });
    }
  }
  return { books };
}
