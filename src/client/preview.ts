/**
 * The live preview: a single client-owned WebviewPanel that mirrors the
 * CURRENTLY active Japanese Novel (`.jpnov`) editor, re-rendered on the live (dirty) buffer.
 *
 * Rendering is done by the SERVER (`jpnov/renderFile` -> standalone `<html>` doc via the
 * pure compiler's `renderPreview`); the client only drives WHEN to render, owns webview
 * security, and keeps the preview scrolled to the editor's TOP-MOST cursor.
 *
 * The server HTML carries an inline `<style>` plus per-paragraph `data-line` anchors.
 * Before assigning it to `webview.html` we harden it with a strict CSP `<meta>` + a
 * per-render nonce on the inline `<style>`, and inject a small nonce'd script that scrolls
 * the paragraph for the active cursor line into view — on load and on `reveal` messages —
 * so an edit no longer snaps the view back to the start.
 *
 * Scope (per spec): a SINGLE current file, no filelist assembly, no pagination; lines wrap at the
 * owning root's `charsPerLine`; ［＃改ページ］ appears as a visible `<hr>` marker.
 */
import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import type { LanguageClient } from 'vscode-languageclient/node';

import { escapeHtml } from '#/shared/compiler/escape.ts';
import {
  RenderFileRequest,
  type RenderFileParams,
  type RenderFileResult,
} from '#/shared/protocol.ts';

const VIEW_TYPE = 'jpnov.preview';

export class Preview {
  private panel: vscode.WebviewPanel | undefined;
  /** Listeners active only while the panel is open; torn down on dispose. */
  private readonly panelDisposables: vscode.Disposable[] = [];
  /** URI string of the document currently shown, to scope edit/cursor re-renders. */
  private currentDocUri: string | undefined;
  /** Serializes renders so a slow request can't clobber a newer buffer's output. */
  private renderSeq = 0;

  private readonly client: LanguageClient;

  constructor(client: LanguageClient) {
    this.client = client;
  }

  /**
   * Command handler for `jpnov.preview` / `jpnov.previewToSide`: reveal the panel
   * (creating it on first use) and render the active editor's `.jpnov` buffer.
   *
   * `toSide` mirrors VS Code's Markdown preview: when true ("Open Preview to the Side",
   * also the editor-title icon) the panel opens BESIDE the editor and keeps focus on the
   * source; when false ("Open Preview") it opens in the editor's own column and takes focus.
   */
  open(toSide: boolean): void {
    const editor = vscode.window.activeTextEditor;
    const column = toSide
      ? vscode.ViewColumn.Beside
      : (editor?.viewColumn ?? vscode.ViewColumn.One);
    const preserveFocus = toSide;

    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Japanese Novel Preview',
        { viewColumn: column, preserveFocus },
        // Scripts are enabled but locked to a per-render nonce via CSP; the only script
        // is our own cursor-follow scroller (no remote/inline-eval scripts can run).
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.teardown();
      });
      this.panelDisposables.push(
        // Re-render when the user switches which file is active...
        vscode.window.onDidChangeActiveTextEditor((next) => {
          if (next !== undefined && this.isPreviewable(next.document)) {
            void this.renderDocument(next.document);
          }
        }),
        // ...on every edit to the file currently shown (live dirty buffer)...
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.toString() === this.currentDocUri) {
            void this.renderDocument(e.document);
          }
        }),
        // ...and follow the top-most cursor as it moves (a scroll message, no re-render).
        vscode.window.onDidChangeTextEditorSelection((e) => {
          if (e.textEditor.document.uri.toString() === this.currentDocUri) {
            this.reveal(minCursorLine(e.selections));
          }
        }),
      );
    } else {
      this.panel.reveal(column, preserveFocus);
    }

    if (editor !== undefined && this.isPreviewable(editor.document)) {
      void this.renderDocument(editor.document);
    } else {
      this.panel.webview.html = this.shell(
        '<p>Open a Japanese Novel (.jpnov) file to preview.</p>',
        this.panel.webview,
      );
    }
  }

  dispose(): void {
    // Capture before teardown(): teardown() nulls `this.panel`, so disposing it must
    // happen against the captured reference (its onDidDispose handler re-enters
    // teardown(), which is idempotent).
    const panel = this.panel;
    this.teardown();
    panel?.dispose();
  }

  // --- internals ----------------------------------------------------------

  /** Only Japanese Novel source documents (novel-jp / `.jpnov`) are previewable. */
  private isPreviewable(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'novel-jp';
  }

  /** Posts a scroll-to-line message to the live webview (no re-render). */
  private reveal(line: number): void {
    void this.panel?.webview.postMessage({ type: 'reveal', line });
  }

  private async renderDocument(doc: vscode.TextDocument): Promise<void> {
    const panel = this.panel;
    if (panel === undefined) {
      return;
    }
    this.currentDocUri = doc.uri.toString();
    panel.title = `Japanese Novel: ${this.basename(doc.uri)}`;

    // The line to scroll to after (re)render — keeps an edit from snapping to the start.
    const activeLine = this.topCursorLine(doc.uri.toString()) ?? 0;
    const seq = ++this.renderSeq;
    const params: RenderFileParams = { uri: doc.uri.toString(), text: doc.getText() };

    let result: RenderFileResult;
    try {
      result = await this.client.sendRequest<RenderFileResult>(
        RenderFileRequest,
        params,
      );
    } catch (err) {
      if (seq === this.renderSeq) {
        const message = err instanceof Error ? err.message : String(err);
        panel.webview.html = this.shell(
          `<p>Preview failed: ${escapeHtml(message)}</p>`,
          panel.webview,
        );
      }
      return;
    }

    // Drop stale responses: a newer edit already kicked off a later render.
    if (seq !== this.renderSeq) {
      return;
    }
    panel.webview.html = this.harden(result.html, panel.webview, activeLine);
  }

  /** The top-most (earliest) cursor line among all selections in an editor for `docUri`. */
  private topCursorLine(docUri: string): number | undefined {
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === docUri) {
        return minCursorLine(ed.selections);
      }
    }
    return undefined;
  }

  /**
   * Inject a strict CSP `<meta>`, a nonce on the inline `<style>`, and a nonce'd
   * cursor-follow `<script>` into the server's standalone document so it is safe to host
   * inside a webview. Only the nonced inline style + our own script may run.
   */
  private harden(html: string, webview: vscode.Webview, activeLine: number): string {
    const nonce = makeNonce();
    const meta = this.cspMeta(nonce, webview);

    let out = html;
    // Add the nonce to the inline <style> tag(s) the compiler emits.
    out = out.replace(/<style(\s[^>]*)?>/gi, (_m, attrs: string | undefined) => {
      const existing = attrs ?? '';
      return `<style${existing} nonce="${nonce}">`;
    });

    // If for some reason there is no <head>, fall back to wrapping in our own shell.
    if (!/<head(\s[^>]*)?>/i.test(out)) {
      return this.shell(html, webview);
    }
    out = out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${meta}`);

    // Inject the cursor-follow scroller at the end of <body> (DOM is ready by then).
    const script = `<script nonce="${nonce}">${scrollScript(activeLine)}</script>`;
    if (/<\/body>/i.test(out)) {
      return out.replace(/<\/body>/i, `${script}</body>`);
    }
    return out.replace(/<\/html>/i, `${script}</html>`);
  }

  /** Minimal hardened standalone document for fallback / placeholder content. */
  private shell(bodyHtml: string, webview: vscode.Webview): string {
    const nonce = makeNonce();
    return [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8">',
      this.cspMeta(nonce, webview),
      `<style nonce="${nonce}">body{font-family:sans-serif;padding:1rem;}</style>`,
      `</head><body>${bodyHtml}</body></html>`,
    ].join('');
  }

  private cspMeta(nonce: string, webview: vscode.Webview): string {
    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource} https: data:`,
    ].join('; ');
    return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  }

  private teardown(): void {
    for (const d of this.panelDisposables) {
      d.dispose();
    }
    this.panelDisposables.length = 0;
    this.panel = undefined;
    this.currentDocUri = undefined;
  }

  private basename(uri: vscode.Uri): string {
    const path = uri.path.replace(/\/+$/, '');
    return path.slice(path.lastIndexOf('/') + 1) || path;
  }
}

/** The earliest (smallest-line) active cursor among `selections`; 0 if none. */
function minCursorLine(selections: readonly vscode.Selection[]): number {
  let min = Number.MAX_SAFE_INTEGER;
  for (const sel of selections) {
    if (sel.active.line < min) {
      min = sel.active.line;
    }
  }
  return min === Number.MAX_SAFE_INTEGER ? 0 : min;
}

/**
 * The webview-side scroller (runs in the panel). Scrolls the paragraph whose `data-line`
 * is the greatest value <= the target line into view, on initial load and on every
 * `reveal` message the client posts as the cursor moves.
 */
function scrollScript(activeLine: number): string {
  return [
    '(function(){',
    'function reveal(line){',
    "var ns=document.querySelectorAll('[data-line]');var t=null;",
    'for(var i=0;i<ns.length;i++){',
    "var l=parseInt(ns[i].getAttribute('data-line'),10);",
    'if(isNaN(l)){continue;}',
    'if(l<=line){t=ns[i];}else{break;}',
    '}',
    "if(t){t.scrollIntoView({block:'center',inline:'center'});}",
    '}',
    "window.addEventListener('message',function(e){",
    "var m=e.data;if(m&&m.type==='reveal'&&typeof m.line==='number'){reveal(m.line);}",
    '});',
    `requestAnimationFrame(function(){reveal(${String(activeLine)});});`,
    '})();',
  ].join('');
}

/** Cryptographically-random nonce for the CSP (base64url, no padding). */
function makeNonce(): string {
  return randomBytes(24).toString('base64url');
}
