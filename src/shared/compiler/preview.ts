import type { PreviewChrome } from './chrome.ts';
import { stylesheet } from './css.ts';
import { buildRows, flowToHtml } from './layout.ts';
import { tokenize } from './tokenizer.ts';

/**
 * Renders ONE file as a full standalone `<html>` document for the preview pane: a CONTINUOUS
 * line flow (no pagination) built by the SAME layout engine the book build uses, so the preview
 * agrees with the printed page. Lines hard-wrap at `charsPerLine` (折り返し), and the stylesheet
 * scales its font so a full charsPerLine-char line fills the pane height; `avoidLineBreaks`
 * enables 禁則処理; ［＃改ページ］ shows as a labelled `<div class="pagebreak">` marker rather
 * than a real page break. `chrome` drives the line-head numbers (JS-numbered `.ln` spans that
 * restart after every break marker, see {@link flowToHtml}) and the CSS-only column edge rules.
 * Each source line's first display column carries a `data-line` anchor so the client can
 * scroll the preview to follow the editor cursor.
 *
 * All options are required and pre-resolved (the settings resolver is the only default layer);
 * "off" is the explicit `{ lineNumbers: false, edgeLine: 'none' }`. Pure + vscode-free (the
 * client owns the CSP/nonce + the scroll script when injecting this into a webview).
 */
export function renderPreview(
  src: string,
  opts: { charsPerLine: number; avoidLineBreaks: boolean; chrome: PreviewChrome },
): string {
  // Render the body first so the CSS includes ONLY the classes it used. The sort is
  // lexicographic by class name (deterministic output), not spec order.
  const used = new Set<string>();
  const body = flowToHtml(
    buildRows(tokenize(src)),
    opts.charsPerLine,
    opts.avoidLineBreaks,
    used,
    opts.chrome.lineNumbers,
  );
  // charsPerLine also drives the stylesheet's fit-to-viewport font-size (a full line
  // fills the pane height), so it MUST match the wrap width used above.
  const css = stylesheet({
    paginate: false,
    charsPerLine: opts.charsPerLine,
    chrome: opts.chrome,
    usedClasses: [...used].sort(),
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}
