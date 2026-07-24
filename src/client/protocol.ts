/**
 * The host ↔ webview wire contract for the client's two webviews (the Books panel and the live
 * preview). PURE types + no imports: this module is compiled into BOTH the Node host bundle
 * (view.ts / preview.ts, which post and receive these) and the browser webview bundles
 * (webview/book/main.ts, webview/preview/scroll.ts, which are the other end). It must therefore
 * stay vscode-free, node-free and DOM-free — only shapes crossing `postMessage`'s structured
 * clone, plus the `__INIT` bootstrap each webview reads synchronously on first paint.
 *
 * Mirrors the host↔server split's `protocol.ts`: single repo, both ends move together, so a
 * shape change is safe as long as both sides change in one commit.
 */

// ---------------------------------------------------------------------------
// Books panel — view models (host → webview `state` / `detail` payloads)
// ---------------------------------------------------------------------------

/** One book row in a `state` group. */
export interface BookVM {
  readonly uri: string;
  readonly title: string;
  readonly fileRel: string;
  readonly checked: boolean;
}

/** One per-root section of the book list; `rootLabel` is null when there is a single root (flat). */
export interface BookGroupVM {
  readonly rootLabel: string | null;
  readonly books: readonly BookVM[];
}

/** One chapter row in a `detail`. */
export interface ChapterVM {
  readonly line: number;
  readonly name: string;
  readonly folder: string;
  readonly fileUri: string;
  readonly missing: boolean;
}

/** One Book-Info metadata row in a `detail` (`note` is the （既定）/（未設定） status beside the label). */
export interface MetaVM {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Books panel — messages
// ---------------------------------------------------------------------------

/** Host → webview: the full book list + selection. The sole authority; every push reconciles the view. */
export interface StateMessage {
  readonly type: 'state';
  /** True before the first enumeration lands — show a neutral placeholder, not the "no books" welcome. */
  readonly loading: boolean;
  readonly noFolder: boolean;
  readonly groups: readonly BookGroupVM[];
}

/** Host → webview: one book's DETAIL screen (chapters + Book Info). */
export interface DetailMessage {
  readonly type: 'detail';
  readonly uri: string;
  readonly title: string;
  readonly chapters: readonly ChapterVM[];
  readonly meta: readonly MetaVM[];
}

/** Host → webview: a vanished open book returns the webview to the list. */
export interface CloseDetailMessage {
  readonly type: 'closeDetail';
}

/** Every message the host posts to the Books webview. */
export type BooksInbound = StateMessage | DetailMessage | CloseDetailMessage;

/** A build action fired from the footer (`pdf` is the client-only PDF post-process). */
export type BuildAction = 'pdf' | 'txt' | 'html';

/** An empty-state welcome-link action. */
export type WelcomeAction = 'createBook' | 'openGuide' | 'openFolder';

/** Every message the Books webview dispatches back to the host. */
export type BooksOutbound =
  | { readonly type: 'ready' }
  | { readonly type: 'toggle'; readonly uri: string; readonly checked: boolean }
  | { readonly type: 'selectAll' }
  | { readonly type: 'deselectAll' }
  | { readonly type: 'build'; readonly format: BuildAction }
  | { readonly type: 'openDetail'; readonly uri: string }
  | { readonly type: 'closeDetail' }
  | { readonly type: 'openFile'; readonly uri: string }
  | { readonly type: 'editMeta'; readonly uri: string; readonly metaKey: string }
  | { readonly type: 'addChapters'; readonly uri: string }
  | { readonly type: 'removeChapter'; readonly uri: string; readonly line: number }
  | { readonly type: 'moveChapter'; readonly uri: string; readonly line: number; readonly dir: -1 | 1 }
  | { readonly type: 'moveChapterTo'; readonly uri: string; readonly line: number; readonly before: number | null }
  | { readonly type: 'welcome'; readonly action: WelcomeAction };

/**
 * Localized UI strings the Books webview renders. Baked into `__INIT` (not re-fetched per node)
 * because the webview builds its own DOM. Keys mirror `labels()` in webviewHtml.ts one-to-one.
 */
export interface Labels {
  readonly loading: string;
  readonly selectAll: string;
  readonly deselectAll: string;
  readonly selectBook: string;
  readonly buildPdf: string;
  readonly buildTxt: string;
  readonly buildHtml: string;
  readonly back: string;
  readonly openChapter: string;
  readonly chapters: string;
  readonly bookInfo: string;
  readonly addChapters: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly remove: string;
  readonly missing: string;
  readonly noChapters: string;
  readonly noBooksTitle: string;
  readonly noBooksBody: string;
  readonly createBook: string;
  readonly openGuide: string;
  readonly noFolderTitle: string;
  readonly noFolderBody: string;
  readonly openFolder: string;
}

/** The Books webview's `__INIT` bootstrap: localized strings baked in for the first paint. */
export interface BooksInit {
  readonly labels: Labels;
}

// ---------------------------------------------------------------------------
// Live preview — messages + bootstrap
// ---------------------------------------------------------------------------

/** Host → preview webview: scroll the anchor for `line` to the reveal position (with a glide). */
export interface RevealMessage {
  readonly type: 'reveal';
  readonly line: number;
}

/**
 * The preview webview's `__INIT` bootstrap: the previewed document URI (persisted through the
 * webview state API for the window-reload serializer) and the line to park on the first paint.
 */
export interface PreviewInit {
  readonly uri: string;
  readonly line: number;
}
