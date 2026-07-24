/**
 * The Books panel's webview-side renderer (runs in the panel's browser realm). It renders the DOM
 * from the host's pushed `state` / `detail` messages with `createElement` / `textContent` — user
 * data (book titles, chapter paths) NEVER flows through innerHTML, so it can carry no markup — and
 * dispatches every user action back as a typed message. The host ({@link ../../book/view.ts}) owns all
 * truth; a checkbox toggle updates optimistically and is not echoed, but each `state` push is
 * authoritative and reconciles the view.
 *
 * Layout is master/detail: a LIST screen (per-root book rows + a pinned footer with the build
 * actions) drills into a DETAIL screen (one book's chapters + Book Info). Localized strings arrive
 * once via the host's `__INIT` bootstrap; icons are codicons ({@link ./icons.ts}).
 */
import type {
  BooksInbound,
  BooksInit,
  BooksOutbound,
  BookVM,
  ChapterVM,
  DetailMessage,
  MetaVM,
  StateMessage,
  WelcomeAction,
} from '../../protocol.ts';

import { CIRCLE_SVG, CODICON, type IconName } from './icons.ts';

const api = acquireVsCodeApi();
function post(m: BooksOutbound): void {
  api.postMessage(m);
}
/** A click/action handler that dispatches one fixed message — snapshots `m` at build time. */
function poster(m: BooksOutbound): () => void {
  return () => {
    post(m);
  };
}

const L = (window.__INIT as BooksInit).labels;

/** The root element, guaranteed present (the shell always emits `<div id="app">`). Returning a
 * non-null type keeps it narrowed inside the render closures below. */
function requireApp(): HTMLElement {
  const el = document.getElementById('app');
  if (el === null) {
    throw new Error('#app missing');
  }
  return el;
}
const app = requireApp();

let state: StateMessage | null = null;
let detail: DetailMessage | null = null;
let screen: 'list' | 'detail' = 'list';
let lastDetailUri: string | null = null;
let infoOpen = false;
let dragLine: number | null = null;
let detailWanted = false; // true only while the user intends to be on the detail screen

function E<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}
function clear(n: Element): void {
  while (n.firstChild) {
    n.removeChild(n.firstChild);
  }
}
/** A codicon glyph, or the bespoke checkbox circle (the sole innerHTML sink — a trusted literal). */
function icon(name: IconName | 'circle'): HTMLSpanElement {
  const s = E('span', 'ic');
  s.setAttribute('aria-hidden', 'true');
  if (name === 'circle') {
    s.innerHTML = CIRCLE_SVG;
  } else {
    s.className = 'codicon codicon-' + CODICON[name];
  }
  return s;
}
function iconBtn(name: IconName, aria: string, fn: () => void): HTMLButtonElement {
  const b = E('button', 'iconbtn');
  b.appendChild(icon(name));
  b.setAttribute('aria-label', aria);
  b.title = aria;
  b.addEventListener('click', fn);
  return b;
}
function textBtn(cls: string, text: string, fn: () => void): HTMLButtonElement {
  const b = E('button', cls, text);
  b.addEventListener('click', fn);
  return b;
}
function fk<T extends HTMLElement>(el: T, key: string): T {
  el.setAttribute('data-fk', key);
  return el;
}
function scroller(): Element | null {
  return app.querySelector('.scroll');
}

/** A captured focus key + scroll offset, restored across a host-driven re-render. */
interface Capture {
  readonly key: string | null;
  readonly top: number;
}
// Focus + scroll preservation across host-driven re-renders (the detail edit loop rebuilds the DOM).
function capture(): Capture {
  const a = document.activeElement;
  const key = a !== null ? a.getAttribute('data-fk') : null;
  const sc = scroller();
  return { key, top: sc ? sc.scrollTop : 0 };
}
function focusFk(key: string | null): void {
  if (key === null) {
    return;
  }
  const els = app.querySelectorAll<HTMLButtonElement>('[data-fk]');
  let idx = -1;
  for (let i = 0; i < els.length; i++) {
    if (els[i]?.getAttribute('data-fk') === key) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return;
  }
  const target = els[idx];
  if (target !== undefined && !target.disabled) {
    target.focus();
    return;
  }
  // The target went disabled (e.g. Select-all after selecting all) — focus the nearest enabled control.
  for (let j = idx + 1; j < els.length; j++) {
    const el = els[j];
    if (el !== undefined && !el.disabled) {
      el.focus();
      return;
    }
  }
  for (let k = idx - 1; k >= 0; k--) {
    const el = els[k];
    if (el !== undefined && !el.disabled) {
      el.focus();
      return;
    }
  }
}
function restore(cap: Capture): void {
  const sc = scroller();
  if (sc) {
    sc.scrollTop = cap.top;
  }
  focusFk(cap.key);
}
function counts(): { selected: number; total: number } {
  let sel = 0;
  let total = 0;
  if (state) {
    for (const group of state.groups) {
      for (const b of group.books) {
        total += 1;
        if (b.checked) {
          sel += 1;
        }
      }
    }
  }
  return { selected: sel, total };
}
// Drive every footer control from (selected, total): Select-all off when all are already selected,
// Deselect-all off when none are, and the build buttons off when none are. Called after each render
// and on every optimistic toggle.
function applyControls(): void {
  const c = counts();
  const off = { selall: c.selected === c.total, deselall: c.selected === 0, build: c.selected === 0 };
  const els = app.querySelectorAll<HTMLButtonElement>('[data-fk]');
  for (const el of els) {
    const k = el.getAttribute('data-fk');
    if (k === 'selall') {
      el.disabled = off.selall;
    } else if (k === 'deselall') {
      el.disabled = off.deselall;
    } else if (k === 'bpdf' || k === 'btxt' || k === 'bhtml') {
      el.disabled = off.build;
    }
  }
}
// The chapter line after the given one in the current detail (null if it is the last) — DnD target.
function nextLine(line: number): number | null {
  const chs = detail?.chapters ?? [];
  for (let i = 0; i < chs.length; i++) {
    if (chs[i]?.line === line) {
      return i + 1 < chs.length ? chs[i + 1]?.line ?? null : null;
    }
  }
  return null;
}
function clearDrop(): void {
  for (const el of app.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

function render(): void {
  if (screen === 'detail' && detail) {
    renderDetail();
  } else {
    renderList();
  }
}

function renderList(): void {
  clear(app);
  const scroll = E('div', 'scroll');
  // Before the first enumeration lands (server still starting) show a neutral placeholder, NOT the
  // "no books yet" welcome — the books may well exist and that copy would misleadingly say create one.
  if (state?.loading) {
    scroll.appendChild(E('div', 'empty', L.loading));
    app.appendChild(scroll);
    return;
  }
  if (state?.noFolder) {
    scroll.appendChild(welcome(L.noFolderTitle, L.noFolderBody, [['openFolder', L.openFolder], ['openGuide', L.openGuide]]));
    app.appendChild(scroll);
    return;
  }
  const groups = state?.groups ?? [];
  let total = 0;
  for (const g of groups) {
    total += g.books.length;
  }
  if (total === 0) {
    scroll.appendChild(welcome(L.noBooksTitle, L.noBooksBody, [['createBook', L.createBook], ['openGuide', L.openGuide]]));
    app.appendChild(scroll);
    return;
  }
  const listEl = E('div', 'list');
  for (const grp of groups) {
    if (grp.rootLabel !== null) {
      listEl.appendChild(E('div', 'group-header', grp.rootLabel));
    }
    for (const b of grp.books) {
      listEl.appendChild(bookRow(b));
    }
  }
  scroll.appendChild(listEl);
  app.appendChild(scroll);
  app.appendChild(footer());
  applyControls();
}

function bookRow(bk: BookVM): HTMLElement {
  const row = E('div', 'row book');
  // Custom checkbox: a button with role=checkbox. The circle is always in the DOM; the .on class shows/tints it.
  const cb = E('button', 'cbtile' + (bk.checked ? ' on' : ''));
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-checked', bk.checked ? 'true' : 'false');
  cb.setAttribute('aria-label', L.selectBook + ': ' + bk.title);
  cb.appendChild(icon('circle'));
  fk(cb, 'cb:' + bk.uri);
  cb.addEventListener('click', () => {
    const checked = !bk.checked;
    cb.setAttribute('aria-checked', checked ? 'true' : 'false');
    cb.classList.toggle('on', checked);
    // Optimistic: write the cached VM so applyControls()'s counts() sees the new value now, and a
    // later re-render off this state (e.g. Back from detail) reflects it. The host records the
    // selection authoritatively without echoing.
    (bk as { checked: boolean }).checked = checked;
    applyControls();
    post({ type: 'toggle', uri: bk.uri, checked });
  });
  row.appendChild(cb);
  const main = E('button', 'main');
  const col = E('div', 'maincol');
  col.appendChild(E('div', 'title', bk.title));
  col.appendChild(E('div', 'sub', bk.fileRel));
  main.appendChild(col);
  const chev = icon('chevR');
  chev.classList.add('chev');
  main.appendChild(chev);
  main.setAttribute('aria-label', bk.title);
  fk(main, 'book:' + bk.uri);
  main.addEventListener('click', () => {
    detailWanted = true;
    post({ type: 'openDetail', uri: bk.uri });
  });
  row.appendChild(main);
  return row;
}

function footer(): HTMLElement {
  const f = E('div', 'footer');
  const sel = E('div', 'selrow');
  // Justified to the two edges: Deselect on the left, Select on the right.
  sel.appendChild(fk(textBtn('link', L.deselectAll, poster({ type: 'deselectAll' })), 'deselall'));
  sel.appendChild(fk(textBtn('link', L.selectAll, poster({ type: 'selectAll' })), 'selall'));
  f.appendChild(sel);
  f.appendChild(fk(textBtn('btn primary', L.buildPdf, poster({ type: 'build', format: 'pdf' })), 'bpdf'));
  const brow = E('div', 'btnrow');
  brow.appendChild(fk(textBtn('btn', L.buildTxt, poster({ type: 'build', format: 'txt' })), 'btxt'));
  brow.appendChild(fk(textBtn('btn', L.buildHtml, poster({ type: 'build', format: 'html' })), 'bhtml'));
  f.appendChild(brow);
  return f; // disabled states are applied by applyControls() once the footer is in the DOM
}

function renderDetail(): void {
  if (detail === null) {
    return;
  }
  const d = detail;
  clear(app);
  dragLine = null; // a rebuild mid-drag (e.g. an edit-triggered refresh) cancels the in-progress drag
  const scroll = E('div', 'scroll');
  const hdr = E('div', 'dhdr');
  const back = iconBtn('chevL', L.back, () => {
    detailWanted = false;
    screen = 'list';
    detail = null;
    post({ type: 'closeDetail' });
    render();
    focusFk('book:' + (lastDetailUri ?? ''));
  });
  fk(back, 'back'); // icon-only; the aria-label/title read "戻る" (Back) for SR + tooltip
  hdr.appendChild(back);
  hdr.appendChild(E('div', 'dtitle', d.title));
  scroll.appendChild(hdr);

  // Book Info: collapsible (collapsed by default), ABOVE the table of contents.
  const miSec = E('div', 'section');
  const miHead = E('button', 'shead sectoggle');
  miHead.setAttribute('aria-expanded', infoOpen ? 'true' : 'false');
  const caret = icon(infoOpen ? 'down' : 'chevR');
  caret.classList.add('caret');
  miHead.appendChild(caret);
  miHead.appendChild(E('span', 'stitle', L.bookInfo));
  fk(miHead, 'infohead');
  miHead.addEventListener('click', () => {
    infoOpen = !infoOpen;
    const c = capture();
    render();
    restore(c);
  });
  miSec.appendChild(miHead);
  if (infoOpen) {
    for (const mi of d.meta) {
      miSec.appendChild(metaRow(d, mi));
    }
  }
  scroll.appendChild(miSec);

  // Table of contents (chapters): always expanded; add + per-row move/remove.
  const chSec = E('div', 'section');
  const chHead = E('div', 'shead');
  chHead.appendChild(E('span', 'stitle', L.chapters));
  chHead.appendChild(fk(iconBtn('add', L.addChapters, poster({ type: 'addChapters', uri: d.uri })), 'add'));
  chSec.appendChild(chHead);
  const chs = d.chapters;
  if (chs.length === 0) {
    chSec.appendChild(E('div', 'empty', L.noChapters));
  }
  for (let i = 0; i < chs.length; i++) {
    const ch = chs[i];
    if (ch !== undefined) {
      chSec.appendChild(chapterRow(d, ch, i, chs.length));
    }
  }
  scroll.appendChild(chSec);

  app.appendChild(scroll);
}

function chapterRow(d: DetailMessage, ch: ChapterVM, idx: number, count: number): HTMLElement {
  const row = E('div', 'row chapter' + (ch.missing ? ' missing' : ''));
  const grip = E('span', 'grip codicon codicon-' + CODICON.grip);
  grip.setAttribute('aria-hidden', 'true');
  grip.draggable = true;
  grip.addEventListener('dragstart', (e: DragEvent) => {
    dragLine = ch.line;
    e.dataTransfer?.setData('text/plain', '');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
    row.classList.add('dragging');
  });
  grip.addEventListener('dragend', () => {
    dragLine = null;
    row.classList.remove('dragging');
    clearDrop();
  });
  row.appendChild(grip);
  const open = E('button', 'chmain');
  if (ch.missing) {
    const w = icon('warn');
    w.classList.add('warn');
    open.appendChild(w);
  }
  const col = E('div', 'maincol');
  col.appendChild(E('div', 'title', ch.name));
  if (ch.folder) {
    col.appendChild(E('div', 'sub', ch.folder));
  }
  open.appendChild(col);
  open.title = ch.missing ? (L.missing + ': ' + ch.name) : L.openChapter;
  open.setAttribute('aria-label', ch.name);
  fk(open, 'chopen:' + ch.fileUri);
  open.addEventListener('click', poster({ type: 'openFile', uri: ch.fileUri }));
  row.appendChild(open);
  const acts = E('div', 'acts');
  // Focus keys use the chapter's fileUri (stable across a move) so keyboard focus follows the row.
  const up = fk(iconBtn('up', L.moveUp, poster({ type: 'moveChapter', uri: d.uri, line: ch.line, dir: -1 })), 'ch:' + ch.fileUri + ':up');
  up.disabled = idx === 0;
  const dn = fk(iconBtn('down', L.moveDown, poster({ type: 'moveChapter', uri: d.uri, line: ch.line, dir: 1 })), 'ch:' + ch.fileUri + ':down');
  dn.disabled = idx === count - 1;
  const rm = fk(iconBtn('close', L.remove, poster({ type: 'removeChapter', uri: d.uri, line: ch.line })), 'ch:' + ch.fileUri + ':rm');
  acts.appendChild(up);
  acts.appendChild(dn);
  acts.appendChild(rm);
  row.appendChild(acts);
  // Drop target: the pointer in a row's top half inserts before it, bottom half after it (before next).
  row.addEventListener('dragover', (e: DragEvent) => {
    if (dragLine === null || dragLine === ch.line) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const r = row.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-before', 'drop-after');
  });
  row.addEventListener('drop', (e: DragEvent) => {
    if (dragLine === null) {
      return;
    }
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const after = (e.clientY - r.top) > r.height / 2;
    row.classList.remove('drop-before', 'drop-after');
    post({ type: 'moveChapterTo', uri: d.uri, line: dragLine, before: after ? nextLine(ch.line) : ch.line });
    dragLine = null;
  });
  return row;
}

function metaRow(d: DetailMessage, mi: MetaVM): HTMLElement {
  const row = E('button', 'row meta');
  const col = E('div', 'maincol');
  // Status note (（既定）/（未設定）) sits beside the LABEL; the value line holds only the value.
  const labelLine = E('div', 'mlabel');
  labelLine.appendChild(E('span', 'mlabeltext', mi.label));
  if (mi.note) {
    labelLine.appendChild(E('span', 'mnote', mi.note));
  }
  col.appendChild(labelLine);
  if (mi.value) {
    col.appendChild(E('div', 'mvalue', mi.value));
  }
  row.appendChild(col);
  const pen = icon('edit');
  pen.classList.add('pen');
  row.appendChild(pen);
  row.setAttribute('aria-label', mi.label + (mi.note ? ' ' + mi.note : '') + (mi.value ? ': ' + mi.value : ''));
  fk(row, 'meta:' + mi.key);
  row.addEventListener('click', poster({ type: 'editMeta', uri: d.uri, metaKey: mi.key }));
  return row;
}

function welcome(title: string, body: string, actions: readonly (readonly [WelcomeAction, string])[]): HTMLElement {
  const w = E('div', 'welcome');
  w.appendChild(E('div', 'wtitle', title));
  w.appendChild(E('div', 'wbody', body));
  for (const [action, label] of actions) {
    w.appendChild(textBtn('btn welcomebtn', label, poster({ type: 'welcome', action })));
  }
  return w;
}

window.addEventListener('message', (e: MessageEvent) => {
  const m: unknown = e.data;
  if (typeof m !== 'object' || m === null || !('type' in m)) {
    return;
  }
  const msg = m as BooksInbound;
  switch (msg.type) {
    case 'state':
      state = msg;
      // Only the list screen renders off state; preserve focus/scroll across the rebuild.
      if (screen === 'list') {
        const c = capture();
        render();
        restore(c);
      }
      break;
    case 'detail': {
      if (!detailWanted) {
        return; // a late push arriving after the user navigated back is ignored
      }
      // A re-push of the SAME open book (after an edit saved -> watcher -> refresh) preserves
      // focus/scroll; opening a book fresh moves focus to the Back button.
      const reentry = screen === 'detail' && detail !== null && detail.uri === msg.uri;
      detail = msg;
      screen = 'detail';
      lastDetailUri = msg.uri;
      if (reentry) {
        const c2 = capture();
        render();
        restore(c2);
      } else {
        infoOpen = false; // a freshly opened book starts collapsed
        render();
        focusFk('back');
      }
      break;
    }
    case 'closeDetail':
      detailWanted = false;
      screen = 'list';
      detail = null;
      render();
      focusFk('book:' + (lastDetailUri ?? ''));
      break;
  }
});

post({ type: 'ready' });
