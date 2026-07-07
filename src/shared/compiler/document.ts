import { stylesheet } from './css.ts';
import { buildRows, paginate, pagesToHtml, type Row } from './layout.ts';
import { tokenize } from './tokenizer.ts';

export interface BookInput {
  readonly files: readonly { readonly name: string; readonly src: string }[];
}

/**
 * Renders one or more books into a full, PAGINATED `<html>` document. The pure layout
 * engine ({@link paginate}) flows each book's text into an explicit
 * `<div class="book"><div class="page"><div class="line">…` skeleton sized by
 * `charsPerLine` x `linesPerPage` (vertical-rl by default), so the output is WYSIWYG
 * page-per-sheet and ready for page numbers / line numbers / 原稿用紙 grids later.
 *
 * Each book concatenates its `files[]` in order; books are separated by a forced page break.
 * ［＃改ページ］ forces a page break. `avoidLineBreaks` is plumbed through to the 禁則処理
 * line-break engine. Pure + vscode-free.
 */
export function renderBook(opts: {
  books: readonly BookInput[];
  charsPerLine: number;
  linesPerPage: number;
  avoidLineBreaks?: boolean;
}): string {
  const rows: Row[] = [];
  opts.books.forEach((book, bookIndex) => {
    if (bookIndex > 0) {
      rows.push({ kind: 'pagebreak' });
    }
    for (const file of book.files) {
      rows.push(...buildRows(tokenize(file.src)));
    }
  });

  const pages = paginate(
    rows,
    opts.charsPerLine,
    opts.linesPerPage,
    opts.avoidLineBreaks ?? false,
  );

  // Emit the body first so the CSS carries ONLY the classes used (on-demand).
  // [...used].sort() is lexicographic by class name (deterministic), not spec order.
  const used = new Set<string>();
  const body = pagesToHtml(pages, used);
  const cssOpts: Parameters<typeof stylesheet>[0] = {
    charsPerLine: opts.charsPerLine,
    linesPerPage: opts.linesPerPage,
    paginate: true,
    usedClasses: [...used].sort(),
  };
  const css = stylesheet(cssOpts);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

/**
 * Concatenates a book's `files[]` into ONE plain-text document — the byte-faithful dual of
 * {@link renderBook}. Each file's single trailing newline (the final-newline artifact) is
 * stripped before joining with `\n`, so the combined text re-tokenizes into the SAME rows
 * `renderBook` produces per file: cf. `buildRows`' `endLine`, which DROPS a file's trailing
 * empty line at end-of-input but KEEPS a genuine blank column on a real `\n` (so `"x\n\n"`
 * keeps one blank, while `"x"` and `"x\n"` never gain a doubled blank at a seam).
 *
 * Interior bytes pass through verbatim (no CRLF normalization): the tokenizer splits on `\n`
 * and treats a lone `\r` as a literal, exactly as the HTML build does. An empty book -> "".
 * (A wholly-empty middle file contributes one blank separator line rather than nothing — a
 * benign divergence from the per-file render, harmless for the Aozora `.txt` deliverable.)
 * Pure + vscode-free.
 */
export function concatBookText(book: BookInput): string {
  return book.files.map((file) => file.src.replace(/\r?\n$/, '')).join('\n');
}
