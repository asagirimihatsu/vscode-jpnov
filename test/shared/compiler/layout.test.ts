import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRows,
  flowToHtml,
  paginate,
  pagesToHtml,
} from '../../../src/shared/compiler/layout.ts';
import { tokenize } from '../../../src/shared/compiler/tokenizer.ts';

// The continuous preview flow (no pagination); mirrors what renderPreview emits as <body>.
const flow = (src: string, charsPerLine = 40, avoidLineBreaks = false): string =>
  flowToHtml(buildRows(tokenize(src)), charsPerLine, avoidLineBreaks);

const pages = (src: string, charsPerLine = 40, linesPerPage = 34) =>
  paginate(buildRows(tokenize(src)), charsPerLine, linesPerPage, false);
// With 禁則処理 on, return each display line as its concatenated unit text (one page only).
const klines = (src: string, charsPerLine: number): string[] =>
  paginate(buildRows(tokenize(src)), charsPerLine, 34, true)
    .flat()
    .map((line) => line.units.map((u) => u.text).join(''));
const html = (src: string, charsPerLine = 40, linesPerPage = 34) =>
  pagesToHtml(pages(src, charsPerLine, linesPerPage));

test('one display line per source line; trailing newline dropped, middle blank kept', () => {
  assert.equal(
    html('一\n二'),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">一</div><div class="line" data-line="1">二</div></div></div>',
  );
  assert.equal(
    html('一\n'),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">一</div></div></div>',
  );
  assert.equal(
    html('一\n\n二'),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">一</div><div class="line" data-line="1"></div><div class="line" data-line="2">二</div></div></div>',
  );
});

test('a long source line hard-wraps at charsPerLine', () => {
  assert.equal(
    html('一二三', 2),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">一二</div><div class="line" data-line="0">三</div></div></div>',
  );
});

test('a ruby unit is atomic — it wraps whole, never split', () => {
  // あ (hiragana) is a different class from 漢字 (kanji), so the implicit base is just
  // 漢字 (2 cells). あ(1)+漢字(2) = 3 > cpl 2, so the ruby unit wraps whole to line 2.
  assert.equal(
    html('あ漢字《かんじ》', 2),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">あ</div>' +
      '<div class="line" data-line="0"><ruby>漢字<rt>かんじ</rt></ruby></div></div></div>',
  );
});

test('paginate fills linesPerPage lines, then a new page', () => {
  const p = pages('一\n二\n三', 40, 2);
  assert.equal(p.length, 2);
  assert.equal(p[0]?.length, 2);
  assert.equal(p[1]?.length, 1);
});

test('［＃改ページ］ forces a new page', () => {
  assert.equal(
    html('前\n［＃改ページ］\n後'),
    '<div class="book">' +
      '<div class="page" data-page="0"><div class="line" data-line="0">前</div></div>' +
      '<div class="page" data-page="1"><div class="line" data-line="2">後</div></div></div>',
  );
});

test('emphasis span groups consecutive units and re-opens across a wrap', () => {
  assert.match(
    html('［＃傍点］強調［＃傍点終わり］'),
    /<span class="emph-fs">強調<\/span>/,
  );
  assert.equal(
    html('［＃傍点］一二三［＃傍点終わり］', 2),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0"><span class="emph-fs">一二</span></div>' +
      '<div class="line" data-line="0"><span class="emph-fs">三</span></div></div></div>',
  );
});

test('postfix emphasis marks the last occurrence on the source line', () => {
  assert.match(
    html('語と語［＃「語」に傍点］'),
    /語と<span class="emph-fs">語<\/span>/,
  );
});

test('a comment is zero-width: it does not consume a cell or force a wrap', () => {
  assert.equal(
    html('［＃注記］本', 1),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0"><!--注記-->本</div></div></div>',
  );
});

test('a broken ［＃ renders as visible literal text, bounded to its own line', () => {
  assert.equal(
    html('本［＃こわれ\n次'),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">本［＃こわれ</div>' +
      '<div class="line" data-line="1">次</div></div></div>',
  );
});

test('broken-annotation text consumes cells and wraps like ordinary prose', () => {
  // cpl 3: 本＋［＃こ… — the swallowed chars are real 1-cell units, so the line hard-wraps.
  assert.equal(
    html('本［＃こわれ', 3),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">本［＃</div>' +
      '<div class="line" data-line="0">こわれ</div></div></div>',
  );
});

test('禁則 rule 1: a line must not END with an opening bracket — push it down', () => {
  // cpl 3: naive ああ「 | い」 traps 「 at end of line 1. 追い出し pushes 「 down to join
  // its content: ああ | 「い」. (Contrast: kinsoku off would keep ああ「 | い」.)
  assert.deepEqual(klines('ああ「い」', 3), ['ああ', '「い」']);
  assert.deepEqual(pages('ああ「い」', 3).flat().map((l) => l.units.map((u) => u.text).join('')), [
    'ああ「',
    'い」',
  ]);
});

test('禁則 rule 2: a line must not START with a closing/punctuation char — pull preceding down', () => {
  // cpl 2: naive ああ | 」 leaves 」 at line start. Pull あ down: あ | あ」.
  assert.deepEqual(klines('ああ」', 2), ['あ', 'あ」']);
  // Trailing punctuation behaves the same: naive 文だ | 。 → pull だ down: 文 | だ。.
  assert.deepEqual(klines('文だ。', 2), ['文', 'だ。']);
});

test('禁則 cascade: forbidden chars reflow and no line overflows cpl', () => {
  // cpl 3: naive 「あ「 | い」」. The trailing 」」 cascade pulls leftward without ever
  // emptying a line or exceeding cpl. Where 追い出し-only + the no-empty guard cannot
  // satisfy every rule at once (forbidden chars cluster tighter than cpl), the guard
  // wins — a defensible degrade, same as the lone-char exception.
  const out = klines('「あ「い」」', 3);
  for (const line of out) {
    assert.ok(Array.from(line).length <= 3, `line "${line}" exceeds cpl`);
  }
  assert.equal(out.join(''), '「あ「い」」'); // no units lost or reordered
});

test('禁則 standard set: small kana / prolonged-sound marks are 行頭禁則 too', () => {
  // っ (small tsu) must not start a line: cpl 2, naive いあ | っ → pull あ down: い | あっ.
  assert.deepEqual(klines('いあっ', 2), ['い', 'あっ']);
  // ー (prolonged sound) must not start a line: naive いあ | ー → pull あ down: い | あー.
  assert.deepEqual(klines('いあー', 2), ['い', 'あー']);
});

test('禁則 exception: a lone forbidden char as the whole row is left as-is', () => {
  // The source row is a single 。 — the > start guard refuses to empty the line.
  assert.deepEqual(klines('。', 1), ['。']);
  assert.deepEqual(klines('「', 1), ['「']);
});

// --- flowToHtml: the continuous preview flow over the shared engine -------------------

test('flowToHtml: continuous .line columns, first-only data-line, no .page wrapper', () => {
  assert.equal(
    flow('一二三', 2),
    '<div class="book"><div class="line" data-line="0">一二</div><div class="line">三</div></div>',
  );
});

test('flowToHtml: each distinct source line keeps its own data-line anchor', () => {
  assert.equal(
    flow('一\n二\n三'),
    '<div class="book"><div class="line" data-line="0">一</div>' +
      '<div class="line" data-line="1">二</div><div class="line" data-line="2">三</div></div>',
  );
});

test('flowToHtml: a blank source line becomes a blank column (kept, not collapsed)', () => {
  assert.equal(
    flow('一\n\n二'),
    '<div class="book"><div class="line" data-line="0">一</div>' +
      '<div class="line" data-line="1"></div><div class="line" data-line="2">二</div></div>',
  );
});

test('flowToHtml: ［＃改ページ］ becomes an <hr class="pagebreak"> between content', () => {
  assert.equal(
    flow('前\n［＃改ページ］\n後'),
    '<div class="book"><div class="line" data-line="0">前</div>' +
      '<hr class="pagebreak"><div class="line" data-line="2">後</div></div>',
  );
});

test('flowToHtml: leading / trailing / doubled page breaks collapse (no stray <hr>)', () => {
  assert.equal(
    flow('［＃改ページ］\n後'),
    '<div class="book"><div class="line" data-line="1">後</div></div>',
  );
  assert.equal(
    flow('前\n［＃改ページ］'),
    '<div class="book"><div class="line" data-line="0">前</div></div>',
  );
  assert.equal(
    flow('前\n［＃改ページ］\n［＃改ページ］\n後'),
    '<div class="book"><div class="line" data-line="0">前</div>' +
      '<hr class="pagebreak"><div class="line" data-line="3">後</div></div>',
  );
});

test('flowToHtml: honors avoidLineBreaks (禁則) — the SAME engine as the build', () => {
  // cpl 2: naive ああ | 」 leaves 」 at line start; 追い出し pulls あ down → あ | あ」.
  assert.equal(
    flow('ああ」', 2, true),
    '<div class="book"><div class="line" data-line="0">あ</div><div class="line">あ」</div></div>',
  );
});

// --- emit coverage migrated from the deleted render.test.ts ---------------------------

test('emit: postfix target missing on the source line degrades to a comment', () => {
  assert.equal(
    html('別の文［＃「無」に傍点］'),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">別の文<!--「無」に傍点--></div></div></div>',
  );
});

test('emit: an emphasis span re-opens on the next source line', () => {
  assert.equal(
    html('これは［＃傍点］強調\nされる文［＃傍点終わり］です'),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">これは<span class="emph-fs">強調</span></div>' +
      '<div class="line" data-line="1"><span class="emph-fs">される文</span>です</div></div></div>',
  );
});

test('emit: escapes & < > " in text', () => {
  assert.equal(
    html('a<b>&"c'),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">a&lt;b&gt;&amp;&quot;c</div></div></div>',
  );
});

test('emit: leading 全角 spaces are preserved verbatim (no auto-indent)', () => {
  assert.equal(
    html('　　本文'),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">　　本文</div></div></div>',
  );
});

test('emit: empty input yields an empty book', () => {
  assert.equal(html(''), '<div class="book"></div>');
});
