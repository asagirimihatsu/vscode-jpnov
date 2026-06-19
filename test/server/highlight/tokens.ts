/**
 * Shared scaffolding for the highlight semantic-token tests: build a novel-jp document, decode the
 * LSP delta-encoded token stream into absolute tuples, and query it by position. (Not a `*.test.ts`
 * file, so the runner imports it as a helper rather than executing it.)
 */
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface Tok {
  line: number;
  char: number;
  len: number;
  type: number;
}

export const doc = (text: string): TextDocument =>
  TextDocument.create('file:///t.txt', 'novel-jp', 1, text);

/** Decode the LSP delta-encoded token array into absolute tuples. */
export function decode(data: readonly number[]): Tok[] {
  const out: Tok[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dl = data[i] ?? 0;
    const dc = data[i + 1] ?? 0;
    line += dl;
    char = dl === 0 ? char + dc : dc;
    out.push({ line, char, len: data[i + 2] ?? 0, type: data[i + 3] ?? 0 });
  }
  return out;
}

/** The token starting exactly at (line, char), if any. */
export const at = (toks: Tok[], line: number, char: number): Tok | undefined =>
  toks.find((t) => t.line === line && t.char === char);

/** Whether any token of `type` covers code unit `char` on line 0. */
export const covers = (toks: Tok[], char: number, type: number): boolean =>
  toks.some((t) => t.line === 0 && t.char <= char && t.char + t.len > char && t.type === type);
