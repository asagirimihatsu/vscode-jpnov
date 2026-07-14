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
 * `jpnov.layout.kinsoku` members: `none` = bare hard wrap, `normal` = the 文庫-grade 禁則処理
 * (行頭・行末禁則 + 分離禁止 + ぶら下げ), `strict` = normal plus the 中点/繰り返し classes.
 * The character classes live next to the wrap engine in compiler/layout.ts.
 */
export const KINSOKU_MODES = ['none', 'normal', 'strict'] as const;
export type KinsokuMode = (typeof KINSOKU_MODES)[number];

/**
 * `jpnov.layout.*` defaults (原稿用紙 40×34, 禁則 normal, 自動縦中横 off) — the single source
 * for the schema defaults and the settings resolver's fallbacks; the config-codegen test locks
 * package.json to these values.
 */
export const LAYOUT_DEFAULT = {
  charsPerLine: 40,
  linesPerPage: 34,
  kinsoku: 'normal' as KinsokuMode,
  autoTcy: 'none' as AutoTcyMode,
} as const;

/**
 * `jpnov.project.*` defaults — the single source for the schema defaults and the server's
 * silent fallback when a configured path fails containment; the config-codegen test locks
 * package.json to these values. A single-segment relative path, so resolving it against
 * any root always stays inside it.
 */
export const PROJECT_DEFAULT = { outDir: 'dist' } as const;
