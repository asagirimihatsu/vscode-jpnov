/**
 * Generates the document stylesheet. The default writing mode is vertical-rl (縦書き).
 * `charsPerLine` = characters per line, `linesPerPage` = lines per page.
 *
 * - paginate=true (BUILD): styles the explicit `.book > .page > .line` skeleton the
 *   layout engine emits. Each `.page` is one printed sheet (`break-after:page`) and, in
 *   vertical-rl, a column grid `linesPerPage` lines wide (block axis, lineHeight em each)
 *   by `charsPerLine` chars tall (inline axis). Visible on screen as bordered sheets.
 * - paginate=false (PREVIEW): a single continuous flow of the SAME `.line` columns the build
 *   emits (already hard-wrapped by the layout engine — no CSS width cap), with ［＃改ページ］
 *   shown as a visible `<hr>` marker.
 *
 * Pure + vscode-free.
 */

import { emphasisClassRule } from './emphasis.ts';

const DEFAULT_LINES_PER_PAGE = 34;
/** Default 折り返し width; shared with the preview renderer's wrap fallback. */
export const DEFAULT_CHARS_PER_LINE = 40;
/** Inter-line (column) pitch as a multiple of 1em; also the CSS line-height. */
const LINE_HEIGHT = 1.75;

export function stylesheet(opts: {
  charsPerLine?: number;
  linesPerPage?: number;
  paginate: boolean;
  /**
   * The emphasis class names the document actually uses (on-demand): only their rules are
   * emitted, so an unused 傍点 variant costs nothing. Callers pass these pre-sorted
   * (lexicographic by class name — not spec order) for deterministic CSS output.
   */
  emphasisClasses?: readonly string[];
}): string {
  const charsPerLine = opts.charsPerLine ?? DEFAULT_CHARS_PER_LINE;
  const linesPerPage = opts.linesPerPage ?? DEFAULT_LINES_PER_PAGE;
  const pageBlock = linesPerPage * LINE_HEIGHT;
  const emphasisRules = (opts.emphasisClasses ?? []).map(emphasisClassRule);

  if (opts.paginate) {
    return [
      `html{font-family:serif;}`,
      `body{margin:0;}`,
      `.book{display:block;}`,
      // One sheet: linesPerPage columns (block) x charsPerLine chars (inline).
      `.page{writing-mode:vertical-rl;line-height:${String(LINE_HEIGHT)};` +
        `inline-size:${String(charsPerLine)}em;block-size:${String(pageBlock)}em;` +
        `border:1px solid #444;margin:0 auto 1em;background:#fff;` +
        `box-sizing:content-box;overflow:hidden;break-after:page;page-break-after:always;}`,
      // Each line is one fixed-thickness column; an empty line is a blank column.
      `.line{block-size:${String(LINE_HEIGHT)}em;margin:0;white-space:pre;}`,
      `ruby>rt{font-size:0.5em;}`,
      // Print sheet = one grid page.
      `@page{size:${String(pageBlock)}em ${String(charsPerLine)}em;margin:0;}`,
      ...emphasisRules,
    ].join('');
  }

  // PREVIEW: a continuous flow of the SAME `.line` columns the build emits (the layout engine
  // has already hard-wrapped each line), with ［＃改ページ］ shown as a visible <hr>. No
  // inline-size cap — wrapping is done in JS now, so a CSS cap would only double-constrain.
  return [
    `html{writing-mode:vertical-rl;font-family:serif;line-height:${String(LINE_HEIGHT)};font-size:1rem;}`,
    `body{margin:0;}`,
    // Pin the manuscript to a stable serif reading size (1rem) on both html and .line, so a
    // host/webview-injected body{font-size} can't shrink the preview to the editor's UI font.
    `.line{block-size:${String(LINE_HEIGHT)}em;margin:0;white-space:pre;font-size:1rem;font-family:serif;}`,
    `ruby>rt{font-size:0.5em;}`,
    `.pagebreak{border:0;border-block-start:2px dashed currentColor;margin-block:1em;}`,
    ...emphasisRules,
  ].join('');
}
