/**
 * Keeps the committed `styles.generated.ts` in sync with the authored `styles/*.css`
 * fragments, and guards the deliberate DOUBLE HOME of the @page geometry: LINE_PITCH /
 * FOLIO_BAND / PRINT_MARGIN live in geometry.ts (the TS `@page` generator consumes them —
 * `@page` cannot read `var()` portably) AND as plain literals in the fragments. If either
 * side moves alone, this fails loudly (see geometry.ts's module header).
 *
 * The literal extraction keys on a KNOWN selector + property and never reads numbers embedded
 * in `calc()` expressions, so an intentional lowering to `calc(var())` breaks the assertion —
 * which is exactly when the constant relationship must be re-examined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateStylesModule } from '../../../scripts/gen-styles.ts';
import {
  FOLIO_BAND,
  LINE_PITCH,
  PRINT_MARGIN,
} from '../../../src/shared/compiler/geometry.ts';

const STYLES = new URL('../../../src/shared/compiler/styles/', import.meta.url);

function read(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, STYLES)), 'utf8');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The plain numeric literal of `selector{…prop:<number>…}` in raw fragment CSS, optionally
 * scoped inside an at-rule block (`within`, e.g. '@media print') via balanced-brace extraction.
 */
function cssValue(css: string, selector: string, prop: string, within?: string): number {
  let hay = css;
  if (within !== undefined) {
    const open = new RegExp(escapeRe(within) + '\\s*\\{').exec(css);
    assert.ok(open !== null, `block ${within} not found`);
    let depth = 0;
    let i = open.index + open[0].length - 1; // at the opening '{'
    const start = i + 1;
    for (; i < css.length; i++) {
      if (css[i] === '{') {
        depth++;
      } else if (css[i] === '}' && --depth === 0) {
        break;
      }
    }
    hay = css.slice(start, i);
  }
  const m = new RegExp(escapeRe(selector) + '\\{[^}]*?\\b' + escapeRe(prop) + ':(-?[\\d.]+)').exec(
    hay,
  );
  const value = m?.[1];
  assert.ok(value !== undefined, `${selector}{${prop}:<number>} not found`);
  return Number.parseFloat(value);
}

test('styles.generated.ts is in sync with the *.css fragments', async () => {
  assert.equal(
    read('styles.generated.ts'),
    await generateStylesModule(),
    'styles.generated.ts is stale — run `npm run gen:styles`',
  );
});

test('the .css geometry literals equal the geometry.ts constants (@page double-home guard)', () => {
  const previewBase = read('preview.base.css');
  const buildBase = read('build.base.css');

  // LINE_PITCH: the column pitch literal, everywhere it appears as a plain value.
  assert.equal(cssValue(previewBase, 'html', 'line-height'), LINE_PITCH);
  assert.equal(cssValue(previewBase, '.line', 'block-size'), LINE_PITCH);
  assert.equal(cssValue(buildBase, '.page', 'line-height'), LINE_PITCH);
  assert.equal(cssValue(buildBase, '.line', 'block-size'), LINE_PITCH);

  // FOLIO_BAND: the always-reserved bottom band.
  assert.equal(cssValue(buildBase, '.page', 'padding-inline-end'), FOLIO_BAND);
  // …and its one DERIVED literal: the outset frame's bottom inset in build.edge.css is
  // FOLIO_BAND − EDGE_INSET (0.25, a .css-only constant). Its 2.25em text collides with
  // LINE_PITCH's, so a FOLIO_BAND change could silently leave it behind — guard it here.
  assert.equal(cssValue(read('build.edge.css'), '.page::before', 'bottom'), FOLIO_BAND - 0.25);

  // PRINT_MARGIN: the sheet's paper inset under @media print.
  assert.equal(cssValue(buildBase, '.page', 'margin', '@media print'), PRINT_MARGIN);
});

test('the base fragments carry NO ruby rules (the css.ts classRule lanes own rt sizing)', () => {
  // Every <rt> the layout emits sits inside a classed ruby (rr/lr/br) whose on-demand rule
  // set declares font-size:0.5em itself — a fragment-level ruby>rt rule would be a silent
  // second home for that value. Guard the absence in both fragments.
  assert.ok(!read('preview.base.css').includes('ruby>rt{'), 'preview.base.css grew a ruby>rt rule');
  assert.ok(!read('build.base.css').includes('ruby>rt{'), 'build.base.css grew a ruby>rt rule');
});
