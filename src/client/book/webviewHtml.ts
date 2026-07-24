/**
 * The Books panel's WebviewView document: a strict-CSP, nonce'd static shell. The provider
 * ({@link ./view.ts}) sets this html ONCE on resolve, then pushes JSON `state` / `detail` messages
 * that the bundled client renderer ({@link ../webview/book/main.ts} → {@link BOOKS_JS}) turns into DOM.
 * This module owns only the shell: the CSP `<meta>` + per-render nonce, the `__INIT` bootstrap of
 * localized strings, and the codicon stylesheet linked from the extension's `media/` via
 * `asWebviewUri`. Hardening mirrors {@link ../preview/preview.ts}.
 */
import * as vscode from 'vscode';

import type { BooksInit, Labels } from '../protocol.ts';

import { makeNonce } from '../nonce.ts';
import { BOOKS_CSS, BOOKS_JS } from './webviewBundle.generated.ts';

/**
 * Strict CSP: only the nonce'd inline style/script run; the codicon stylesheet + font load from
 * the webview source (the same `cspSource` that already backs `style-src`/`font-src`).
 */
function cspMeta(nonce: string, webview: vscode.Webview): string {
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}' ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

/**
 * Localized UI strings baked into the `__INIT` bootstrap. Keys mirror the {@link Labels} contract
 * one-to-one. (HTML is a proper noun, left literal; txt and everything else localize.)
 */
function labels(): Labels {
  return {
    loading: vscode.l10n.t('Loading…'),
    selectAll: vscode.l10n.t('Select all'),
    deselectAll: vscode.l10n.t('Deselect all'),
    selectBook: vscode.l10n.t('Include in build'),
    buildPdf: vscode.l10n.t('Build to PDF'),
    buildTxt: vscode.l10n.t('txt'),
    buildHtml: 'HTML',
    back: vscode.l10n.t('Back'),
    openChapter: vscode.l10n.t('Open chapter'),
    chapters: vscode.l10n.t('Chapters'),
    bookInfo: vscode.l10n.t('Book Info'),
    addChapters: vscode.l10n.t('Add chapters…'),
    moveUp: vscode.l10n.t('Move up'),
    moveDown: vscode.l10n.t('Move down'),
    remove: vscode.l10n.t('Remove from book'),
    missing: vscode.l10n.t('File not found'),
    noChapters: vscode.l10n.t('No chapters yet — add one.'),
    noBooksTitle: vscode.l10n.t('No books yet.'),
    noBooksBody: vscode.l10n.t('A .jpbook collects your chapters into one book — create one and save it in your workspace folder.'),
    createBook: vscode.l10n.t('Create a Book File'),
    openGuide: vscode.l10n.t('Open the Guide'),
    noFolderTitle: vscode.l10n.t('No folder open.'),
    noFolderBody: vscode.l10n.t('Book files (.jpbook) live inside a workspace folder. Open your novel’s folder first, then create the book there.'),
    openFolder: vscode.l10n.t('Open Folder'),
  };
}

/**
 * The full static webview document. Content is rendered client-side from pushed messages. A nonce'd
 * bootstrap `<script>` seeds `window.__INIT` (localized strings; `<` escaped so a translation cannot
 * break out of the script); a second nonce'd `<script>` then runs the bundled renderer — kept
 * separate so the bundle's own `"use strict"` prologue stays first (a `__INIT` prefix would demote it).
 */
export function booksHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const codiconHref = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codicon', 'codicon.css'));
  const init: BooksInit = { labels: labels() };
  const boot = `window.__INIT=${JSON.stringify(init).replace(/</g, '\\u003c')};`;
  return [
    '<!DOCTYPE html>',
    `<html lang="${vscode.env.language || 'en'}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    cspMeta(nonce, webview),
    `<link href="${codiconHref.toString()}" rel="stylesheet">`,
    `<style nonce="${nonce}">${BOOKS_CSS}</style>`,
    '</head><body>',
    '<div id="app"></div>',
    `<script nonce="${nonce}">${boot}</script>`,
    `<script nonce="${nonce}">${BOOKS_JS}</script>`,
    '</body></html>',
  ].join('');
}
