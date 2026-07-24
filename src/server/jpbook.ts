/**
 * The impure (`node:fs`) half of the `*.jpbook` support: the single place where the pure
 * grammar/naming/completion logic in `#/shared/book/jpbook.ts` meets the filesystem. It
 * provides the three live editor features — diagnostics, completion, and document links —
 * and is also reused by the build (`build.ts`) so a `.jpbook`'s line-level diagnostics are
 * computed by exactly one code path. Callers parse once (`parseJpbook`) and hand the result
 * in, so an event never parses the same text twice.
 *
 * Entries are relative to the book's OWNING WORKSPACE FOLDER root (`rootUri`), which every
 * function takes explicitly — the live handlers look it up via `context.roots.rootOf`, the
 * build passes its target root. A null root (a `.jpbook` outside every workspace folder)
 * degrades to syntax/metadata-only: no containment or existence checks, no links, no path
 * completion. Filesystem access is `file:`-scheme only (the server never touches
 * `vscode.fs`); a non-`file:` root degrades the same way existence-wise, and front-matter
 * completion (fs-free) works everywhere.
 *
 * vscode-free: only `import type`/value-imports of the language-SERVER package (never the
 * `vscode` module) are used here.
 */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CompletionItemKind, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { CompletionItem, Diagnostic, DocumentLink, Range } from 'vscode-languageserver/node';

import {
  colonIndex,
  completeEntryLine,
  completeMetaLine,
  metaKeyOf,
  metaRegionOf,
  type JpbookCompletion,
  type ParsedJpbook,
  type ParsedLine,
} from '#/shared/book/jpbook.ts';
import { resolveContained } from '#/shared/config/validate.ts';
import { unencodableChars } from '#/shared/encoding.ts';

import { diagnostic } from './diagnostics.ts';
import { isFileScheme } from './fsUri.ts';

/** The on-line span of a parsed line as an LSP {@link Range}. */
function lineRange(pl: ParsedLine): Range {
  return {
    start: { line: pl.line, character: pl.range.startChar },
    end: { line: pl.line, character: pl.range.endChar },
  };
}

/**
 * Warns for each character of a `divider` value that Shift JIS cannot hold. Only `divider` is
 * checked: it is the one front-matter value that reaches the built `.txt`, and it repeats at every
 * chapter seam. This is manifest validation like every other `jpbook.*` diagnostic, NOT the
 * `shiftJisSafe` prose rule — that one never sees a `.jpbook`, and a divider is a symbol rather
 * than a character an author mistyped.
 */
function dividerEncodingWarnings(pl: ParsedLine): Diagnostic[] {
  if (metaKeyOf(pl.value) !== 'divider') {
    return [];
  }
  const afterColon = pl.value.slice(colonIndex(pl.value) + 1);
  // Offset of the trimmed value within the line, so each range lands on the character itself.
  const base = pl.range.startChar + (pl.value.length - afterColon.length) +
    (afterColon.length - afterColon.trimStart().length);
  return unencodableChars(afterColon.trim()).map(({ cluster, offset, length }) => diagnostic(
    {
      start: { line: pl.line, character: base + offset },
      end: { line: pl.line, character: base + offset + length },
    },
    { code: 'jpbook.dividerNotEncodable', args: [cluster] },
    DiagnosticSeverity.Warning,
  ));
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
 * {@link parseJpbook}'s line kinds), then — root permitting — containment/escape rejections
 * (via {@link resolveContained}) and, on a `file:` root, existence (a missing path or one
 * resolving to a directory is an Error). Used by both the live editor handler and the
 * build, so the two never disagree.
 */
export async function diagnoseJpbook(rootUri: string | null, parsed: ParsedJpbook): Promise<Diagnostic[]> {
  const canCheckFs = rootUri !== null && isFileScheme(rootUri);
  const diagnostics: Diagnostic[] = [];

  for (const pl of parsed.lines) {
    if (pl.kind === 'meta') {
      diagnostics.push(...dividerEncodingWarnings(pl));
      continue;
    }
    if (pl.kind === 'blank' || pl.kind === 'fence') {
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
    if (rootUri === null) {
      continue; // no owning workspace folder — containment/existence unverifiable
    }
    const resolved = resolveContained(rootUri, pl.value, 'jpbookEntry');
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
 * line (`ok`/`duplicate`), pointing at the root-resolved file URI. Blank, front-matter,
 * error/warning lines — and every line when no root owns the book — get no link. No fs
 * access: links resolve as URIs and are cheap, so a not-yet-existing target still links
 * (its squiggle says so).
 */
export function documentLinksForJpbook(rootUri: string | null, parsed: ParsedJpbook): DocumentLink[] {
  if (rootUri === null) {
    return [];
  }
  const links: DocumentLink[] = [];
  for (const pl of parsed.lines) {
    if (pl.kind !== 'ok' && pl.kind !== 'duplicate') {
      continue;
    }
    const resolved = resolveContained(rootUri, pl.value, 'jpbookEntry');
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
 * it works with or without a root. On chapter lines it lists the directory the current
 * path prefix points into (relative to the OWNING ROOT) and hands it to the pure
 * {@link completeEntryLine}; that path returns nothing without a `file:` root, or when the
 * whole line already names an existing file with the cursor at its end (per the "no more
 * suggestions once the line matches" rule). Folder items re-trigger suggestions so the
 * user keeps drilling.
 */
export async function completeJpbook(
  rootUri: string | null,
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

  if (rootUri === null || !isFileScheme(rootUri)) {
    return [];
  }

  // Suppress when nothing meaningful follows the cursor and the line already names a file.
  const whole = lineText.trim();
  if (whole !== '' && prefix.trim() === whole) {
    const resolvedWhole = resolveContained(rootUri, whole, 'jpbookEntry');
    if (resolvedWhole.ok && (await statEntry(resolvedWhole.abs)) === 'file') {
      return [];
    }
  }

  const pathSoFar = prefix.replace(/^\s+/, '');

  // A leading "/" is an absolute path — never a valid entry — so offer nothing rather than
  // misleadingly listing the workspace folder root.
  if (pathSoFar.startsWith('/')) {
    return [];
  }

  const lastSlash = pathSoFar.lastIndexOf('/');
  const dirPortion = lastSlash >= 0 ? pathSoFar.slice(0, lastSlash) : '';

  let listDirUri: string;
  if (dirPortion === '' || dirPortion === '.') {
    // No directory part, or an explicit "./" — list the workspace folder root itself.
    listDirUri = rootUri;
  } else {
    // The label is irrelevant here — a containment failure just yields no completions.
    const resolvedDir = resolveContained(rootUri, dirPortion, 'jpbookEntry');
    if (!resolvedDir.ok) {
      return [];
    }
    listDirUri = resolvedDir.abs;
  }

  const entries = await readDirEntries(listDirUri);
  return completeEntryLine(prefix, entries).map((c) => toCompletionItem(c, position.line));
}
