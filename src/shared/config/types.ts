/**
 * Inclusive bounds for `jpnov.layout.charsPerLine` / `jpnov.layout.linesPerPage`.
 */
export const CHARS_MIN = 16;
export const CHARS_MAX = 64;

/**
 * `jpnov.layout.*` defaults (原稿用紙 40×34, 禁則 off) — the single source for the schema
 * defaults and the settings resolver's fallbacks; the config-codegen test locks
 * package.json to these values.
 */
export const LAYOUT_DEFAULT = {
  charsPerLine: 40,
  linesPerPage: 34,
  avoidLineBreaks: false,
} as const;

/**
 * `jpnov.project.*` defaults — the single source for the schema defaults and the server's
 * silent fallback when a configured path fails containment; the config-codegen test locks
 * package.json to these values. Both are single-segment relative paths, so resolving them
 * against any root always stays inside it.
 */
export const PROJECT_DEFAULT = { sourceDir: './src', outDir: 'dist' } as const;
