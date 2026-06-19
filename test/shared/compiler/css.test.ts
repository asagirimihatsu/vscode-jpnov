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

test('non-paginated (preview) stylesheet pins text font-size to the root (pitch cannot desync)', () => {
  // The line/column pitch is em-based (block-size:1.75em); the text must share a fixed root
  // basis (1rem on html + .line) so a webview-injected body{font-size} can't desync the glyph
  // advance from that pitch.
  const css = stylesheet({ paginate: false });
  assert.match(css, /html\{[^}]*font-size:1rem/);
  assert.match(css, /\.line\{[^}]*font-size:1rem/);
});

test('stylesheet emits ONLY the requested emphasis class rules (on-demand)', () => {
  for (const paginate of [false, true]) {
    const label = `paginate=${String(paginate)}`;
    const css = stylesheet({ paginate, emphasisClasses: ['emph-fs', 'emph-x-l'] });
    assert.match(css, /\.emph-fs\{text-emphasis-style:filled sesame\}/, label);
    assert.match(
      css,
      /\.emph-x-l\{text-emphasis-style:'×';text-emphasis-position:left\}/,
      label,
    );
    // A variant that was not requested gets no rule.
    assert.doesNotMatch(css, /\.emph-ot\b/, label);
  }
});

test('stylesheet emits NO .emph- rule when no emphasis classes are requested', () => {
  assert.doesNotMatch(stylesheet({ paginate: false }), /\.emph-/);
  assert.doesNotMatch(stylesheet({ paginate: true }), /\.emph-/);
});

test('stylesheet preserves the caller-provided (lexicographic) emphasis rule order', () => {
  // The renderers pass classes pre-sorted by class name (not spec order); stylesheet emits
  // them in that order verbatim.
  const css = stylesheet({ paginate: false, emphasisClasses: ['emph-fs', 'emph-ot'] });
  assert.ok(css.indexOf('.emph-fs{') < css.indexOf('.emph-ot{'));
});
