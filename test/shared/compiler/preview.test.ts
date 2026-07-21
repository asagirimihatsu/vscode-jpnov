import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PreviewChrome } from '../../../src/shared/compiler/chrome.ts';
import { renderPreview } from '../../../src/shared/compiler/preview.ts';

/**
 * The single 80%-alpha edge recipe (base-INDEPENDENT — the base colour rides the `--edge`
 * variable, asserted separately on the `:root` block).
 */
const EDGE_MIX = 'color-mix(in srgb,var(--edge) 80%,transparent)';
/** A match pattern: raw regex source with the escaped recipe for `base` appended. */
const edgeMixRe = (raw: string): RegExp => new RegExp(raw + EDGE_MIX.replace(/[()]/g, '\\$&'));
// Full recipe pinned by css.test.ts / styles-codegen.test.ts; here only a shipped-fragment probe.
const EDGE_GRAD_PROBE = /\.segment::before\{[^}]*repeating-linear-gradient\(to left/;

/** renderPreview with explicit resolved options (the compiler has no defaults); chrome all-off. */
function preview(
  src: string,
  o: Partial<{
    charsPerLine: number;
    linesPerPage: number;
    kinsoku: 'none' | 'normal' | 'strict';
    autoTcy: 'none' | 'punctuationPairs';
    chrome: PreviewChrome;
  }> = {},
): string {
  return renderPreview(src, {
    charsPerLine: 40,
    linesPerPage: 34,
    kinsoku: 'none',
    autoTcy: 'none',
    chrome: { lineNumbers: false, edgeLine: 'none' },
    ...o,
  });
}

test('renderPreview: autoTcy=punctuationPairs combines pairs exactly like the build', () => {
  const on = preview('えっ!?', { autoTcy: 'punctuationPairs' });
  assert.match(on, /<span class="tcy">!\?<\/span>/);
  assert.match(on, /\.tcy\{text-combine-upright:all\}/); // the on-demand rule rides along
  const off = preview('えっ!?');
  assert.doesNotMatch(off, /tcy/); // none: the pair stays plain rotated text, zero dead rules
});

test('renderPreview wraps the body in a standalone HTML document', () => {
  const html = preview('本文です。');
  assert.match(html, /^<!DOCTYPE html><html><head>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<style>[^<]*writing-mode:vertical-rl/);
  assert.match(
    html,
    /<body><div class="book"><div class="segment"><div class="line" data-line="0">本文です。<\/div><\/div><\/div><\/body><\/html>$/,
  );
});

test('renderPreview is continuous: no pagination (no .page / @page)', () => {
  const html = preview('本文');
  assert.doesNotMatch(html, /@page/);
  assert.doesNotMatch(html, /break-before:page/);
  assert.doesNotMatch(html, /data-page/);
});

test('renderPreview shows ［＃改ページ］ as a labelled marker, not a real page break', () => {
  const html = preview('前\n［＃改ページ］\n後');
  // The marker sits BETWEEN the two segments (a direct .book child), never inside one.
  assert.match(
    html,
    /<div class="line" data-line="0">前<\/div><\/div><div class="pagebreak"><span class="pb-label">改ページ<\/span><\/div><div class="segment"><div class="line" data-line="2">後<\/div>/,
  );
  assert.doesNotMatch(html, /<hr/);
});

test('renderPreview never renders a book title', () => {
  const html = preview('本文');
  assert.doesNotMatch(html, /<h1/);
  assert.doesNotMatch(html, /class="line title"/);
});

test('renderPreview compiles ruby + emphasis inside the standalone doc', () => {
  const html = preview('漢字《かんじ》と語［＃「語」に傍点］');
  assert.match(html, /<ruby class="rr"><span>漢<\/span><span>字<\/span><rt><span>か<\/span><span>ん<\/span><span>じ<\/span><\/rt><\/ruby>/);
  assert.match(html, /<span class="emph-fs">語<\/span>/);
});

test('renderPreview emits the used emphasis rule in the <style>, omits unused (on-demand)', () => {
  // Goal #2: the 傍点 rule lives in the nonce-able <style>, not an inline attribute, so the
  // webview CSP can no longer strip it. Goal #3: only the used variant's rule is emitted.
  const html = preview('語［＃「語」に傍点］');
  assert.match(html, /<span class="emph-fs">/);
  assert.match(html, /\.emph-fs\{text-emphasis-style:filled sesame\}/);
  assert.doesNotMatch(html, /\.emph-ot\b/); // an unused variant's rule is absent
  assert.doesNotMatch(html, /style="text-emphasis/); // no inline emphasis styles remain
});

test('renderPreview emits per-line data-line anchors (for cursor-follow)', () => {
  const html = preview('一\n二\n三');
  assert.match(
    html,
    /<div class="line" data-line="0">一<\/div><div class="line" data-line="1">二<\/div><div class="line" data-line="2">三<\/div>/,
  );
});

test('renderPreview hard-wraps at charsPerLine; data-line is first-only on a wrapped line', () => {
  // 一二三 at cpl 2 → two columns; only the first carries the source-line anchor.
  assert.match(
    preview('一二三', { charsPerLine: 2 }),
    /<div class="line" data-line="0">一二<\/div><div class="line">三<\/div>/,
  );
});

test('renderPreview honors the kinsoku mode (禁則) — the same engine as the build', () => {
  // cpl 2: naive ああ|」 would leave 」 at a line start; 追い出し pulls あ down → あ|あ」.
  assert.match(
    preview('ああ」', { charsPerLine: 2, kinsoku: 'normal' }),
    /<div class="line" data-line="0">あ<\/div><div class="line">あ」<\/div>/,
  );
  // A trailing 。 hangs (ぶら下げ): the .hang span and its on-demand rule ride together,
  // and neither appears when nothing hangs.
  const hung = preview('文だ。', { charsPerLine: 2, kinsoku: 'normal' });
  assert.match(hung, /<div class="line" data-line="0">文だ<span class="hang">。<\/span><\/div>/);
  assert.match(hung, /\.hang\{letter-spacing:-1em\}/);
  assert.doesNotMatch(preview('文だ', { charsPerLine: 2, kinsoku: 'normal' }), /\.hang/);
  // With 禁則 off, the naive wrap returns (」 leads the second column).
  assert.match(
    preview('ああ」', { charsPerLine: 2 }),
    /<div class="line" data-line="0">ああ<\/div><div class="line">」<\/div>/,
  );
});

test('renderPreview renders an unclosed ［＃ as visible literal text on its own line only', () => {
  // Lenient line-bounded recovery: the swallowed tail stays visible (typing feedback), and the
  // NEXT source line is untouched — the old cross-line swallow must not come back.
  const html = preview('本文［＃こわれ\n次の行');
  assert.match(html, /<div class="line" data-line="0">本文［＃こわれ<\/div>/);
  assert.match(html, /<div class="line" data-line="1">次の行<\/div>/);
});

test('renderPreview keeps a blank source line as a blank column', () => {
  assert.match(
    preview('一\n\n二'),
    /<div class="line" data-line="0">一<\/div><div class="line" data-line="1"><\/div><div class="line" data-line="2">二<\/div>/,
  );
});

test('renderPreview pins line font-size to the root and emits no CSS width cap', () => {
  const html = preview('本文', { charsPerLine: 24 });
  assert.match(html, /\.line\{[^}]*font-size:1rem/);
  assert.doesNotMatch(html, /inline-size/);
});

test('renderPreview scales the root font so a full line fills the pane height', () => {
  // The SAME charsPerLine drives both the JS hard wrap and the stylesheet's
  // fit-to-viewport formula — a full 20-char column plus the two reserved 0.35em frame
  // gaps measures exactly 100vh − padding.
  const html = preview('本文', { charsPerLine: 20 });
  assert.match(html, /html\{[^}]*font-size:calc\(\(100vh - 32px\) \/ \(var\(--cpl\) \+ 0\.7\)\)/);
  assert.match(html, /:root\{--cpl:20\}/);
});

test('renderPreview: 傍線 postfix emits a dec-solid span + its on-demand rule (right side)', () => {
  const out = preview('語［＃「語」に傍線］');
  assert.match(out, /<span class="dec-solid">語<\/span>/);
  assert.match(
    out,
    /\.dec-solid\{text-decoration-line:underline;text-decoration-style:solid;text-underline-position:right\}/,
  );
});

test('renderPreview: block 字下げ continuations keep indent-N; only the first column anchors', () => {
  const out = preview('［＃ここから１字下げ］\n一二\n［＃ここで字下げ終わり］', {
    charsPerLine: 2,
  });
  assert.match(out, /<div class="line indent-1" data-line="1">一<\/div>/);
  assert.match(out, /<div class="line indent-1">二<\/div>/);
  assert.match(out, /\.indent-1\{padding-inline-start:1em\}/);
});

test('renderPreview line numbers: .ln head spans count display lines, restarting at 改ページ', () => {
  // JS-numbered spans (not CSS counters: a sibling counter-reset does not reset following
  // siblings in Chromium). 三 wraps at cpl 2? No — one char per line here; the wrap case
  // below covers continuation columns.
  const on = preview('一\n二\n［＃改ページ］\n三', {
    chrome: { lineNumbers: true, edgeLine: 'none' },
  });
  assert.match(
    on,
    /<div class="line" data-line="0"><span class="ln">1<\/span>一<\/div><div class="line" data-line="1"><span class="ln">2<\/span>二<\/div><\/div><div class="pagebreak"><span class="pb-label">改ページ<\/span><\/div><div class="segment"><div class="line" data-line="3"><span class="ln">1<\/span>三<\/div>/,
  );
  assert.match(on, /\.ln\{position:absolute/);
  assert.match(on, /\.ln\{[^}]*font-size:10px/); // fixed px — fill invariant
});

test('renderPreview line numbers count wrapped continuation columns as their own lines', () => {
  const on = preview('一二三', { charsPerLine: 2, chrome: { lineNumbers: true, edgeLine: 'none' } });
  assert.match(
    on,
    /<div class="line" data-line="0"><span class="ln">1<\/span>一二<\/div><div class="line"><span class="ln">2<\/span>三<\/div>/,
  );
});

test('renderPreview edge lines ride the stylesheet only: red and text, both at 80% alpha', () => {
  const red = preview('一', { chrome: { lineNumbers: false, edgeLine: 'red' } });
  assert.match(red, EDGE_GRAD_PROBE); // full-page rules on the frame's own background
  assert.match(red, edgeMixRe(String.raw`\.segment::before\{[^}]*border:1px solid `));
  assert.match(red, /\.segment\{min-block-size:calc\(var\(--lpp\)\*2\.25rem\);\}/);
  assert.match(red, /:root\{[^}]*--lpp:34;--edge:#cc0000\}/);
  const text = preview('一', { chrome: { lineNumbers: false, edgeLine: 'text' } });
  assert.match(text, EDGE_GRAD_PROBE);
  assert.match(text, /:root\{[^}]*--edge:currentColor\}/);
});

test('renderPreview all-off chrome emits neither number spans nor edge rules', () => {
  const html = preview('一');
  assert.doesNotMatch(html, /class="ln"/);
  assert.doesNotMatch(html, /\.ln\{/);
  assert.doesNotMatch(html, /::after/);
  assert.doesNotMatch(html, /--lpp|min-block-size/); // the page extent rides the edge fragment only
  assert.match(html, /\.pb-label\{/); // the page-break label styling is unconditional
});
