/**
 * Resolves the wire settings payload (`jpnov.layout/preview/html.*`) into fully-clamped,
 * enum-checked {@link PreviewSettings} / {@link HtmlSettings}. This is the SINGLE home of
 * the product defaults ({@link LAYOUT_DEFAULT} + the two chrome default tables); the
 * config-codegen test locks the package.json `default`s to these constants.
 *
 * The input types are the full wire shapes (the client always sends every field), but the
 * helpers take `unknown` on purpose: an IPC payload is untrusted at runtime, and a
 * hand-edited settings.json can carry out-of-range numbers or bogus enum strings —
 * anything invalid coerces to its default. This is validation, not a compatibility layer.
 * Pure + vscode-free.
 */
import type { EdgeLineStyle, PageNumberPosition } from '../compiler/chrome.ts';
import { EDGE_LINE_STYLES } from '../compiler/chrome.ts';
import type { HtmlSettings, PreviewSettings } from '../protocol.ts';
import type { LayoutSettings } from './types.ts';
import { AUTO_TCY_MODES, CHARS_MAX, CHARS_MIN, KINSOKU_MODES, LAYOUT_DEFAULT } from './types.ts';

export const PREVIEW_CHROME_DEFAULT = {
  lineNumbers: true,
  edgeLine: 'none',
} as const satisfies { lineNumbers: boolean; edgeLine: EdgeLineStyle };

/**
 * `lineNumbers`/`edgeLine` default the `jpnov.html.*` settings; the page-furniture fields
 * (`pageNumber`/`pageNumberFormat`/`header`) are NOT settings — they default a
 * `.jpbook`'s front matter when it omits the key (see `composeBookChrome`).
 */
export const BUILD_CHROME_DEFAULT = {
  lineNumbers: false,
  edgeLine: 'none',
  pageNumber: 'right',
  pageNumberFormat: '{page} / {totalPage}',
  header: '',
} as const satisfies {
  lineNumbers: boolean;
  edgeLine: EdgeLineStyle;
  pageNumber: PageNumberPosition;
  pageNumberFormat: string;
  header: string;
};

/** A safe integer clamped to [{@link CHARS_MIN}..{@link CHARS_MAX}]; anything else → `fallback`. */
function clampChars(value: unknown, fallback: number): number {
  if (!Number.isSafeInteger(value)) {
    return fallback;
  }
  const n = value as number;
  return n < CHARS_MIN ? CHARS_MIN : n > CHARS_MAX ? CHARS_MAX : n;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** `value` when it is a member of `allowed`, else `fallback`. */
function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** The shared `jpnov.layout.*` slice, resolved once for both wire snapshots. */
function resolveLayout(s: LayoutSettings): LayoutSettings {
  return {
    charsPerLine: clampChars(s.charsPerLine, LAYOUT_DEFAULT.charsPerLine),
    linesPerPage: clampChars(s.linesPerPage, LAYOUT_DEFAULT.linesPerPage),
    kinsoku: enumOr(s.kinsoku, KINSOKU_MODES, LAYOUT_DEFAULT.kinsoku),
    autoTcy: enumOr(s.autoTcy, AUTO_TCY_MODES, LAYOUT_DEFAULT.autoTcy),
  };
}

export function resolvePreviewSettings(s: PreviewSettings): PreviewSettings {
  return {
    ...resolveLayout(s),
    lineNumbers: boolOr(s.lineNumbers, PREVIEW_CHROME_DEFAULT.lineNumbers),
    edgeLine: enumOr(s.edgeLine, EDGE_LINE_STYLES, PREVIEW_CHROME_DEFAULT.edgeLine),
  };
}

export function resolveHtmlSettings(s: HtmlSettings): HtmlSettings {
  return {
    ...resolveLayout(s),
    lineNumbers: boolOr(s.lineNumbers, BUILD_CHROME_DEFAULT.lineNumbers),
    edgeLine: enumOr(s.edgeLine, EDGE_LINE_STYLES, BUILD_CHROME_DEFAULT.edgeLine),
  };
}
