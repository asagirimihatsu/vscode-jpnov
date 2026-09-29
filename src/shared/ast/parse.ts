/**
 * Source text → the resolved manuscript: {@link scan}, then {@link resolve}. A reader of the
 * syntax layer alone calls `scan`.
 *
 * Pure + vscode-free.
 */
import type { Ast, ValueLookup } from './nodes.ts';
import { resolve } from './resolve.ts';
import { scan } from './scan.ts';

/** `values` are those of ［＃ここに「…」の値を表示］; omitted = every field shows its default. */
export function parse(src: string, values?: ValueLookup): Ast {
  return resolve(scan(src), values);
}
