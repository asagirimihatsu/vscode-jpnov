/**
 * The Books panel's management commands — tree-as-form editing over the `.jpbook` TEXT.
 * Every action plans precise range edits via the pure `#/shared/book/edits.ts`, applies
 * them as one `WorkspaceEdit`, and SAVES immediately (settings-UI semantics: a panel
 * action persists on the spot; the saved file then re-enters through the panel's own
 * watcher, so no manual refresh plumbing exists here). Metadata is upsert-only: the five
 * keys are always shown and never deleted or reordered — layout-conscious authors use
 * code mode.
 */
import * as vscode from 'vscode';

import { appendChapters, chapterLines, moveChapterTo, removeChapter, upsertMeta } from '#/shared/book/edits.ts';
import type { TextReplace } from '#/shared/book/edits.ts';
import { composeDividerValue, DIVIDER_PRESETS, parseDividerValue, parseJpbook, type MetaKey } from '#/shared/book/jpbook.ts';
import { PAGE_NUMBER_POSITIONS, type PageNumberPosition } from '#/shared/compiler/chrome.ts';
import { BUILD_CHROME_DEFAULT } from '#/shared/config/settings.ts';
import { unencodableChars } from '#/shared/encoding.ts';
import type { BookEntry } from '#/shared/protocol.ts';

import { command } from '../commands.ts';
import { renderMessage } from '../messages.ts';
import { normalizeFsPath } from './rename.ts';
import type { BookNode } from './nodes.ts';

/** Localized display name of a metadata key (the meta row's label and edit prompt). */
export function metaLabel(key: MetaKey): string {
  switch (key) {
    case 'title':
      return vscode.l10n.t('Title');
    case 'header':
      return vscode.l10n.t('Header');
    case 'pageNumber':
      return vscode.l10n.t('Page Number');
    case 'pageNumberFormat':
      return vscode.l10n.t('Page Number Format');
    case 'divider':
      return vscode.l10n.t('Chapter Divider');
  }
}

/** Localized display of one folio-position member (QuickPick items and meta-row values). */
function positionLabel(value: PageNumberPosition): string {
  switch (value) {
    case 'right':
      return vscode.l10n.t('Always bottom-right');
    case 'left':
      return vscode.l10n.t('Always bottom-left');
    case 'rightLeft':
      return vscode.l10n.t('Alternate: right, then left');
    case 'leftRight':
      return vscode.l10n.t('Alternate: left, then right');
    case 'none':
      return vscode.l10n.t('No page number');
  }
}

/** The meta row's value text: the set value, the annotated default, or "not set". */
export function metaValueLabel(key: MetaKey, value: string | undefined): string {
  const display = (v: string): string => (key === 'pageNumber' ? positionLabel(v as PageNumberPosition) : v);
  if (value !== undefined) {
    return display(value);
  }
  if (key === 'title' || key === 'divider') {
    return vscode.l10n.t('(not set)'); // no default: absent = no divider / no title
  }
  const fallback =
    key === 'header'
      ? BUILD_CHROME_DEFAULT.header
      : key === 'pageNumber'
        ? BUILD_CHROME_DEFAULT.pageNumber
        : BUILD_CHROME_DEFAULT.pageNumberFormat;
  return fallback === ''
    ? vscode.l10n.t('(not set)')
    : vscode.l10n.t('{0} (default)', display(fallback));
}

/** Applies planned replaces and saves — the panel's watcher does the refresh. */
export async function applyBookEdits(uri: vscode.Uri, replaces: readonly TextReplace[]): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (const r of replaces) {
    edit.replace(uri, new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character), r.newText);
  }
  if (await vscode.workspace.applyEdit(edit)) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    await doc?.save();
  }
}

/** The book's live text (dirty buffer included) — every planner starts from this. */
async function bookText(entry: BookEntry): Promise<{ uri: vscode.Uri; text: string }> {
  const uri = vscode.Uri.parse(entry.uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  return { uri, text: doc.getText() };
}

function nodeOf(arg: unknown): BookNode | null {
  return typeof arg === 'object' && arg !== null && 'kind' in arg ? (arg as BookNode) : null;
}

async function addChapters(arg: unknown): Promise<void> {
  const node = nodeOf(arg);
  if (node?.kind !== 'book') {
    return;
  }
  const rootUri = vscode.Uri.parse(node.entry.rootUri);
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    defaultUri: rootUri,
    openLabel: vscode.l10n.t('Add'),
    filters: { 'Japanese Novel': ['jpnov'] },
  });
  if (picked === undefined || picked.length === 0) {
    return;
  }

  // Entries are root-relative, so only files under THIS book's workspace folder qualify.
  const rels: string[] = [];
  let outside = 0;
  for (const uri of picked) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder?.uri.toString().replace(/\/$/, '') !== node.entry.rootUri) {
      outside += 1;
      continue;
    }
    rels.push(normalizeFsPath(vscode.workspace.asRelativePath(uri, false)));
  }
  if (outside > 0) {
    // UI notification: showWarningMessage never rejects, so void is safe.
    void vscode.window.showWarningMessage(
      vscode.l10n.t('Japanese Novel: {0} file(s) were skipped — chapters must live in the same workspace folder as the book.', String(outside)),
    );
  }
  if (rels.length === 0) {
    return;
  }

  const { uri, text } = await bookText(node.entry);
  const edit = appendChapters(text, rels);
  if (edit === null) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Japanese Novel: already in this book.'));
    return;
  }
  await applyBookEdits(uri, [edit]);
}

async function removeChapterCmd(arg: unknown): Promise<void> {
  const node = nodeOf(arg);
  if (node?.kind !== 'chapter') {
    return;
  }
  const { uri, text } = await bookText(node.entry);
  const edit = removeChapter(text, node.line);
  if (edit !== null) {
    await applyBookEdits(uri, [edit]);
  }
}

async function moveChapter(arg: unknown, direction: -1 | 1): Promise<void> {
  const node = nodeOf(arg);
  if (node?.kind !== 'chapter') {
    return;
  }
  const { uri, text } = await bookText(node.entry);
  const lines = chapterLines(parseJpbook(text).lines);
  const index = lines.indexOf(node.line);
  if (index < 0) {
    return;
  }
  // Up: insert before the previous chapter. Down: insert before the one PAST the next
  // (or at the end when the next chapter is the last).
  const before =
    direction === -1
      ? lines[index - 1]
      : index + 2 < lines.length
        ? lines[index + 2]
        : null;
  if (before === undefined || (direction === 1 && index + 1 >= lines.length)) {
    return; // already first / already last
  }
  const edits = moveChapterTo(text, node.line, before);
  if (edits !== null) {
    await applyBookEdits(uri, edits);
  }
}

/**
 * Two-step divider flow: pick the mark (presets / custom input), then its position — a bare
 * value is centred at build time, a ［＃○字下げ］ prefix indents (the value grammar lives in
 * parseDividerValue/composeDividerValue). Any step dismissed = whole edit dismissed.
 */
async function pickDivider(current: string | undefined): Promise<string | undefined> {
  const parsed = current !== undefined && current !== '' ? parseDividerValue(current) : null;

  type MarkItem = vscode.QuickPickItem & { pick: 'none' | 'preset' | 'custom' };
  const markItems: MarkItem[] = [
    { label: vscode.l10n.t('(none)'), pick: 'none' },
    ...DIVIDER_PRESETS.map((m): MarkItem => ({ label: m, pick: 'preset' })),
    { label: vscode.l10n.t('Custom mark…'), pick: 'custom' },
  ];
  const markPick = await vscode.window.showQuickPick(markItems, {
    placeHolder: vscode.l10n.t('Divider between chapters without a heading'),
  });
  if (markPick === undefined) {
    return undefined;
  }
  if (markPick.pick === 'none') {
    return ''; // upsert-only: the row stays, with an empty value
  }
  let mark = markPick.label;
  if (markPick.pick === 'custom') {
    const typed = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Divider mark'),
      value: parsed?.mark ?? '',
      validateInput: (v) => {
        const mark = v.trim();
        if (mark === '') {
          return vscode.l10n.t('Enter a divider mark');
        }
        // The divider repeats at every chapter seam, so one unencodable mark would 〓 the whole
        // book. Refused here; a hand-edited `.jpbook` is caught by `diagnoseJpbook` instead.
        const unencodable = unencodableChars(mark)[0];
        return unencodable === undefined
          ? null
          : renderMessage({ code: 'jpbook.dividerNotEncodable', args: [unencodable.cluster] });
      },
    });
    if (typed === undefined) {
      return undefined;
    }
    mark = typed.trim();
  }

  type PosItem = vscode.QuickPickItem & { indented: boolean };
  const posItems: PosItem[] = [
    {
      label: vscode.l10n.t('Centred'),
      description: vscode.l10n.t('A ［＃○字下げ］ computed from the line length at build time'),
      indented: false,
    },
    { label: vscode.l10n.t('Indented'), description: '［＃○字下げ］', indented: true },
  ];
  const posPick = await vscode.window.showQuickPick(posItems, {
    placeHolder: vscode.l10n.t('Position of the divider in its line'),
  });
  if (posPick === undefined) {
    return undefined;
  }
  if (!posPick.indented) {
    return mark;
  }
  const amount = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Indent (full-width cells)'),
    value: String(parsed?.indent ?? 3),
    validateInput: (v) => (/^[0-9０-９]{1,2}$/.test(v.trim()) ? null : vscode.l10n.t('Enter a number (0-99)')),
  });
  if (amount === undefined) {
    return undefined;
  }
  // IME-friendly: full-width digits are accepted here and normalized — the composed
  // annotation is written in full-width either way.
  const digits = amount.trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  return composeDividerValue(mark, Number(digits));
}

async function editMeta(arg: unknown): Promise<void> {
  const node = nodeOf(arg);
  if (node?.kind !== 'meta') {
    return;
  }

  let value: string | undefined;
  if (node.metaKey === 'divider') {
    value = await pickDivider(node.value);
  } else if (node.metaKey === 'pageNumber') {
    const picked = await vscode.window.showQuickPick(
      PAGE_NUMBER_POSITIONS.map((v) => ({ label: positionLabel(v), description: v, value: v })),
      { placeHolder: vscode.l10n.t('Where the page number goes') },
    );
    value = picked?.value;
  } else {
    value = await vscode.window.showInputBox({
      prompt: metaLabel(node.metaKey),
      value: node.value ?? (node.metaKey === 'pageNumberFormat' ? BUILD_CHROME_DEFAULT.pageNumberFormat : ''),
      ...(node.metaKey === 'pageNumberFormat' ? { placeHolder: '{page} / {totalPage}' } : {}),
    });
  }
  if (value === undefined) {
    return; // dismissed
  }

  const { uri, text } = await bookText(node.entry);
  await applyBookEdits(uri, [upsertMeta(text, node.metaKey, value)]);
}

/** Registers the five panel commands (plain — they only fire from tree nodes). */
export function registerBookCommands(): vscode.Disposable[] {
  return [
    command('jpbook.addChapters', addChapters),
    command('jpbook.removeChapter', removeChapterCmd),
    command('jpbook.moveChapterUp', (arg?: unknown) => moveChapter(arg, -1)),
    command('jpbook.moveChapterDown', (arg?: unknown) => moveChapter(arg, 1)),
    command('jpbook.editMeta', editMeta),
  ];
}
