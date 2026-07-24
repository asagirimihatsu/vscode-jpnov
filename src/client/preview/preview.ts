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
 * per-render nonce on the inline `<style>`, and inject a small nonce'd script that parks
 * the paragraph for the active cursor line at the golden-ratio viewport position — on
 * load, on `reveal` messages, and on resize — so an edit keeps the view anchored at the
 * cursor instead of snapping to the start.
 *
 * The panel survives window reloads: the injected script persists `{uri, line}` through
 * the webview state API, and extension.ts registers a WebviewPanelSerializer that hands
 * the workbench-restored panel back to `adopt()` to re-wire listeners and re-render.
 *
 * Scope (per spec): a SINGLE current file, no book assembly, no pagination; lines wrap at
 * the `jpnov.layout.charsPerLine` setting; ［＃改ページ］ appears as a labelled
 * `<div class="pagebreak">` marker.
 */
import * as vscode from 'vscode';

import type { LanguageClient } from 'vscode-languageclient/node';

import { escapeHtml } from '#/shared/compiler/escape.ts';
import {
  RenderFileRequest,
  type RenderFileParams,
  type RenderFileResult,
} from '#/shared/protocol.ts';

import type { PreviewInit, RevealMessage } from '../protocol.ts';

import { makeNonce } from '../nonce.ts';
import { lastPathSegment } from '../paths.ts';
import { buildPreviewSettings } from '../renderConfig.ts';
import { LOADING_CSS, SCROLL_JS } from './webviewBundle.generated.ts';

/**
 * Trailing-edge debounce for edit-driven re-renders. Every keystroke otherwise ships the whole
 * buffer to the server and swaps the full webview DOM; 120ms coalesces a typing burst into one
 * render while staying under the ~200ms "feels live" bar. Only the edit path is debounced —
 * open/adopt/editor-switch renders stay immediate.
 */
const RENDER_DEBOUNCE_MS = 120;

export class Preview {
  /** The panel's viewType — the key the window-reload serializer registers under. */
  static readonly viewType = 'jpnov.preview';

  private panel: vscode.WebviewPanel | undefined;
  /** Listeners active only while the panel is open; torn down on dispose. */
  private readonly panelDisposables: vscode.Disposable[] = [];
  /** URI string of the document currently shown, to scope edit/cursor re-renders. */
  private currentDocUri: string | undefined;
  /**
   * The last line baked into a render or posted as a reveal — always for currentDocUri,
   * reset on document switch. A re-render falls back here while the editor is transiently
   * absent from visibleTextEditors, instead of snapping to line 0.
   */
  private lastRevealLine: number | undefined;
  /**
   * Serializes renders so a slow request can't clobber a newer buffer's output.
   * teardown() bumps it, so an in-flight render can never write to a disposed or
   * replaced panel (every panel transition funnels through teardown()).
   */
  private renderSeq = 0;
  /** Pending edit-driven re-render (see {@link RENDER_DEBOUNCE_MS}); cleared by teardown(). */
  private renderDebounce: ReturnType<typeof setTimeout> | undefined;

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

    let panel = this.panel;
    if (panel === undefined) {
      panel = vscode.window.createWebviewPanel(
        Preview.viewType,
        vscode.l10n.t('Japanese Novel Preview'),
        { viewColumn: column, preserveFocus },
        // Scripts are enabled but locked to a per-render nonce via CSP; the only script
        // is our own cursor-follow scroller (no remote/inline-eval scripts can run).
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.wire(panel);
    } else {
      panel.reveal(column, preserveFocus);
    }

    if (editor !== undefined && this.isPreviewable(editor.document)) {
      void this.renderDocument(editor.document);
    } else {
      panel.webview.html = this.emptyShell(panel.webview);
    }
  }

  /**
   * Serializer entry (see extension.ts): take ownership of a panel the workbench
   * restored from a previous session and re-render it. Synchronous through the first
   * paint and never throws, so revival hands VS Code an already-resolved promise.
   *
   * Content policy is active-editor-first: this preview mirrors the CURRENTLY active
   * editor, and revival can happen long after reload (a restored tab deserializes when
   * it first becomes visible), so the persisted state may be stale. `state.uri` is used
   * only when no previewable editor is active; the persisted `line` scrolls the restored
   * render only when the rendered document is `state.uri` itself.
   */
  adopt(panel: vscode.WebviewPanel, state: unknown): void {
    if (this.panel !== undefined) {
      // A live panel already exists (revival raced the preview command, or the tab is a
      // zombie persisted by a pre-serializer build): the incoming panel is redundant.
      panel.dispose();
      return;
    }
    this.wire(panel);
    // Re-assert: without scripts, the cursor-follow scroller and its setState
    // persistence would die silently — and every later reload would degrade further.
    panel.webview.options = { enableScripts: true };

    const { uri, line } = parsePanelState(state);
    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined && this.isPreviewable(editor.document)) {
      // Paint before the async render: the server is cold right after a reload, so the
      // first response can take seconds — and if it never comes up at all, a silent
      // blank would present exactly like the missing-serializer bug this path fixes.
      panel.webview.html = this.loadingShell(panel.webview);
      const fallbackLine = editor.document.uri.toString() === uri ? line : undefined;
      void this.renderDocument(editor.document, fallbackLine);
    } else if (uri !== undefined) {
      panel.webview.html = this.loadingShell(panel.webview);
      void this.renderRestored(panel, uri, line);
    } else {
      panel.webview.html = this.emptyShell(panel.webview);
    }
  }

  /**
   * Re-render the current document with FRESH settings. The config-change hook in
   * extension.ts calls this on jpnov.layout / jpnov.preview edits; a no-op when nothing
   * is shown. renderDocument re-reads buildPreviewSettings(), so the new values ride the
   * next request.
   */
  refresh(): void {
    const uri = this.currentDocUri;
    if (uri === undefined) {
      return;
    }
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (doc !== undefined && this.isPreviewable(doc)) {
      void this.renderDocument(doc);
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

  /** Only Japanese Novel source documents (jpnov / `.jpnov`) are previewable. */
  private isPreviewable(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'jpnov';
  }

  /** Posts a scroll-to-line message to the live webview (no re-render). */
  private reveal(line: number): void {
    this.lastRevealLine = line;
    const message: RevealMessage = { type: 'reveal', line };
    // Posts to the webview; postMessage never rejects (resolves false if the panel is gone), so void is safe.
    void this.panel?.webview.postMessage(message);
  }

  /**
   * Take ownership of `panel` (freshly created by open() or revived by the serializer):
   * track it, tear down on dispose, and wire the listeners that drive re-renders and
   * cursor-follow. The dispose hook is attached before anything can await, so an early
   * close cannot leak panelDisposables.
   */
  private wire(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.onDidDispose(() => {
      this.teardown();
    });
    this.panelDisposables.push(
      // Re-render when the user switches which file is active...
      vscode.window.onDidChangeActiveTextEditor((next) => {
        if (next !== undefined && this.isPreviewable(next.document)) {
          void this.renderDocument(next.document);
        }
      }),
      // ...on every edit to the file currently shown (live dirty buffer), debounced so a typing
      // burst costs one render. The trailing call reads the document's CURRENT text (TextDocument
      // is live), and re-checks the panel still shows that document (it may have switched or
      // closed during the delay).
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.currentDocUri) {
          clearTimeout(this.renderDebounce);
          this.renderDebounce = setTimeout(() => {
            this.renderDebounce = undefined;
            if (e.document.uri.toString() === this.currentDocUri) {
              void this.renderDocument(e.document);
            }
          }, RENDER_DEBOUNCE_MS);
        }
      }),
      // ...and follow the top-most cursor as it moves (a scroll message, no re-render).
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.uri.toString() === this.currentDocUri) {
          this.reveal(minCursorLine(e.selections));
        }
      }),
    );
  }

  /** Revival tail for a persisted uri: load the document and render, or fall back to the neutral shell. */
  private async renderRestored(
    panel: vscode.WebviewPanel,
    uri: string,
    line: number | undefined,
  ): Promise<void> {
    let doc: vscode.TextDocument | undefined;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    } catch {
      doc = undefined; // deleted/renamed while the window was closed, or an unloadable scheme
    }
    if (this.panel !== panel) {
      return; // closed or replaced while the document loaded
    }
    if (doc !== undefined && this.isPreviewable(doc)) {
      await this.renderDocument(doc, line);
      return;
    }
    panel.webview.html = this.emptyShell(panel.webview);
  }

  /**
   * Renders `doc` into the panel. Self-catching (a failed request paints a placeholder) and
   * renderSeq-serialized (a stale response never lands), so every call site may fire-and-forget
   * with `void`.
   */
  private async renderDocument(doc: vscode.TextDocument, fallbackLine?: number): Promise<void> {
    const panel = this.panel;
    if (panel === undefined) {
      return;
    }
    const uri = doc.uri.toString();
    if (uri !== this.currentDocUri) {
      this.lastRevealLine = undefined; // the remembered line belongs to the old document
    }
    this.currentDocUri = uri;
    panel.title = vscode.l10n.t('{0} — Preview', lastPathSegment(uri));

    const seq = ++this.renderSeq;
    const params: RenderFileParams = {
      uri,
      text: doc.getText(),
      settings: buildPreviewSettings(),
    };

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
          `<p>${vscode.l10n.t('Preview failed. {0}', escapeHtml(message))}</p>`,
          panel.webview,
        );
      }
      return;
    }

    // Drop stale responses: a newer edit already kicked off a later render.
    if (seq !== this.renderSeq) {
      return;
    }
    // Sampled at swap time, after the seq check: pre-await sampling bakes a stale line,
    // and a dropped response must not write lastRevealLine. `fallbackLine` (revived
    // panel state) applies only before any live cursor line is known.
    const activeLine = this.topCursorLine(uri) ?? this.lastRevealLine ?? fallbackLine ?? 0;
    this.lastRevealLine = activeLine;
    panel.webview.html = this.harden(result.html, panel.webview, activeLine, uri);
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
  private harden(
    html: string,
    webview: vscode.Webview,
    activeLine: number,
    docUri: string,
  ): string {
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

    // Inject the scroller at the end of <body> (DOM is ready) as two nonce'd <script>s — a bootstrap
    // that seeds `window.__INIT`, then the bundled scroller. Escaping `<` in the JSON forecloses a
    // `</script>` breakout via a hostile file name; the two stay separate so the bundle's own
    // `"use strict"` prologue keeps effect (same rationale as book/webviewHtml.ts's booksHtml).
    const init: PreviewInit = { uri: docUri, line: activeLine };
    const boot = `window.__INIT=${JSON.stringify(init).replace(/</g, '\\u003c')};`;
    const script = `<script nonce="${nonce}">${boot}</script><script nonce="${nonce}">${SCROLL_JS}</script>`;
    if (/<\/body>/i.test(out)) {
      return out.replace(/<\/body>/i, `${script}</body>`);
    }
    return out.replace(/<\/html>/i, `${script}</html>`);
  }

  /** Minimal hardened standalone document for fallback / placeholder content. */
  private shell(bodyHtml: string, webview: vscode.Webview, extraCss = ''): string {
    const nonce = makeNonce();
    return [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8">',
      this.cspMeta(nonce, webview),
      `<style nonce="${nonce}">body{font-family:sans-serif;padding:1rem;}${extraCss}</style>`,
      `</head><body>${bodyHtml}</body></html>`,
    ].join('');
  }

  /** The neutral empty state: nothing previewable to render (also the failure fallback at revival). */
  private emptyShell(webview: vscode.Webview): string {
    return this.shell(
      `<p>${escapeHtml(vscode.l10n.t('Open a .jpnov file to preview.'))}</p>`,
      webview,
    );
  }

  /** Hardened "Loading preview…" placeholder; the CSS-only spinner + its rationale live in loading.css. */
  private loadingShell(webview: vscode.Webview): string {
    return this.shell(
      `<p class="loading"><span class="spinner"></span>${escapeHtml(vscode.l10n.t('Loading preview…'))}</p>`,
      webview,
      LOADING_CSS,
    );
  }

  private cspMeta(nonce: string, webview: vscode.Webview): string {
    const csp = [
      "default-src 'none'",
      `style-src 'nonce-${nonce}' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource} https: data:`,
    ].join('; ');
    return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  }

  private teardown(): void {
    // Invalidate any in-flight render: both html assignments in renderDocument() are
    // seq-guarded, so the bump keeps a slow response from writing to this panel after
    // it is disposed (or, via adopt()'s duplicate guard, replaced).
    this.renderSeq++;
    clearTimeout(this.renderDebounce);
    this.renderDebounce = undefined;
    for (const d of this.panelDisposables) {
      d.dispose();
    }
    this.panelDisposables.length = 0;
    this.panel = undefined;
    this.currentDocUri = undefined;
    this.lastRevealLine = undefined;
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
 * Defensive read of the serializer's persisted webview state: whatever a previous
 * session's injected script last `setState`-ed — or `undefined` for panels persisted
 * by builds that predate the serializer — so nothing about its shape can be trusted.
 */
function parsePanelState(state: unknown): {
  uri: string | undefined;
  line: number | undefined;
} {
  if (typeof state !== 'object' || state === null) {
    return { uri: undefined, line: undefined };
  }
  const { uri, line } = state as { uri?: unknown; line?: unknown };
  return {
    uri: typeof uri === 'string' ? uri : undefined,
    line: typeof line === 'number' && Number.isFinite(line) ? line : undefined,
  };
}
