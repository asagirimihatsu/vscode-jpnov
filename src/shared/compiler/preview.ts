import { DEFAULT_CHARS_PER_LINE, stylesheet } from './css.ts';
import { buildRows, flowToHtml } from './layout.ts';
import { tokenize } from './tokenizer.ts';

/**
 * Renders ONE file as a full standalone `<html>` document for the preview pane: a CONTINUOUS
 * line flow (no pagination) built by the SAME layout engine the book build uses, so the preview
 * agrees with the printed page. Lines hard-wrap at `charsPerLine` (折り返し); `avoidLineBreaks`
 * enables 禁則処理; ［＃改ページ］ shows as a visible `<hr class="pagebreak">` marker rather than a
 * real page break. Each source line's first display column carries a `data-line` anchor so the
 * client can scroll the preview to follow the editor cursor.
 *
 * Pure + vscode-free (the client owns the CSP/nonce + the scroll script when injecting this into
 * a webview).
 */
export function renderPreview(
  src: string,
  opts: { charsPerLine?: number; avoidLineBreaks?: boolean } = {},
): string {
  // Render the body first so the CSS includes ONLY the emphasis classes it used. The sort is
  // lexicographic by class name (deterministic output), not spec order.
  const used = new Set<string>();
  const body = flowToHtml(
    buildRows(tokenize(src)),
    opts.charsPerLine ?? DEFAULT_CHARS_PER_LINE,
    opts.avoidLineBreaks ?? false,
    used,
  );
  const css = stylesheet({ paginate: false, emphasisClasses: [...used].sort() });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}
