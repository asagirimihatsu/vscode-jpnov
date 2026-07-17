/**
 * The page-geometry constants the TypeScript side still CONSUMES at runtime — the `@page`
 * size generator (css.ts's `atPage`) and the `--htop` band variable are computed from these,
 * so they cannot live only in the static stylesheets.
 *
 * Three of them (LINE_PITCH, FOLIO_BAND, PRINT_MARGIN) are ALSO written as plain literals in
 * `styles/*.css` (`2.25em` column pitch, `2.5em` folio band, `2.5em` print margin): that
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
 * whether the 枠 is drawn or not, so toggling edgeLine reflows nothing). A ruby
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
 * Uniform paper margin around the printed sheet: ~10.6mm at the default 16px em, clear of
 * typical printer dead zones, so a direct print never puts the frame or the chrome at the
 * paper edge. The screen sheet mirrors the same 2.5em surround (build.base.css) so the
 * on-screen proof breathes like the paper one — styles-codegen.test.ts guards the pair.
 */
export const PRINT_MARGIN = 2.5;

/** The 赤 edge-rule base colour (原稿用紙の赤枠) — semantic red, identical in both media. */
export const EDGE_RED = '#cc0000';
