/**
 * 傍点 baseline-shift probe — the runtime companion of class.emr.css (mechanism and geometry
 * documented there), inlined by css.ts's emrProbe(). Two probe lines, plain vs emphasised,
 * same glyph, measure Chromium's actual baseline push; the result pins `--emr-shift` in em,
 * so the value survives the preview's viewport-fit font-size. All styling is CSSOM: the
 * preview webview's CSP strips markup style= attributes, which would silently zero the
 * measurement.
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
  box.appendChild(cell);
  host.appendChild(box);
  return { box, cell };
}

const probe = document.createElement('div');
probe.style.cssText =
  'position:fixed;top:0;left:0;visibility:hidden;writing-mode:vertical-rl;line-height:var(--pitch)';
const plain = probeLine(probe, false);
const marked = probeLine(probe, true);
document.body.appendChild(probe);

// The two glyphs must sit exactly one pitch apart; the excess is Chromium's baseline push.
const push =
  plain.cell.getBoundingClientRect().x -
  marked.cell.getBoundingClientRect().x -
  plain.box.getBoundingClientRect().width;
probe.remove();

const em = parseFloat(getComputedStyle(document.documentElement).fontSize);
document.documentElement.style.setProperty('--emr-shift', `${String(Math.max(0, push / em))}em`);
