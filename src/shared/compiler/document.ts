import type { AutoTcyMode, DashMode, KinsokuMode, LinePitch } from '../config/types.ts';
import { applyAutoTcy } from './autoTcy.ts';
import type { BuildChrome } from './chrome.ts';
import { emrProbe, stylesheet } from './css.ts';
import type { PaperOrientation, PaperSize } from './geometry.ts';
import { buildRows, paginate, pagesToHtml, type DisplayLine, type RenderPage, type Row } from './layout.ts';
import { indentAnnotation, tokenize } from './tokenizer.ts';

export interface BookInput {
  readonly files: readonly { readonly name: string; readonly src: string }[];
  /**
   * Chapter divider from the book's front matter ('' / absent = none) — a line of `.jpnov`
   * notation inserted between chapters by {@link chapterGlue}. Explicit `| undefined` so the
   * server can assign `meta.divider` verbatim under exactOptionalPropertyTypes.
   */
  readonly divider?: string | undefined;
  /**
   * The `cover` sources, rendered by the html build as unnumbered front pages (txt and EPUB
   * never see them). `title`/`author` are the ［＃ここに「…」の値を表示］ substitutions,
   * pre-resolved by the caller. Absent/empty = no cover pages.
   */
  readonly cover?: {
    readonly files: readonly { readonly name: string; readonly src: string }[];
    readonly title: string;
    readonly author: string;
  } | undefined;
}

/** The first (or last) non-blank line of a chapter source, `\r`-stripped; null when none. */
function boundaryLine(src: string, edge: 'first' | 'last'): string | null {
  const lines = src.split('\n');
  const ordered = edge === 'first' ? lines : lines.reverse();
  for (const raw of ordered) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() !== '') {
      return line;
    }
  }
  return null;
}

/**
 * True iff the chapter OPENS with a 見出し: its first non-blank line resolves to a heading
 * row — match-validated by the layout itself, so a broken-target 見出し (which renders as
 * plain text) never suppresses the divider. One line suffices: postfix targets bind
 * same-line only, and a span/block opener on that line makes the first PAINTED line a
 * heading — when the line itself paints nothing (a suppressed ここから directive, or a lone
 * inline opener dropped as the end-of-input artifact), the opener token decides.
 */
function opensWithHeading(src: string): boolean {
  const line = boundaryLine(src, 'first');
  if (line === null) {
    return false;
  }
  const tokens = tokenize(line);
  const first = buildRows(tokens)[0];
  if (first !== undefined) {
    return first.kind === 'line' && first.heading !== undefined;
  }
  return tokens.some((t) => t.kind === 'headingSpanStart');
}

/** True iff `src`'s junction side reaches a ［＃改ページ］ before (first) / after (last) content. */
function pageBreakAt(src: string, edge: 'first' | 'last'): boolean {
  const line = boundaryLine(src, edge);
  if (line === null) {
    return false;
  }
  const rows = buildRows(tokenize(line));
  const row = edge === 'first' ? rows[0] : rows[rows.length - 1];
  return row?.kind === 'pagebreak';
}

/**
 * The divider LINE as it appears in the output: a bare mark gains a centring ［＃N字下げ］
 * prefix, N = `floor((charsPerLine − cells) / 2)` with cells measured by the layout itself
 * (a ruby/縦中横-bearing mark centres on its true advance); a value already carrying a
 * ［＃○字下げ］ prefix passes through verbatim, and N = 0 emits the bare mark — never a
 * ［＃０字下げ］. The annotation spelling keeps the offset out of the `.txt` prose while the
 * HTML side renders the same string through the indent machinery as padding.
 */
function dividerLine(divider: string, charsPerLine: number): string {
  const tokens = tokenize(divider);
  if (tokens[0]?.kind === 'indent') {
    return divider;
  }
  let cells = 0;
  for (const row of buildRows(tokens)) {
    if (row.kind === 'line') {
      for (const u of row.units) {
        cells += u.cells;
      }
    }
  }
  const pad = Math.max(0, Math.floor((charsPerLine - cells) / 2));
  return pad > 0 ? indentAnnotation(pad) + divider : divider;
}

/**
 * The junction "glue" between two adjacent chapters, as ONE shared string: the `.txt` build
 * joins newline-stripped chapter sources with `'\n' + glue`, and the HTML build inserts
 * `buildRows(tokenize(glue))` between the files' row batches — the leading `'\n'` belongs to
 * the txt seam only (it terminates the previous chapter's last line, which the HTML side has
 * already emitted), so the two outputs stay byte-faithful duals.
 *
 * One blank line ALWAYS separates chapters. The divider line plus one more blank follows
 * only when a divider is configured AND the next chapter does not open with a 見出し (the
 * heading IS the separator — heading and divider are mutually exclusive) AND the junction
 * does not abut a ［＃改ページ］ on either side (the page break separates by itself; a
 * divider dangling at a page seam serves nothing — the blank line still applies).
 *
 * Chapter edges are read LITERALLY: author blank lines are preserved and stack with the
 * glue. Passing the txt path's stripped previous source is equivalent — the strip only drops
 * the final-newline artifact. The glue is never autoTcy'd (both callers pass post-rewrite
 * sources); a divider that is itself a bare `!?` pair would only be combined on a `.txt`
 * re-render — documented here, not compensated.
 */
export function chapterGlue(
  prevSrc: string,
  nextSrc: string,
  divider: string,
  charsPerLine: number,
): string {
  if (
    divider !== '' &&
    !opensWithHeading(nextSrc) &&
    !pageBreakAt(prevSrc, 'last') &&
    !pageBreakAt(nextSrc, 'first')
  ) {
    return `\n${dividerLine(divider, charsPerLine)}\n\n`;
  }
  return '\n';
}

/**
 * The 印刷／PDF 保存 button, baked into every BUILD artifact (never the preview or the
 * EPUB): the file prints itself from whatever browser opens it — the extension's Print action
 * only opens the file. Screen-only fixed UI; build.print.css owns the geometry and the
 * @media print removal, so it cannot affect the paper. First in `<body>` = first (and only)
 * tab stop.
 */
const PRINT_BUTTON = '<button class="print" type="button" onclick="window.print()">印刷／PDF 保存</button>';

/**
 * Head script: `?p=1` on the document URL opens the print dialog once the page loads. No
 * shipped surface can send the query — OS browser hand-offs strip file:// queries and
 * fragments (macOS LaunchServices; Windows ShellExecute and GNOME gio can even fail on
 * them) — so this fires only on browser-internal navigations: an address-bar `?p=1`, a
 * bookmark, a local link.
 */
const PRINT_AUTORUN =
  '<script>if(new URLSearchParams(location.search).get(\'p\')===\'1\')addEventListener(\'load\',()=>{window.print();});</script>';

/** One junction's glue as rows; srcLine −1 = synthetic (emitLine emits no data-line anchor). */
function glueRows(glue: string, dash: DashMode): Row[] {
  return buildRows(tokenize(glue), { dash }).map((row) =>
    row.kind === 'line' ? { ...row, srcLine: -1 } : row,
  );
}

/**
 * Renders one or more books into a full, PAGINATED `<html>` document. The pure layout
 * engine ({@link paginate}) flows each book's text into an explicit
 * `<div class="book"><div class="page"><div class="line">…` skeleton sized by
 * `charsPerLine` x `linesPerPage` (vertical-rl by default), so the output is WYSIWYG
 * page-per-sheet; `chrome` adds the page furniture (line numbers, edge rules + frame,
 * page numbers, header) around that grid.
 *
 * Each book concatenates its `files[]` in order with {@link chapterGlue} between chapters
 * (a blank line, plus the book's divider where it applies); each book starts on a fresh
 * page (the bodies paginate per book). ［＃改ページ］ forces a page break. A book's `cover`
 * files render BEFORE its body as unnumbered, furniture-free pages, each starting on a
 * fresh page; they compile AFTER the bodies are paginated, so ［＃ここに「総ページ数」の値を
 * 表示］ substitutes the document's body page count — the same count the folio's
 * `{totalPage}` shows. `kinsoku` selects the 禁則処理 tier of the line-break engine;
 * `autoTcy` runs the 自動縦中横 source rewrite per file before tokenizing (the same front
 * door as the `.txt` build and the preview). All options are required and pre-resolved (the
 * settings resolver is the only default layer); "off" is the explicit all-off chrome.
 * Pure + vscode-free.
 */
export function renderBook(opts: {
  books: readonly BookInput[];
  charsPerLine: number;
  linesPerPage: number;
  linePitch: LinePitch;
  kinsoku: KinsokuMode;
  autoTcy: AutoTcyMode;
  dash: DashMode;
  paperSize: PaperSize;
  paperOrientation: PaperOrientation;
  /** Resolved `jpnov.layout.fontFamily`; '' = the built-in stack (css.ts DEFAULT_FONT_STACK). */
  fontFamily: string;
  chrome: BuildChrome;
}): string {
  const bodyRowsOf = (book: BookInput): Row[] => {
    const sources = book.files.map((file) => applyAutoTcy(file.src, opts.autoTcy));
    return sources.flatMap((src, fileIndex): Row[] => {
      const glue = fileIndex > 0
        ? glueRows(
            chapterGlue(sources[fileIndex - 1] ?? '', src, book.divider ?? '', opts.charsPerLine),
            opts.dash,
          )
        : [];
      return [...glue, ...buildRows(tokenize(src), { dash: opts.dash })];
    });
  };

  const coverPagesOf = (book: BookInput, totalBody: number): DisplayLine[][] => {
    const cover = book.cover;
    if (cover === undefined || cover.files.length === 0) {
      return [];
    }
    const values = { title: cover.title, author: cover.author, totalPages: String(totalBody) };
    const rows = cover.files.flatMap((file, i): Row[] => {
      const r = buildRows(tokenize(applyAutoTcy(file.src, opts.autoTcy)), { dash: opts.dash, values });
      return i > 0 ? [{ kind: 'pagebreak' }, ...r] : r; // each cover file starts on a fresh page
    });
    return paginate(rows, opts.charsPerLine, opts.linesPerPage, opts.kinsoku);
  };

  // Bodies paginate FIRST — covers need the count. Per book is output-identical to one run
  // with a pagebreak row at each seam: paginate flushes only non-empty pages.
  const bodies = opts.books.map((book) => ({
    book,
    pages: paginate(bodyRowsOf(book), opts.charsPerLine, opts.linesPerPage, opts.kinsoku),
  }));
  const totalBody = bodies.reduce((n, b) => n + b.pages.length, 0);

  const pages = bodies.flatMap(({ book, pages: bodyPages }): RenderPage[] => [
    ...coverPagesOf(book, totalBody).map((lines): RenderPage => ({ lines, cover: true })),
    ...bodyPages.map((lines): RenderPage => ({ lines })),
  ]);

  // Blank-template normalization (single source): a template that is blank after trim
  // means "no folio", folded into the one `pageNumber === 'none'` gate so the
  // `.pn` DOM element and its CSS rule always agree. Only the suppression check trims —
  // a rendered non-blank template keeps the author's literal spaces.
  const chrome: BuildChrome = {
    ...opts.chrome,
    pageNumber:
      opts.chrome.pageNumberFormat.trim() === '' ? 'none' : opts.chrome.pageNumber,
  };

  // Emit the body first so the CSS carries ONLY the classes used (on-demand).
  // [...used].sort() is lexicographic by class name (deterministic), not spec order.
  const used = new Set<string>();
  const body = pagesToHtml(pages, used, chrome);
  const css = stylesheet({
    paginate: true,
    charsPerLine: opts.charsPerLine,
    linesPerPage: opts.linesPerPage,
    linePitch: opts.linePitch,
    paperSize: opts.paperSize,
    paperOrientation: opts.paperOrientation,
    fontFamily: opts.fontFamily,
    chrome,
    usedClasses: [...used].sort(),
  });

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>${css}</style>${PRINT_AUTORUN}</head><body>${PRINT_BUTTON}${body}${emrProbe(used)}</body></html>`;
}

/**
 * Concatenates a book's `files[]` into ONE plain-text document — the byte-faithful dual of
 * {@link renderBook}. Each file's single trailing newline (the final-newline artifact) is
 * stripped, then adjacent files join with `'\n' + chapterGlue(...)`: the `'\n'` terminates
 * the previous chapter's last line, and the glue re-tokenizes into exactly the rows
 * `renderBook` inserts at that seam — cf. `buildRows`' `endLine`, which DROPS a trailing
 * empty line at end-of-input but KEEPS a genuine blank column on a real `\n` (so the glue's
 * own `"\n"` is one blank column, never a doubled one).
 *
 * Interior bytes pass through verbatim (no CRLF normalization): the tokenizer splits on `\n`
 * and treats a lone `\r` as a literal, exactly as the HTML build does. An empty book -> "".
 * (A wholly-empty middle file contributes one extra blank separator line compared to the
 * per-file render — a benign divergence, harmless for the Aozora `.txt` deliverable.)
 *
 * `autoTcy` is the ONE exception to byte-fidelity: `punctuationPairs` materializes the
 * 自動縦中横 rewrite per file (the same front door {@link renderBook} tokenizes through), so
 * the `.txt` carries explicit markers and round-trips idempotently. Pure + vscode-free.
 */
export function concatBookText(
  book: BookInput,
  autoTcy: AutoTcyMode,
  charsPerLine: number,
): string {
  const sources = book.files.map((file) => applyAutoTcy(file.src, autoTcy).replace(/\r?\n$/, ''));
  return sources.reduce(
    (acc, src, i) =>
      i === 0
        ? src
        : `${acc}\n${chapterGlue(sources[i - 1] ?? '', src, book.divider ?? '', charsPerLine)}${src}`,
    '',
  );
}
