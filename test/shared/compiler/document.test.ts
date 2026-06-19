import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concatBookText, renderBook, type BookInput } from '../../../src/shared/compiler/document.ts';

const book = (over: Pick<BookInput, 'files'>): BookInput => ({ ...over });

/** Render one file with an optional grid; returns the full HTML document. */
const render = (
  src: string,
  opts: { charsPerLine?: number; linesPerPage?: number } = {},
): string =>
  renderBook({
    books: [book({ files: [{ name: 'a.jpnov', src }] })],
    charsPerLine: opts.charsPerLine ?? 40,
    linesPerPage: opts.linesPerPage ?? 34,
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

test('renderBook concatenates files[] in order', () => {
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
  });
  assert.equal(
    bodyOf(html),
    '<div class="book"><div class="page" data-page="0">' +
      '<div class="line" data-line="0">第一</div>' +
      '<div class="line" data-line="0">第二</div></div></div>',
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
  assert.match(html, /<ruby>漢字<rt>かんじ<\/rt><\/ruby>/);
  assert.match(html, /<span class="emph-fs">語<\/span>/);
  // On-demand: the used class's rule is present inside the stylesheet.
  assert.match(html, /\.emph-fs\{text-emphasis-style:filled sesame\}/);
});

test('concatBookText strips one trailing newline per file and joins with a single \\n', () => {
  // no trailing newline: exactly one separator inserted between files
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あいう' }, { name: 'b.jpnov', src: 'かきく' }] })),
    'あいう\nかきく',
  );
  // one trailing newline per file: NOT doubled at the seam
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\n' }, { name: 'b.jpnov', src: 'か\n' }] })),
    'あ\nか',
  );
  // a genuine blank line (\n\n) is preserved: only the final newline artifact is stripped
  assert.equal(
    concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\n\n' }, { name: 'b.jpnov', src: 'か' }] })),
    'あ\n\nか',
  );
  // CRLF trailing is stripped as one EOL too
  assert.equal(concatBookText(book({ files: [{ name: 'a.jpnov', src: 'あ\r\n' }] })), 'あ');
  // empty book -> ""
  assert.equal(concatBookText(book({ files: [] })), '');
});
