/**
 * Icons for the Books webview. The nine chrome glyphs are VS Code codicons, rendered as a font
 * class (`codicon codicon-<suffix>`) off the stylesheet the shell links in; only the checkbox
 * needs a bespoke double-ring SVG, which has no codicon equivalent.
 */

/** The codicon-backed icons (everything except the custom checkbox circle). */
export type IconName = 'chevR' | 'chevL' | 'up' | 'down' | 'warn' | 'add' | 'close' | 'edit' | 'grip';

/** Codicon suffix per icon; the element gets `class="codicon codicon-<suffix>"`. */
export const CODICON: Record<IconName, string> = {
  chevR: 'chevron-right',
  chevL: 'chevron-left',
  up: 'chevron-up',
  down: 'chevron-down',
  warn: 'warning',
  add: 'add',
  close: 'close',
  edit: 'edit',
  grip: 'gripper',
};

/** Custom checkbox glyph: double-ring if checked, single-ring if hovered */
export const CIRCLE_SVG =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">' +
  '<circle cx="8" cy="8" r="5"/><circle class="cd-inner" cx="8" cy="8" r="2.2"/></svg>';
