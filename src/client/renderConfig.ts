/**
 * Snapshots the `jpnov.layout/preview/html.*` settings into the wire shapes carried on
 * `jpnov/renderFile` / `jpnov/build`. Read at default (resource-less) scope — one
 * window-global set of values, no folder overrides (mirrors lintConfig.ts). Raw values
 * are forwarded as-is; clamping / enum coercion is the server resolver's job. The `get`
 * fallbacks reference the single-source default constants (never fresh literals).
 */
import * as vscode from 'vscode';

import type { EdgeLineStyle, PageNumberPosition } from '#/shared/compiler/chrome.ts';
import { BUILD_CHROME_DEFAULT, PREVIEW_CHROME_DEFAULT } from '#/shared/config/settings.ts';
import { LAYOUT_DEFAULT } from '#/shared/config/types.ts';
import type { HtmlSettings, PreviewSettings } from '#/shared/protocol.ts';

export function buildPreviewSettings(): PreviewSettings {
  const c = vscode.workspace.getConfiguration();
  return {
    charsPerLine: c.get<number>('jpnov.layout.charsPerLine', LAYOUT_DEFAULT.charsPerLine),
    avoidLineBreaks: c.get<boolean>(
      'jpnov.layout.avoidLineBreaks',
      LAYOUT_DEFAULT.avoidLineBreaks,
    ),
    lineNumbers: c.get<boolean>('jpnov.preview.lineNumbers', PREVIEW_CHROME_DEFAULT.lineNumbers),
    edgeLine: c.get<EdgeLineStyle>('jpnov.preview.edgeLine', PREVIEW_CHROME_DEFAULT.edgeLine),
  };
}

export function buildHtmlSettings(): HtmlSettings {
  const c = vscode.workspace.getConfiguration();
  return {
    charsPerLine: c.get<number>('jpnov.layout.charsPerLine', LAYOUT_DEFAULT.charsPerLine),
    linesPerPage: c.get<number>('jpnov.layout.linesPerPage', LAYOUT_DEFAULT.linesPerPage),
    avoidLineBreaks: c.get<boolean>(
      'jpnov.layout.avoidLineBreaks',
      LAYOUT_DEFAULT.avoidLineBreaks,
    ),
    lineNumbers: c.get<boolean>('jpnov.html.lineNumbers', BUILD_CHROME_DEFAULT.lineNumbers),
    edgeLine: c.get<EdgeLineStyle>('jpnov.html.edgeLine', BUILD_CHROME_DEFAULT.edgeLine),
    pageNumberPosition: c.get<PageNumberPosition>(
      'jpnov.html.pageNumber.position',
      BUILD_CHROME_DEFAULT.pageNumberPosition,
    ),
    pageNumberTemplate: c.get<string>(
      'jpnov.html.pageNumber.template',
      BUILD_CHROME_DEFAULT.pageNumberTemplate,
    ),
    header: c.get<string>('jpnov.html.header', BUILD_CHROME_DEFAULT.header),
  };
}
