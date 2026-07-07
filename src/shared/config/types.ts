export type DataConfigFormat = 'json';

export type ModuleConfigFormat = 'js' | 'cjs' | 'mjs' | 'ts';

export type NovelConfigFormat = DataConfigFormat | ModuleConfigFormat;

/**
 * The user-authored config shape (post-normalization); `outDir` added. Grid geometry
 * (chars per line / lines per page) is NOT config-file territory — it lives in the
 * `jpnov.layout.*` VS Code settings ({@link LAYOUT_DEFAULT}); a leftover key here is
 * silently ignored like any other unknown key.
 */
export interface RawNovelConfig {
  sourceDir: string;
  /**
   * 禁則処理 (line-break avoidance) toggle, applied by BOTH the live preview and the book
   * build (they share the layout engine): when on, a line never ends on an opening bracket
   * nor starts with a closing/punctuation char (追い出し). Omitted when off (the default).
   */
  avoidLineBreaks?: boolean;
  outDir?: string;
  /**
   * Author-declared cast. Each entry is split on half-/full-width spaces into surname + given so a
   * narration subject (巳一は / 朝霧先生が) highlights as a character. Omitted when none are defined.
   */
  characters?: readonly string[];
  /** Coined terms bolded (not recoloured) where they appear in narration; omitted when none. */
  keywords?: readonly string[];
}

/**
 * A {@link RawNovelConfig} with `sourceDir`/`outDir` resolved against the workspace
 * root into absolute URI strings (the form sent over the wire to the client).
 */
export interface ResolvedConfig extends RawNovelConfig {
  readonly sourceDirUri: string;
  readonly outDirUri: string;
}

/**
 * Inclusive bounds for `jpnov.layout.charsPerLine` / `jpnov.layout.linesPerPage`.
 */
export const CHARS_MIN = 16;
export const CHARS_MAX = 64;

/**
 * Grid-geometry defaults (原稿用紙 40×34) — the single source for the `jpnov.layout.*`
 * schema defaults and the settings resolver's fallbacks; the config-codegen test locks
 * package.json to these values.
 */
export const LAYOUT_DEFAULT = { charsPerLine: 40, linesPerPage: 34 } as const;

export const DEFAULT: RawNovelConfig = {
  sourceDir: './src',
  outDir: 'dist',
};
