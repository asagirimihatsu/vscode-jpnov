/**
 * Generates the document stylesheet. The default writing mode is vertical-rl (縦書き).
 *
 * - paginate=true (BUILD): styles the explicit `.book > .page > .line` skeleton the
 *   layout engine emits. Each `.page` is one printed sheet (`break-after:page`) and, in
 *   vertical-rl, a column grid `linesPerPage` lines wide (block axis, lineHeight em each)
 *   by `charsPerLine` chars tall (inline axis). Chrome (line numbers / edge rules / page
 *   numbers / header) lives in padding bands that grow the sheet — the header and folio
 *   bands are always reserved, the line-number band is on demand — while the text grid
 *   itself never changes size, so the printed body stays WYSIWYG.
 * - paginate=false (PREVIEW): a single continuous flow of the SAME `.line` columns the
 *   build emits (already hard-wrapped by the layout engine — no CSS width cap), with
 *   ［＃改ページ］ shown as a labelled `<div class="pagebreak">` marker. The root
 *   font-size is fit-to-viewport — (100vh − 2·pad) / charsPerLine — so a full line
 *   always fills the pane top to bottom.
 *
 * Chrome sub-elements (`.pn` / `.hd` / the `.line::before` numbers) are horizontal-tb
 * INSIDE a vertical-rl container, so they are positioned with PHYSICAL properties only
 * (logical insets resolve against the element's OWN writing mode and would land them on
 * the wrong edge). The sheet's own band padding stays logical: `.page` is vertical-rl
 * itself, so `padding-inline-start/end` = physical top/bottom.
 *
 * Pure + vscode-free.
 */

import type { BuildChrome, EdgeLineStyle, PreviewChrome } from './chrome.ts';
import { styleRule } from './emphasis.ts';

/** Inter-line (column) pitch as a multiple of 1em; also the CSS line-height. */
const LINE_HEIGHT = 1.75;
/**
 * The wider pitch used whenever edge rules are on. A ruby annotation (rt at 0.5em) needs
 * pitch ≥ 2em to stay inside its own line box (glyph half 0.5 + rt 0.5 on the over side);
 * at the default 1.75em it overflows into the boundary, where an edge rule would strike
 * straight through the 注音. 2.25 keeps a 0.125em clearance on each side.
 */
const EDGE_LINE_HEIGHT = 2.25;
/**
 * Preview-only vertical (inline-axis) padding above/below the columns, in px. The
 * fit-to-viewport font-size subtracts twice this from 100vh; the bottom half also keeps
 * the horizontal scrollbar (~10px in vscode webviews) from covering the last character.
 *
 * The inline-start (top) half doubles as the band the line-number span (`.ln`) is lifted
 * into: OUT of the text flow (absolutely positioned) at a FIXED px font — in-flow or
 * em-sized content would break the exact-fill invariant (charsPerLine × 1em =
 * 100vh − 2·pad). If the band ever gets too small, split this into start/end constants
 * and subtract both in the calc.
 */
const PREVIEW_PAD_PX = 16;

// Build-only chrome bands, in em (the same unit system as the charsPerLine-em grid).
// The header and folio bands are ALWAYS allocated — the sheet keeps stable top/bottom
// margins no matter which furniture is enabled — while the line-number band is on demand.
// Both are deliberately as wide as PRINT_MARGIN: the furniture pins to the sheet's outer
// edge, leaving ≥1em of air to the text frame (the look of a print-margin header/footer).
/** Header band at the physical top of a sheet (reserved even with no header text). */
const HEADER_BAND = 2.5;
/** Line-number band between the header band and the column heads. */
const LINENUM_BAND = 1;
/** Page-number (folio) band at the physical bottom of a sheet (reserved even without one). */
const FOLIO_BAND = 2.5;
/**
 * Uniform paper margin around the printed sheet (@page only — the screen sheet is
 * untouched): ~10.6mm at the default 16px em, clear of typical printer dead zones, so a
 * direct print never puts the frame or the chrome at the paper edge.
 */
const PRINT_MARGIN = 2.5;

/** Edge-rule stroke width (px); shared by the preview rules and the build rules + frame. */
const EDGE_RULE_PX = 1;
/** The 赤 edge-rule colour, identical in preview and build. */
const EDGE_RED = '#cc0000';

/**
 * Maps an edge-line style to its CSS colour, or null for 'none' (no rule). 黒 is
 * theme-relative in the preview (currentColor — literal black would vanish on a dark
 * theme) but ink-black in the build (#000 on the white sheet); 赤 is the same in both.
 * Single home of the edge-rule colour policy.
 */
export function edgeRuleColor(edge: EdgeLineStyle, paginate: boolean): string | null {
  switch (edge) {
    case 'none':
      return null;
    case 'red':
      return EDGE_RED;
    case 'black':
      return paginate ? '#000' : 'currentColor';
  }
}

/**
 * The CSS rule for one used class name, or '' for an unknown one (keeps the "no stray rules"
 * invariant). `indent-N` (字下げ) is generated here — it is layout geometry, not a style-table
 * entry; the suffix check is defence in depth (emitLine only ever emits positive N_eff). Every
 * other class (emph-* / dec-* / b / i) is forwarded to emphasis.ts's {@link styleRule}, the
 * single home of the style CSS values.
 */
function classRule(name: string): string {
  if (name.startsWith('indent-')) {
    const n = name.slice('indent-'.length);
    return /^[1-9][0-9]*$/.test(n) ? `.indent-${n}{padding-inline-start:${n}em}` : '';
  }
  return styleRule(name);
}

type StylesheetOptions =
  | {
      readonly paginate: true;
      readonly charsPerLine: number;
      readonly linesPerPage: number;
      readonly chrome: BuildChrome;
      readonly usedClasses?: readonly string[];
    }
  | {
      readonly paginate: false;
      readonly charsPerLine: number;
      readonly chrome: PreviewChrome;
      readonly usedClasses?: readonly string[];
    };

/**
 * Renders the stylesheet for one document. `usedClasses` is the on-demand class sink
 * (callers pass it pre-sorted, lexicographic by class name, for deterministic output);
 * chrome rules are likewise emitted only when the corresponding feature is on, in a fixed
 * order (line numbers → header → folio), so the output stays deterministic.
 */
export function stylesheet(opts: StylesheetOptions): string {
  const rules = (opts.usedClasses ?? []).map(classRule);

  if (opts.paginate) {
    const { charsPerLine, linesPerPage, chrome } = opts;
    const ruleColor = edgeRuleColor(chrome.edgeLine, true); // null ⟺ no edge rules
    const pitch = ruleColor === null ? LINE_HEIGHT : EDGE_LINE_HEIGHT;
    const pageBlock = linesPerPage * pitch;
    const borderColor = ruleColor ?? '#444';
    const hTop = HEADER_BAND + (chrome.lineNumbers ? LINENUM_BAND : 0);
    const hBot = FOLIO_BAND;

    const chromeRules: string[] = [];
    if (chrome.lineNumbers) {
      // The number sits ABOVE its column: lifted by its own height into the line-number
      // band (inside the padding box, so overflow:hidden keeps it).
      chromeRules.push(
        `.line::before{content:counter(ln);position:absolute;top:0;left:0;right:0;` +
          `transform:translateY(-100%);writing-mode:horizontal-tb;text-align:center;` +
          `font-size:0.5em;color:#888;}`,
      );
    }
    if (chrome.header !== '') {
      chromeRules.push(
        `.hd{position:absolute;top:0;left:0;right:0;writing-mode:horizontal-tb;` +
          `text-align:center;font-size:0.9em;color:#000;}`,
      );
    }
    if (chrome.pageNumberPosition !== 'none') {
      chromeRules.push(
        `.pn{position:absolute;bottom:0.5em;writing-mode:horizontal-tb;font-size:0.8em;color:#444;}`,
        `.pn.r{right:0.35em;}`,
        `.pn.l{left:0.35em;}`,
      );
    }

    return [
      `html{font-family:serif;}`,
      `body{margin:0;}`,
      `.book{display:block;}`,
      // One sheet: linesPerPage columns (block) x charsPerLine chars (inline). The bands
      // are padding OUTSIDE the content box, so the grid keeps its exact size and the
      // sheet grows instead; overflow's clip box is the padding box, so band content
      // stays visible while anything past it is cut.
      `.page{writing-mode:vertical-rl;line-height:${String(pitch)};` +
        `inline-size:${String(charsPerLine)}em;block-size:${String(pageBlock)}em;` +
        `padding-inline-start:${String(hTop)}em;padding-inline-end:${String(hBot)}em;` +
        `position:relative;margin:0 auto 1em;background:#fff;` +
        `box-sizing:content-box;overflow:hidden;break-after:page;page-break-after:always;` +
        `${chrome.lineNumbers ? 'counter-reset:ln;' : ''}}`,
      // The frame hugs the TEXT GRID (inset past the bands), so line numbers, header and
      // folio all sit OUTSIDE it — like the printed 枠 of 原稿用紙.
      `.page::before{content:"";position:absolute;top:${String(hTop)}em;right:0;` +
        `bottom:${String(hBot)}em;left:0;` +
        `border:${String(EDGE_RULE_PX)}px solid ${borderColor};pointer-events:none;}`,
      // Each line is one fixed-thickness column. The inter-column rule is a box-shadow —
      // pure paint, so the pitch never moves; the leftmost column's shadow spills past
      // the padding box and is clipped, leaving the frame's own edge to close the run
      // (no doubled line).
      `.line{block-size:${String(pitch)}em;margin:0;white-space:pre;` +
        (ruleColor === null ? '' : `box-shadow:-${String(EDGE_RULE_PX)}px 0 0 0 ${ruleColor};`) +
        `${chrome.lineNumbers ? 'counter-increment:ln;position:relative;' : ''}}`,
      `ruby>rt{font-size:0.5em;}`,
      // Print sheet = one grid page, grown by the same bands plus a uniform paper margin.
      // The margin lives on the SHEET (below), never on @page: browsers render their own
      // print headers/footers (date, URL, their page numbers) into the @page margin boxes,
      // so zero @page margins are what keeps that furniture off the paper.
      `@page{size:${String(pageBlock + 2 * PRINT_MARGIN)}em ` +
        `${String(charsPerLine + hTop + hBot + 2 * PRINT_MARGIN)}em;` +
        `margin:0;}`,
      // Print fixes, verified against headless Chromium:
      // - root goes vertical-rl so the sheets are ordinary in-flow blocks — as ORTHOGONAL
      //   flows (vertical sheets in a horizontal root) Chromium splits every near-page-size
      //   sheet onto two papers regardless of fit;
      // - the sheet's own margin replaces both the screen 1em gap and the paper inset.
      `@media print{html{writing-mode:vertical-rl;}` +
        `.page{margin:${String(PRINT_MARGIN)}em;}}`,
      ...chromeRules,
      ...rules,
    ].join('');
  }

  // PREVIEW: a continuous flow of the SAME `.line` columns the build emits (the layout
  // engine has already hard-wrapped each line), with ［＃改ページ］ shown as a labelled
  // marker. No inline-size cap — wrapping is done in JS, so a CSS cap would only
  // double-constrain.
  const { charsPerLine, chrome } = opts;
  const edgeColor = edgeRuleColor(chrome.edgeLine, false); // null ⟺ no edge rules
  const pitch = edgeColor === null ? LINE_HEIGHT : EDGE_LINE_HEIGHT; // rules must clear ruby

  const feature: string[] = [];
  if (chrome.lineNumbers) {
    // The numbers themselves are `<span class="ln">` heads emitted by flowToHtml (JS-computed,
    // restarting after each break marker — a sibling counter-reset does not reset following
    // siblings in Chromium, so CSS counters can't express the page-local numbering here).
    // Fixed px font, absolutely lifted into the PREVIEW_PAD_PX band — never in-flow, never
    // em-sized (the fit-to-viewport invariant, see PREVIEW_PAD_PX).
    feature.push(
      `.line{position:relative;}`,
      `.ln{position:absolute;top:0;left:0;right:0;` +
        `transform:translateY(-100%);writing-mode:horizontal-tb;text-align:center;` +
        `font-size:10px;line-height:1;color:var(--vscode-editorLineNumber-foreground,#888);` +
        `pointer-events:none;user-select:none;}`,
    );
  } else if (edgeColor !== null) {
    feature.push(`.line{position:relative;}`);
  }
  if (edgeColor !== null) {
    // Same recipe as the build: every column draws ONE left rule (a right+left pair per
    // boundary would stack into a fat 2px line), and a real frame on `.book` closes the
    // outer edges and the top/bottom of the writing band — no first/last special cases.
    // The rule box is out-of-flow and fixed-height (the full band), so blank and short
    // columns rule at full height and the column pitch never moves; the outermost
    // column's rule lands on the same pixel strip as the frame's inward border.
    feature.push(
      `.line::after{content:"";position:absolute;top:0;left:0;right:0;` +
        `height:calc(100vh - ${String(2 * PREVIEW_PAD_PX)}px);box-sizing:border-box;` +
        `border-left:${String(EDGE_RULE_PX)}px solid ${edgeColor};pointer-events:none;}`,
      `.book{position:relative;}`,
      `.book::before{content:"";position:absolute;inset:0;` +
        `border:${String(EDGE_RULE_PX)}px solid ${edgeColor};pointer-events:none;}`,
    );
  }

  return [
    // Fit-to-viewport type scale: in vertical-rl a full-width char advances exactly 1em along
    // the column, so (100vh − 2·pad) / charsPerLine makes a full charsPerLine-char line fill
    // the pane top to bottom; vh re-evaluates on panel resize, so no script is involved.
    `html{writing-mode:vertical-rl;font-family:serif;line-height:${String(pitch)};` +
      `font-size:calc((100vh - ${String(2 * PREVIEW_PAD_PX)}px) / ${String(charsPerLine)});}`,
    // The inline axis is vertical here: padding-inline is the top/bottom breathing room the
    // font-size formula subtracts.
    `body{margin:0;padding-inline:${String(PREVIEW_PAD_PX)}px;}`,
    // Re-pin the manuscript to the scaled root (1rem) on .line, so a host/webview-injected
    // body{font-size} can't desync the glyph advance from the em-based line pitch.
    `.line{block-size:${String(pitch)}em;margin:0;white-space:pre;font-size:1rem;font-family:serif;}`,
    `ruby>rt{font-size:0.5em;}`,
    // The forced-page-break marker: a dashed rule with a small vertical 「改ページ」 label
    // pinned to its middle, so it reads as a page break and not as an edge rule.
    `.pagebreak{position:relative;border:0;border-block-start:2px dashed currentColor;margin-block:1em;}`,
    `.pb-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);` +
      `writing-mode:vertical-rl;font-size:10px;line-height:1;color:currentColor;` +
      `background:var(--vscode-editor-background,#fff);padding-block:2px;` +
      `pointer-events:none;user-select:none;}`,
    ...feature,
    ...rules,
  ].join('');
}
