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
import { EDGE_LINE_STYLES, PAGE_NUMBER_POSITIONS } from '../compiler/chrome.ts';
import type { HtmlSettings, PreviewSettings } from '../protocol.ts';
import type { AutoTcyMode } from './types.ts';
import { AUTO_TCY_MODES, CHARS_MAX, CHARS_MIN, LAYOUT_DEFAULT } from './types.ts';

export const PREVIEW_CHROME_DEFAULT = {
  lineNumbers: true,
  edgeLine: 'none',
} as const satisfies { lineNumbers: boolean; edgeLine: EdgeLineStyle };

export const BUILD_CHROME_DEFAULT = {
  lineNumbers: false,
  edgeLine: 'none',
  pageNumberPosition: 'rightThenLeft',
  pageNumberTemplate: '{page} / {totalPage}',
  header: '',
} as const satisfies {
  lineNumbers: boolean;
  edgeLine: EdgeLineStyle;
  pageNumberPosition: PageNumberPosition;
  pageNumberTemplate: string;
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

function edgeLine(value: unknown): EdgeLineStyle {
  return typeof value === 'string' && (EDGE_LINE_STYLES as readonly string[]).includes(value)
    ? (value as EdgeLineStyle)
    : 'none';
}

function pageNumberPosition(value: unknown): PageNumberPosition {
  return typeof value === 'string' && (PAGE_NUMBER_POSITIONS as readonly string[]).includes(value)
    ? (value as PageNumberPosition)
    : BUILD_CHROME_DEFAULT.pageNumberPosition;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function autoTcyMode(value: unknown): AutoTcyMode {
  return typeof value === 'string' && (AUTO_TCY_MODES as readonly string[]).includes(value)
    ? (value as AutoTcyMode)
    : LAYOUT_DEFAULT.autoTcy;
}

/** Folds the header to a single line (newline runs → one space); the literal spaces stay. */
function singleLine(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ') : fallback;
}

export function resolvePreviewSettings(s: PreviewSettings): PreviewSettings {
  return {
    charsPerLine: clampChars(s.charsPerLine, LAYOUT_DEFAULT.charsPerLine),
    avoidLineBreaks: boolOr(s.avoidLineBreaks, LAYOUT_DEFAULT.avoidLineBreaks),
    autoTcy: autoTcyMode(s.autoTcy),
    lineNumbers: boolOr(s.lineNumbers, PREVIEW_CHROME_DEFAULT.lineNumbers),
    edgeLine: edgeLine(s.edgeLine),
  };
}

export function resolveHtmlSettings(s: HtmlSettings): HtmlSettings {
  return {
    charsPerLine: clampChars(s.charsPerLine, LAYOUT_DEFAULT.charsPerLine),
    linesPerPage: clampChars(s.linesPerPage, LAYOUT_DEFAULT.linesPerPage),
    avoidLineBreaks: boolOr(s.avoidLineBreaks, LAYOUT_DEFAULT.avoidLineBreaks),
    autoTcy: autoTcyMode(s.autoTcy),
    lineNumbers: boolOr(s.lineNumbers, BUILD_CHROME_DEFAULT.lineNumbers),
    edgeLine: edgeLine(s.edgeLine),
    pageNumberPosition: pageNumberPosition(s.pageNumberPosition),
    // '' is a legitimate value (suppresses the folio via renderBook's blank-template
    // normalization), so only a non-string falls back.
    pageNumberTemplate:
      typeof s.pageNumberTemplate === 'string'
        ? s.pageNumberTemplate
        : BUILD_CHROME_DEFAULT.pageNumberTemplate,
    header: singleLine(s.header, BUILD_CHROME_DEFAULT.header),
  };
}
