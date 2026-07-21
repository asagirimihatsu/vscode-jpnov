import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuildChrome, PreviewChrome } from '../../../src/shared/compiler/chrome.ts';
import { stylesheet } from '../../../src/shared/compiler/css.ts';

/**
 * The single 80%-alpha edge recipe (base-INDEPENDENT — the base colour rides the `--edge`
 * variable, asserted separately on the `:root` block).
 */
const EDGE_MIX = 'color-mix(in srgb,var(--edge) 80%,transparent)';
/** A match pattern: raw regex source with the escaped recipe appended. */
const edgeMixRe = (raw: string): RegExp => new RegExp(raw + EDGE_MIX.replace(/[()]/g, '\\$&'));

const PREVIEW_OFF: PreviewChrome = { lineNumbers: false, edgeLine: 'none' };
const BUILD_OFF: BuildChrome = {
  lineNumbers: false,
  edgeLine: 'none',
  pageNumber: 'none',
  pageNumberFormat: '{page} / {totalPage}',
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
  // vertical-rl: the static calc() geometry reads the :root variables (page block = lpp ×
  // 2.25em columns; page inline = cpl × 1em chars); @page stays TS-computed (var() is not
  // portable inside @page), so its size is still literal numbers.
  const css = build({ charsPerLine: 30, linesPerPage: 25 });
  assert.match(css, /\.page\{[^}]*inline-size:calc\(var\(--cpl\)\*1em\)/);
  assert.match(css, /\.page\{[^}]*block-size:calc\(var\(--lpp\)\*2\.25em\)/);
  assert.match(css, /:root\{[^}]*--cpl:30/);
  assert.match(css, /:root\{[^}]*--lpp:25/);
  assert.match(css, /@page\{size:64\.25em 41em;margin:0;\}/); // + reserved header/folio bands + paper margin
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
  // font-size = (100vh − 2·16px padding) / (charsPerLine + 2·EDGE_INSET) makes a full
  // line plus the always-reserved frame gaps fill the pane height. `.line` re-pins to
  // that root (1rem) so a webview-injected body{font-size} can't desync the glyph
  // advance from the em-based pitch.
  const css = preview({ charsPerLine: 25 });
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ \(var\(--cpl\) \+ 0\.7\)\)/);
  assert.match(css, /:root\{--cpl:25\}/);
  assert.match(css, /\.line\{[^}]*font-size:1rem/);
});

test('preview fit formula at the standard 40 chars per line pads the columns', () => {
  const css = preview();
  assert.match(css, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ \(var\(--cpl\) \+ 0\.7\)\)/);
  assert.match(css, /:root\{--cpl:40\}/);
  // The padding the formula subtracts (top/bottom = inline axis in vertical-rl).
  assert.match(css, /body\{[^}]*padding-inline:16px/);
  // The matching text inset the denominator pays for — reserved with or without a frame.
  assert.match(css, /\.segment\{position:relative;padding-inline:0\.35rem;\}/);
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
  assert.match(p, /\.line\{block-size:2\.25em;margin:0;white-space:pre;\}/);
  assert.match(p, /@page\{size:84\.5em 51em;margin:0;\}/); // 34×2.25em + 40 chars + reserved bands + paper margin
  const v = preview({ usedClasses: ['indent-5'] });
  assert.match(v, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ \(var\(--cpl\) \+ 0\.7\)\)/);
  assert.match(v, /:root\{--cpl:40\}/);
  assert.match(v, /\.line\{[^}]*block-size:2\.25em[^}]*font-size:1rem/);
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

test('縦中横 .tcy rule is on-demand and identical in both media', () => {
  const rule = '.tcy{text-combine-upright:all}';
  assert.ok(preview({ usedClasses: ['tcy'] }).includes(rule));
  assert.ok(build({ usedClasses: ['tcy'] }).includes(rule));
  assert.doesNotMatch(preview(), /\.tcy\b/); // zero dead rules
  assert.doesNotMatch(build(), /\.tcy\b/);
});

test('見出し .midashi rule is on-demand and identical in both media', () => {
  const rule = '.midashi{font-family:sans-serif;font-weight:bold}';
  assert.ok(preview({ usedClasses: ['midashi'] }).includes(rule));
  assert.ok(build({ usedClasses: ['midashi'] }).includes(rule));
  assert.doesNotMatch(preview(), /\.midashi\b/); // zero dead rules
  assert.doesNotMatch(build(), /\.midashi\b/);
});

test('ruby rr/lr/br rule sets are on-demand, self-contained and media-identical', () => {
  for (const make of [preview, build]) {
    // rr: the right-only lane every plain ruby now uses (native ruby layout is retired).
    const rr = make({ usedClasses: ['rr'] });
    assert.match(
      rr,
      /ruby\.rr\{display:inline-flex;flex-direction:row;justify-content:space-around;position:relative\}/,
    );
    assert.match(rr, /ruby\.rr>rt\{transform:translate\(-50%,-50%\) translateX\(1\.5em\)\}/);
    assert.doesNotMatch(rr, /ruby\.(lr|br)/);
    const lr = make({ usedClasses: ['lr'] });
    // The ruby box itself distributes its base spans (stretches with rh-N like native ruby).
    assert.match(
      lr,
      /ruby\.lr\{display:inline-flex;flex-direction:row;justify-content:space-around;position:relative\}/,
    );
    // Centre-anchored, box-extent lane distributing its reading spans (native ruby-align).
    assert.match(
      lr,
      /ruby\.lr>rt\{position:absolute;top:50%;left:50%;min-height:100%;display:flex;flex-direction:row;justify-content:space-around;writing-mode:vertical-rl;font-size:0\.5em;line-height:1;white-space:nowrap\}/,
    );
    assert.match(lr, /ruby\.lr>rt\{transform:translate\(-50%,-50%\) translateX\(-1\.5em\)\}/);
    assert.doesNotMatch(lr, /ruby\.br/); // only the requested set
    const br = make({ usedClasses: ['br'] });
    assert.match(br, /ruby\.br>rt\{transform:translate\(-50%,-50%\) translateX\(1\.5em\)\}/); // right lane
    assert.match(br, /ruby\.br>rt\.rt-l\{transform:translate\(-50%,-50%\) translateX\(-1\.5em\)\}/); // left lane
    assert.doesNotMatch(br, /ruby\.lr/);
    assert.doesNotMatch(make(), /ruby\.(rr|lr|br)/); // zero dead rules
    // The stretched-ruby min-height family is on-demand too, like indent-N.
    assert.match(make({ usedClasses: ['rh-23'] }), /\.rh-23\{min-height:23em\}/);
    assert.doesNotMatch(make(), /\.rh-/);
  }
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

test('edgeLine → --edge base: red/text inject the base colour, none injects nothing at all', () => {
  // The 80%-alpha recipe lives once in the edge fragments; the :root variable carries ONLY
  // the base. 'none' must leave no trace — no variable, no edge fragment (zero dead rules).
  assert.match(preview({ chrome: { lineNumbers: false, edgeLine: 'red' } }), /:root\{[^}]*--edge:#cc0000\}/);
  assert.match(
    preview({ chrome: { lineNumbers: false, edgeLine: 'text' } }),
    /:root\{[^}]*--edge:currentColor\}/,
  );
  assert.match(build({ chrome: { ...BUILD_OFF, edgeLine: 'red' } }), /:root\{[^}]*--edge:#cc0000\}/);
  assert.doesNotMatch(preview(), /--edge/);
  assert.doesNotMatch(build(), /--edge/);
});

// --- preview chrome ----------------------------------------------------------

test('preview line numbers: fixed-px out-of-flow .ln rule (numbers are JS-emitted spans)', () => {
  const css = preview({ chrome: { lineNumbers: true, edgeLine: 'none' } });
  assert.match(css, /\.line\{position:relative;\}/);
  assert.match(css, /\.ln\{position:absolute/);
  assert.match(css, /\.ln\{[^}]*font-size:10px/); // fixed px — fill invariant
  // Lifted into the pad band, past the text inset (the rem term cancels the em inset at
  // any fit size) and 2px clear of where the frame line would sit — the SAME spot
  // whether edgeLine is on or off.
  assert.match(css, /\.ln\{[^}]*translateY\(calc\(-100% - 0\.35rem - 2px\)\)/);
  // No CSS counters: a sibling counter-reset does not reset following siblings in Chromium.
  assert.doesNotMatch(css, /counter/);
  assert.doesNotMatch(css, /::after/); // no edge rules leak into the lineNumbers-only sheet
});

test('preview edge lines: full-height single-sided rules on the ruby-safe wider pitch', () => {
  const red = preview({ chrome: { lineNumbers: false, edgeLine: 'red' } });
  assert.match(red, /\.line\{position:relative;\}/);
  // One 1px rule per boundary: each column draws its LEFT rule only (left+right pairs
  // would sit side-by-side and read as 2px); a per-segment frame closes the outer edges,
  // so the frames on either side of a ［＃改ページ］ close independently.
  assert.match(red, edgeMixRe(String.raw`\.line:not\(:last-child\)::after\{[^}]*border-left:1px solid `));
  assert.match(red, /:root\{[^}]*--edge:#cc0000\}/); // the recipe's base colour rides --edge
  assert.doesNotMatch(red, /border-right/); // no per-column right rules at all
  // The LAST (leftmost) column draws no rule: at 80% alpha it would stack with the
  // frame's left border into a darker strip — the frame alone closes the run.
  assert.doesNotMatch(red, /\.line::after/);
  assert.match(red, /\.segment\{position:relative;padding-inline:0\.35rem;\}/);
  // The frame is full-band-high (the same fixed height as the rules), never
  // content-hugging: a short segment still gets the complete 原稿用紙 枠.
  assert.match(red, /\.segment::before\{[^}]*top:0;[^}]*height:calc\(100vh - 32px\)/);
  assert.match(red, edgeMixRe(String.raw`\.segment::before\{[^}]*border:1px solid `));
  assert.doesNotMatch(red, /\.book/); // the one-frame-around-everything recipe is gone
  assert.match(red, /\.line:not\(:last-child\)::after\{[^}]*height:calc\(100vh - 32px\)/);
  // The rule anchors on a .line the segment padding inset by 0.35rem, and climbs back
  // the same length so it meets the frame's top edge exactly — rem on BOTH sides, so a
  // webview-injected body{font-size} can't desync the two.
  assert.match(red, /\.line:not\(:last-child\)::after\{[^}]*top:-0\.35rem/);
  // The pitch is the SAME 2.25em with rules on or off (uniform-layout contract); it is
  // wide enough that the boundary lines clear ruby annotations.
  assert.match(red, /html\{[^}]*line-height:2\.25/);
  assert.match(red, /\.line\{[^}]*block-size:2\.25em/);
  const text = preview({ chrome: { lineNumbers: false, edgeLine: 'text' } });
  assert.match(
    text,
    edgeMixRe(String.raw`\.line:not\(:last-child\)::after\{[^}]*border-left:1px solid `),
  );
  assert.match(text, edgeMixRe(String.raw`\.segment::before\{[^}]*border:1px solid `));
  assert.match(text, /:root\{[^}]*--edge:currentColor\}/);
  // Rules off ⇒ the SAME pitch — toggling edgeLine repaints, never reflows.
  assert.match(preview(), /html\{[^}]*line-height:2\.25/);
});

test('preview all-off chrome emits no .ln rule, no edge rules, no frame', () => {
  const css = preview();
  assert.doesNotMatch(css, /\.ln\{/);
  assert.doesNotMatch(css, /::after/);
  assert.doesNotMatch(css, /\.segment::before/); // no frame is drawn…
  // …but the text inset stays reserved, so turning a frame on moves nothing.
  assert.match(css, /\.segment\{position:relative;padding-inline:0\.35rem;\}/);
  assert.doesNotMatch(css, /counter/);
  assert.match(css, /\.pb-label\{/); // the page-break label is unconditional
});

test('preview: the 改ページ dashed rule overshoots the writing band into the pads', () => {
  // Negative inline margins stretch the auto-sized marker 8px (half the pad) past the
  // band on each side, independent of edgeLine — the break outranks frame and text alike.
  const css = preview();
  assert.match(css, /\.pagebreak\{[^}]*border-block-start:2px dashed currentColor/);
  assert.match(css, /\.pagebreak\{[^}]*margin-block:1em/);
  assert.match(css, /\.pagebreak\{[^}]*margin-inline:-8px/);
});

// --- build chrome ------------------------------------------------------------

const BUILD_ON: BuildChrome = {
  lineNumbers: true,
  edgeLine: 'text',
  pageNumber: 'rightLeft',
  pageNumberFormat: '{page} / {totalPage}',
  header: '章',
};

test('build all-on chrome: bands, outset frame, counters, rules, furniture styles', () => {
  const css = build({ chrome: BUILD_ON });
  // Bands: header 2.5 + line numbers 1 on top (--htop), folio 2.5 at the bottom (static).
  assert.match(css, /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
  assert.match(css, /:root\{[^}]*--htop:4/); // header 3 + line numbers 1
  assert.match(css, /\.page\{[^}]*padding-inline-end:3em/);
  assert.match(css, /\.page\{[^}]*position:relative/);
  assert.match(css, /\.page\{[^}]*counter-reset:ln/); // per-page numbering
  // The frame floats EDGE_INSET off the text grid, into the bands (chrome renders
  // OUTSIDE it), and matches the rule colour.
  assert.match(
    css,
    /\.page::before\{[^}]*top:calc\(var\(--htop\)\*1em - 0\.35em\);right:1\.5em;bottom:2\.65em;left:1\.5em/,
  );
  assert.match(css, edgeMixRe(String.raw`\.page::before\{[^}]*border:1px solid `));
  assert.match(css, /:root\{[^}]*--edge:currentColor\}/);
  assert.doesNotMatch(css, /\.page\{[^}]*border:/); // the sheet box itself has no border
  // The pitch is the same 2.25em with rules on or off; it keeps the rules clear of ruby.
  assert.match(css, /\.page\{[^}]*line-height:2\.25/);
  assert.match(css, /\.page\{[^}]*block-size:calc\(var\(--lpp\)\*2\.25em\)/);
  assert.match(css, /:root\{[^}]*--lpp:34/);
  assert.match(css, /\.line\{[^}]*block-size:2\.25em/);
  // The inter-column rule is the preview recipe transplanted: one left rule per boundary
  // (none on the page's last column), stretched 0.35em past both grid ends to meet the
  // outset frame. The old box-shadow recipe (grid-height only — it could no longer reach
  // the frame) is fully retired — the only box-shadow left is the screen sheet's paper
  // shadow, never anything on a .line.
  assert.match(css, edgeMixRe(String.raw`\.line:not\(:last-child\)::after\{[^}]*border-left:1px solid `));
  assert.match(css, /\.line:not\(:last-child\)::after\{[^}]*top:-0\.35em;bottom:-0\.35em/);
  assert.doesNotMatch(css, /\.line[^{]*\{[^}]*box-shadow/);
  // Once-merged declarations now arrive as stacking rules (anchor + ln fragments).
  assert.match(css, /\.line\{counter-increment:ln;\}/);
  assert.match(css, /\.line\{position:relative;\}/);
  assert.match(css, /\.line::before\{content:counter\(ln\)/);
  // The number lifts an extra 0.35rem (rem: its own em is halved by font-size:0.5em) so
  // it clears the outset frame; line-height:1 keeps it inside the line-number band.
  assert.match(css, /\.line::before\{[^}]*translateY\(calc\(-100% - 0\.35rem\)\)/);
  assert.match(css, /\.line::before\{[^}]*line-height:1;/);
  // The header floats 1em inside the sheet edge — the mirror of .pn{bottom:1em} below.
  assert.match(css, /\.hd\{position:absolute;top:1em;left:0;right:0/);
  assert.match(css, /\.hd\{[^}]*line-height:1;/);
  assert.match(css, /\.pn\{position:absolute;bottom:1em/);
  assert.match(css, /\.pn\{[^}]*line-height:1;/);
  assert.match(css, /\.pn\.r\{right:1\.85em;\}/);
  assert.match(css, /\.pn\.l\{left:1\.85em;\}/);
  // Sheet grows by the bands: 40 + 4 + 3 + 2×2.5 = 52em on the inline (char) axis.
  assert.match(css, /@page\{size:84\.5em 52em;margin:0;\}/);
});

test('build all-off chrome keeps a plain sheet with the reserved bands, no chrome rules', () => {
  const css = build();
  // Header and folio bands are reserved even with no furniture; edgeLine 'none' draws NO
  // frame at all (same semantics as the preview) — and the sheet lays out identically.
  assert.doesNotMatch(css, /\.page::before/);
  assert.doesNotMatch(css, /#444/); // the frame's old grey fallback is gone (.pn is off here)
  assert.match(css, /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
  assert.match(css, /:root\{[^}]*--htop:3/); // header band only — no line-number band
  assert.match(css, /\.page\{[^}]*padding-inline-end:3em/);
  assert.match(css, /\.page\{[^}]*line-height:2\.25/); // the SAME pitch without edge rules
  assert.match(css, /@page\{size:84\.5em 51em;margin:0;\}/);
  // The screen-only paper look (grey backdrop + sheet shadow + the shared 2.5em surround)
  // is chrome-independent — present even with every feature off — and print resets it.
  assert.match(css, /@media screen\{html\{background:#e8e8e8;\}\.page\{box-shadow:0 1px 4px rgba\(0,0,0,0\.25\);\}\}/);
  assert.match(css, /\.page\{[^}]*margin:2\.5em auto/);
  // Print keeps sheets one-per-page (vertical-rl root — Chromium splits orthogonal-flow
  // sheets onto two papers) with the paper inset on the SHEET; @page margins stay 0 so
  // the browser's own header/footer (its page numbers, URL, date) has nowhere to render.
  assert.match(css, /@media print\{html\{writing-mode:vertical-rl;background:none;\}\.page\{margin:2\.5em;box-shadow:none;\}\}/);
  assert.doesNotMatch(css, /\.line[^{]*\{[^}]*box-shadow/);
  assert.doesNotMatch(css, /::after/); // no inter-column rules without edge lines
  assert.doesNotMatch(css, /counter/);
  assert.doesNotMatch(css, /\.hd\{|\.pn\{/);
});

test('build red edge lines colour both the frame and the inter-column rules', () => {
  const css = build({ chrome: { ...BUILD_OFF, edgeLine: 'red' } });
  assert.match(css, edgeMixRe(String.raw`\.page::before\{[^}]*border:1px solid `));
  assert.match(css, /:root\{[^}]*--edge:#cc0000\}/);
  // No line-number band here (--htop:3), so the frame floats 0.35em off the header band.
  assert.match(
    css,
    /\.page::before\{[^}]*top:calc\(var\(--htop\)\*1em - 0\.35em\);right:1\.5em;bottom:2\.65em;left:1\.5em/,
  );
  assert.match(css, /:root\{[^}]*--htop:3/);
  assert.match(css, edgeMixRe(String.raw`\.line:not\(:last-child\)::after\{[^}]*border-left:1px solid `));
  assert.match(css, /\.line\{[^}]*position:relative/); // the rule's anchor, even with numbers off
  assert.match(css, /\.line\{[^}]*block-size:2\.25em/); // the constant ruby-safe pitch
});

test('build bands: header/folio bands are constant; only line numbers add geometry', () => {
  // Folio and header furniture change nothing geometric — those bands are always there.
  for (const chrome of [
    BUILD_OFF,
    { ...BUILD_OFF, pageNumber: 'right' as const },
    { ...BUILD_OFF, header: 'X' },
  ]) {
    const css = build({ chrome });
    assert.match(css, /:root\{[^}]*--htop:3/); // the top band is furniture-independent
    assert.match(css, /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
    assert.match(css, /\.page\{[^}]*padding-inline-end:3em/);
    assert.match(css, /@page\{size:84\.5em 51em/); // 40 + 3 + 3 + 2×2.5
  }
  const lnOnly = build({ chrome: { ...BUILD_OFF, lineNumbers: true } });
  assert.match(lnOnly, /:root\{[^}]*--htop:4/); // header 3 + numbers 1
  assert.match(lnOnly, /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
  assert.match(lnOnly, /\.page\{[^}]*padding-inline-end:3em/);
});

test('edgeLine none draws no frame in either medium (preview/build cohesion)', () => {
  assert.doesNotMatch(preview(), /\.segment::before/);
  assert.doesNotMatch(build(), /\.page::before/);
  // …while both keep the text where a frame-bearing sheet puts it: the reserve is
  // unconditional (preview text inset / build grid position), so toggling edgeLine
  // repaints but never reflows.
  assert.match(preview(), /\.segment\{position:relative;padding-inline:0\.35rem;\}/);
  assert.match(build(), /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
});
