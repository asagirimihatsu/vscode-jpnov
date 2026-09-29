/**
 * Prints the syntax layer back to source text. The nodes tile their lines, so a document
 * prints as it was read.
 *
 * Pure + vscode-free.
 */
import type { SyntaxLine } from './nodes.ts';

/** One line's source, terminator excluded. */
export function printLine(line: SyntaxLine): string {
  let out = '';
  for (const node of line.syntax) {
    out += node.text;
  }
  return out;
}

/** The source of `doc`, every line with its terminator as typed. */
export function printSource(doc: { readonly lines: readonly SyntaxLine[] }): string {
  let out = '';
  for (const line of doc.lines) {
    out += printLine(line) + line.eol;
  }
  return out;
}
