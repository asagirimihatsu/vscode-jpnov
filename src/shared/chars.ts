/**
 * Cross-layer character tables: the single home for the dash-glyph facts shared by the
 * layout engine, the EPUB reflow emitter and the prose lint. Lint shares the tokenizer
 * (token stream + character predicates) and THIS table; it never imports the rendering
 * modules (layout / reflow / css / document).
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
