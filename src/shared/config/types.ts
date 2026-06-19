export type DataConfigFormat = 'json';

export type ModuleConfigFormat = 'js' | 'cjs' | 'mjs' | 'ts';

export type NovelConfigFormat = DataConfigFormat | ModuleConfigFormat;

/**
 * The user-authored config shape (post-normalization). `charsPerLine` = characters per
 * line, `linesPerPage` = lines per page (both default to 40 x 34); `outDir` added.
 */
export interface RawNovelConfig {
  sourceDir: string;
  charsPerLine: number;
  linesPerPage: number;
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

export const DEFAULT: RawNovelConfig = {
  sourceDir: './src',
  charsPerLine: 40,
  linesPerPage: 34,
  outDir: 'dist',
};
