/**
 * Inclusive bounds for `jpnov.layout.charsPerLine` / `jpnov.layout.linesPerPage`.
 */
export const CHARS_MIN = 16;
export const CHARS_MAX = 64;

/**
 * `jpnov.layout.autoTateChuYoko` members: `none` = off, `punctuationPairs` = auto-combine the
 * half-width pairs !! !? ?! ?? (二連半角約物) into 縦中横 squares. An enum so future members
 * (e.g. digit pairs) extend without a rename; the wire/TS field is the short `autoTcy`.
 */
export const AUTO_TCY_MODES = ['none', 'punctuationPairs'] as const;
export type AutoTcyMode = (typeof AUTO_TCY_MODES)[number];

/**
 * `jpnov.layout.*` defaults (原稿用紙 40×34, 禁則 off, 自動縦中横 off) — the single source for
 * the schema defaults and the settings resolver's fallbacks; the config-codegen test locks
 * package.json to these values.
 */
export const LAYOUT_DEFAULT = {
  charsPerLine: 40,
  linesPerPage: 34,
  avoidLineBreaks: false,
  autoTcy: 'none' as AutoTcyMode,
} as const;

/**
 * `jpnov.project.*` defaults — the single source for the schema defaults and the server's
 * silent fallback when a configured path fails containment; the config-codegen test locks
 * package.json to these values. A single-segment relative path, so resolving it against
 * any root always stays inside it.
 */
export const PROJECT_DEFAULT = { outDir: 'dist' } as const;
