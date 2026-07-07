import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stylesheet } from '../../../src/shared/compiler/css.ts';

test('stylesheet defaults to vertical-rl writing mode', () => {
  const css = stylesheet({ paginate: false });
  assert.match(css, /writing-mode:vertical-rl/);
});

test('paginated stylesheet sizes the page + @page by charsPerLine x linesPerPage', () => {
  // vertical-rl: page block (cols) = 25 * 1.75 = 43.75em; page inline (chars) = 30em.
  const css = stylesheet({ paginate: true, charsPerLine: 30, linesPerPage: 25 });
  assert.match(css, /\.page\{[^}]*inline-size:30em/);
  assert.match(css, /\.page\{[^}]*block-size:43\.75em/);
  assert.match(css, /@page\{size:43\.75em 30em/);
});

test('paginated stylesheet breaks each .page onto its own sheet', () => {
  const css = stylesheet({ paginate: true });
  assert.match(css, /\.page\{[^}]*break-after:page/);
  assert.match(css, /\.page\{[^}]*page-break-after:always/);
});

test('non-paginated (preview) stylesheet makes .pagebreak a visible rule, no @page', () => {
  const css = stylesheet({ paginate: false });
  assert.doesNotMatch(css, /@page/);
  assert.doesNotMatch(css, /break-before:page/);
  assert.match(css, /\.pagebreak\{[^}]*border-block-start/);
});

test('non-paginated (preview) stylesheet no longer caps width in CSS (JS hard-wraps)', () => {
  // Line wrapping moved into the layout engine; the preview CSS must NOT emit an inline-size
  // cap, which would only double-constrain the already-wrapped .line columns.
  const css = stylesheet({ paginate: false, charsPerLine: 24 });
  assert.doesNotMatch(css, /inline-size/);
});

test('non-paginated (preview) stylesheet fits the root font-size to the viewport', () => {
  // In vertical-rl a full-width char advances exactly 1em along the column, so root
  // font-size = (100vh − 2·16px padding) / charsPerLine makes a full line fill the pane
  // height. `.line` re-pins to that root (1rem) so a webview-injected body{font-size}
  // can't desync the glyph advance from the em-based pitch.
  const css = stylesheet({ paginate: false, charsPerLine: 25 });
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 25\)/);
  assert.match(css, /\.line\{[^}]*font-size:1rem/);
});

test('preview fit formula defaults to 40 chars per line and pads the columns', () => {
  const css = stylesheet({ paginate: false });
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 40\)/);
  // The padding the formula subtracts (top/bottom = inline axis in vertical-rl).
  assert.match(css, /body\{[^}]*padding-inline:16px/);
});

test('stylesheet emits ONLY the requested class rules (on-demand)', () => {
  for (const paginate of [false, true]) {
    const label = `paginate=${String(paginate)}`;
    const css = stylesheet({ paginate, usedClasses: ['emph-fs', 'emph-x-l'] });
    assert.match(css, /\.emph-fs\{text-emphasis-style:filled sesame\}/, label);
    assert.match(
      css,
      /\.emph-x-l\{text-emphasis-style:'×';text-emphasis-position:under left\}/,
      label,
    );
    // A variant that was not requested gets no rule.
    assert.doesNotMatch(css, /\.emph-ot\b/, label);
  }
});

test('stylesheet emits NO .emph- rule when no classes are requested', () => {
  assert.doesNotMatch(stylesheet({ paginate: false }), /\.emph-/);
  assert.doesNotMatch(stylesheet({ paginate: true }), /\.emph-/);
});

test('stylesheet preserves the caller-provided (lexicographic) rule order', () => {
  // The renderers pass classes pre-sorted by class name (not spec order); stylesheet emits
  // them in that order verbatim.
  const css = stylesheet({ paginate: false, usedClasses: ['emph-fs', 'emph-ot'] });
  assert.ok(css.indexOf('.emph-fs{') < css.indexOf('.emph-ot{'));
});

test('字下げ padding is inline-start, never block-start (axis lock)', () => {
  // vertical-rl: the inline axis runs down the column, so the indent pushes the first glyph
  // DOWN via padding-inline-start. padding-block-start would shove the whole column sideways.
  const css = stylesheet({ paginate: false, usedClasses: ['indent-3'] });
  assert.match(css, /\.indent-3\{padding-inline-start:3em\}/);
  assert.doesNotMatch(css, /padding-block-start/);
});

test('base fill rules stay untouched by decoration/indent classes', () => {
  const p = stylesheet({ paginate: true, usedClasses: ['dec-wavy', 'b', 'i', 'indent-5'] });
  assert.match(p, /\.line\{block-size:1\.75em;margin:0;white-space:pre;\}/);
  assert.match(p, /@page\{size:59\.5em 40em;margin:0;\}/); // 34 lines × 1.75em, 40 chars
  const v = stylesheet({ paginate: false, usedClasses: ['indent-5'] });
  assert.match(v, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 40\)/);
  assert.match(v, /\.line\{[^}]*block-size:1\.75em[^}]*font-size:1rem/);
});

test('傍線 rules carry an explicit text-underline-position (right default / left variant)', () => {
  const css = stylesheet({ paginate: false, usedClasses: ['dec-solid', 'dec-wavy-l'] });
  assert.match(
    css,
    /\.dec-solid\{text-decoration-line:underline;text-decoration-style:solid;text-underline-position:right\}/,
  );
  assert.match(
    css,
    /\.dec-wavy-l\{text-decoration-line:underline;text-decoration-style:wavy;text-underline-position:left\}/,
  );
});

test('太字/斜体 rules come through classRule → styleRule forwarding', () => {
  const css = stylesheet({ paginate: false, usedClasses: ['b', 'i'] });
  assert.match(css, /\.b\{font-weight:bold\}/);
  assert.match(css, /\.i\{font-style:italic\}/);
});

test('.indent-N rules generate on demand; malformed suffixes are ignored', () => {
  const css = stylesheet({ paginate: false, usedClasses: ['indent-2', 'indent-10'] });
  assert.match(css, /\.indent-2\{padding-inline-start:2em\}/);
  assert.match(css, /\.indent-10\{padding-inline-start:10em\}/);
  assert.doesNotMatch(
    stylesheet({ paginate: false, usedClasses: ['indent-', 'indent-0', 'indent-x'] }),
    /padding-inline-start/,
  );
});
