/**
 * Cuts a node into its parts: one walk from its start, each part taken by length.
 *
 * Pure + vscode-free.
 */
import type { Part, PartRole, RolePart } from './nodes.ts';

export class Cutter {
  readonly parts: RolePart[] = [];
  private readonly src: string;
  private at: number;

  constructor(src: string, start: number) {
    this.src = src;
    this.at = start;
  }

  /** The next `length` units as one part; an empty part is returned but not listed. */
  take(role: PartRole, length: number): Part {
    const span = { start: this.at, end: this.at + length };
    const part = { span, text: this.src.slice(span.start, span.end) };
    if (length > 0) {
      this.parts.push({ role, ...part });
    }
    this.at = span.end;
    return part;
  }
}
