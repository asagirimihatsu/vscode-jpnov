/**
 * Inclusive bounds for `jpnov.layout.charsPerLine` / `jpnov.layout.linesPerPage`.
 */
export const CHARS_MIN = 16;
export const CHARS_MAX = 64;

/**
 * `jpnov.layout.autoTcy` members: `none` = off, `punctuationPairs` = auto-combine the
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
 * `jpnov.layout.linePitch` members: 行送り as a multiple of the character size — the CSS
 * line-height, injected as `--pitch`, and fitPaper's block-axis quantum. A ruby reading's
 * outer edge sits 1.0em off its column centre (0.5em glyph half + 0.5em lane), the drawn
 * rule at pitch/2, an opposing left-side reading at pitch−1.0, the neighboring glyphs at
 * pitch−0.5. So: 2.25 keeps 0.125em clear of rules and opposing readings; 2.0 sits exactly
 * flush with both; below 2.0 a reading crosses a drawn rule / an opposing left-side reading;
 * plain right-side ruby touches the neighboring glyphs only at 1.5. The author's tradeoff,
 * deliberately unguarded.
 */
export const LINE_PITCHES = [1.5, 1.75, 2, 2.25] as const;
export type LinePitch = (typeof LINE_PITCHES)[number];

/**
 * The `jpnov.layout.*` slice shared verbatim by both wire snapshots — preview and build stay
 * same-source. `linesPerPage`: the build grid's page depth; the preview edge frame reserves
 * the same extent per segment while drawn.
 */
export interface LayoutSettings {
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  /** 行送り in character-size multiples. */
  readonly linePitch: LinePitch;
  /** 組版 font-family list; '' = the built-in 明朝 stack (css.ts DEFAULT_FONT_STACK). */
  readonly fontFamily: string;
  /** 禁則処理 mode. */
  readonly kinsoku: KinsokuMode;
  /** 自動縦中横 mode. */
  readonly autoTcy: AutoTcyMode;
}

/**
 * `jpnov.layout.*` defaults (投稿書式 40×34, 行送り 1.5 — the pitch print books and e-book readers
 * settle on, 禁則 normal, 自動縦中横 punctuationPairs) — the single source for the schema defaults
 * and the settings resolver's fallbacks; the config-codegen test locks package.json to these
 * values.
 */
export const LAYOUT_DEFAULT: LayoutSettings = {
  charsPerLine: 40,
  linesPerPage: 34,
  linePitch: 1.5,
  fontFamily: '',
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
};

/**
 * `jpnov.layout.outDir` defaults — the single source for the schema defaults and the server's
 * silent fallback when a configured path fails containment; the config-codegen test locks
 * package.json to these values. A single-segment relative path, so resolving it against
 * any root always stays inside it.
 */
export const PROJECT_DEFAULT = { outDir: 'dist' } as const;
