/**
 * The Books panel's webview-side renderer (runs in the panel's browser realm). It rebuilds the DOM
 * from the host's pushed `state` / `detail` messages with the `h()` builder — string children
 * become text nodes, so user data (book titles, chapter paths) NEVER flows through innerHTML and
 * can carry no markup — and dispatches every user action back as a typed message. The host
 * ({@link ../../book/view.ts}) owns all truth; a checkbox toggle updates optimistically and is not
 * echoed, but each `state` push is authoritative and reconciles the view.
 *
 * Because every push rebuilds the DOM, cross-render continuity rides on two mechanisms: `data-fk`
 * focus keys captured/restored around each rebuild (capture/restore/focusFk), and applyControls(),
 * which owns the list footer's disabled state after each list render and optimistic toggle.
 *
 * Layout is master/detail: a LIST screen (per-root book rows) drills into a DETAIL screen (one
 * book's chapters + Book Info); both carry a pinned footer with the build actions, the list's
 * adding the selection links. Localized strings arrive once via the host's `__INIT` bootstrap;
 * icons are codicons (`CODICON`).
 */
import type {
  BooksInbound,
  BooksInit,
  BooksOutbound,
  BookVM,
  BuildAction,
  ChapterVM,
  DetailMessage,
  MetaVM,
  StateMessage,
  WelcomeAction,
} from '../../protocol.ts';

/** Every glyph the panel draws; `cbOff`/`cbOn` are the selection checkbox's two states. */
type IconName =
  | 'chevR' | 'chevL' | 'up' | 'down' | 'warn' | 'add' | 'close' | 'edit' | 'grip' | 'cbOff' | 'cbOn';

/** Codicon suffix per icon; the element gets `class="codicon codicon-<suffix>"`. */
const CODICON: Record<IconName, string> = {
  chevR: 'chevron-right',
  chevL: 'chevron-left',
  up: 'chevron-up',
  down: 'chevron-down',
  warn: 'warning',
  add: 'add',
  close: 'close',
  edit: 'edit',
  grip: 'gripper',
  cbOff: 'circle-large-outline',
  cbOn: 'circle-large-filled',
};

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
let detailWanted = false; // true while the detail screen is intended (user click, or an adopted host reveal)

/** The attributes/handlers this panel sets; keys mirror the DOM attribute names, so a grep for
 * `data-fk` / `aria-expanded` finds every writer. Extend only as call sites need. */
interface Props {
  readonly class?: string;
  readonly title?: string;
  readonly role?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-hidden'?: true;
  readonly 'data-fk'?: string;
  readonly onClick?: () => void;
}
/** A child of `h()`; `false` is skipped so call sites can inline `cond && h(...)` conditionals. */
type Child = Node | string | false;

/** The Props keys h() writes with `setAttribute`; booleans serialize as 'true'/'false'. */
const ATTRS: readonly Exclude<keyof Props, 'onClick'>[] =
  ['class', 'title', 'role', 'aria-label', 'aria-expanded', 'aria-hidden', 'data-fk'];

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const name of ATTRS) {
    const v = props[name];
    if (v !== undefined) {
      el.setAttribute(name, String(v));
    }
  }
  if (props.onClick !== undefined) {
    el.addEventListener('click', props.onClick);
  }
  for (const c of children) {
    if (c !== false) {
      el.append(c);
    }
  }
  return el;
}
/** A codicon glyph span; `extraCls` appends site classes. */
function icon(name: IconName, extraCls?: string): HTMLSpanElement {
  const cls = 'codicon codicon-' + CODICON[name] + (extraCls === undefined ? '' : ' ' + extraCls);
  return h('span', { class: cls, 'aria-hidden': true });
}
/**
 * Inline-SVG brand marks for the format buttons — the webview CSP loads no external images,
 * and currentColor keeps them right in every theme. Mark-only cuts of the official logos
 * (both usage guides allow the bare mark): the EPUB "e" (https://www.w3.org/publishing/groups/epub-wg/)
 * and the HTML5 shield (https://www.w3.org/html/logo/, CC BY 3.0); viewBoxes are the marks'
 * measured bounds.
 */
const BRAND = {
  epub: {
    viewBox: '97.1 135.5 401.2 401.2',
    d: [
      'M297.63,462.07,171.58,336l126-126,42,42-84.05,84,42,42L423.69,252,313.88,142.17a23,23,0,0,0-32.48,0L103.79,319.78a23,23,0,0,0,0,32.48L281.4,529.86a23,23,0,0,0,32.48,0l177.61-177.6a23,23,0,0,0,0-32.48L465.7,294Z',
    ],
  },
  html: {
    viewBox: '88.7 112 334.6 379.7',
    d: [
      'M200.662,266.676H256v-42.92h-59.169L200.662,266.676z M88.686,111.982l30.47,341.74l136.762,37.966 l136.891-37.948l30.507-341.758H88.686z M366.694,431.981L256,462.668v-43.494l-0.067,0.02l-85.858-23.835l-6.004-67.298h42.075 l3.116,34.914l46.68,12.607l0.059-0.019V308.59h-93.669l-11.306-126.749H256v-41.914h136.766L366.694,431.981z',
      'M307.592,308.59H256v66.974l46.728-12.613L307.592,308.59z M256,139.927v41.914h104.975 l-3.754,41.915H256v42.92h97.406l-11.499,128.683L256,419.174v43.494l110.694-30.687l26.071-292.055H256z',
    ],
  },
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** An h()-composable brand mark; SVG needs createElementNS, which h() (HTML-only) cannot do. */
function brandIcon(name: keyof typeof BRAND): SVGSVGElement {
  const mark = BRAND[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', mark.viewBox);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of mark.d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** `data-fk` is required — every icon button participates in the focus-restore system. */
interface BtnExtra {
  readonly 'data-fk': string;
  readonly disabled?: boolean;
}
function iconBtn(name: IconName, aria: string, fn: () => void, extra: BtnExtra): HTMLButtonElement {
  const b = h('button', { class: 'iconbtn', 'aria-label': aria, title: aria, onClick: fn, 'data-fk': extra['data-fk'] }, icon(name));
  b.disabled = extra.disabled ?? false;
  return b;
}
/** The scrollable pane; `scroller()` (for capture/restore) finds it by this class. */
function scrollPane(...children: Child[]): HTMLElement {
  return h('div', { class: 'scroll' }, ...children);
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
// Deselect-all off when none are, and the build buttons off when none are. Called after each list
// render and on every optimistic toggle. The detail footer shares these data-fk keys but must stay
// enabled, hence the list-only guard.
function applyControls(): void {
  if (screen !== 'list') {
    return;
  }
  const c = counts();
  const off = { selall: c.selected === c.total, deselall: c.selected === 0, build: c.selected === 0 };
  const els = app.querySelectorAll<HTMLButtonElement>('[data-fk]');
  for (const el of els) {
    const k = el.getAttribute('data-fk');
    if (k === 'selall') {
      el.disabled = off.selall;
    } else if (k === 'deselall') {
      el.disabled = off.deselall;
    } else if (k === 'bpdf' || k === 'btxt' || k === 'bhtml' || k === 'bepub') {
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
  // Before the first enumeration lands (server still starting) show a neutral placeholder, NOT the
  // "no books yet" welcome — the books may well exist and that copy would misleadingly say create one.
  if (state?.loading) {
    app.replaceChildren(scrollPane(h('div', { class: 'empty' }, L.loading)));
    return;
  }
  if (state?.noFolder) {
    app.replaceChildren(scrollPane(
      welcome(L.noFolderTitle, L.noFolderBody, [['openFolder', L.openFolder], ['openGuide', L.openGuide]])));
    return;
  }
  if (counts().total === 0) {
    app.replaceChildren(scrollPane(
      welcome(L.noBooksTitle, L.noBooksBody, [['createBook', L.createBook], ['openGuide', L.openGuide]])));
    return;
  }
  const groups = state?.groups ?? [];
  app.replaceChildren(
    scrollPane(h('div', { class: 'list' }, ...groups.flatMap((g) => [
      g.rootLabel !== null && h('div', { class: 'group-header' }, g.rootLabel),
      ...g.books.map((b) => bookRow(b)),
    ]))),
    footer(),
  );
  applyControls();
}

/** The single writer of the checkbox's checked look (aria-checked, `.on` tint, glyph) — used at
 * build time and by the optimistic toggle. */
function paintChecked(cb: HTMLButtonElement, checked: boolean): void {
  cb.setAttribute('aria-checked', String(checked));
  cb.classList.toggle('on', checked);
  cb.replaceChildren(icon(checked ? 'cbOn' : 'cbOff'));
}

function bookRow(bk: BookVM): HTMLElement {
  // Custom checkbox: a button with role=checkbox. The glyph is always in the DOM (hidden until hover
  // or checked); the .on class tints the tile and swaps the outline circle for the filled one.
  const cb = h('button', {
    class: 'cbtile',
    role: 'checkbox',
    'aria-label': L.selectBook + ': ' + bk.title,
    'data-fk': 'cb:' + bk.uri,
  });
  paintChecked(cb, bk.checked);
  cb.addEventListener('click', () => {
    const checked = !bk.checked;
    paintChecked(cb, checked);
    // Optimistic: write the cached VM so applyControls()'s counts() sees the new value now, and a
    // later re-render off this state (e.g. Back from detail) reflects it. The host records the
    // selection authoritatively without echoing.
    (bk as { checked: boolean }).checked = checked;
    applyControls();
    post({ type: 'toggle', uri: bk.uri, checked });
  });
  return h('div', { class: 'row book' },
    cb,
    h('button', {
      class: 'main',
      'aria-label': bk.title,
      'data-fk': 'book:' + bk.uri,
      onClick: () => {
        detailWanted = true;
        post({ type: 'openDetail', uri: bk.uri });
      },
    },
    h('div', { class: 'maincol' },
      h('div', { class: 'title' }, bk.title),
      h('div', { class: 'sub' }, bk.fileRel)),
    icon('chevR', 'chev')));
}

// Disabled states (list mode only) are applied by applyControls() once the footer is in the DOM.
function footer(buildUri?: string): HTMLElement {
  const build = (format: BuildAction): BooksOutbound =>
    buildUri === undefined ? { type: 'build', format } : { type: 'build', format, uri: buildUri };
  return h('div', { class: 'footer' },
    // Justified to the two edges: Deselect on the left, Select on the right.
    buildUri === undefined &&
      h('div', { class: 'selrow' },
        h('button', { class: 'link', 'data-fk': 'deselall', onClick: poster({ type: 'deselectAll' }) }, L.deselectAll),
        h('button', { class: 'link', 'data-fk': 'selall', onClick: poster({ type: 'selectAll' }) }, L.selectAll)),
    h('button', { class: 'btn primary', 'data-fk': 'bpdf', onClick: poster(build('pdf')) }, L.buildPdf),
    // The text button keeps the row's growing flex (double width); HTML/EPUB are icon
    // buttons whose accessible name doubles as the hover tooltip.
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn', 'data-fk': 'btxt', onClick: poster(build('txt')) }, L.buildTxt),
      h('button', {
        class: 'btn icon', 'data-fk': 'bhtml', title: L.buildHtml, 'aria-label': L.buildHtml,
        onClick: poster(build('html')),
      }, brandIcon('html')),
      h('button', {
        class: 'btn icon', 'data-fk': 'bepub', title: L.buildEpub, 'aria-label': L.buildEpub,
        onClick: poster(build('epub')),
      }, brandIcon('epub'))));
}

function renderDetail(): void {
  if (detail === null) {
    return;
  }
  const d = detail;
  dragLine = null; // a rebuild mid-drag (e.g. an edit-triggered refresh) cancels the in-progress drag
  const hdr = h('div', { class: 'dhdr' },
    iconBtn('chevL', L.back, () => {
      detailWanted = false;
      screen = 'list';
      detail = null;
      post({ type: 'closeDetail' });
      render();
      focusFk('book:' + (lastDetailUri ?? ''));
    }, { 'data-fk': 'back' }),
    h('div', { class: 'dtitle' }, d.title));
  // Book Info: collapsible (collapsed by default), ABOVE the table of contents.
  const info = h('div', { class: 'section' },
    h('button', {
      class: 'shead sectoggle',
      'aria-expanded': infoOpen,
      'data-fk': 'infohead',
      onClick: () => {
        infoOpen = !infoOpen;
        const c = capture();
        render();
        restore(c);
      },
    },
    icon(infoOpen ? 'down' : 'chevR', 'caret'),
    h('span', { class: 'stitle' }, L.bookInfo)),
    ...(infoOpen ? d.meta.map((mi) => metaRow(d, mi)) : []));
  // Table of contents (chapters): always expanded; add + per-row move/remove.
  const chs = d.chapters;
  const toc = h('div', { class: 'section' },
    h('div', { class: 'shead' },
      h('span', { class: 'stitle' }, L.chapters),
      iconBtn('add', L.addChapters, poster({ type: 'addChapters', uri: d.uri }), { 'data-fk': 'add' })),
    chs.length === 0 && h('div', { class: 'empty' }, L.noChapters),
    ...chs.map((ch, i) => chapterRow(d, ch, i, chs.length)));
  app.replaceChildren(scrollPane(hdr, info, toc), footer(d.uri));
}

function chapterRow(d: DetailMessage, ch: ChapterVM, idx: number, count: number): HTMLElement {
  const grip = icon('grip', 'grip');
  const row = h('div', { class: 'row chapter' + (ch.missing ? ' missing' : '') },
    grip,
    h('button', {
      class: 'chmain',
      title: ch.missing ? (L.missing + ': ' + ch.name) : L.openChapter,
      'aria-label': ch.name,
      'data-fk': 'chopen:' + ch.fileUri,
      onClick: poster({ type: 'openFile', uri: ch.fileUri }),
    },
    ch.missing && icon('warn', 'warn'),
    h('div', { class: 'maincol' },
      h('div', { class: 'title' }, ch.name),
      ch.folder !== '' && h('div', { class: 'sub' }, ch.folder))),
    // Focus keys use the chapter's fileUri (stable across a move) so keyboard focus follows the row.
    h('div', { class: 'acts' },
      iconBtn('up', L.moveUp, poster({ type: 'moveChapter', uri: d.uri, line: ch.line, dir: -1 }),
        { 'data-fk': 'ch:' + ch.fileUri + ':up', disabled: idx === 0 }),
      iconBtn('down', L.moveDown, poster({ type: 'moveChapter', uri: d.uri, line: ch.line, dir: 1 }),
        { 'data-fk': 'ch:' + ch.fileUri + ':down', disabled: idx === count - 1 }),
      iconBtn('close', L.remove, poster({ type: 'removeChapter', uri: d.uri, line: ch.line }),
        { 'data-fk': 'ch:' + ch.fileUri + ':rm' })));
  // Drag wiring attaches after construction — the handlers mutate `row` from both elements.
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
  return h('button', {
    class: 'row meta',
    'aria-label': mi.label + (mi.note ? ' ' + mi.note : '') + (mi.value ? ': ' + mi.value : ''),
    'data-fk': 'meta:' + mi.key,
    onClick: poster({ type: 'editMeta', uri: d.uri, metaKey: mi.key }),
  },
  h('div', { class: 'maincol' },
    // Status note (（既定）/（未設定）) sits beside the LABEL; the value line holds only the value.
    h('div', { class: 'mlabel' },
      h('span', { class: 'mlabeltext' }, mi.label),
      mi.note !== '' && h('span', { class: 'mnote' }, mi.note)),
    mi.value !== '' && h('div', { class: 'mvalue' }, mi.value)),
  icon('edit', 'pen'));
}

function welcome(title: string, body: string, actions: readonly (readonly [WelcomeAction, string])[]): HTMLElement {
  return h('div', { class: 'welcome' },
    h('div', { class: 'wtitle' }, title),
    h('div', { class: 'wbody' }, body),
    ...actions.map(([action, label]) =>
      h('button', { class: 'btn welcomebtn', onClick: poster({ type: 'welcome', action }) }, label)));
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
      if (!detailWanted && msg.reveal !== true) {
        return; // a late push arriving after the user navigated back is ignored
      }
      detailWanted = true; // a reveal adopts the intent, so later plain re-pushes render too
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
