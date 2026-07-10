export type DataConfigFormat = 'json';

export type ModuleConfigFormat = 'js' | 'cjs' | 'mjs' | 'ts';

export type NovelConfigFormat = DataConfigFormat | ModuleConfigFormat;

/**
 * The user-authored `novel.jp.*` shape (post-normalization). The config file now carries ONLY
 * the highlighting vocabulary: paths and 禁則 moved to the `jpnov.project.*` /
 * `jpnov.layout.*` VS Code settings, and a leftover migrated key is silently ignored like any
 * other unknown key.
 */
export interface RawNovelConfig {
  /**
   * Author-declared cast. Each entry is split on half-/full-width spaces into surname + given so a
   * narration subject (巳一は / 朝霧先生が) highlights as a character. Omitted when none are defined.
   */
  characters?: readonly string[];
  /** Coined terms bolded (not recoloured) where they appear in narration; omitted when none. */
  keywords?: readonly string[];
}

/**
 * Alias kept while the `novel.jp.*` pipeline survives: nothing is path-resolved anymore, so
 * a "resolved" config IS the parsed one.
 */
export type ResolvedConfig = RawNovelConfig;

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
