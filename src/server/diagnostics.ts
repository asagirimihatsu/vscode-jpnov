/**
 * The server's single source for LSP `Diagnostic` construction. Collapses three previously
 * re-implemented factories (filelist's `diagnostic`, build's `fileLevelError`, configLoad's
 * inline config diagnostic) into one `source: 'jpnov'` constructor plus a file-level
 * (zero-width, doc-start) error helper, so every diagnostic carries an identical
 * `source` and shape.
 *
 * Imports only `vscode-languageserver/node` (already a dependency of every consumer); owns no
 * state and imports no other server module, so it stays a dependency-free leaf (no cycle risk).
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic, Range } from 'vscode-languageserver/node';

/** The `source` field stamped on every diagnostic this server emits. */
const DIAGNOSTIC_SOURCE = 'jpnov';

/** A zero-width range at the document start; file-level diagnostics aren't line-specific. */
const FILE_START_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
} as const;

/** Builds a `Diagnostic` over an explicit range. */
export function diagnostic(
  range: Range,
  message: string,
  severity: DiagnosticSeverity,
): Diagnostic {
  return { range, severity, source: DIAGNOSTIC_SOURCE, message };
}

/** An Error-severity, document-start ("file level") diagnostic. */
export function fileLevelError(message: string): Diagnostic {
  return diagnostic(FILE_START_RANGE, message, DiagnosticSeverity.Error);
}
