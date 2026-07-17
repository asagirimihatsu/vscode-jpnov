/**
 * The Books panel's node vocabulary, shared by the tree provider (`view.ts`) and the
 * management commands (`manage.ts`) so neither has to import the other for types.
 * Only `book` leaves carry a checkbox; `meta` rows are the tree-as-form surface (fixed
 * key order, always all four), `chapter` rows are the reorderable list.
 */
import type { MetaKey } from '#/shared/book/jpbook.ts';
import type { BookEntry } from '#/shared/protocol.ts';

export type BookNode =
  | { readonly kind: 'root'; readonly rootUri: string; readonly label: string }
  | { readonly kind: 'folder'; readonly rootUri: string; readonly prefix: string; readonly label: string }
  | { readonly kind: 'book'; readonly entry: BookEntry }
  | { readonly kind: 'info'; readonly entry: BookEntry }
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
    readonly rel: string;
    readonly missing: boolean;
  };
