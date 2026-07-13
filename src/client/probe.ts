/**
 * The startup probe: decides whether one workspace folder looks like a novel project, so
 * `startIfProjectPresent` (extension.ts) can fork the server without any document open.
 *
 * Two signals, cheapest first:
 *  1. Settings presence — any `jpnov.*` key saved at the WORKSPACE or FOLDER level (never
 *     the user level: a personal cast list in user settings must not auto-start every
 *     window). Synchronous, zero I/O — one section-level `inspect('jpnov')`.
 *  2. Filenames — one shallow `readDirectory` of the folder root matching a root-level
 *     `*.filelist` that is a PLAIN FILE (strict FileType.File: a directory named
 *     `x.filelist` is no book, and symlinks match the server's discovery, which never
 *     follows them). A single round-trip matters on remote/virtual filesystems; deeper
 *     filelists still start the server the moment a document opens.
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
  return entries.some(
    ([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.filelist'),
  );
}
