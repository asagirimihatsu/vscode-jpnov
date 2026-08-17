import { randomBytes } from 'node:crypto';

import type * as vscode from 'vscode';

/** A cryptographically-random nonce for a webview's CSP (base64url, no padding). */
export function makeNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Strict CSP shared by the extension's webviews: only the nonce'd inline style/script run.
 * `remoteFonts` widens `font-src` to https/data for the preview, whose rendered document may
 * reference user-configured fonts; the Books panel loads only the bundled codicon font.
 */
export function cspMeta(nonce: string, webview: vscode.Webview, remoteFonts = false): string {
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}' ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}${remoteFonts ? ' https: data:' : ''}`,
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

/**
 * The nonce'd `<script>` that seeds `window.__INIT` for a webview bundle. `<` is escaped so
 * hostile content inside `init` (e.g. a file name) cannot break out via `</script>`; the bundle
 * itself must load in a SEPARATE script tag so its `"use strict"` prologue stays first.
 */
export function bootScript(nonce: string, init: unknown): string {
  return `<script nonce="${nonce}">window.__INIT=${JSON.stringify(init).replace(/</g, '\\u003c')};</script>`;
}
