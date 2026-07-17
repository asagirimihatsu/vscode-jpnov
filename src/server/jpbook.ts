/**
 * The impure (`node:fs`) half of the `*.jpbook` support: the single place where the pure
 * grammar/naming/completion logic in `#/shared/book/jpbook.ts` meets the filesystem. It
 * provides the three live editor features — diagnostics, completion, and document links —
 * and is also reused by the build (`build.ts`) so a `.jpbook`'s line-level diagnostics are
 * computed by exactly one code path. Callers parse once (`parseJpbook`) and hand the result
 * in, so an event never parses the same text twice.
 *
 * Filesystem access is `file:`-scheme only (the server never touches `vscode.fs`), matching
 * the build's existing posture: on a non-`file:` scheme, existence cannot be verified, so
 * diagnostics fall back to syntax-only and path completion returns nothing (front-matter
 * completion is fs-free and still works).
 *
 * vscode-free: only `import type`/value-imports of the language-SERVER package (never the
 * `vscode` module) are used here.
 */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CompletionItemKind, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { CompletionItem, Diagnostic, DocumentLink, Range } from 'vscode-languageserver/node';

import {
  completeEntryLine,
  completeMetaLine,
  metaRegionOf,
  type JpbookCompletion,
  type ParsedJpbook,
  type ParsedLine,
} from '#/shared/book/jpbook.ts';
import { resolveContained } from '#/shared/config/validate.ts';

import { diagnostic } from './diagnostics.ts';
import { isFileScheme } from './fsUri.ts';

/** The directory URI containing `fileUri` (no trailing slash). */
function dirUriOf(fileUri: string): string {
  const slash = fileUri.lastIndexOf('/');
  return slash <= 0 ? fileUri : fileUri.slice(0, slash);
}

/** The on-line span of a parsed line as an LSP {@link Range}. */
function lineRange(pl: ParsedLine): Range {
  return {
    start: { line: pl.line, character: pl.range.startChar },
    end: { line: pl.line, character: pl.range.endChar },
  };
}

/** Classifies a `file:` URI on disk; any error (incl. ENOENT) is `'missing'`. */
async function statEntry(uri: string): Promise<'file' | 'dir' | 'missing'> {
  try {
    const s = await stat(fileURLToPath(uri));
    return s.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'missing';
  }
}

async function readDirEntries(dirUri: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const dirents = await readdir(fileURLToPath(dirUri), { withFileTypes: true });
    return dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch {
    return [];
  }
}

/**
 * Per-line diagnostics for one parsed `.jpbook`: syntax/metadata errors and warnings (from
 * {@link parseJpbook}'s line kinds), containment/escape rejections (via
 * {@link resolveContained}), duplicate warnings, and — on `file:` only — existence (a
 * missing path or one resolving to a directory is an Error). Used by both the live editor
 * handler and the build, so the two never disagree.
 */
export async function diagnoseJpbook(jpbookUri: string, parsed: ParsedJpbook): Promise<Diagnostic[]> {
  const dir = dirUriOf(jpbookUri);
  const canCheckFs = isFileScheme(jpbookUri);
  const diagnostics: Diagnostic[] = [];

  for (const pl of parsed.lines) {
    if (pl.kind === 'blank' || pl.kind === 'fence' || pl.kind === 'meta') {
      continue;
    }
    const range = lineRange(pl);
    if (typeof pl.kind === 'object') {
      if ('error' in pl.kind) {
        diagnostics.push(diagnostic(range, pl.kind.error, DiagnosticSeverity.Error));
      } else {
        diagnostics.push(diagnostic(range, pl.kind.warning, DiagnosticSeverity.Warning));
      }
      continue;
    }
    if (pl.kind === 'duplicate') {
      diagnostics.push(
        diagnostic(range, { code: 'jpbook.duplicateEntry', args: [pl.value] }, DiagnosticSeverity.Warning),
      );
      continue;
    }
    const resolved = resolveContained(dir, pl.value, 'jpbookEntry');
    if (!resolved.ok) {
      diagnostics.push(diagnostic(range, { code: resolved.code, args: resolved.args }, DiagnosticSeverity.Error));
      continue;
    }
    if (!canCheckFs) {
      continue; // existence unverifiable off `file:` — leave the path un-flagged.
    }
    const verdict = await statEntry(resolved.abs);
    if (verdict === 'missing') {
      diagnostics.push(diagnostic(range, { code: 'jpbook.fileNotFound', args: [pl.value] }, DiagnosticSeverity.Error));
    } else if (verdict === 'dir') {
      diagnostics.push(
        diagnostic(range, { code: 'jpbook.entryIsDirectory', args: [pl.value] }, DiagnosticSeverity.Error),
      );
    }
  }
  return diagnostics;
}

/**
 * Cmd+click targets: one {@link DocumentLink} per syntactically-valid, contained chapter
 * line (`ok`/`duplicate`), pointing at the resolved file URI. Blank, front-matter, and
 * error/warning lines get no link (the diagnostic already flags the latter). No fs access —
 * links resolve as URIs and are cheap, so a not-yet-existing target still links (its
 * squiggle says so).
 */
export function documentLinksForJpbook(jpbookUri: string, parsed: ParsedJpbook): DocumentLink[] {
  const dir = dirUriOf(jpbookUri);
  const links: DocumentLink[] = [];
  for (const pl of parsed.lines) {
    if (pl.kind !== 'ok' && pl.kind !== 'duplicate') {
      continue;
    }
    const resolved = resolveContained(dir, pl.value, 'jpbookEntry');
    if (resolved.ok) {
      links.push({ range: lineRange(pl), target: resolved.abs });
    }
  }
  return links;
}

/** A pure {@link JpbookCompletion} as an LSP {@link CompletionItem} on `line`. */
function toCompletionItem(c: JpbookCompletion, line: number): CompletionItem {
  const kind =
    c.kind === 'folder'
      ? CompletionItemKind.Folder
      : c.kind === 'key'
        ? CompletionItemKind.Property
        : c.kind === 'value'
          ? CompletionItemKind.EnumMember
          : CompletionItemKind.File;
  const item: CompletionItem = {
    label: c.label,
    kind,
    textEdit: {
      range: {
        start: { line, character: c.replace.startChar },
        end: { line, character: c.replace.endChar },
      },
      newText: c.insertText,
    },
  };
  if (c.kind === 'folder') {
    item.command = { title: 'Suggest', command: 'editor.action.triggerSuggest' };
  }
  return item;
}

/**
 * Completions for the cursor on `lineText` at `position`. Inside the front-matter region
 * (strictly between the fences) it offers metadata keys / enum values — pure, fs-free, so
 * it works on any scheme. On chapter lines it lists the directory the current path prefix
 * points into (relative to the `.jpbook`'s own dir) and hands it to the pure
 * {@link completeEntryLine}; that path returns nothing off `file:`, or when the whole line
 * already names an existing file with the cursor at its end (per the "no more suggestions
 * once the line matches" rule). Folder items re-trigger suggestions so the user keeps drilling.
 */
export async function completeJpbook(
  jpbookUri: string,
  parsed: ParsedJpbook,
  lineText: string,
  position: { line: number; character: number },
): Promise<CompletionItem[]> {
  const prefix = lineText.slice(0, position.character);

  const region = metaRegionOf(parsed.lines);
  if (region !== null && position.line >= region.open) {
    const inMeta = position.line > region.open && (region.close === null || position.line < region.close);
    if (inMeta) {
      return completeMetaLine(prefix).map((c) => toCompletionItem(c, position.line));
    }
    if (position.line === region.open || position.line === region.close) {
      return []; // on a fence line — nothing sensible to offer.
    }
  }

  if (!isFileScheme(jpbookUri)) {
    return [];
  }
  const dir = dirUriOf(jpbookUri);

  // Suppress when nothing meaningful follows the cursor and the line already names a file.
  const whole = lineText.trim();
  if (whole !== '' && prefix.trim() === whole) {
    const resolvedWhole = resolveContained(dir, whole, 'jpbookEntry');
    if (resolvedWhole.ok && (await statEntry(resolvedWhole.abs)) === 'file') {
      return [];
    }
  }

  const pathSoFar = prefix.replace(/^\s+/, '');

  // A leading "/" is an absolute path — never a valid entry — so offer nothing rather than
  // misleadingly listing the `.jpbook`'s own directory.
  if (pathSoFar.startsWith('/')) {
    return [];
  }

  const lastSlash = pathSoFar.lastIndexOf('/');
  const dirPortion = lastSlash >= 0 ? pathSoFar.slice(0, lastSlash) : '';

  let listDirUri: string;
  if (dirPortion === '' || dirPortion === '.') {
    // No directory part, or an explicit "./" — list the `.jpbook`'s own directory.
    listDirUri = dir;
  } else {
    // The label is irrelevant here — a containment failure just yields no completions.
    const resolvedDir = resolveContained(dir, dirPortion, 'jpbookEntry');
    if (!resolvedDir.ok) {
      return [];
    }
    listDirUri = resolvedDir.abs;
  }

  const entries = await readDirEntries(listDirUri);
  return completeEntryLine(prefix, entries).map((c) => toCompletionItem(c, position.line));
}
