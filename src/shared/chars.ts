/**
 * Cross-layer character tables: the single home for the dash-glyph facts and the CJK
 * ideograph blocks shared by the layout engine, the EPUB reflow emitter and the prose lint.
 * Lint shares the tokenizer (token stream + character predicates) and THIS table; it never
 * imports the rendering modules (layout / reflow / css / document).
 */
import type { DashMode } from './config/types.ts';

/** The dash glyph each `jpnov.lint.common.dash` choice stands for. */
export const DASH_BY_MODE: Readonly<Record<DashMode, string>> = {
  emDash: '—', // U+2014
  horizontalBar: '―', // U+2015
  boxDrawing: '─', // U+2500
};

/** Every dash glyph, whatever the setting selects: all of them bind as one 分離禁止 class.
 *  Shared with the lint scanner (server/lint/prescan.ts). */
export const DASH_CHARS = new Set<string>(Object.values(DASH_BY_MODE));

/** The configured dash mode's glyph is EMITTED as this one (U+2014): its ink runs edge to edge
 *  in the default font stack, so a doubled dash joins seamlessly. */
export const DASH_GLYPH = DASH_BY_MODE.emDash;

/** A CJK ideograph: Ext A + Unified (U+3400–9FFF), Compatibility (U+F900–FAFF), SIP (U+20000–2FFFF). */
export function isCjkIdeograph(cp: number): boolean {
  return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2ffff);
}
