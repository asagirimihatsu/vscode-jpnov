/**
 * Pure, vscode-free folder-tree shaping for the Books panel: groups the flat {@link BookEntry}
 * list the server enumerates into a per-root directory forest that mirrors each book's output path
 * (`outRel`). Kept separate from `booksView.ts` so it pulls in neither `vscode` nor any runtime
 * `#/` value import (only an erased `import type`), which lets it be unit-tested directly under
 * `node --test` — no vscode mock, no esbuild bundling.
 */
import type { BookEntry } from '#/shared/protocol.ts';

/** A node in the per-root output-path forest: subdirectories plus the book leaves at this level. */
export interface TreeDir {
  readonly dirs: Map<string, TreeDir>;
  readonly books: BookEntry[];
}

/**
 * Groups books into a folder forest keyed by root URI, mirroring each book's `outRel` path: a book
 * with `outRel` `part1/vol2` becomes a leaf inside folder `part1`. The `index`-collapse already
 * happened in `jpbookOutRel`, so no `index` sentinel ever appears.
 */
export function buildForest(books: readonly BookEntry[]): Map<string, TreeDir> {
  const forest = new Map<string, TreeDir>();
  const childDir = (parent: TreeDir, seg: string): TreeDir => {
    let next = parent.dirs.get(seg);
    if (!next) {
      next = { dirs: new Map(), books: [] };
      parent.dirs.set(seg, next);
    }
    return next;
  };
  for (const entry of books) {
    let root = forest.get(entry.rootUri);
    if (!root) {
      root = { dirs: new Map(), books: [] };
      forest.set(entry.rootUri, root);
    }
    const segments = entry.outRel.split('/');
    segments.pop(); // the last segment is the book leaf itself, not a folder
    let dir: TreeDir = root;
    for (const seg of segments) {
      dir = childDir(dir, seg);
    }
    dir.books.push(entry);
  }
  return forest;
}
