/**
 * Always-on structural (syntax) diagnostics for an open .jpnov buffer — the editor surface of the
 * compiler's lenient recovery, in two tiers mirroring the damage:
 *   - Lexically broken (an unclosed ［＃, swallowed to its line end and rendered as literal text
 *     by the layout) is an ERROR, like an unterminated string literal in a programming language.
 *   - Structurally unpaired blocks (a ［＃ここから…］ open at EOF, or a ［＃ここで…終わり］ with no
 *     open block) are WARNINGS: every bracket is well-formed and the render stays lenient (EOF
 *     auto-close / dangling no-op), the pairing is just incomplete.
 * A lone 《 / ］ / 》 is NOT an error (the tokenizer keeps them literal).
 *
 * Unconditional by design: unlike the prose lint (selection-gated Warnings through the textlint
 * kernel), these publish under every lint configuration, including all-off. The findings stay
 * OUT of the lint findings cache — there is no quick fix to offer.
 *
 * Relative imports only (native test loader; see test/server/lint/syntaxDiagnostics.test.ts).
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { findPostfixTargetIssues } from '../shared/compiler/layout.ts';
import {
  findBrokenAnnotations,
  findTcyIssues,
  findUnpairedBlocks,
} from '../shared/compiler/tokenizer.ts';

import { diagnostic } from './diagnostics.ts';

// findUnpairedBlocks / findTcyIssues return a STRUCTURAL kind, not a protocol code — the
// tokenizer stays message-code-free. The kind→MsgCode mappings live here, server-side.
const BLOCK_WARNING_CODE = {
  unterminated: 'syntax.unterminatedBlock',
  dangling: 'syntax.danglingBlockEnd',
} as const;

const TCY_WARNING_CODE = {
  unterminated: 'syntax.unterminatedTcy',
  dangling: 'syntax.danglingTcyEnd',
  tooLong: 'syntax.tcyTooLong',
} as const;

/**
 * One Error per unclosed ［＃, then Warnings: unpaired blocks, structural 縦中横 issues, and
 * corner-target postfixes whose target is absent or not unit-aligned (the latter derived by
 * running the layout itself, so the Warning surface always matches the render).
 */
export function annotationDiagnostics(doc: TextDocument): Diagnostic[] {
  const text = doc.getText();
  const errors = findBrokenAnnotations(text).map((span) =>
    diagnostic(
      { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
      { code: 'syntax.unclosedAnnotation' },
      DiagnosticSeverity.Error,
    ),
  );
  const warnings = findUnpairedBlocks(text).map((span) =>
    diagnostic(
      { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
      { code: BLOCK_WARNING_CODE[span.kind] },
      DiagnosticSeverity.Warning,
    ),
  );
  const tcyWarnings = findTcyIssues(text).map((span) =>
    diagnostic(
      { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
      { code: TCY_WARNING_CODE[span.kind] },
      DiagnosticSeverity.Warning,
    ),
  );
  const targetWarnings = findPostfixTargetIssues(text).map((span) =>
    diagnostic(
      { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
      { code: 'syntax.postfixTargetMissing', args: [span.target] },
      DiagnosticSeverity.Warning,
    ),
  );
  return [...errors, ...warnings, ...tcyWarnings, ...targetWarnings];
}
