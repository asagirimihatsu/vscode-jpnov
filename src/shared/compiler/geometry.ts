/**
 * The page-geometry constants the TypeScript side still CONSUMES at runtime — the paper-fit
 * generator (css.ts's `paperRules` via {@link fitPaper}) and the `--htop` band variable are
 * computed from these, so they cannot live only in the static stylesheets.
 *
 * Three of them (LINE_PITCH, FOLIO_BAND, SIDE_PAD) are ALSO written as plain literals in
 * `styles/*.css` (`2.25em` column pitch, `3em` folio band, `1.5em` side pads): that
 * double home is deliberate — `@page` cannot read `var()` portably (ruling: build output
 * stays portable) — and is guarded by `test/shared/compiler/styles-codegen.test.ts`, which
 * asserts the `.css` literals equal these constants. Change a value here WITHOUT updating the
 * fragments (or vice versa) and that test fails loudly.
 *
 * Pure + vscode-free.
 */

/**
 * Inter-line (column) pitch as a multiple of 1em; also the CSS line-height. ONE constant,
 * edge rules on or off (the uniform-layout contract: every column is the same width
 * whether the 枠 is drawn or not, so toggling edgeLine never moves a glyph within its
 * segment/page). A ruby
 * annotation (rt at 0.5em) needs pitch ≥ 2em to stay inside its own line box (glyph half
 * 0.5 + rt 0.5 on the over side); 2.25 keeps a 0.125em clearance on each side, so the
 * inter-column rules — when drawn — never strike through the 注音.
 */
export const LINE_PITCH = 2.25;

// Build-only chrome bands, in em (the same unit system as the charsPerLine-em grid).
// The header and folio bands are ALWAYS allocated — the sheet keeps stable top/bottom
// margins no matter which furniture is enabled — while the line-number band is on demand.
// The furniture floats 1em inside the sheet edge (.hd top / .pn bottom, kept symmetric),
// leaving ~0.75em of air to the outset frame (the look of a print-margin header/footer).
/** Header band at the physical top of a sheet (reserved even with no header text). */
export const HEADER_BAND = 3;
/** Line-number band between the header band and the column heads. */
export const LINENUM_BAND = 1;
/** Page-number (folio) band at the physical bottom of a sheet (reserved even without one). */
export const FOLIO_BAND = 3;
/**
 * Sheet padding on the physical left/right (the vertical-rl block axis): the text grid and
 * the outset frame never touch the paper's side cut. Doubly homed as fragment literals
 * (padding-block, frame sides, folio corners at SIDE_PAD + 0.35 EDGE_INSET) —
 * styles-codegen.test.ts guards the set.
 */
export const SIDE_PAD = 1.5;
/**
 * MINIMUM paper inset per side, in em: {@link fitPaper} caps the font size so the sheet keeps
 * at least this surround inside the paper (the tight axis lands at 2.48–2.49em after the
 * emission guard — ~8.7mm on A4, clear of typical printer dead zones). The screen sheet's
 * 2.5em inter-paper gap (build.base.css) is a cosmetic look-alike, no longer coupled.
 */
export const PRINT_MARGIN = 2.5;

/** The 赤 edge-rule base colour (原稿用紙の赤枠) — semantic red, identical in both media. */
export const EDGE_RED = '#cc0000';

/** `jpnov.layout.paper.size` members (ISO 216 A series). */
export const PAPER_SIZES = ['a4', 'a6'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/** `jpnov.layout.paper.orientation` members: how the physical sheet turns — unrelated to 縦書き. */
export const PAPER_ORIENTATIONS = ['auto', 'landscape', 'portrait'] as const;
export type PaperOrientation = (typeof PAPER_ORIENTATIONS)[number];

/** Portrait width × height in mm (ISO 216). */
const PAPER_MM: Record<PaperSize, { readonly w: number; readonly h: number }> = {
  a4: { w: 210, h: 297 },
  a6: { w: 105, h: 148 },
};

/**
 * One build sheet fitted onto physical paper: the paper box (mm), the root font size that
 * scales the whole em-based sheet onto it, and the per-side sheet→paper insets css.ts emits
 * as a white border (border-box == paper, centered). Every value is pre-floored to its
 * emission quantum so the printed border-box lands strictly INSIDE the `@page` box —
 * Chromium would push an overflowing sheet onto a second PDF page.
 */
export interface PaperFit {
  /** Paper width in mm — the horizontal axis, which is the vertical-rl BLOCK axis. */
  readonly widthMm: number;
  /** Paper height in mm — the vertical axis, which is the vertical-rl INLINE axis. */
  readonly heightMm: number;
  /** Root font size in mm, floored to 0.001. */
  readonly fontMm: number;
  /** Per-side inset on the block axis (physical left/right), em floored to 0.01. */
  readonly insetBlockEm: number;
  /** Per-side inset on the inline axis (physical top/bottom), em floored to 0.01. */
  readonly insetInlineEm: number;
}

/**
 * Per-side inset growing the sheet's border box to the paper box, floored to the 0.01em
 * emission quantum MINUS one extra quantum: each axis keeps a 0.02–0.04em slack over the
 * exact fit, which outweighs Chromium's 1/64px layout rounding (the fragmentation guard).
 */
function inset(paperMm: number, fontMm: number, sheetEm: number): number {
  return (Math.floor(((paperMm / fontMm - sheetEm) / 2) * 100) - 1) / 100;
}

/**
 * Fits one sheet (grid + chrome bands + a {@link PRINT_MARGIN} minimum surround) onto the
 * selected paper. `auto` orientation is the product rule: `linesPerPage > charsPerLine / 2`
 * → landscape, else portrait. `hTop` is the same header/line-number band value css.ts
 * injects as `--htop`.
 */
export function fitPaper(opts: {
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  readonly hTop: number;
  readonly size: PaperSize;
  readonly orientation: PaperOrientation;
}): PaperFit {
  const landscape = opts.orientation === 'auto'
    ? opts.linesPerPage > opts.charsPerLine / 2
    : opts.orientation === 'landscape';
  const paper = PAPER_MM[opts.size];
  const widthMm = landscape ? paper.h : paper.w;
  const heightMm = landscape ? paper.w : paper.h;
  const sheetBlockEm = opts.linesPerPage * LINE_PITCH + 2 * SIDE_PAD;
  const sheetInlineEm = opts.charsPerLine + opts.hTop + FOLIO_BAND;
  const fontMm = Math.floor(Math.min(
    widthMm / (sheetBlockEm + 2 * PRINT_MARGIN),
    heightMm / (sheetInlineEm + 2 * PRINT_MARGIN),
  ) * 1000) / 1000;
  return {
    widthMm,
    heightMm,
    fontMm,
    insetBlockEm: inset(widthMm, fontMm, sheetBlockEm),
    insetInlineEm: inset(heightMm, fontMm, sheetInlineEm),
  };
}
