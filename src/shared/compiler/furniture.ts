/**
 * The page furniture of the paginated build: the header and the footer of a sheet, horizontal
 * lines outside the vertical engine. Pure + vscode-free.
 */
import type { ValueLookup } from '../ast/nodes.ts';
import { VALUE_NAMES, valueOf } from '../ast/notation.ts';
import { scan } from '../ast/scan.ts';
import type { BuildChrome, FooterAlign } from './chrome.ts';
import { escapeHtml } from './escape.ts';

/** The footer's physical side on page `pi` (0-based), or null for no footer. */
function footerSide(pos: FooterAlign, pi: number): 'r' | 'l' | null {
  if (pos === 'none') {
    return null;
  }
  const odd = pi % 2 === 0; // display page = pi + 1, so an even index is an odd page
  switch (pos) {
    case 'rightLeft':
      return odd ? 'r' : 'l';
    case 'leftRight':
      return odd ? 'l' : 'r';
    case 'right':
      return 'r';
    case 'left':
      return 'l';
  }
}

/** A header or footer line cut into what it prints: a value to look up by name, or text as typed. */
type FurnitureSlot = string | { readonly name: string };

/**
 * The slots of a header or footer line. Only ［＃ここに「…」の値を表示］ is interpreted; every
 * other node — prose, ruby, any other annotation — prints as its source characters.
 */
function furnitureSlots(text: string): readonly FurnitureSlot[] {
  return scan(text).lines.flatMap((line): FurnitureSlot[] => [
    ...line.syntax.map((node) => (node.kind === 'valueField' ? { name: node.name.text } : node.text)),
    line.eol,
  ]);
}

function furnitureHtml(slots: readonly FurnitureSlot[], values: ValueLookup): string {
  return slots.map((slot) => escapeHtml(typeof slot === 'string' ? slot : valueOf(slot.name, values))).join('');
}

/** The header and footer of one render, cut once for all its pages. */
export interface Furniture {
  readonly header: readonly FurnitureSlot[];
  readonly footer: readonly FurnitureSlot[];
}

export function cutFurniture(chrome: BuildChrome): Furniture {
  return { header: furnitureSlots(chrome.header), footer: furnitureSlots(chrome.footer) };
}

/**
 * One page's absolutely-positioned furniture (header + footer), emitted after its lines. The
 * page's own numbers join the book's `values` under {@link VALUE_NAMES}. A blank footer never
 * reaches here (renderBook normalizes it to footerAlign 'none').
 */
export function pageFurniture(
  chrome: BuildChrome,
  furniture: Furniture,
  values: ValueLookup | undefined,
  pi: number,
  totalPage: number,
): string {
  const own = new Map<string, string>([
    [VALUE_NAMES.page, String(pi + 1)],
    [VALUE_NAMES.totalPages, String(totalPage)],
  ]);
  const all: ValueLookup = { get: (name) => own.get(name) ?? values?.get(name) };
  let out = '';
  if (chrome.header !== '') {
    out += `<div class="hd">${furnitureHtml(furniture.header, all)}</div>`;
  }
  const side = footerSide(chrome.footerAlign, pi);
  if (side !== null) {
    out += `<div class="ft ${side}">${furnitureHtml(furniture.footer, all)}</div>`;
  }
  return out;
}
