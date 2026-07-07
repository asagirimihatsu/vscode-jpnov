import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuildChrome, PreviewChrome } from '../../../src/shared/compiler/chrome.ts';
import { edgeRuleColor, stylesheet } from '../../../src/shared/compiler/css.ts';

const PREVIEW_OFF: PreviewChrome = { lineNumbers: false, edgeLine: 'none' };
const BUILD_OFF: BuildChrome = {
  lineNumbers: false,
  edgeLine: 'none',
  pageNumberPosition: 'none',
  pageNumberTemplate: '{page} / {totalPage}',
  header: '',
};

/** Preview stylesheet with explicit resolved options (the compiler has no defaults). */
function preview(
  o: { charsPerLine?: number; chrome?: PreviewChrome; usedClasses?: readonly string[] } = {},
): string {
  return stylesheet({
    paginate: false,
    charsPerLine: o.charsPerLine ?? 40,
    chrome: o.chrome ?? PREVIEW_OFF,
    usedClasses: o.usedClasses ?? [],
  });
}

/** Build stylesheet with explicit resolved options (the compiler has no defaults). */
function build(
  o: {
    charsPerLine?: number;
    linesPerPage?: number;
    chrome?: BuildChrome;
    usedClasses?: readonly string[];
  } = {},
): string {
  return stylesheet({
    paginate: true,
    charsPerLine: o.charsPerLine ?? 40,
    linesPerPage: o.linesPerPage ?? 34,
    chrome: o.chrome ?? BUILD_OFF,
    usedClasses: o.usedClasses ?? [],
  });
}

test('stylesheet renders vertical-rl writing mode', () => {
  assert.match(preview(), /writing-mode:vertical-rl/);
});

test('paginated stylesheet sizes the page + @page by charsPerLine x linesPerPage', () => {
  // vertical-rl: page block (cols) = 25 * 1.75 = 43.75em; page inline (chars) = 30em.
  const css = build({ charsPerLine: 30, linesPerPage: 25 });
  assert.match(css, /\.page\{[^}]*inline-size:30em/);
  assert.match(css, /\.page\{[^}]*block-size:43\.75em/);
  assert.match(css, /@page\{size:48\.75em 40em;margin:0;\}/); // + reserved header/folio bands + paper margin
});

test('paginated stylesheet breaks each .page onto its own sheet', () => {
  const css = build();
  assert.match(css, /\.page\{[^}]*break-after:page/);
  assert.match(css, /\.page\{[^}]*page-break-after:always/);
});

test('non-paginated (preview) stylesheet makes .pagebreak a labelled rule, no @page', () => {
  const css = preview();
  assert.doesNotMatch(css, /@page/);
  assert.doesNotMatch(css, /break-before:page/);
  assert.match(css, /\.pagebreak\{[^}]*border-block-start/);
  // The 「改ページ」 label styling is always present (the marker DOM always carries it).
  assert.match(css, /\.pb-label\{[^}]*writing-mode:vertical-rl/);
});

test('non-paginated (preview) stylesheet no longer caps width in CSS (JS hard-wraps)', () => {
  // Line wrapping moved into the layout engine; the preview CSS must NOT emit an inline-size
  // cap, which would only double-constrain the already-wrapped .line columns.
  const css = preview({ charsPerLine: 24 });
  assert.doesNotMatch(css, /inline-size/);
});

test('non-paginated (preview) stylesheet fits the root font-size to the viewport', () => {
  // In vertical-rl a full-width char advances exactly 1em along the column, so root
  // font-size = (100vh − 2·16px padding) / charsPerLine makes a full line fill the pane
  // height. `.line` re-pins to that root (1rem) so a webview-injected body{font-size}
  // can't desync the glyph advance from the em-based pitch.
  const css = preview({ charsPerLine: 25 });
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 25\)/);
  assert.match(css, /\.line\{[^}]*font-size:1rem/);
});

test('preview fit formula at the standard 40 chars per line pads the columns', () => {
  const css = preview();
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 40\)/);
  // The padding the formula subtracts (top/bottom = inline axis in vertical-rl).
  assert.match(css, /body\{[^}]*padding-inline:16px/);
});

test('stylesheet emits ONLY the requested class rules (on-demand)', () => {
  const cases: [string, string][] = [
    ['preview', preview({ usedClasses: ['emph-fs', 'emph-x-l'] })],
    ['build', build({ usedClasses: ['emph-fs', 'emph-x-l'] })],
  ];
  for (const [label, css] of cases) {
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
  assert.doesNotMatch(preview(), /\.emph-/);
  assert.doesNotMatch(build(), /\.emph-/);
});

test('stylesheet preserves the caller-provided (lexicographic) rule order', () => {
  // The renderers pass classes pre-sorted by class name (not spec order); stylesheet emits
  // them in that order verbatim.
  const css = preview({ usedClasses: ['emph-fs', 'emph-ot'] });
  assert.ok(css.indexOf('.emph-fs{') < css.indexOf('.emph-ot{'));
});

test('字下げ padding is inline-start, never block-start (axis lock)', () => {
  // vertical-rl: the inline axis runs down the column, so the indent pushes the first glyph
  // DOWN via padding-inline-start. padding-block-start would shove the whole column sideways.
  const css = preview({ usedClasses: ['indent-3'] });
  assert.match(css, /\.indent-3\{padding-inline-start:3em\}/);
  assert.doesNotMatch(css, /padding-block-start/);
});

test('base fill rules stay untouched by decoration/indent classes', () => {
  const p = build({ usedClasses: ['dec-wavy', 'b', 'i', 'indent-5'] });
  assert.match(p, /\.line\{block-size:1\.75em;margin:0;white-space:pre;\}/);
  assert.match(p, /@page\{size:64\.5em 50em;margin:0;\}/); // 34×1.75em + 40 chars + reserved bands + paper margin
  const v = preview({ usedClasses: ['indent-5'] });
  assert.match(v, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ 40\)/);
  assert.match(v, /\.line\{[^}]*block-size:1\.75em[^}]*font-size:1rem/);
});

test('傍線 rules carry an explicit text-underline-position (right default / left variant)', () => {
  const css = preview({ usedClasses: ['dec-solid', 'dec-wavy-l'] });
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
  const css = preview({ usedClasses: ['b', 'i'] });
  assert.match(css, /\.b\{font-weight:bold\}/);
  assert.match(css, /\.i\{font-style:italic\}/);
});

test('.indent-N rules generate on demand; malformed suffixes are ignored', () => {
  const css = preview({ usedClasses: ['indent-2', 'indent-10'] });
  assert.match(css, /\.indent-2\{padding-inline-start:2em\}/);
  assert.match(css, /\.indent-10\{padding-inline-start:10em\}/);
  assert.doesNotMatch(
    preview({ usedClasses: ['indent-', 'indent-0', 'indent-x'] }),
    /padding-inline-start/,
  );
});

// --- edge-rule colour policy -------------------------------------------------

test('edgeRuleColor: 黒 is theme-relative in preview, ink in build; 赤 shared; none is null', () => {
  assert.equal(edgeRuleColor('black', false), 'currentColor');
  assert.equal(edgeRuleColor('black', true), '#000');
  assert.equal(edgeRuleColor('red', false), '#cc0000');
  assert.equal(edgeRuleColor('red', true), '#cc0000');
  assert.equal(edgeRuleColor('none', false), null);
  assert.equal(edgeRuleColor('none', true), null);
});

// --- preview chrome ----------------------------------------------------------

test('preview line numbers: fixed-px out-of-flow .ln rule (numbers are JS-emitted spans)', () => {
  const css = preview({ chrome: { lineNumbers: true, edgeLine: 'none' } });
  assert.match(css, /\.line\{position:relative;\}/);
  assert.match(css, /\.ln\{position:absolute/);
  assert.match(css, /\.ln\{[^}]*font-size:10px/); // fixed px — fill invariant
  assert.match(css, /\.ln\{[^}]*translateY\(-100%\)/); // lifted into the pad band
  // No CSS counters: a sibling counter-reset does not reset following siblings in Chromium.
  assert.doesNotMatch(css, /counter/);
  assert.doesNotMatch(css, /\.line::after/);
});

test('preview edge lines: full-height single-sided rules on the ruby-safe wider pitch', () => {
  const red = preview({ chrome: { lineNumbers: false, edgeLine: 'red' } });
  assert.match(red, /\.line\{position:relative;\}/);
  // One 1px rule per boundary: every column draws its LEFT rule only (left+right pairs
  // would sit side-by-side and read as 2px); the .book frame closes the outer edges.
  assert.match(red, /\.line::after\{[^}]*border-left:1px solid #cc0000/);
  assert.doesNotMatch(red, /border-right/); // no per-column right rules at all
  assert.match(red, /\.book\{position:relative;\}/);
  assert.match(red, /\.book::before\{[^}]*inset:0/);
  assert.match(red, /\.book::before\{[^}]*border:1px solid #cc0000/);
  assert.match(red, /\.line::after\{[^}]*height:calc\(100vh - 32px\)/);
  // Rules on ⇒ pitch widens to 2.25em so the boundary lines clear ruby annotations.
  assert.match(red, /html\{[^}]*line-height:2\.25/);
  assert.match(red, /\.line\{[^}]*block-size:2\.25em/);
  const black = preview({ chrome: { lineNumbers: false, edgeLine: 'black' } });
  assert.match(black, /\.line::after\{[^}]*border-left:1px solid currentColor/);
  // Rules off ⇒ the default pitch stays.
  assert.match(preview(), /html\{[^}]*line-height:1\.75/);
});

test('preview all-off chrome emits no .ln rule, no edge rules, no frame', () => {
  const css = preview();
  assert.doesNotMatch(css, /\.ln\{/);
  assert.doesNotMatch(css, /::after/);
  assert.doesNotMatch(css, /\.book::before/);
  assert.doesNotMatch(css, /counter/);
  assert.match(css, /\.pb-label\{/); // the page-break label is unconditional
});

// --- build chrome ------------------------------------------------------------

const BUILD_ON: BuildChrome = {
  lineNumbers: true,
  edgeLine: 'black',
  pageNumberPosition: 'rightThenLeft',
  pageNumberTemplate: '{page} / {totalPage}',
  header: '章',
};

test('build all-on chrome: bands, grid-hugging frame, counters, rules, furniture styles', () => {
  const css = build({ chrome: BUILD_ON });
  // Bands: header 1.75 + line numbers 1 on top; folio 1.75 at the bottom.
  assert.match(css, /\.page\{[^}]*padding-inline-start:3\.5em/); // header 2.5 + line numbers 1
  assert.match(css, /\.page\{[^}]*padding-inline-end:2\.5em/);
  assert.match(css, /\.page\{[^}]*position:relative/);
  assert.match(css, /\.page\{[^}]*counter-reset:ln/); // per-page numbering
  // The frame is inset past the bands (chrome renders OUTSIDE it) and matches the rule colour.
  assert.match(css, /\.page::before\{[^}]*top:3\.5em;right:0;bottom:2\.5em;left:0/);
  assert.match(css, /\.page::before\{[^}]*border:1px solid #000/);
  assert.doesNotMatch(css, /\.page\{[^}]*border:/); // the sheet box itself has no border
  // Edge rules on ⇒ the pitch widens (1.75 → 2.25em) so the rules clear ruby annotations.
  assert.match(css, /\.page\{[^}]*line-height:2\.25/);
  assert.match(css, /\.page\{[^}]*block-size:76\.5em/); // 34 lines × 2.25em
  assert.match(css, /\.line\{[^}]*block-size:2\.25em/);
  assert.match(css, /\.line\{[^}]*box-shadow:-1px 0 0 0 #000/);
  assert.match(css, /\.line\{[^}]*counter-increment:ln;position:relative/);
  assert.match(css, /\.line::before\{content:counter\(ln\)/);
  assert.match(css, /\.hd\{position:absolute;top:0;left:0;right:0/);
  assert.match(css, /\.pn\{position:absolute;bottom:0\.5em/);
  assert.match(css, /\.pn\.r\{right:0\.35em;\}/);
  assert.match(css, /\.pn\.l\{left:0\.35em;\}/);
  // Sheet grows by the bands: 40 + 2.75 + 1.75 = 44.5em on the inline (char) axis.
  assert.match(css, /@page\{size:81\.5em 51em;margin:0;\}/);
});

test('build all-off chrome keeps a plain sheet with the reserved bands, no chrome rules', () => {
  const css = build();
  // Header and folio bands are reserved even with no furniture; the frame sits between them.
  assert.match(css, /\.page::before\{[^}]*top:2\.5em;right:0;bottom:2\.5em;left:0/);
  assert.match(css, /\.page::before\{[^}]*border:1px solid #444/);
  assert.match(css, /\.page\{[^}]*padding-inline-start:2\.5em/);
  assert.match(css, /\.page\{[^}]*padding-inline-end:2\.5em/);
  assert.match(css, /\.page\{[^}]*line-height:1\.75/); // default pitch without edge rules
  assert.match(css, /@page\{size:64\.5em 50em;margin:0;\}/);
  // Print keeps sheets one-per-page (vertical-rl root — Chromium splits orthogonal-flow
  // sheets onto two papers) with the paper inset on the SHEET; @page margins stay 0 so
  // the browser's own header/footer (its page numbers, URL, date) has nowhere to render.
  assert.match(css, /@media print\{html\{writing-mode:vertical-rl;\}\.page\{margin:2\.5em;\}\}/);
  assert.doesNotMatch(css, /box-shadow/);
  assert.doesNotMatch(css, /counter/);
  assert.doesNotMatch(css, /\.hd\{|\.pn\{/);
});

test('build red edge lines colour both the frame and the inter-column rules', () => {
  const css = build({ chrome: { ...BUILD_OFF, edgeLine: 'red' } });
  assert.match(css, /\.page::before\{[^}]*border:1px solid #cc0000/);
  assert.match(css, /\.line\{[^}]*box-shadow:-1px 0 0 0 #cc0000/);
  assert.match(css, /\.line\{[^}]*block-size:2\.25em/); // ruby-safe pitch rides with the rules
});

test('build bands: header/folio bands are constant; only line numbers add geometry', () => {
  // Folio and header furniture change nothing geometric — those bands are always there.
  for (const chrome of [
    BUILD_OFF,
    { ...BUILD_OFF, pageNumberPosition: 'alwaysRight' as const },
    { ...BUILD_OFF, header: 'X' },
  ]) {
    const css = build({ chrome });
    assert.match(css, /\.page\{[^}]*padding-inline-start:2\.5em/);
    assert.match(css, /\.page\{[^}]*padding-inline-end:2\.5em/);
    assert.match(css, /@page\{size:64\.5em 50em/); // 40 + 2.5 + 2.5 + 2×2.5
  }
  const lnOnly = build({ chrome: { ...BUILD_OFF, lineNumbers: true } });
  assert.match(lnOnly, /\.page\{[^}]*padding-inline-start:3\.5em/); // header 2.5 + numbers 1
  assert.match(lnOnly, /\.page\{[^}]*padding-inline-end:2\.5em/);
});
