/**
 * The Books panel's command-argument vocabulary, shared by the WebviewView provider (`view.ts`)
 * and the management commands (`manage.ts`) so neither has to import the other for types. The
 * provider synthesizes one of these from a webview message and dispatches it to the matching
 * `jpbook.*` command; `manage.ts` narrows on `kind`. `meta` carries one of the five fixed
 * front-matter keys and its current value; `chapter` carries the document `line` the edit
 * planners key on.
 */
import type { MetaKey } from '#/shared/book/jpbook.ts';
import type { BookEntry } from '#/shared/protocol.ts';

export type BookNode =
  | { readonly kind: 'book'; readonly entry: BookEntry }
  | {
    readonly kind: 'meta';
    readonly entry: BookEntry;
    readonly metaKey: MetaKey;
    readonly value: string | undefined;
  }
  | {
    readonly kind: 'chapter';
    readonly entry: BookEntry;
    /** 0-based document line of this chapter's entry (the edit planners key on it). */
    readonly line: number;
  };
