/**
 * The vscode half of rename tracking: listens to `workspace.onDidRenameFiles` (AFTER the
 * rename — `onWillRenameFiles` participants run under a time budget that forbids prompting),
 * plans the reference updates via the pure `bookRename.ts`, asks per the
 * `jpnov.book.updateReferencesOnFileMove` setting (`prompt`/`always`/`never`, the TS
 * `updateImportsOnFileMove` triad — the toast's Always/Never buttons persist it globally),
 * and applies ONE `WorkspaceEdit` across every affected `.jpbook`. Edited books are left
 * dirty for the author to save, matching the platform convention.
 *
 * Renames from outside VS Code (Finder, terminal, git) fire no event; the standing
 * `jpbook.fileNotFound` diagnostics are the net for those.
 */
import * as vscode from 'vscode';

import { normalizeFsPath, planBookEdits, type BookEditPlan, type FileRename } from './bookRename.ts';
import { lastPathSegment } from './paths.ts';

const SETTING = 'jpnov.book.updateReferencesOnFileMove';

type Mode = 'prompt' | 'always' | 'never';

function currentMode(): Mode {
  const v = vscode.workspace.getConfiguration().get<string>(SETTING, 'prompt');
  return v === 'always' || v === 'never' ? v : 'prompt';
}

function persistMode(value: Mode): Thenable<void> {
  return vscode.workspace.getConfiguration().update(SETTING, value, vscode.ConfigurationTarget.Global);
}

/** Books the event touches, each with its computed plan (empty plans dropped). */
async function planAffectedBooks(
  renames: readonly FileRename[],
): Promise<{ uri: vscode.Uri; plan: BookEditPlan }[]> {
  // Same exclusions as the startup probe; the server-side walk stays the build's arbiter.
  const books = await vscode.workspace.findFiles('**/*.jpbook', '**/{node_modules,.*}/**');
  const affected: { uri: vscode.Uri; plan: BookEditPlan }[] = [];
  for (const uri of books) {
    // Entries are root-relative: a book outside every workspace folder has no base at all
    // (the server degrades it to syntax-only the same way), so there is nothing to update.
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder === undefined) {
      continue;
    }
    let doc: vscode.TextDocument;
    try {
      // openTextDocument yields the LIVE buffer when the book is open (dirty edits included).
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      continue; // unreadable (gone mid-event) — nothing to update
    }
    const plan = planBookEdits(normalizeFsPath(folder.uri.fsPath), doc.getText(), renames);
    if (plan.edits.length > 0 || plan.unrepresentable.length > 0) {
      affected.push({ uri, plan });
    }
  }
  return affected;
}

/** The prompt-mode toast; resolves to whether the update should proceed. */
async function askUser(bookCount: number): Promise<boolean> {
  const update = vscode.l10n.t('Update');
  const always = vscode.l10n.t('Always Update');
  const never = vscode.l10n.t('Never Update');
  // l10n.t has no plural support, so branch into a singular/plural pair of bundle keys;
  // Japanese maps both to one (number-invariant) string.
  const message = bookCount === 1
    ? vscode.l10n.t('Japanese Novel: a chapter file was renamed or moved — update the paths in 1 book file?')
    : vscode.l10n.t('Japanese Novel: chapter files were renamed or moved — update the paths in {0} book files?', String(bookCount));
  const pick = await vscode.window.showInformationMessage(message, update, always, never);
  if (pick === always) {
    await persistMode('always');
    return true;
  }
  if (pick === never) {
    await persistMode('never');
    return false;
  }
  return pick === update; // dismissed -> skip this once, keep asking next time
}

async function handleRenames(e: vscode.FileRenameEvent): Promise<void> {
  if (currentMode() === 'never') {
    return;
  }
  const renames: FileRename[] = e.files
    .filter((f) => f.oldUri.scheme === 'file' && f.newUri.scheme === 'file')
    .map((f) => ({ oldPath: normalizeFsPath(f.oldUri.fsPath), newPath: normalizeFsPath(f.newUri.fsPath) }));
  if (renames.length === 0) {
    return;
  }

  const affected = await planAffectedBooks(renames);
  const editable = affected.filter((a) => a.plan.edits.length > 0);

  let applied = false;
  if (editable.length > 0) {
    const proceed = currentMode() === 'always' || (await askUser(editable.length));
    if (proceed) {
      const edit = new vscode.WorkspaceEdit();
      for (const { uri, plan } of editable) {
        for (const ed of plan.edits) {
          edit.replace(uri, new vscode.Range(ed.line, ed.startChar, ed.line, ed.endChar), ed.newText);
        }
      }
      applied = await vscode.workspace.applyEdit(edit);
    }
  }

  // Entries that left the workspace folder cannot be rewritten into a valid path; explain
  // the incoming red squiggle — but not when the user just declined the whole update.
  const skipped = affected.filter((a) => a.plan.unrepresentable.length > 0);
  if (skipped.length > 0 && (applied || editable.length === 0)) {
    const names = skipped.map((a) => lastPathSegment(a.uri.toString())).join(', ');
    // UI notification: showWarningMessage never rejects, so void is safe.
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Japanese Novel: couldn't update {0} — the moved file's new location is outside the workspace folder.",
        names,
      ),
    );
  }
}

/** Registers the tracker; called once from `ensureStarted()` (novel workspaces only). */
export function registerRenameTracking(): vscode.Disposable {
  return vscode.workspace.onDidRenameFiles((e) => {
    // Fire-and-forget: a tracker failure must never surface as an unhandled rejection.
    handleRenames(e).catch(() => undefined);
  });
}
