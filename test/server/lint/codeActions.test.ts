/** Pure-builder tests for buildCodeActions (quick-fix overlap, only-filter, fix-all bundling). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CodeActionKind } from 'vscode-languageserver/node';
import type { CodeAction, Diagnostic, Range, TextEdit } from 'vscode-languageserver/node';

import { buildCodeActions } from '../../../src/server/lint/codeActions.ts';
import type { LintFinding } from '../../../src/server/lint/kernel.ts';

const URI = 'file:///x.jpnov';

function range(l1: number, c1: number, l2: number, c2: number): Range {
  return { start: { line: l1, character: c1 }, end: { line: l2, character: c2 } };
}

function finding(r: Range, code: string, fixNewText?: string): LintFinding {
  const diagnostic: Diagnostic = { range: r, message: `msg:${code}`, severity: 2, source: 'jpnov', data: { code } };
  return fixNewText !== undefined ? { diagnostic, fix: { range: r, newText: fixNewText } } : { diagnostic };
}

function editsOf(action: CodeAction): TextEdit[] {
  return action.edit?.changes?.[URI] ?? [];
}

function kinds(actions: readonly CodeAction[]): (string | undefined)[] {
  return actions.map((a) => a.kind);
}

test('a fixable finding yields a quick-fix (with edit + diagnostic) and a fix-all', () => {
  const f = finding(range(0, 1, 0, 2), 'lint.narration.noHankakuKana', 'ア');
  const actions = buildCodeActions(URI, [f], range(0, 1, 0, 1), undefined);
  assert.deepEqual(kinds(actions), [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll]);
  const quickFix = actions[0];
  assert.ok(quickFix);
  assert.deepEqual(quickFix.diagnostics, [f.diagnostic]);
  assert.deepEqual(editsOf(quickFix), [{ range: range(0, 1, 0, 2), newText: 'ア' }]);
});

test('non-fixable findings produce no actions at all', () => {
  const f = finding(range(0, 0, 0, 1), 'lint.narration.maxTen'); // no fix
  assert.deepEqual(buildCodeActions(URI, [f], range(0, 0, 0, 1), undefined), []);
});

test('quick-fix is only offered for findings overlapping the requested range', () => {
  const f = finding(range(0, 1, 0, 2), 'lint.narration.noHankakuKana', 'ア');
  const actions = buildCodeActions(URI, [f], range(5, 0, 5, 0), undefined); // far from the finding
  assert.deepEqual(kinds(actions), [CodeActionKind.SourceFixAll]); // fix-all still offered, no quick-fix
});

test('the only-filter selects quick-fix vs fix-all', () => {
  const f = finding(range(0, 1, 0, 2), 'lint.narration.noHankakuKana', 'ア');
  assert.deepEqual(
    kinds(buildCodeActions(URI, [f], range(0, 1, 0, 1), [CodeActionKind.SourceFixAll])),
    [CodeActionKind.SourceFixAll],
  );
  assert.deepEqual(
    kinds(buildCodeActions(URI, [f], range(0, 1, 0, 1), [CodeActionKind.QuickFix])),
    [CodeActionKind.QuickFix],
  );
});

test('fix-all bundles every fixable edit and drops overlaps', () => {
  const a = finding(range(0, 1, 0, 2), 'lint.narration.noHankakuKana', 'ア');
  const b = finding(range(0, 5, 0, 6), 'lint.narration.noNfd', 'が');
  const overlap = finding(range(0, 1, 0, 2), 'lint.dialogue.noHankakuKana', 'イ'); // same range as a -> dropped
  const all = buildCodeActions(URI, [a, b, overlap], range(0, 0, 0, 10), [CodeActionKind.SourceFixAll]);
  assert.equal(all.length, 1);
  const fixAll = all[0];
  assert.ok(fixAll);
  assert.deepEqual(editsOf(fixAll), [
    { range: range(0, 1, 0, 2), newText: 'ア' },
    { range: range(0, 5, 0, 6), newText: 'が' },
  ]);
});
