/**
 * The vscode half of 自動字下げ: an on-Enter rule opens every new line with a full-width
 * space; the space is deleted again for lines opened with 「/『 — immediately for an
 * autoclosed pair, at composition end for an IME bare opener (editing mid-composition
 * desyncs the IME). Only spaces the feature itself inserted are ever deleted. Registered
 * in Phase-1 activate(), so the module owns its configuration listener — the central one
 * exists only post-start and is Running-gated.
 */
import * as vscode from 'vscode';

import {
  AUTO_INDENT_DEFAULT,
  ON_ENTER_RULES,
  indentHeadsRealText,
  planArmedUpkeep,
  planAutoIndentMark,
  planIndentReaction,
  planMarkUpkeep,
  type ReactionInput,
} from './indent.ts';

const SETTING = 'jpnov.editor.autoIndent';
const LANG_ID = 'jpnov';

function toOnEnterRules(): vscode.OnEnterRule[] {
  return ON_ENTER_RULES.map((rule) => ({
    beforeText: rule.beforeText,
    ...(rule.afterText === undefined ? {} : { afterText: rule.afterText }),
    action: {
      indentAction: vscode.IndentAction.None,
      ...(rule.appendText === undefined ? {} : { appendText: rule.appendText }),
    },
  }));
}

/** Registers the feature; live-toggled by `jpnov.editor.autoIndent`, default on. */
export function registerAutoIndent(): vscode.Disposable {
  let active: vscode.Disposable[] = [];
  /** Deferred deletion for a bare opener typed after a lone indent; at most one line. */
  let armed: { readonly uri: string; readonly line: number } | null = null;
  /** The line whose indent this feature just inserted and nothing has touched since. */
  let pending: { readonly uri: string; readonly line: number } | null = null;

  const deleteIndent = (editor: vscode.TextEditor, line: number): void => {
    // undoStop:false folds the deletion into the typing's undo step; the editor's document-
    // version guard drops a stale edit, hence the ignored result.
    void editor.edit(
      (b) => { b.delete(new vscode.Range(line, 0, line, 1)); },
      { undoStopBefore: false, undoStopAfter: false },
    );
  };

  // Runs after `default:compositionEnd`: the composition is over, so the deletion is safe.
  const resolveArmedAfterComposition = (): void => {
    if (armed === null) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() !== armed.uri) {
      return;
    }
    const line = armed.line;
    armed = null; // the composition episode on the armed line concluded either way
    if (editor.selections.length === 1 && line < editor.document.lineCount &&
      indentHeadsRealText(editor.document.lineAt(line).text)) {
      deleteIndent(editor, line);
    }
  };

  // The command slot is global; the handler always forwards to the built-in first, so
  // every editor's IME keeps its native behavior. If another extension owns the slot,
  // the bare-opener indent simply stays.
  const hookCompositionEnd = (): vscode.Disposable => {
    try {
      return vscode.commands.registerCommand('compositionEnd', async (...args: unknown[]) => {
        await vscode.commands.executeCommand('default:compositionEnd', ...args);
        resolveArmedAfterComposition();
      });
    } catch {
      return new vscode.Disposable(() => undefined);
    }
  };

  const onChange = (e: vscode.TextDocumentChangeEvent): void => {
    const [change] = e.contentChanges;
    if (e.document.languageId !== LANG_ID || change === undefined) {
      return;
    }
    const docUri = e.document.uri.toString();
    // Only a visible editor proves the single-cursor requirement; without one the plans
    // stay null, but the armed/pending upkeep below must still see the change.
    const editor = vscode.window.activeTextEditor;
    const input: ReactionInput = {
      selectionCount: editor?.document === e.document ? editor.selections.length : 0,
      undoOrRedo: e.reason !== undefined,
      changes: e.contentChanges.map((c) => ({
        startLine: c.range.start.line,
        startChar: c.range.start.character,
        endLine: c.range.end.line,
        rangeLength: c.rangeLength,
        text: c.text,
      })),
      changedLineText: e.document.lineAt(change.range.start.line).text,
      pendingLine: pending !== null && pending.uri === docUri ? pending.line : null,
    };
    if (armed !== null && armed.uri === docUri &&
      planArmedUpkeep(armed.line, input) === 'disarm') {
      armed = null;
    }
    const plan = planIndentReaction(input);
    if (pending !== null && pending.uri === docUri && !planMarkUpkeep(pending.line, input)) {
      pending = null;
    }
    const marked = planAutoIndentMark(input);
    if (marked !== null) {
      pending = { uri: docUri, line: marked };
    }
    if (plan === null || editor?.document !== e.document) {
      return;
    }
    if (plan.kind === 'arm') {
      armed = { uri: docUri, line: plan.line };
      return;
    }
    deleteIndent(editor, plan.line);
  };

  const onSelection = (e: vscode.TextEditorSelectionChangeEvent): void => {
    // Every editor fires selection events (output/log editors on each append); only the
    // armed document's own editor counts.
    if (e.textEditor.document.uri.toString() !== armed?.uri) {
      return;
    }
    // Leaving the armed line forces any composition to commit first; the indent stays.
    const [sel] = e.selections;
    if (e.selections.length !== 1 || sel?.active.line !== armed.line) {
      armed = null;
    }
  };

  const disable = (): void => {
    for (const d of active) {
      d.dispose();
    }
    active = [];
    armed = null;
    pending = null;
  };
  const apply = (): void => {
    // setLanguageConfiguration layers per property: only `onEnterRules` is overridden, and
    // disposing restores the state from `jpnov.language-configuration.json`.
    if (vscode.workspace.getConfiguration().get<boolean>(SETTING, AUTO_INDENT_DEFAULT)) {
      if (active.length === 0) {
        active = [
          vscode.languages.setLanguageConfiguration(LANG_ID, { onEnterRules: toOnEnterRules() }),
          hookCompositionEnd(),
          vscode.workspace.onDidChangeTextDocument(onChange),
          vscode.window.onDidChangeTextEditorSelection(onSelection),
          // A close can revert unsaved content under the recorded line numbers.
          vscode.workspace.onDidCloseTextDocument((d) => {
            const uri = d.uri.toString();
            if (armed?.uri === uri) {
              armed = null;
            }
            if (pending?.uri === uri) {
              pending = null;
            }
          }),
        ];
      }
    } else {
      disable();
    }
  };

  apply();
  const listener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SETTING)) {
      apply();
    }
  });
  return vscode.Disposable.from(listener, { dispose: disable });
}
