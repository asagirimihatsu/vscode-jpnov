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
 * The `jpnov.layout.*` slice shared verbatim by both wire snapshots — preview and build stay
 * same-source. `linesPerPage`: the build grid's page depth; the preview edge frame reserves
 * the same extent per segment while drawn.
 */
export interface LayoutSettings {
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  /** 禁則処理 mode. */
  readonly kinsoku: KinsokuMode;
  /** 自動縦中横 mode. */
  readonly autoTcy: AutoTcyMode;
}

/**
 * `jpnov.layout.*` defaults (投稿書式 40×34, 禁則 normal, 自動縦中横 punctuationPairs) — the single source
 * for the schema defaults and the settings resolver's fallbacks; the config-codegen test locks
 * package.json to these values.
 */
export const LAYOUT_DEFAULT: LayoutSettings = {
  charsPerLine: 40,
  linesPerPage: 34,
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
};

/**
 * `jpnov.project.*` defaults — the single source for the schema defaults and the server's
 * silent fallback when a configured path fails containment; the config-codegen test locks
 * package.json to these values. A single-segment relative path, so resolving it against
 * any root always stays inside it.
 */
export const PROJECT_DEFAULT = { outDir: 'dist' } as const;
