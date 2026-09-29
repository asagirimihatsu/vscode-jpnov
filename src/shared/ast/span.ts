import type { Span } from './nodes.ts';

/** Source order, the order of every list the AST hands out: by start, then by end. */
export function bySource(a: { readonly span: Span }, b: { readonly span: Span }): number {
  return a.span.start - b.span.start || a.span.end - b.span.end;
}
