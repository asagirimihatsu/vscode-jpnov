/**
 * 自動字下げ decision logic: the on-Enter rule table (first match wins, replicated here by
 * `firstMatch`) and the cancel/arm/trim planners. vscode-free — imports the pure module directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FULL_WIDTH_SPACE,
  INDENT_CANCEL_PAIRS,
  ON_ENTER_RULES,
  indentHeadsRealText,
  planArmedUpkeep,
  planAutoIndentMark,
  planIndentReaction,
  planMarkUpkeep,
  type ChangeShape,
  type EnterRuleSpec,
  type ReactionInput,
} from '../../src/client/editor/indent.ts';

function firstMatch(before: string, after: string): EnterRuleSpec | undefined {
  return ON_ENTER_RULES.find(
    (r) => r.beforeText.test(before) && (r.afterText === undefined || r.afterText.test(after)),
  );
}

function change(over: Partial<ChangeShape>): ChangeShape {
  return {
    startLine: 3, startChar: 1, endLine: over.startLine ?? 3, rangeLength: 0, text: '「', ...over,
  };
}

// pendingLine mirrors change()'s default startLine, so shapes read as "on the marked line".
function input(over: Partial<ReactionInput>): ReactionInput {
  return {
    selectionCount: 1, undoOrRedo: false, changes: [], changedLineText: '', pendingLine: 3, ...over,
  };
}

test('enter rules: EOL, empty line, and mid-line split all append the indent', () => {
  for (const [before, after] of [
    ['吾輩は猫である。', ''],
    ['', ''],
    ['吾輩は', '猫である。'],
  ] as const) {
    const rule = firstMatch(before, after);
    assert.ok(rule);
    assert.equal(rule.appendText, FULL_WIDTH_SPACE);
  }
});

test('enter rules: column 0 of a non-empty line stays a plain newline', () => {
  for (const after of ['吾輩は猫である。', FULL_WIDTH_SPACE]) {
    const rule = firstMatch('', after);
    assert.ok(rule);
    assert.equal(rule.appendText, undefined);
  }
});

test('openers: a bare opener arms, its autoclosed pair cancels immediately', () => {
  for (const [open, close] of INDENT_CANCEL_PAIRS) {
    assert.deepEqual(planIndentReaction(input({
      changes: [change({ text: open })],
      changedLineText: FULL_WIDTH_SPACE + open,
    })), { kind: 'arm', line: 3 });
    assert.deepEqual(planIndentReaction(input({
      changes: [change({ text: open + close })],
      changedLineText: FULL_WIDTH_SPACE + open + close,
    })), { kind: 'cancel', line: 3 });
  }
});

test('cancel: non-trigger openers and inexact insertions plan nothing', () => {
  for (const [text, line] of [
    ['（', '　（'], // legitimate indented opener, not a cancel trigger
    ['「abc', '　「abc'], // paste — exact match only
  ] as const) {
    assert.equal(planIndentReaction(input({
      changes: [change({ text })],
      changedLineText: line,
    })), null);
  }
});

test('cancel: fires only right after a lone indent', () => {
  for (const [startChar, line] of [
    [1, 'あ「'], // line head is not the indent
    [1, '　「あ'], // trailing rest: the line was not exactly the indent
    [2, '　　「'], // deeper than one indent
    [0, '「'], // opener at the line head
  ] as const) {
    assert.equal(planIndentReaction(input({
      changes: [change({ startChar, text: '「' })],
      changedLineText: line,
    })), null);
  }
});

test('ambiguous events plan nothing: multi-cursor, multi-change, replace, undo/redo, none', () => {
  const hit = change({ text: '「' });
  const line = '　「';
  assert.equal(planIndentReaction(input({
    selectionCount: 2, changes: [hit], changedLineText: line,
  })), null);
  assert.equal(planIndentReaction(input({
    changes: [hit, change({ startLine: 5 })], changedLineText: line,
  })), null);
  assert.equal(planIndentReaction(input({
    changes: [change({ text: '「', rangeLength: 2 })], changedLineText: line,
  })), null);
  assert.equal(planIndentReaction(input({
    undoOrRedo: true, changes: [hit], changedLineText: line,
  })), null);
  assert.equal(planIndentReaction(input({ changes: [] })), null);
});

test('our own deletion (a 1-char removal) can never re-trigger', () => {
  assert.equal(planIndentReaction(input({
    changes: [change({ startChar: 0, rangeLength: 1, text: '' })],
    changedLineText: '「」',
  })), null);
});

test('trim: Enter leaving a lone indent behind, LF and CRLF', () => {
  for (const text of ['\n　', '\r\n　']) {
    assert.deepEqual(planIndentReaction(input({
      changes: [change({ text })],
      changedLineText: FULL_WIDTH_SPACE,
    })), { kind: 'trim', line: 3 });
  }
});

test('trim: plain newline, non-indent remainder, and offset Enter plan nothing', () => {
  for (const [startChar, text, line] of [
    [1, '\n', ''], // editor.autoIndent degraded: no appendText, feature idles
    [1, '\n　', 'あ'], // the abandoned line head was real text
    [0, '\n　', ''], // not the position right after a lone indent
    [1, '\n　', '　　'], // deeper than one indent
  ] as const) {
    assert.equal(planIndentReaction(input({
      changes: [change({ startChar, text })],
      changedLineText: line,
    })), null);
  }
});

test('trim: a selection-replacing or multi-cursor Enter plans nothing', () => {
  assert.equal(planIndentReaction(input({
    changes: [change({ text: '\n　', rangeLength: 4 })],
    changedLineText: FULL_WIDTH_SPACE,
  })), null);
  assert.equal(planIndentReaction(input({
    changes: [change({ text: '\n　' }), change({ startLine: 8, text: '\n　' })],
    changedLineText: FULL_WIDTH_SPACE,
  })), null);
});

test('armed: any Enter on the line stands down — deletion is composition-end only', () => {
  for (const text of ['\n　', '\r\n　', '\n']) {
    assert.equal(planArmedUpkeep(3, input({
      changes: [change({ startChar: 9, text })],
      changedLineText: '　「こんにちは」',
    })), 'disarm');
  }
});

test('armed: same-line typing and composition updates keep the arming', () => {
  assert.equal(planArmedUpkeep(3, input({
    changes: [change({ startChar: 2, text: '」' })],
    changedLineText: '　「」',
  })), 'keep');
  assert.equal(planArmedUpkeep(3, input({
    changes: [change({ rangeLength: 1, text: '「あ」' })],
    changedLineText: '　「あ」',
  })), 'keep');
});

test('armed: ambiguous events and edits off the line stand down', () => {
  const enter = change({ startChar: 9, text: '\n　' });
  const line = '　「こんにちは」';
  assert.equal(planArmedUpkeep(5, input({ changes: [enter], changedLineText: line })), 'disarm');
  assert.equal(planArmedUpkeep(3, input({
    undoOrRedo: true, changes: [enter], changedLineText: line,
  })), 'disarm');
  assert.equal(planArmedUpkeep(3, input({
    selectionCount: 2, changes: [enter], changedLineText: line,
  })), 'disarm');
  assert.equal(planArmedUpkeep(3, input({
    changes: [enter, change({ startLine: 8 })], changedLineText: line,
  })), 'disarm');
  assert.equal(planArmedUpkeep(3, input({ changes: [], changedLineText: line })), 'disarm');
});

test('plans act only on this feature\'s own indent — hand-typed spaces stay', () => {
  assert.equal(planIndentReaction(input({
    pendingLine: null, changes: [change({ text: '「' })], changedLineText: '　「',
  })), null);
  assert.equal(planIndentReaction(input({
    pendingLine: 7, changes: [change({ text: '\n　' })], changedLineText: FULL_WIDTH_SPACE,
  })), null);
});

test('mark: Enter-plus-indent marks the new line as this feature\'s own indent', () => {
  for (const text of ['\n　', '\r\n　']) {
    assert.equal(planAutoIndentMark(input({ changes: [change({ startChar: 5, text })] })), 4);
  }
  assert.equal(planAutoIndentMark(input({ changes: [change({ text: '\n' })] })), null);
  assert.equal(planAutoIndentMark(input({
    changes: [change({ text: '\n　', rangeLength: 2 })],
  })), null);
  assert.equal(planAutoIndentMark(input({
    undoOrRedo: true, changes: [change({ text: '\n　' })],
  })), null);
  assert.equal(planAutoIndentMark(input({
    selectionCount: 2, changes: [change({ text: '\n　' })],
  })), null);
});

test('mark upkeep: only single-line edits clear of the marked line keep it', () => {
  assert.equal(planMarkUpkeep(5, input({ changes: [change({ startLine: 2, text: 'あ' })] })), true);
  assert.equal(planMarkUpkeep(5, input({
    changes: [change({ startLine: 9, rangeLength: 1, text: '' })],
  })), true);
  assert.equal(planMarkUpkeep(5, input({ changes: [change({ startLine: 5, text: 'あ' })] })), false);
  assert.equal(planMarkUpkeep(5, input({
    changes: [change({ startLine: 2, text: 'あ\nい' })],
  })), false);
  assert.equal(planMarkUpkeep(5, input({
    changes: [change({ startLine: 2, endLine: 3, rangeLength: 1, text: '' })],
  })), false);
  assert.equal(planMarkUpkeep(5, input({
    undoOrRedo: true, changes: [change({ startLine: 2, text: 'あ' })],
  })), false);
  assert.equal(planMarkUpkeep(5, input({ changes: [] })), false);
});

test('a deferred deletion applies only while a lone indent heads real text', () => {
  assert.equal(indentHeadsRealText('　「こんにちは」'), true);
  assert.equal(indentHeadsRealText('　「'), true);
  assert.equal(indentHeadsRealText(FULL_WIDTH_SPACE), false);
  assert.equal(indentHeadsRealText('「こんにちは」'), false);
  assert.equal(indentHeadsRealText(''), false);
});
