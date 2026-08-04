/**
 * `jpbook.createBook` — the guided new-book wizard: folder (multi-root only) → title →
 * chapters (the shared picker) → write `<title>.jpbook` at the folder root → reveal the
 * new book's detail screen. Any dismissed step aborts with nothing written.
 */
import * as vscode from 'vscode';

import { newBookText, sanitizeBookStem } from '#/shared/book/create.ts';

import { findChapterCandidates, pickChapterFiles } from './manage.ts';
import type { BooksViewProvider } from './view.ts';

/** The target file name, or undefined when the title reduces to nothing usable. */
function bookFileName(title: string): string | undefined {
  const stem = sanitizeBookStem(title);
  return stem === '' ? undefined : `${stem}.jpbook`;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Japanese Novel: open a folder first, then create a book.'));
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({
    placeHolder: vscode.l10n.t('Select a folder for the new book'),
    ignoreFocusOut: true,
  });
}

async function inputTitle(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: vscode.l10n.t('Title of the new book'),
    ignoreFocusOut: true,
    validateInput: async (value) => {
      const fileName = bookFileName(value);
      if (fileName === undefined) {
        return value.trim() === ''
          ? vscode.l10n.t('Enter a title')
          : vscode.l10n.t('This title cannot be used as a file name');
      }
      return (await fileExists(vscode.Uri.joinPath(folder.uri, fileName)))
        ? vscode.l10n.t('{0} already exists in this folder', fileName)
        : null;
    },
  });
}

/** The wizard body (`jpbook.createBook`); `view` reveals the created book's detail. */
export async function createBook(view: BooksViewProvider | undefined): Promise<void> {
  const folder = await pickFolder();
  if (folder === undefined) {
    return;
  }
  const title = await inputTitle(folder);
  if (title === undefined) {
    return;
  }
  // The validator is advisory: re-derive here, and re-probe the target just before the
  // write — the file may have appeared while the prompts were open.
  const fileName = bookFileName(title);
  if (fileName === undefined) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Japanese Novel: this title cannot be used as a file name.'));
    return;
  }

  const candidates = await findChapterCandidates(folder.uri);
  let chapters: readonly string[] = [];
  if (candidates.length > 0) {
    const picked = await pickChapterFiles(candidates, { ignoreFocusOut: true });
    if (picked === undefined) {
      return;
    }
    chapters = picked;
  }

  const target = vscode.Uri.joinPath(folder.uri, fileName);
  if (await fileExists(target)) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Japanese Novel: {0} already exists; creation was cancelled.', fileName),
    );
    return;
  }
  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(newBookText(title, chapters), 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(vscode.l10n.t("Japanese Novel: couldn't write {0}. {1}", fileName, message));
    return;
  }
  await view?.revealNewBook(folder.uri, fileName);
}
