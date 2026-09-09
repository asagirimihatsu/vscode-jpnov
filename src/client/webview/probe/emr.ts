/**
 * 傍点 baseline-shift probe — the runtime companion of class.emr.css (mechanism and geometry
 * documented there), inlined by css.ts's emrProbe(). Two probe lines, plain vs emphasised, are
 * laid out BESIDE a real line, at the page's own font size: they must share the real line's
 * formatting context (Chromium 152 pushes a full mark band only inside an out-of-flow container,
 * a detached probe measures a shift the page never gets) and its metrics rounding (what remains
 * of the push in normal flow is a sub-pixel residue that does not scale with the font size). The
 * result pins `--emr-shift` in em. All styling is CSSOM: the preview webview's CSP strips markup
 * style= attributes, which would silently zero the measurement.
 */

function probeLine(
  host: HTMLElement,
  emphasised: boolean,
): { readonly box: HTMLElement; readonly cell: HTMLElement } {
  const cell = document.createElement('span');
  cell.textContent = '永';
  if (emphasised) {
    cell.style.cssText = '-webkit-text-emphasis:filled sesame;text-emphasis:filled sesame';
  }
  const box = document.createElement('div');
  box.className = 'line';
  box.style.visibility = 'hidden';
  box.appendChild(cell);
  host.appendChild(box);
  return { box, cell };
}

const host = document.querySelector('.line')?.parentElement ?? document.body;
const plain = probeLine(host, false);
const marked = probeLine(host, true);

// The two glyphs must sit exactly one pitch apart; the excess is Chromium's baseline push.
const push =
  plain.cell.getBoundingClientRect().x -
  marked.cell.getBoundingClientRect().x -
  plain.box.getBoundingClientRect().width;
plain.box.remove();
marked.box.remove();

const em = parseFloat(getComputedStyle(document.documentElement).fontSize);
document.documentElement.style.setProperty('--emr-shift', `${String(Math.max(0, push / em))}em`);
