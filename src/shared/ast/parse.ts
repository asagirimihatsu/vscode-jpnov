/**
 * Source text → the resolved manuscript: {@link scan}, then {@link autoTcy} when asked, then
 * {@link resolve}. A reader of the syntax layer alone calls `scan`.
 *
 * Pure + vscode-free.
 */
import { autoTcy } from './autoTcy.ts';
import type { Ast, ValueLookup } from './nodes.ts';
import { resolve } from './resolve.ts';
import { scan } from './scan.ts';

export interface ParseOptions {
  /** `punctuationPairs` wraps the half-width pairs !! !? ?! ?? in 縦中横; omitted = `none`. */
  readonly autoTcy?: 'none' | 'punctuationPairs' | undefined;
  /** The values of ［＃ここに「…」の値を表示］; omitted = every field shows its default. */
  readonly values?: ValueLookup | undefined;
}

export function parse(src: string, opts?: ParseOptions): Ast {
  const syntax = scan(src);
  return resolve(opts?.autoTcy === 'punctuationPairs' ? autoTcy(syntax) : syntax, opts?.values);
}
