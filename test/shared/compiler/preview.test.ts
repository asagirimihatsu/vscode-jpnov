import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview } from '../../../src/shared/compiler/preview.ts';

test('renderPreview wraps the body in a standalone HTML document', () => {
  const html = renderPreview('本文です。');
  assert.match(html, /^<!DOCTYPE html><html><head>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<style>[^<]*writing-mode:vertical-rl/);
  assert.match(
    html,
    /<body><div class="book"><div class="line" data-line="0">本文です。<\/div><\/div><\/body><\/html>$/,
  );
});

test('renderPreview is continuous: no pagination (no .page / @page)', () => {
  const html = renderPreview('本文');
  assert.doesNotMatch(html, /@page/);
  assert.doesNotMatch(html, /break-before:page/);
  assert.doesNotMatch(html, /data-page/);
});

test('renderPreview shows ［＃改ページ］ as a visible <hr>, not a real page break', () => {
  const html = renderPreview('前\n［＃改ページ］\n後');
  assert.match(
    html,
    /<div class="line" data-line="0">前<\/div><hr class="pagebreak"><div class="line" data-line="2">後<\/div>/,
  );
  assert.doesNotMatch(html, /<div class="pagebreak">/);
});

test('renderPreview never renders a book title', () => {
  const html = renderPreview('本文');
  assert.doesNotMatch(html, /<h1/);
  assert.doesNotMatch(html, /class="line title"/);
});

test('renderPreview compiles ruby + emphasis inside the standalone doc', () => {
  const html = renderPreview('漢字《かんじ》と語［＃「語」に傍点］');
  assert.match(html, /<ruby>漢字<rt>かんじ<\/rt><\/ruby>/);
  assert.match(html, /<span class="emph-fs">語<\/span>/);
});

test('renderPreview emits the used emphasis rule in the <style>, omits unused (on-demand)', () => {
  // Goal #2: the 傍点 rule lives in the nonce-able <style>, not an inline attribute, so the
  // webview CSP can no longer strip it. Goal #3: only the used variant's rule is emitted.
  const html = renderPreview('語［＃「語」に傍点］');
  assert.match(html, /<span class="emph-fs">/);
  assert.match(html, /\.emph-fs\{text-emphasis-style:filled sesame\}/);
  assert.doesNotMatch(html, /\.emph-ot\b/); // an unused variant's rule is absent
  assert.doesNotMatch(html, /style="text-emphasis/); // no inline emphasis styles remain
});

test('renderPreview emits per-line data-line anchors (for cursor-follow)', () => {
  const html = renderPreview('一\n二\n三');
  assert.match(
    html,
    /<div class="line" data-line="0">一<\/div><div class="line" data-line="1">二<\/div><div class="line" data-line="2">三<\/div>/,
  );
});

test('renderPreview hard-wraps at charsPerLine; data-line is first-only on a wrapped line', () => {
  // 一二三 at cpl 2 → two columns; only the first carries the source-line anchor.
  assert.match(
    renderPreview('一二三', { charsPerLine: 2 }),
    /<div class="line" data-line="0">一二<\/div><div class="line">三<\/div>/,
  );
});

test('renderPreview honors avoidLineBreaks (禁則) — the same engine as the build', () => {
  // cpl 2: naive ああ|」 would leave 」 at a line start; 追い出し pulls あ down → あ|あ」.
  assert.match(
    renderPreview('ああ」', { charsPerLine: 2, avoidLineBreaks: true }),
    /<div class="line" data-line="0">あ<\/div><div class="line">あ」<\/div>/,
  );
  // With 禁則 off, the naive wrap returns (」 leads the second column).
  assert.match(
    renderPreview('ああ」', { charsPerLine: 2 }),
    /<div class="line" data-line="0">ああ<\/div><div class="line">」<\/div>/,
  );
});

test('renderPreview keeps a blank source line as a blank column', () => {
  assert.match(
    renderPreview('一\n\n二'),
    /<div class="line" data-line="0">一<\/div><div class="line" data-line="1"><\/div><div class="line" data-line="2">二<\/div>/,
  );
});

test('renderPreview pins line font-size to the root and emits no CSS width cap', () => {
  const html = renderPreview('本文', { charsPerLine: 24 });
  assert.match(html, /\.line\{[^}]*font-size:1rem/);
  assert.doesNotMatch(html, /inline-size/);
});
