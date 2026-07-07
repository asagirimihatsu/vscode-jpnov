/**
 * Always-on structural (syntax) diagnostics for an open .jpnov buffer — the editor surface of the
 * compiler's lenient recovery: every unclosed ［＃ (swallowed to its line end and rendered as
 * literal text by the layout) is an Error here, like an unterminated string literal in a
 * programming language. A lone 《 / ］ / 》 is NOT an error (the tokenizer keeps them literal).
 *
 * Unconditional by design: unlike the prose lint (selection-gated Warnings through the textlint
 * kernel), a broken annotation publishes under every lint configuration, including all-off. The
 * findings stay OUT of the lint findings cache — there is no quick fix to offer.
 *
 * Relative imports only (native test loader; see test/server/lint/syntaxDiagnostics.test.ts).
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { findBrokenAnnotations } from '../shared/compiler/tokenizer.ts';

import { diagnostic } from './diagnostics.ts';

/** One Error per unclosed ［＃, covering exactly the swallowed ［＃…-to-line-end span. */
export function annotationDiagnostics(doc: TextDocument): Diagnostic[] {
  return findBrokenAnnotations(doc.getText()).map((span) =>
    diagnostic(
      { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
      { code: 'syntax.unclosedAnnotation' },
      DiagnosticSeverity.Error,
    ),
  );
}
