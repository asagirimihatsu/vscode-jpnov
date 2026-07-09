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
 *   build emits (already hard-wrapped by the layout engine — no CSS width cap), grouped
 *   into per-break `.segment` blocks — the build page's preview analogue, each carrying
 *   its own edge-rule frame — with ［＃改ページ］ shown as a labelled
 *   `<div class="pagebreak">` marker BETWEEN segments. The root font-size is
 *   fit-to-viewport — (100vh − 2·pad) / (charsPerLine + 2·EDGE_INSET) — so a full line
 *   plus the always-reserved frame gaps fills the pane top to bottom.
 *
 * In BOTH modes the edge rules are pure paint: the EDGE_INSET gap is reserved and the
 * pitch is LINE_PITCH whether edgeLine is on or off, so toggling it never moves a glyph,
 * a line number, or a page boundary.
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

/**
 * Inter-line (column) pitch as a multiple of 1em; also the CSS line-height. ONE constant,
 * edge rules on or off (the uniform-layout contract: every column is the same width
 * whether the 枠 is drawn or not, so toggling edgeLine reflows nothing). A ruby
 * annotation (rt at 0.5em) needs pitch ≥ 2em to stay inside its own line box (glyph half
 * 0.5 + rt 0.5 on the over side); 2.25 keeps a 0.125em clearance on each side, so the
 * inter-column rules — when drawn — never strike through the 注音.
 */
const LINE_PITCH = 2.25;
/**
 * Breathing gap between the text and the edge-rule frame (枠), in ROOT em — ALWAYS
 * reserved, frame drawn or not, so toggling edgeLine never moves a glyph or a line
 * number. A glyph-relative unit, not px: the air must read against the glyph size at any
 * fit scale. Purely visual — Chromium does not overhang ruby past a column's inline ends
 * (long readings stretch the ruby box along the column instead), so this is not a ruby
 * allowance. The preview reserves it by insetting the TEXT (fit-formula denominator +
 * .segment padding); the build reserves it by outsetting the FRAME into the chrome bands
 * (the text grid and @page never move). Preview lengths write it as REM (the webview
 * host injects body{font-size}, which would skew an em on anything outside the
 * font-size:1rem re-pinned .line); build lengths write it as em (standalone document —
 * nothing overrides fonts, and the page em IS the root em).
 */
const EDGE_INSET = 0.25;
/**
 * Preview-only vertical (inline-axis) padding above/below the columns, in px. The
 * fit-to-viewport font-size subtracts twice this from 100vh; the bottom half also keeps
 * the horizontal scrollbar (~10px in vscode webviews) from covering the last character.
 *
 * The inline-start (top) half doubles as the band the line-number span (`.ln`) is lifted
 * into: OUT of the text flow (absolutely positioned) at a FIXED px font — in-flow or
 * em-sized content would break the exact-fill invariant ((charsPerLine + 2·EDGE_INSET) ×
 * 1em = 100vh − 2·pad). If the band ever gets too small, split this into start/end
 * constants and subtract both in PREVIEW_BAND.
 */
const PREVIEW_PAD_PX = 16;
/** The writing band's CSS length: the viewport minus both PREVIEW_PAD_PX pads. */
const PREVIEW_BAND = `100vh - ${String(2 * PREVIEW_PAD_PX)}px`;
/**
 * Air between the `.ln` number's bottom edge and the frame line below it, in px. The
 * number is lifted its own height, then EDGE_INSET·rem (rem = the fit em = exactly the
 * .segment text inset, so the em term cancels and the number lands at the same pad-band
 * spot at ANY fit size), then this gap — just clear of the 枠 stroke, still inside the
 * PREVIEW_PAD_PX band.
 */
const LN_GAP_PX = 2;
/**
 * How far the ［＃改ページ］ dashed rule overshoots the writing band into EACH of the
 * PREVIEW_PAD_PX bands, in px (negative margin-inline on the auto-sized marker box).
 * Half the pad: clearly past the 1px segment frames — the break outranks the 枠 and the
 * text alike — while the tips stay off the viewport edge and clear of most of the ~10px
 * scrollbar strip the bottom pad reserves. Must stay ≤ PREVIEW_PAD_PX so the marker
 * never leaves the body padding box (no overflow, no stray scrollbar).
 */
const PAGEBREAK_PROTRUDE_PX = PREVIEW_PAD_PX / 2;

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
/** The 赤 edge-rule base colour. */
const EDGE_RED = '#cc0000';
/** Knocks an edge-rule base colour back to 80% alpha — rules sit under the text's weight. */
const edgeAlpha = (base: string): string => `color-mix(in srgb,${base} 80%,transparent)`;

/**
 * Maps an edge-line style to its CSS colour, or null for 'none' (no rule). One recipe,
 * identical in preview and build: the base colour at 80% alpha. `text` bases on
 * currentColor — the rules always match the surrounding text (theme foreground in the
 * preview, ink on the build's white sheet). Single home of the edge-rule colour policy.
 */
export function edgeRuleColor(edge: EdgeLineStyle): string | null {
  switch (edge) {
    case 'none':
      return null;
    case 'red':
      return edgeAlpha(EDGE_RED);
    case 'text':
      return edgeAlpha('currentColor');
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
    const ruleColor = edgeRuleColor(chrome.edgeLine); // null ⟺ no edge rules, no frame
    const pageBlock = linesPerPage * LINE_PITCH;
    const hTop = HEADER_BAND + (chrome.lineNumbers ? LINENUM_BAND : 0);
    const hBot = FOLIO_BAND;

    const chromeRules: string[] = [];
    if (chrome.lineNumbers) {
      // The number sits ABOVE its column: lifted by its own height into the line-number
      // band (inside the padding box, so overflow:hidden keeps it), plus EDGE_INSET so it
      // stays OUTSIDE the outset frame. That extra lift is rem, not em: font-size:0.5em
      // halves the local em, while rem = the page em (the build never sets a root
      // font-size) — the same base the frame's inset is measured in. line-height:1 keeps
      // the lifted box its glyph height, inside the LINENUM_BAND.
      chromeRules.push(
        `.line::before{content:counter(ln);position:absolute;top:0;left:0;right:0;` +
          `transform:translateY(calc(-100% - ${String(EDGE_INSET)}rem));` +
          `writing-mode:horizontal-tb;text-align:center;` +
          `font-size:0.5em;line-height:1;color:#888;}`,
      );
    }
    if (chrome.header !== '') {
      chromeRules.push(
        `.hd{position:absolute;top:0;left:0;right:0;writing-mode:horizontal-tb;` +
          `text-align:center;font-size:0.9em;line-height:1;color:#000;}`,
      );
    }
    if (chrome.pageNumberPosition !== 'none') {
      // line-height:1 (here as on .hd and .line::before) keeps the furniture box its
      // glyph height — an inherited 2.25 line box would reach grazing distance of the
      // outset frame.
      chromeRules.push(
        `.pn{position:absolute;bottom:0.5em;writing-mode:horizontal-tb;font-size:0.8em;line-height:1;color:#444;}`,
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
      `.page{writing-mode:vertical-rl;line-height:${String(LINE_PITCH)};` +
        `inline-size:${String(charsPerLine)}em;block-size:${String(pageBlock)}em;` +
        `padding-inline-start:${String(hTop)}em;padding-inline-end:${String(hBot)}em;` +
        `position:relative;margin:0 auto 1em;background:#fff;` +
        `box-sizing:content-box;overflow:hidden;break-after:page;page-break-after:always;` +
        `${chrome.lineNumbers ? 'counter-reset:ln;' : ''}}`,
      // The frame floats EDGE_INSET off the text grid, borrowed from the bands, so the
      // glyphs never touch the stroke while line numbers, header and folio still sit
      // OUTSIDE it — like the printed 枠 of 原稿用紙. Emitted only when edge rules are on
      // ('none' draws no frame in either medium); the grid itself never moves.
      ...(ruleColor === null
        ? []
        : [
            `.page::before{content:"";position:absolute;top:${String(hTop - EDGE_INSET)}em;right:0;` +
              `bottom:${String(hBot - EDGE_INSET)}em;left:0;` +
              `border:${String(EDGE_RULE_PX)}px solid ${ruleColor};pointer-events:none;}`,
          ]),
      // Each line is one fixed-thickness column.
      `.line{block-size:${String(LINE_PITCH)}em;margin:0;white-space:pre;` +
        (chrome.lineNumbers ? 'counter-increment:ln;' : '') +
        `${chrome.lineNumbers || ruleColor !== null ? 'position:relative;' : ''}}`,
      // The inter-column rule is the preview's recipe transplanted: each column but the
      // page's last draws ONE left rule (out-of-flow paint — the pitch never moves),
      // stretched EDGE_INSET past both grid ends so it meets the outset frame exactly.
      // The last column draws none: its outer edge is the frame's own border, and the
      // 80%-alpha strokes would composite into a visibly darker line.
      ...(ruleColor === null
        ? []
        : [
            `.line:not(:last-child)::after{content:"";position:absolute;` +
              `top:-${String(EDGE_INSET)}em;bottom:-${String(EDGE_INSET)}em;left:0;right:0;` +
              `border-left:${String(EDGE_RULE_PX)}px solid ${ruleColor};pointer-events:none;}`,
          ]),
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
  // engine has already hard-wrapped each line), grouped into per-break `.segment` blocks,
  // with ［＃改ページ］ shown as a labelled marker between them. No inline-size cap —
  // wrapping is done in JS, so a CSS cap would only double-constrain.
  const { charsPerLine, chrome } = opts;
  const edgeColor = edgeRuleColor(chrome.edgeLine); // null ⟺ no edge rules

  const feature: string[] = [];
  if (chrome.lineNumbers || edgeColor !== null) {
    // The anchor box for the out-of-flow per-line chrome (.ln heads, edge rules).
    feature.push(`.line{position:relative;}`);
  }
  if (chrome.lineNumbers) {
    // The numbers themselves are `<span class="ln">` heads emitted by flowToHtml (JS-computed,
    // restarting after each break marker — a sibling counter-reset does not reset following
    // siblings in Chromium, so CSS counters can't express the page-local numbering here).
    // Fixed px font, absolutely lifted into the PREVIEW_PAD_PX band — never in-flow, never
    // em-sized (the fit-to-viewport invariant, see PREVIEW_PAD_PX). The lift walks back the
    // .segment text inset with the SAME length in rem (rem = the fit em), so the number
    // sits at a fixed pad-band spot at any fit size, LN_GAP_PX above the frame line.
    feature.push(
      `.ln{position:absolute;top:0;left:0;right:0;` +
        `transform:translateY(calc(-100% - ${String(EDGE_INSET)}rem - ${String(LN_GAP_PX)}px));` +
        `writing-mode:horizontal-tb;text-align:center;` +
        `font-size:10px;line-height:1;color:var(--vscode-editorLineNumber-foreground,#888);` +
        `pointer-events:none;user-select:none;}`,
    );
  }
  if (edgeColor !== null) {
    // Same recipe as the build: each column draws ONE left rule (a right+left pair per
    // boundary would stack into a fat 2px line), and a real frame per `.segment` closes
    // the outer edges — the build's per-`.page` 枠 transplanted, so the frames on either
    // side of a ［＃改ページ］ close independently and the marker rides BETWEEN them,
    // never inside one. The LAST (leftmost) column draws no rule: it would land on the
    // same pixel strip as the frame's left border, and the 80%-alpha strokes would
    // composite into a visibly darker line — the frame alone closes the run, as the
    // build's overflow clip does. Frame and rule boxes are out-of-flow at the same fixed
    // height (the full band): blank and short columns rule at full height, a short
    // segment's frame still spans the band, and the column pitch never moves.
    // Rule and frame share one band box up to its top anchor: the frame's containing
    // block is the .segment padding box (= the band), so it starts at 0; the rule anchors
    // on a .line already inset EDGE_INSET by the segment padding, so it climbs back the
    // same length — in REM, the exact unit of that padding, so a webview-injected
    // body{font-size} can't desync the two — to meet the frame's top edge exactly.
    const bandBox = (top: string): string =>
      `content:"";position:absolute;top:${top};left:0;right:0;height:calc(${PREVIEW_BAND});`;
    feature.push(
      `.line:not(:last-child)::after{${bandBox(`-${String(EDGE_INSET)}rem`)}` +
        `border-left:${String(EDGE_RULE_PX)}px solid ${edgeColor};pointer-events:none;}`,
      // border-box keeps the frame's own borders inside the band height (the rule has no
      // block-axis borders, so it needs no box-sizing).
      `.segment::before{${bandBox('0')}box-sizing:border-box;` +
        `border:${String(EDGE_RULE_PX)}px solid ${edgeColor};pointer-events:none;}`,
    );
  }

  return [
    // Fit-to-viewport type scale: in vertical-rl a full-width char advances exactly 1em along
    // the column, so (100vh − 2·pad) / (charsPerLine + 2·EDGE_INSET) makes a full line PLUS
    // the always-reserved frame gaps fill the pane top to bottom; vh re-evaluates on panel
    // resize, so no script is involved.
    `html{writing-mode:vertical-rl;font-family:serif;line-height:${String(LINE_PITCH)};` +
      `font-size:calc((${PREVIEW_BAND}) / ${String(charsPerLine + 2 * EDGE_INSET)});}`,
    // The inline axis is vertical here: padding-inline is the top/bottom breathing room the
    // font-size formula subtracts.
    `body{margin:0;padding-inline:${String(PREVIEW_PAD_PX)}px;}`,
    // Every segment insets its text EDGE_INSET from both band ends — the reserve the fit
    // formula's denominator pays for. Unconditional (frame or not): toggling edgeLine must
    // not move the text. REM, not em: the webview host injects body{font-size}, and an em
    // here would follow it while the text follows the 1rem-pinned .line — same defence as
    // .line{font-size:1rem}. position:relative doubles as the frame's anchor box.
    `.segment{position:relative;padding-inline:${String(EDGE_INSET)}rem;}`,
    // Re-pin the manuscript to the scaled root (1rem) on .line, so a host/webview-injected
    // body{font-size} can't desync the glyph advance from the em-based line pitch.
    `.line{block-size:${String(LINE_PITCH)}em;margin:0;white-space:pre;font-size:1rem;font-family:serif;}`,
    `ruby>rt{font-size:0.5em;}`,
    // The forced-page-break marker: a dashed rule with a small vertical 「改ページ」 label
    // pinned to its middle, so it reads as a page break and not as an edge rule. The
    // negative inline margins stretch the auto-sized box past the writing band into each
    // pad, so the rule's tips overshoot the segment frames and the text alike (the break
    // outranks both) — deliberately independent of edgeLine, the marker's reach is not a
    // frame property. The symmetric stretch leaves the centred label untouched.
    `.pagebreak{position:relative;border-block-start:2px dashed currentColor;` +
      `margin-block:1em;margin-inline:-${String(PAGEBREAK_PROTRUDE_PX)}px;}`,
    `.pb-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);` +
      `writing-mode:vertical-rl;font-size:10px;line-height:1;color:currentColor;` +
      `background:var(--vscode-editor-background,#fff);padding-block:2px;` +
      `pointer-events:none;user-select:none;}`,
    ...feature,
    ...rules,
  ].join('');
}
