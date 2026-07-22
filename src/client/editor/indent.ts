/**
 * Pure decision half of 自動字下げ (auto indent): the on-Enter rule table and the planners
 * for deleting a lone leading full-width space again. vscode-free — the unit suite imports
 * this file directly; `autoIndent.ts` owns the editor wiring.
 */

export const FULL_WIDTH_SPACE = '　';

/** Runtime default for `jpnov.editor.autoIndent`; the schema mirrors it as a bare literal. */
export const AUTO_INDENT_DEFAULT = true;

/**
 * Openers that cancel a fresh indent (セリフ/引用 start at the column head). A bare opener
 * can sit inside an IME composition, where editing desyncs the IME, so it only arms a
 * deferred deletion; the autoclosed open+close pair never comes from a composition and
 * cancels immediately.
 */
export const INDENT_CANCEL_PAIRS: readonly (readonly [open: string, close: string])[] = [
  ['「', '」'],
  ['『', '』'],
];

export interface EnterRuleSpec {
  readonly beforeText: RegExp;
  readonly afterText?: RegExp;
  /** Omitted = plain newline. */
  readonly appendText?: string;
}

/**
 * VS Code applies the first matching rule. The head-of-line exception keeps Enter at
 * column 0 of a non-empty line from prepending the space into that line's existing text.
 */
export const ON_ENTER_RULES: readonly EnterRuleSpec[] = [
  { beforeText: /^$/, afterText: /^./ },
  { beforeText: /.*/, appendText: FULL_WIDTH_SPACE },
];

/** Enter through the append rule arrives as one contentChange, CRLF included. */
const ENTER_WITH_INDENT = /^\r?\n　$/;

const NEWLINE_HEAD = /^\r?\n/;

export interface ChangeShape {
  readonly startLine: number;
  readonly startChar: number;
  /** Last line of the replaced range; equals `startLine` for pure insertions. */
  readonly endLine: number;
  readonly rangeLength: number;
  readonly text: string;
}

export interface ReactionInput {
  /** Selection count of the editor showing the document; anything but 1 blocks every plan. */
  readonly selectionCount: number;
  /** True when the event replays an undo/redo; reacting again would double-fire. */
  readonly undoOrRedo: boolean;
  /**
   * The event's changes, in pre-change coordinates. Multi-change events (multi-cursor)
   * are rejected wholesale — folding their line deltas is not worth the error surface.
   */
  readonly changes: readonly ChangeShape[];
  /** Text of line `changes[0].startLine` AFTER the change. */
  readonly changedLineText: string;
  /**
   * Line still holding this feature's own untouched indent (doc-matched by the caller),
   * or null; deletions only ever target this line.
   */
  readonly pendingLine: number | null;
}

export type IndentReaction =
  { readonly kind: 'cancel' | 'arm' | 'trim'; readonly line: number } | null;

/**
 * `cancel` deletes the line's leading indent now (autoclosed pair), `arm` defers that
 * deletion to composition end (bare opener), `trim` deletes the lone indent Enter left
 * behind. All act only on `pendingLine` and only on exact single-change matches —
 * anything ambiguous plans nothing.
 */
export function planIndentReaction(input: ReactionInput): IndentReaction {
  const [change] = input.changes;
  if (input.undoOrRedo || input.selectionCount !== 1 || input.changes.length !== 1 ||
    change?.rangeLength !== 0 || change.startChar !== 1 ||
    change.startLine !== input.pendingLine) {
    return null;
  }
  if (input.changedLineText === FULL_WIDTH_SPACE + change.text) {
    for (const [open, close] of INDENT_CANCEL_PAIRS) {
      if (change.text === open) {
        return { kind: 'arm', line: change.startLine };
      }
      if (change.text === open + close) {
        return { kind: 'cancel', line: change.startLine };
      }
    }
  }
  if (ENTER_WITH_INDENT.test(change.text) && input.changedLineText === FULL_WIDTH_SPACE) {
    return { kind: 'trim', line: change.startLine };
  }
  return null;
}

export type ArmedUpkeep = 'keep' | 'disarm';

/**
 * A deferred deletion applies only while a lone indent heads real text; a bare surviving
 * indent (canceled composition) stays.
 */
export function indentHeadsRealText(lineText: string): boolean {
  return lineText.startsWith(FULL_WIDTH_SPACE) && lineText !== FULL_WIDTH_SPACE;
}

/**
 * Whether an armed deletion survives the just-applied change: only same-line single edits
 * that are not an Enter keep it (the deletion fires exclusively at composition end);
 * everything else stands down and the indent stays.
 */
export function planArmedUpkeep(armedLine: number, input: ReactionInput): ArmedUpkeep {
  const [change] = input.changes;
  if (input.undoOrRedo || input.selectionCount !== 1 || input.changes.length !== 1 ||
    change?.startLine !== armedLine || NEWLINE_HEAD.test(change.text)) {
    return 'disarm';
  }
  return 'keep';
}

/**
 * The line the append rule just auto-indented — the Enter-plus-indent change creates the
 * only indents this feature may delete again; null for every other change.
 */
export function planAutoIndentMark(input: ReactionInput): number | null {
  const [change] = input.changes;
  if (input.undoOrRedo || input.selectionCount !== 1 || input.changes.length !== 1 ||
    change?.rangeLength !== 0 || !ENTER_WITH_INDENT.test(change.text)) {
    return null;
  }
  return change.startLine + 1;
}

/**
 * Whether an untouched auto-indent mark survives the just-applied change: only a
 * single-line edit clear of the marked line keeps its geometry; everything else stands
 * down and the indent counts as the author's own.
 */
export function planMarkUpkeep(markLine: number, input: ReactionInput): boolean {
  const [change] = input.changes;
  if (input.undoOrRedo || input.changes.length !== 1 || change === undefined) {
    return false;
  }
  return change.endLine === change.startLine && !change.text.includes('\n') &&
    change.startLine !== markLine;
}
