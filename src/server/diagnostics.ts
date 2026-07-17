/**
 * The server's single source for LSP `Diagnostic` construction. Collapses the previously
 * re-implemented factories (jpbook's `diagnostic`, build's `fileLevelError`) into one
 * `source: 'jpnov'` constructor plus a file-level (zero-width, doc-start) error helper,
 * so every diagnostic carries an identical `source` and shape.
 *
 * Imports only `vscode-languageserver/node` (already a dependency of every consumer); owns no
 * state and imports no other server module, so it stays a dependency-free leaf (no cycle risk).
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic, Range } from 'vscode-languageserver/node';

import { renderEnglish } from '../shared/messages.ts';
import type { LocalizableMessage } from '../shared/protocol.ts';

/** The `source` field stamped on every diagnostic this server emits. */
const DIAGNOSTIC_SOURCE = 'jpnov';

/** A zero-width range at the document start; file-level diagnostics aren't line-specific. */
const FILE_START_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
} as const;

/**
 * Builds a `Diagnostic` over an explicit range from a {@link LocalizableMessage}. The English
 * render goes in `.message` (the fallback VS Code shows directly), and the `{code, args}` ride
 * in `.data` so the client's `handleDiagnostics` middleware can replace `.message` with the
 * localized text. Callers never hand-write English — it is single-sourced in `renderEnglish`.
 */
export function diagnostic(
  range: Range,
  message: LocalizableMessage,
  severity: DiagnosticSeverity,
): Diagnostic {
  return {
    range,
    severity,
    source: DIAGNOSTIC_SOURCE,
    message: renderEnglish(message.code, message.args),
    data: message,
  };
}

/** An Error-severity, document-start ("file level") diagnostic. */
export function fileLevelError(message: LocalizableMessage): Diagnostic {
  return diagnostic(FILE_START_RANGE, message, DiagnosticSeverity.Error);
}
