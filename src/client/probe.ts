/**
 * The startup probe: decides whether one workspace folder looks like a novel project, so
 * `startIfProjectPresent` (extension.ts) can fork the server without any document open.
 *
 * Three signals, cheapest first:
 *  1. Settings presence — any `jpnov.*` key saved at the WORKSPACE or FOLDER level (never
 *     the user level: a personal cast list in user settings must not auto-start every
 *     window). Synchronous, zero I/O — one section-level `inspect('jpnov')`.
 *  2. Filenames — one shallow `readDirectory` of the folder root matching a root-level
 *     `*.filelist` that is a PLAIN FILE (strict FileType.File: a directory named
 *     `x.filelist` is no book, and symlinks match the server's discovery, which never
 *     follows them). A single round-trip; also the only file signal on virtual
 *     filesystems without a search provider (signal 3 needs one).
 *  3. Deep search — one `findFiles` capped at a single match, for filelists that live
 *     only in subfolders. Excludes node_modules and dot-directories like the server's
 *     discovery; its deltas (symlinked matches, no outDir exclusion, glob case rules)
 *     can only cause a benign start — the server stays the arbiter of what is a book.
 *
 * Beyond that, name-only membership — the server is the robust arbiter.
 */
import * as vscode from 'vscode';

export async function folderIsNovelProject(
  folder: vscode.WorkspaceFolder,
): Promise<boolean> {
  const insp = vscode.workspace
    .getConfiguration(undefined, folder.uri)
    .inspect('jpnov');
  if (insp !== undefined && (insp.workspaceValue !== undefined || insp.workspaceFolderValue !== undefined)) {
    return true;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folder.uri);
  } catch {
    return false; // unreadable root (gone, permission, exotic scheme) -> not a novel root
  }
  if (entries.some(
    ([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.filelist'),
  )) {
    return true;
  }

  try {
    const nested = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*.filelist'),
      '**/{node_modules,.*}/**',
      1,
    );
    return nested.length > 0;
  } catch {
    return false; // no search provider / search failed -> the other start triggers still cover us
  }
}
