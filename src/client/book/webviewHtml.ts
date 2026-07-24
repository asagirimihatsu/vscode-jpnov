/**
 * The Books panel's WebviewView document: a strict-CSP, nonce'd static shell that hosts a
 * message-driven client renderer. The provider ({@link ./view.ts}) sets this html ONCE on
 * resolve, then pushes JSON `state` / `detail` messages; the client script below renders the
 * DOM with `createElement` / `textContent` — it NEVER assigns user data through `innerHTML`,
 * so a book title or chapter path can carry no markup — and dispatches every user action
 * back as a message. Webview hardening (CSP `<meta>` + per-render nonce, `--vscode-*`
 * theming) mirrors {@link ../preview.ts}.
 *
 * Layout is master/detail: a LIST screen (per-root sections of book rows + a pinned footer
 * with the build actions) drills into a DETAIL screen (one book's chapters + Book Info).
 * The host owns all truth; a checkbox toggle updates optimistically and is not echoed, but
 * every `state` push is authoritative and reconciles the view.
 */
import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

/** Cryptographically-random nonce for the CSP (base64url, no padding); see preview.ts. */
function makeNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** Strict CSP: only the nonce'd inline style/script run; images/fonts limited to the webview source. */
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
 * Localized UI strings baked into the client script. The client renders the DOM, so the
 * strings ride along in one injected `L` object rather than being re-fetched per node.
 * (HTML is a proper noun, left literal; txt and everything else localize.)
 */
function labels(): Record<string, string> {
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

/** The full static webview document. Content is rendered client-side from pushed messages. */
export function booksHtml(webview: vscode.Webview): string {
  const nonce = makeNonce();
  return [
    '<!DOCTYPE html>',
    `<html lang="${vscode.env.language || 'en'}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    cspMeta(nonce, webview),
    `<style nonce="${nonce}">${CSS}</style>`,
    '</head><body>',
    '<div id="app"></div>',
    `<script nonce="${nonce}">${clientScript(labels())}</script>`,
    '</body></html>',
  ].join('');
}

/** Wraps {@link CLIENT_JS} in an IIFE with the localized `L` injected (`<` escaped, script-safe). */
function clientScript(L: Record<string, string>): string {
  const injected = JSON.stringify(L).replace(/</g, '\\u003c');
  return `(function(){\nvar L = ${injected};\n${CLIENT_JS}\n})();`;
}

const CSS = `
* { box-sizing: border-box; }
/* Override VS Code's default injected body padding (0 20px) so the panel goes edge-to-edge. */
html, body { height: 100%; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}
#app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; }
.ic { display: inline-flex; align-items: center; justify-content: center; }
.ic svg { display: block; }
button { font: inherit; color: inherit; }
button:focus-visible, input:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.list { padding: 2px 0; }
.group-header {
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--vscode-descriptionForeground); padding: 8px 8px 2px;
}
.row { display: flex; align-items: center; gap: 6px; padding: 0 6px 0 8px; min-height: 24px; }
.row:hover { background: var(--vscode-list-hoverBackground); }
/* Custom selection cell: a FULL-HEIGHT, fixed-width segment split from the content by a vertical
   divider. Unchecked shows nothing (a faint single ring on hover); checked fills with a primary
   tint + a double ring. */
.row.book { padding-left: 0; }
.cbtile {
  flex: 0 0 auto; align-self: stretch; width: 36px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--vscode-foreground);
  border-right: 1px solid var(--vscode-panel-border, transparent);
}
.cbtile .ic { opacity: 0; }
.cbtile:hover:not(.on) .ic { opacity: .4; }
.cbtile:hover:not(.on) .cd-inner { display: none; } /* hover-unchecked = single ring (hide inner) */
.cbtile.on {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  background: color-mix(in srgb, var(--vscode-button-background) 50%, transparent);
}
.cbtile.on .ic { opacity: 1; } /* checked = double ring (outer + inner) */
.main, .chmain, .meta {
  flex: 1 1 auto; display: flex; align-items: center; gap: 6px; min-width: 0;
  text-align: left; background: none; border: none; color: inherit; padding: 4px 0; cursor: pointer;
}
/* Meta rows are the row itself (a button), so give them full width + row padding, not content width. */
.meta { width: 100%; padding: 4px 6px 4px 8px; }
.maincol { flex: 1 1 auto; min-width: 0; }
.title, .mlabeltext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlabel { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.mnote { flex: 0 0 auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
.sub, .mvalue {
  font-size: 11px; color: var(--vscode-descriptionForeground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.chev { flex: 0 0 auto; color: var(--vscode-descriptionForeground); }

.dhdr {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  position: sticky; top: 0; z-index: 1;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border, transparent);
}
.dtitle { flex: 1 1 auto; text-align: center; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iconbtn {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px;
  background: none; border: none; cursor: pointer; padding: 3px; border-radius: 4px;
}
.iconbtn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.iconbtn:disabled { opacity: .4; cursor: default; }
.iconbtn:disabled:hover { background: none; }

.section { padding: 0 0 2px; }
.shead { display: flex; align-items: center; padding: 4px 8px 2px; }
.stitle {
  flex: 1 1 auto; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--vscode-descriptionForeground);
}
.sectoggle { width: 100%; background: none; border: none; cursor: pointer; text-align: left; }
.caret { flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
.acts { display: flex; flex: 0 0 auto; }
.chapter.missing .title { color: var(--vscode-list-warningForeground, #cca700); }
.grip { flex: 0 0 auto; cursor: grab; color: var(--vscode-descriptionForeground); }
.chapter.dragging { opacity: .5; }
.chapter.drop-before { box-shadow: inset 0 2px 0 var(--vscode-focusBorder); }
.chapter.drop-after { box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
.warn { flex: 0 0 auto; color: var(--vscode-list-warningForeground, #cca700); }
.pen { flex: 0 0 auto; color: var(--vscode-descriptionForeground); opacity: 0; }
.meta:hover .pen, .meta:focus-visible .pen { opacity: 1; }
.empty { padding: 4px 8px; color: var(--vscode-descriptionForeground); font-size: 12px; }

.footer {
  flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-sideBarSectionHeader-border, transparent));
  background: var(--vscode-sideBar-background, transparent);
}
.selrow { display: flex; justify-content: space-between; }
.link {
  background: none; border: none; color: var(--vscode-textLink-foreground);
  cursor: pointer; padding: 2px 0; font-size: 12px;
}
.link:hover { text-decoration: underline; }
.link:disabled { opacity: .5; cursor: default; }
.link:disabled:hover { text-decoration: none; }
.btn {
  display: block; width: 100%; padding: 5px 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.btn:disabled { opacity: .5; cursor: default; }
.btn:disabled:hover { background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }
.btn.primary:disabled:hover { background: var(--vscode-button-background); }
.btnrow { display: flex; gap: 6px; }
.btnrow .btn { flex: 1 1 0; }

.welcome { padding: 16px 12px; display: flex; flex-direction: column; gap: 8px; }
.wtitle { font-weight: 600; }
.wbody { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
.welcomebtn { margin-top: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// The webview-side renderer. Plain ES5-ish JS (no template literals / no `${...}` so it can
// live inside a TS template string): every string is single-quoted, every node is built with
// createElement/textContent. `L` (localized strings) is injected by clientScript() above.
const CLIENT_JS = `
var api = acquireVsCodeApi();
function post(m) { api.postMessage(m); }
var app = document.getElementById('app');
var state = null;
var detail = null;
var screen = 'list';
var lastDetailUri = null;
var infoOpen = false;
var dragLine = null;
var detailWanted = false; // true only while the user intends to be on the detail screen

var ICON = {
  chevR: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  chevL: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 3.5 5.5 8 10 12.5"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 10 8 5.5 12.5 10"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 6 8 10.5 12.5 6"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path fill-rule="evenodd" d="M8 1.8 15.2 14.4H.8L8 1.8Zm-.75 4.7v3.6h1.5V6.5h-1.5Zm0 4.6v1.5h1.5V11.1h-1.5Z"/></svg>',
  add: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11.6 2.4 13.6 4.4 6.2 11.8 3.4 12.6 4.2 9.8zM10.9 3.1 12.9 5.1"/></svg>',
  grip: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="6" cy="4" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/></svg>',
  circle: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><circle class="cd-inner" cx="8" cy="8" r="2.2"/></svg>'
};

function E(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) { e.className = cls; }
  if (text != null) { e.textContent = text; }
  return e;
}
function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
function icon(name) {
  var s = E('span', 'ic');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[name] || '';
  return s;
}
function iconBtn(name, cls, aria, fn) {
  var b = E('button', 'iconbtn' + (cls ? ' ' + cls : ''));
  b.appendChild(icon(name));
  b.setAttribute('aria-label', aria);
  b.title = aria;
  b.addEventListener('click', fn);
  return b;
}
function textBtn(cls, text, fn) {
  var b = E('button', cls, text);
  b.addEventListener('click', fn);
  return b;
}
function fk(el, key) { el.setAttribute('data-fk', key); return el; }
function scroller() { return app.querySelector('.scroll'); }
// Focus + scroll preservation across host-driven re-renders (the detail edit loop rebuilds the DOM).
function capture() {
  var a = document.activeElement;
  var key = a && a.getAttribute ? a.getAttribute('data-fk') : null;
  var sc = scroller();
  return { key: key, top: sc ? sc.scrollTop : 0 };
}
function focusFk(key) {
  if (!key) { return; }
  var els = app.querySelectorAll('[data-fk]');
  var idx = -1;
  for (var i = 0; i < els.length; i++) { if (els[i].getAttribute('data-fk') === key) { idx = i; break; } }
  if (idx < 0) { return; }
  if (!els[idx].disabled) { els[idx].focus(); return; }
  // The target went disabled (e.g. Select-all after selecting all) — focus the nearest enabled control.
  for (var j = idx + 1; j < els.length; j++) { if (!els[j].disabled) { els[j].focus(); return; } }
  for (var k = idx - 1; k >= 0; k--) { if (!els[k].disabled) { els[k].focus(); return; } }
}
function restore(cap) {
  var sc = scroller();
  if (sc) { sc.scrollTop = cap.top; }
  focusFk(cap.key);
}
function counts() {
  var sel = 0, total = 0;
  if (state && state.groups) {
    for (var g = 0; g < state.groups.length; g++) {
      var bks = state.groups[g].books;
      for (var b = 0; b < bks.length; b++) { total += 1; if (bks[b].checked) { sel += 1; } }
    }
  }
  return { selected: sel, total: total };
}
// Drive every footer control from (selected, total): Select-all off when all are already selected,
// Deselect-all off when none are, and the build buttons off when none are.
// Called after each render and on every optimistic toggle.
function applyControls() {
  var c = counts();
  var off = { selall: c.selected === c.total, deselall: c.selected === 0, build: c.selected === 0 };
  var els = app.querySelectorAll('[data-fk]');
  for (var i = 0; i < els.length; i++) {
    var k = els[i].getAttribute('data-fk');
    if (k === 'selall') { els[i].disabled = off.selall; }
    else if (k === 'deselall') { els[i].disabled = off.deselall; }
    else if (k === 'bpdf' || k === 'btxt' || k === 'bhtml') { els[i].disabled = off.build; }
  }
}
// The chapter line after the given one in the current detail (null if it is the last) — DnD target.
function nextLine(line) {
  var chs = (detail && detail.chapters) || [];
  for (var i = 0; i < chs.length; i++) {
    if (chs[i].line === line) { return i + 1 < chs.length ? chs[i + 1].line : null; }
  }
  return null;
}
function clearDrop() {
  var els = app.querySelectorAll('.drop-before, .drop-after');
  for (var i = 0; i < els.length; i++) { els[i].classList.remove('drop-before', 'drop-after'); }
}

function render() {
  if (screen === 'detail' && detail) { renderDetail(); } else { renderList(); }
}

function renderList() {
  clear(app);
  var scroll = E('div', 'scroll');
  // Before the first enumeration lands (server still starting) show a neutral placeholder, NOT the
  // "no books yet" welcome — the books may well exist and that copy would misleadingly say create one.
  if (state && state.loading) {
    scroll.appendChild(E('div', 'empty', L.loading));
    app.appendChild(scroll);
    return;
  }
  if (state && state.noFolder) {
    scroll.appendChild(welcome(L.noFolderTitle, L.noFolderBody, [['openFolder', L.openFolder], ['openGuide', L.openGuide]]));
    app.appendChild(scroll);
    return;
  }
  var groups = (state && state.groups) || [];
  var total = 0;
  for (var i = 0; i < groups.length; i++) { total += groups[i].books.length; }
  if (total === 0) {
    scroll.appendChild(welcome(L.noBooksTitle, L.noBooksBody, [['createBook', L.createBook], ['openGuide', L.openGuide]]));
    app.appendChild(scroll);
    return;
  }
  var listEl = E('div', 'list');
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    if (grp.rootLabel) { listEl.appendChild(E('div', 'group-header', grp.rootLabel)); }
    for (var b = 0; b < grp.books.length; b++) { listEl.appendChild(bookRow(grp.books[b])); }
  }
  scroll.appendChild(listEl);
  app.appendChild(scroll);
  app.appendChild(footer());
  applyControls();
}

function bookRow(bk) {
  var row = E('div', 'row book');
  // Custom checkbox: a button with role=checkbox. The circle is always in the DOM; the .on class shows/tints it.
  var cb = E('button', 'cbtile' + (bk.checked ? ' on' : ''));
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-checked', bk.checked ? 'true' : 'false');
  cb.setAttribute('aria-label', L.selectBook + ': ' + bk.title);
  cb.appendChild(icon('circle'));
  fk(cb, 'cb:' + bk.uri);
  cb.addEventListener('click', function () {
    var now = cb.getAttribute('aria-checked') !== 'true';
    cb.setAttribute('aria-checked', now ? 'true' : 'false');
    cb.classList.toggle('on', now);
    // Optimistic + keep the cached VM in sync, so a later re-render off this state (e.g. Back from
    // detail) reflects the toggle. The host records it authoritatively without echoing.
    bk.checked = now;
    applyControls();
    post({ type: 'toggle', uri: bk.uri, checked: now });
  });
  row.appendChild(cb);
  var main = E('button', 'main');
  var col = E('div', 'maincol');
  col.appendChild(E('div', 'title', bk.title));
  col.appendChild(E('div', 'sub', bk.fileRel));
  main.appendChild(col);
  var chev = icon('chevR');
  chev.classList.add('chev');
  main.appendChild(chev);
  main.setAttribute('aria-label', bk.title);
  fk(main, 'book:' + bk.uri);
  main.addEventListener('click', function () { detailWanted = true; post({ type: 'openDetail', uri: bk.uri }); });
  row.appendChild(main);
  return row;
}

function footer() {
  var f = E('div', 'footer');
  var sel = E('div', 'selrow');
  // Justified to the two edges: Deselect on the left, Select on the right.
  sel.appendChild(fk(textBtn('link', L.deselectAll, function () { post({ type: 'deselectAll' }); }), 'deselall'));
  sel.appendChild(fk(textBtn('link', L.selectAll, function () { post({ type: 'selectAll' }); }), 'selall'));
  f.appendChild(sel);
  f.appendChild(fk(textBtn('btn primary', L.buildPdf, function () { post({ type: 'build', format: 'pdf' }); }), 'bpdf'));
  var brow = E('div', 'btnrow');
  brow.appendChild(fk(textBtn('btn', L.buildTxt, function () { post({ type: 'build', format: 'txt' }); }), 'btxt'));
  brow.appendChild(fk(textBtn('btn', L.buildHtml, function () { post({ type: 'build', format: 'html' }); }), 'bhtml'));
  f.appendChild(brow);
  return f; // disabled states are applied by applyControls() once the footer is in the DOM
}

function renderDetail() {
  clear(app);
  dragLine = null; // a rebuild mid-drag (e.g. an edit-triggered refresh) cancels the in-progress drag
  var scroll = E('div', 'scroll');
  var hdr = E('div', 'dhdr');
  var back = iconBtn('chevL', null, L.back, function () {
    detailWanted = false;
    screen = 'list'; detail = null; post({ type: 'closeDetail' }); render();
    focusFk('book:' + lastDetailUri);
  });
  fk(back, 'back'); // icon-only; the aria-label/title read "戻る" (Back) for SR + tooltip
  hdr.appendChild(back);
  hdr.appendChild(E('div', 'dtitle', detail.title));
  scroll.appendChild(hdr);

  // Book Info: collapsible (collapsed by default), ABOVE the table of contents.
  var miSec = E('div', 'section');
  var miHead = E('button', 'shead sectoggle');
  miHead.setAttribute('aria-expanded', infoOpen ? 'true' : 'false');
  var caret = icon(infoOpen ? 'down' : 'chevR');
  caret.classList.add('caret');
  miHead.appendChild(caret);
  miHead.appendChild(E('span', 'stitle', L.bookInfo));
  fk(miHead, 'infohead');
  miHead.addEventListener('click', function () {
    infoOpen = !infoOpen;
    var c = capture();
    render();
    restore(c);
  });
  miSec.appendChild(miHead);
  if (infoOpen) {
    var meta = detail.meta || [];
    for (var j = 0; j < meta.length; j++) { miSec.appendChild(metaRow(meta[j])); }
  }
  scroll.appendChild(miSec);

  // Table of contents (chapters): always expanded; add + per-row move/remove.
  var chSec = E('div', 'section');
  var chHead = E('div', 'shead');
  chHead.appendChild(E('span', 'stitle', L.chapters));
  chHead.appendChild(fk(iconBtn('add', null, L.addChapters, function () { post({ type: 'addChapters', uri: detail.uri }); }), 'add'));
  chSec.appendChild(chHead);
  var chs = detail.chapters || [];
  if (chs.length === 0) { chSec.appendChild(E('div', 'empty', L.noChapters)); }
  for (var i = 0; i < chs.length; i++) { chSec.appendChild(chapterRow(chs[i], i, chs.length)); }
  scroll.appendChild(chSec);

  app.appendChild(scroll);
}

function chapterRow(ch, idx, count) {
  var row = E('div', 'row chapter' + (ch.missing ? ' missing' : ''));
  var grip = E('span', 'grip');
  grip.setAttribute('aria-hidden', 'true');
  grip.innerHTML = ICON.grip;
  grip.draggable = true;
  grip.addEventListener('dragstart', function (e) {
    dragLine = ch.line;
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  grip.addEventListener('dragend', function () { dragLine = null; row.classList.remove('dragging'); clearDrop(); });
  row.appendChild(grip);
  var open = E('button', 'chmain');
  if (ch.missing) {
    var w = icon('warn');
    w.classList.add('warn');
    open.appendChild(w);
  }
  var col = E('div', 'maincol');
  col.appendChild(E('div', 'title', ch.name));
  if (ch.folder) { col.appendChild(E('div', 'sub', ch.folder)); }
  open.appendChild(col);
  open.title = ch.missing ? (L.missing + ': ' + ch.name) : L.openChapter;
  open.setAttribute('aria-label', ch.name);
  fk(open, 'chopen:' + ch.fileUri);
  open.addEventListener('click', function () { post({ type: 'openFile', uri: ch.fileUri }); });
  row.appendChild(open);
  var acts = E('div', 'acts');
  // Focus keys use the chapter's fileUri (stable across a move) so keyboard focus follows the row.
  var up = fk(iconBtn('up', null, L.moveUp, function () { post({ type: 'moveChapter', uri: detail.uri, line: ch.line, dir: -1 }); }), 'ch:' + ch.fileUri + ':up');
  up.disabled = idx === 0;
  var dn = fk(iconBtn('down', null, L.moveDown, function () { post({ type: 'moveChapter', uri: detail.uri, line: ch.line, dir: 1 }); }), 'ch:' + ch.fileUri + ':down');
  dn.disabled = idx === count - 1;
  var rm = fk(iconBtn('close', null, L.remove, function () { post({ type: 'removeChapter', uri: detail.uri, line: ch.line }); }), 'ch:' + ch.fileUri + ':rm');
  acts.appendChild(up);
  acts.appendChild(dn);
  acts.appendChild(rm);
  row.appendChild(acts);
  // Drop target: the pointer in a row's top half inserts before it, bottom half after it (before next).
  row.addEventListener('dragover', function (e) {
    if (dragLine === null || dragLine === ch.line) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var r = row.getBoundingClientRect();
    var after = (e.clientY - r.top) > r.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', function () { row.classList.remove('drop-before', 'drop-after'); });
  row.addEventListener('drop', function (e) {
    if (dragLine === null) { return; }
    e.preventDefault();
    var r = row.getBoundingClientRect();
    var after = (e.clientY - r.top) > r.height / 2;
    row.classList.remove('drop-before', 'drop-after');
    post({ type: 'moveChapterTo', uri: detail.uri, line: dragLine, before: after ? nextLine(ch.line) : ch.line });
    dragLine = null;
  });
  return row;
}

function metaRow(mi) {
  var row = E('button', 'row meta');
  var col = E('div', 'maincol');
  // Status note (（既定）/（未設定）) sits beside the LABEL; the value line holds only the value.
  var labelLine = E('div', 'mlabel');
  labelLine.appendChild(E('span', 'mlabeltext', mi.label));
  if (mi.note) { labelLine.appendChild(E('span', 'mnote', mi.note)); }
  col.appendChild(labelLine);
  if (mi.value) { col.appendChild(E('div', 'mvalue', mi.value)); }
  row.appendChild(col);
  var pen = icon('edit');
  pen.classList.add('pen');
  row.appendChild(pen);
  row.setAttribute('aria-label', mi.label + (mi.note ? ' ' + mi.note : '') + (mi.value ? ': ' + mi.value : ''));
  fk(row, 'meta:' + mi.key);
  row.addEventListener('click', function () { post({ type: 'editMeta', uri: detail.uri, metaKey: mi.key }); });
  return row;
}

function welcome(title, body, actions) {
  var w = E('div', 'welcome');
  w.appendChild(E('div', 'wtitle', title));
  w.appendChild(E('div', 'wbody', body));
  for (var i = 0; i < actions.length; i++) {
    (function (a) {
      w.appendChild(textBtn('btn welcomebtn', a[1], function () { post({ type: 'welcome', action: a[0] }); }));
    })(actions[i]);
  }
  return w;
}

window.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || typeof m !== 'object') { return; }
  if (m.type === 'state') {
    state = m;
    // Only the list screen renders off state; preserve focus/scroll across the rebuild.
    if (screen === 'list') { var c = capture(); render(); restore(c); }
  } else if (m.type === 'detail') {
    if (!detailWanted) { return; } // a late push arriving after the user navigated back is ignored
    // A re-push of the SAME open book (after an edit saved -> watcher -> refresh) preserves
    // focus/scroll; opening a book fresh moves focus to the Back button.
    var reentry = screen === 'detail' && detail !== null && detail.uri === m.uri;
    detail = m;
    screen = 'detail';
    lastDetailUri = m.uri;
    if (reentry) { var c2 = capture(); render(); restore(c2); }
    else { infoOpen = false; render(); focusFk('back'); } // a freshly opened book starts collapsed
  } else if (m.type === 'closeDetail') {
    detailWanted = false;
    screen = 'list';
    detail = null;
    render();
    focusFk('book:' + lastDetailUri);
  }
});

post({ type: 'ready' });
`;
