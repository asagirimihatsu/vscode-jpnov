import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuildChrome } from '../../../src/shared/compiler/chrome.ts';
import { chapterGlue, concatBookText, renderBook, type BookInput } from '../../../src/shared/compiler/document.ts';

const book = (over: Pick<BookInput, 'files' | 'divider'>): BookInput => ({ ...over });

/** All-off chrome: renderBook emits the bare page/line skeleton with no furniture. */
const OFF: BuildChrome = {
  lineNumbers: false,
  edgeLine: 'none',
  pageNumber: 'none',
  pageNumberFormat: '{page} / {totalPage}',
  header: '',
};

/** Render one file with explicit resolved options; returns the full HTML document. */
const render = (
  src: string,
  opts: { charsPerLine?: number; linesPerPage?: number; chrome?: Partial<BuildChrome> } = {},
): string =>
  renderBook({
    books: [book({ files: [{ name: 'a.jpnov', src }] })],
    charsPerLine: opts.charsPerLine ?? 40,
    linesPerPage: opts.linesPerPage ?? 34,
    kinsoku: 'none',
    autoTcy: 'none',
    chrome: { ...OFF, ...opts.chrome },
  });

const bodyOf = (html: string): string =>
  html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

test('renderBook emits a paginated page/line skeleton document', () => {
  const html = render('本文');
  assert.match(html, /^<!DOCTYPE html><html><head>/);
  assert.match(html, /<style>[^<]*\.page\{/);
  assert.equal(
    bodyOf(html),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">本文</div></div></div>',
  );
});

test('renderBook joins files[] in order with one blank separator line', () => {
  const html = renderBook({
    books: [
      book({
        files: [
          { name: 'a.jpnov', src: '第一' },
          { name: 'b.jpnov', src: '第二' },
        ],
      }),
    ],
    charsPerLine: 40,
    linesPerPage: 34,
    kinsoku: 'none',
    autoTcy: 'none',
    chrome: OFF,
  });
  // The glue's blank column is synthetic (srcLine −1): no data-line anchor.
  assert.equal(
    bodyOf(html),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">第一</div>' +
      '<div class="line"></div>' +
      '<div class="line" data-line="0">第二</div></div></div>',
  );
});

test('renderBook keeps a broken ［＃ as visible literal text (build stays lenient)', () => {
  assert.equal(
    bodyOf(render('本文［＃こわれ')),
    '<div class="book"><div class="page" data-page="0"><div class="line" data-line="0">本文［＃こわれ</div></div></div>',
  );
});

test('renderBook: ［＃改ページ］ starts a new page', () => {
  assert.equal(
    bodyOf(render('前\n［＃改ページ］\n後')),
    '<div class="book">' +
      '<div class="page" data-page="0"><div class="line" data-line="0">前</div></div>' +
      '<div class="page" data-page="1"><div class="line" data-line="2">後</div></div></div>',
  );
});

test('renderBook paginates at linesPerPage lines per page', () => {
  assert.equal(
    bodyOf(render('一\n二\n三', { linesPerPage: 2 })),
    '<div class="book">' +
      '<div class="page" data-page="0"><div class="line" data-line="0">一</div><div class="line" data-line="1">二</div></div>' +
      '<div class="page" data-page="1"><div class="line" data-line="2">三</div></div></div>',
  );
});

test('renderBook wraps a long source line at charsPerLine', () => {
  assert.equal(
    bodyOf(render('一二三四五', { charsPerLine: 2 })),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">一二</div>' +
      '<div class="line" data-line="0">三四</div>' +
      '<div class="line" data-line="0">五</div></div></div>',
  );
});

test('renderBook renders ruby + emphasis inside the page lines', () => {
  const html = render('漢字《かんじ》と語［＃「語」に傍点］');
  assert.match(html, /<ruby class="rr"><span>漢<\/span><span>字<\/span><rt><span>か<\/span><span>ん<\/span><span>じ<\/span><\/rt><\/ruby>/);
  assert.match(html, /<span class="emph-fs">語<\/span>/);
  // On-demand: the used classes' rules are present inside the stylesheet.
  assert.match(html, /\.emph-fs\{text-emphasis-style:filled sesame\}/);
  assert.match(html, /ruby\.rr>rt\{transform:translate\(-50%,-50%\) translateX\(1\.5em\)\}/);
});

test('concatBookText strips one trailing newline per file and joins with one blank line', () => {
  // no trailing newline: exactly one blank separator line between files
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あいう' }, { name: 'b.jpnov', src: 'かきく' }] }), 'none', 40),
    'あいう\n\nかきく',
  );
  // one trailing newline per file: the artifact is stripped, never doubling the seam
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\n' }, { name: 'b.jpnov', src: 'か\n' }] }), 'none', 40),
    'あ\n\nか',
  );
  // a genuine author blank line (\n\n) is preserved LITERALLY and stacks with the glue
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\n\n' }, { name: 'b.jpnov', src: 'か' }] }), 'none', 40),
    'あ\n\n\nか',
  );
  // CRLF trailing is stripped as one EOL too
  assert.equal(concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\r\n' }] }), 'none', 40), 'あ');
  // empty book -> ""
  assert.equal(concatBookText(book({ files: [] }), 'none', 40), '');
});

// --- chapter divider (章区切り) --------------------------------------------------------

const two = (a: string, b: string, divider?: string): BookInput =>
  book({ files: [{ name: 'a.jpnov', src: a }, { name: 'b.jpnov', src: b }], divider });

test('chapterGlue: one blank line always; divider centred by CELLS + one blank after', () => {
  assert.equal(chapterGlue('前章', '次章', '', 40), '\n');
  // ＊ = 1 cell at cpl 8 → floor((8−1)/2) = 3, spelled as the Aozora annotation.
  assert.equal(chapterGlue('前章', '次章', '＊', 8), '\n［＃３字下げ］＊\n\n');
  // A 縦中横 mark is ONE cell however many chars it combines (cells ≠ chars).
  assert.equal(
    chapterGlue('前章', '次章', '!?［＃「!?」は縦中横］', 9),
    '\n［＃４字下げ］!?［＃「!?」は縦中横］\n\n',
  );
  // A value already ［＃○字下げ］-prefixed passes through verbatim (author's own position).
  assert.equal(chapterGlue('前章', '次章', '［＃２字下げ］＊', 40), '\n［＃２字下げ］＊\n\n');
  // A mark as wide as the line centres to 0 → bare, no ［＃０字下げ］ noise, never negative.
  assert.equal(chapterGlue('前章', '次章', '＊　＊　＊', 3), '\n＊　＊　＊\n\n');
});

test('chapterGlue suppression: a 見出し-opening next chapter takes the plain blank seam', () => {
  assert.equal(chapterGlue('前章', '第二章［＃「第二章」は大見出し］\n本文', '＊', 8), '\n');
  // Leading blank lines are skipped when probing for the heading.
  assert.equal(chapterGlue('前章', '\n\n二［＃「二」は中見出し］', '＊', 8), '\n');
  // A broken-target 見出し renders plain, so it does NOT suppress the divider.
  assert.equal(chapterGlue('前章', '二［＃「別」は中見出し］', '＊', 8), '\n［＃３字下げ］＊\n\n');
});

test('chapterGlue suppression covers the 見出し span/block openers too', () => {
  // Block form: the first non-blank line paints nothing — the opener token decides.
  assert.equal(
    chapterGlue('前章', '［＃ここから大見出し］\n第二章\n［＃ここで大見出し終わり］', '＊', 8),
    '\n',
  );
  // Inline pair on the first line resolves through the normal heading-row probe.
  assert.equal(chapterGlue('前章', '［＃大見出し］第二章［＃大見出し終わり］\n本文', '＊', 8), '\n');
  // A lone inline opener line (the title follows on the next line) suppresses too.
  assert.equal(chapterGlue('前章', '［＃大見出し］\n第二章\n［＃大見出し終わり］', '＊', 8), '\n');
  // A non-見出し directive first line still takes the divider (first painted line is prose).
  assert.equal(
    chapterGlue('前章', '［＃ここから２字下げ］\n本文', '＊', 8),
    '\n［＃３字下げ］＊\n\n',
  );
});

test('chapterGlue suppression at ［＃改ページ］ junctions keeps the blank line', () => {
  assert.equal(chapterGlue('あ\n［＃改ページ］', 'か', '＊', 8), '\n'); // prev ends on a break
  assert.equal(chapterGlue('あ', '［＃改ページ］\nか', '＊', 8), '\n'); // next opens on a break
  assert.equal(chapterGlue('あ', 'か', '＊', 8), '\n［＃３字下げ］＊\n\n'); // no break → divider
});

test('concatBookText interleaves the divider; author edge blanks stack literally', () => {
  assert.equal(concatBookText(two('あ', 'か', '＊'), 'none', 8), 'あ\n\n［＃３字下げ］＊\n\nか');
  assert.equal(
    concatBookText(two('あ\n\n', '\nか', '＊'), 'none', 8),
    'あ\n\n\n［＃３字下げ］＊\n\n\nか', // one author blank each side, kept verbatim around the glue
  );
  assert.equal(
    concatBookText(two('あ', '第二章［＃「第二章」は大見出し］\n本文', '＊'), 'none', 8),
    'あ\n\n第二章［＃「第二章」は大見出し］\n本文',
  );
});

test('renderBook inserts the divider line + one blank as synthetic (anchor-less) rows', () => {
  const html = renderBook({
    books: [two('第一', '第二', '＊')],
    charsPerLine: 4,
    linesPerPage: 34,
    kinsoku: 'none',
    autoTcy: 'none',
    chrome: OFF,
  });
  // cpl 4 → the centring annotation is ［＃１字下げ］: the glue line carries indent-1.
  assert.equal(
    bodyOf(html),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">第一</div>' +
      '<div class="line"></div>' +
      '<div class="line indent-1">＊</div>' +
      '<div class="line"></div>' +
      '<div class="line" data-line="0">第二</div></div></div>',
  );
  assert.match(html, /\.indent-1\{padding-inline-start:1em\}/); // its rule emits on demand
});

test('dual invariant: per-file render + glue == rendering the concatenated .txt', () => {
  const opts = {
    charsPerLine: 8,
    linesPerPage: 5,
    kinsoku: 'none',
    autoTcy: 'none',
    chrome: OFF,
  } as const;
  const matrix: BookInput[] = [
    two('あ\n\nい', 'か', '＊'), // divider + author blanks
    two('あ', '第二章［＃「第二章」は大見出し］\n本文', '＊'), // heading suppression
    two('あ\n［＃改ページ］', '\nか', '＊'), // page-break suppression
    two('あ', 'か'), // no divider configured
    two('あ', 'か', '［＃３字下げ］◇'), // indented divider
  ];
  const strip = (h: string): string => bodyOf(h).replace(/ data-line="\d+"/g, '');
  for (const b of matrix) {
    const perFile = renderBook({ books: [b], ...opts });
    const combined = renderBook({
      books: [book({ files: [{ name: 'all.jpnov', src: concatBookText(b, 'none', opts.charsPerLine) }] })],
      ...opts,
    });
    // data-line is the only legitimate delta: per-file numbering restarts (and glue rows have
    // no anchor at all) while the combined source numbers continuously.
    assert.equal(strip(perFile), strip(combined));
  }
});

test('renderBook: a 太字 span emits <span class="b"> and the .b rule on demand', () => {
  const out = render('［＃太字］強［＃太字終わり］');
  assert.match(out, /<span class="b">強<\/span>/);
  assert.match(out, /\.b\{font-weight:bold\}/);
});

test('renderBook: a 字下げ column carries the indent class + its .indent-N rule', () => {
  const out = render('［＃２字下げ］頭');
  assert.match(out, /<div class="line indent-2" data-line="0">頭<\/div>/);
  assert.match(out, /\.indent-2\{padding-inline-start:2em\}/);
});

// --- page furniture (chrome) ---------------------------------------------------------

/** Three one-line pages: display pages 1, 2, 3. */
const THREE_PAGES = '一\n二\n三';

test('folio parity: rightLeft puts odd pages bottom-right, even bottom-left', () => {
  const body = bodyOf(
    render(THREE_PAGES, {
      linesPerPage: 1,
      chrome: { pageNumber: 'rightLeft' },
    }),
  );
  assert.match(body, /data-page="0">[^]*?<div class="pn r">1 \/ 3<\/div>/);
  assert.match(body, /data-page="1">[^]*?<div class="pn l">2 \/ 3<\/div>/);
  assert.match(body, /data-page="2">[^]*?<div class="pn r">3 \/ 3<\/div>/);
  // Furniture comes AFTER the lines, so line adjacency is untouched.
  assert.match(body, /<div class="line" data-line="0">一<\/div><div class="pn r">/);
});

test('folio positions: all five enum values place (or omit) the number correctly', () => {
  const sides = (pos: BuildChrome['pageNumber']): (string | null)[] => {
    const body = bodyOf(
      render('一\n二', { linesPerPage: 1, chrome: { pageNumber: pos } }),
    );
    return [0, 1].map((i) => {
      const m = new RegExp(`data-page="${String(i)}">[^]*?<div class="pn (r|l)">`).exec(body);
      return m?.[1] ?? null;
    });
  };
  assert.deepEqual(sides('rightLeft'), ['r', 'l']);
  assert.deepEqual(sides('leftRight'), ['l', 'r']);
  assert.deepEqual(sides('right'), ['r', 'r']);
  assert.deepEqual(sides('left'), ['l', 'l']);
  assert.deepEqual(sides('none'), [null, null]);
});

test('folio template: escaped before substitution; unknown variables stay literal', () => {
  const escaped = render('本文', {
    chrome: { pageNumber: 'right', pageNumberFormat: '<b>{page}</b>' },
  });
  assert.match(escaped, /<div class="pn r">&lt;b&gt;1&lt;\/b&gt;<\/div>/);
  const unknown = render('本文', {
    chrome: { pageNumber: 'right', pageNumberFormat: 'p{page}/{foo}' },
  });
  assert.match(unknown, /<div class="pn r">p1\/\{foo\}<\/div>/);
});

test('folio blank-template suppression: a blank template drops the folio, keeps its band', () => {
  for (const tpl of ['', '   ']) {
    const html = render('本文', {
      chrome: { pageNumber: 'rightLeft', pageNumberFormat: tpl },
    });
    assert.doesNotMatch(html, /class="pn/);
    assert.match(html, /\.page\{[^}]*padding-inline-end:3em/); // element goes, band stays reserved
  }
  // "{page}" renders non-blank, so it is NOT suppressed; literal spaces are kept as-is.
  const kept = render('本文', {
    chrome: { pageNumber: 'left', pageNumberFormat: ' {page} ' },
  });
  assert.match(kept, /<div class="pn l"> 1 <\/div>/);
});

test('header: centered furniture div, escaped, absent (with its band) when empty', () => {
  const on = render('本文', { chrome: { header: '第一章' } });
  assert.match(on, /<div class="hd">第一章<\/div>/);
  assert.match(on, /:root\{[^}]*--htop:3/);
  const escaped = render('本文', { chrome: { header: 'a<b' } });
  assert.match(escaped, /<div class="hd">a&lt;b<\/div>/);
  const off = render('本文');
  assert.doesNotMatch(off, /class="hd"/);
  // No element, but the band stays reserved — sheet geometry is header-independent.
  assert.match(off, /:root\{[^}]*--htop:3/);
  assert.match(off, /\.page\{[^}]*padding-inline-start:calc\(var\(--htop\)\*1em\)/);
});

test('line numbers and edge lines never change the body DOM (pure CSS features)', () => {
  const plain = bodyOf(render(THREE_PAGES, { linesPerPage: 2 }));
  const decorated = bodyOf(
    render(THREE_PAGES, { linesPerPage: 2, chrome: { lineNumbers: true, edgeLine: 'text' } }),
  );
  assert.equal(decorated, plain);
});
