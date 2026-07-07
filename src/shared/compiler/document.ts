import type { BuildChrome } from './chrome.ts';
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
 * page-per-sheet; `chrome` adds the page furniture (line numbers, edge rules + frame,
 * page numbers, header) around that grid.
 *
 * Each book concatenates its `files[]` in order; books are separated by a forced page break.
 * ［＃改ページ］ forces a page break. `avoidLineBreaks` is plumbed through to the 禁則処理
 * line-break engine. All options are required and pre-resolved (the settings resolver is the
 * only default layer); "off" is the explicit all-off chrome. Pure + vscode-free.
 */
export function renderBook(opts: {
  books: readonly BookInput[];
  charsPerLine: number;
  linesPerPage: number;
  avoidLineBreaks: boolean;
  chrome: BuildChrome;
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

  const pages = paginate(rows, opts.charsPerLine, opts.linesPerPage, opts.avoidLineBreaks);

  // Blank-template normalization (single source): a template that is blank after trim
  // means "no folio", folded into the one `pageNumberPosition === 'none'` gate so the
  // `.pn` DOM element and its CSS rule always agree. Only the suppression check trims —
  // a rendered non-blank template keeps the author's literal spaces.
  const chrome: BuildChrome = {
    ...opts.chrome,
    pageNumberPosition:
      opts.chrome.pageNumberTemplate.trim() === '' ? 'none' : opts.chrome.pageNumberPosition,
  };

  // Emit the body first so the CSS carries ONLY the classes used (on-demand).
  // [...used].sort() is lexicographic by class name (deterministic), not spec order.
  const used = new Set<string>();
  const body = pagesToHtml(pages, used, chrome);
  const css = stylesheet({
    paginate: true,
    charsPerLine: opts.charsPerLine,
    linesPerPage: opts.linesPerPage,
    chrome,
    usedClasses: [...used].sort(),
  });

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
