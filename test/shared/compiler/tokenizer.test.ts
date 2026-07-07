import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findBrokenAnnotations,
  tokenize,
  type Token,
} from '../../../src/shared/compiler/tokenizer.ts';

const kinds = (tokens: readonly Token[]): string[] => tokens.map((t) => t.kind);

test('tokenize returns no tokens for the empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

test('tokenize emits a single text token for plain text', () => {
  assert.deepEqual(tokenize('ただの本文'), [
    { kind: 'text', raw: 'ただの本文', text: 'ただの本文' },
  ]);
});

test('tokenize keeps 「」 dialogue as ordinary text (never a comment)', () => {
  const toks = tokenize('彼は「こんにちは」と言った');
  assert.deepEqual(kinds(toks), ['text']);
});

test('tokenize splits an explicit-base ruby with a ｜ marker', () => {
  const toks = tokenize('彼は｜走《はし》った');
  assert.deepEqual(toks, [
    { kind: 'text', raw: '彼は', text: '彼は' },
    { kind: 'rubyExplicit', raw: '｜走《はし》', base: '走', reading: 'はし' },
    { kind: 'text', raw: 'った', text: 'った' },
  ]);
});

test('tokenize keeps a standalone ｜ (no following ruby) as literal text', () => {
  assert.deepEqual(tokenize('これは｜です'), [
    { kind: 'text', raw: 'これは｜です', text: 'これは｜です' },
  ]);
});

test('tokenize keeps a trailing ｜ at end of input as literal text', () => {
  assert.deepEqual(tokenize('終わり｜'), [
    { kind: 'text', raw: '終わり｜', text: '終わり｜' },
  ]);
});

test('tokenize keeps the ｜ when the reading is empty (｜漢字《》)', () => {
  assert.deepEqual(tokenize('｜漢字《》'), [
    { kind: 'text', raw: '｜漢字《》', text: '｜漢字《》' },
  ]);
});

test('tokenize keeps the ｜ when the explicit base is empty (｜《よみ》)', () => {
  assert.deepEqual(tokenize('｜《よみ》'), [
    { kind: 'text', raw: '｜《よみ》', text: '｜《よみ》' },
  ]);
});

test('tokenize lets the last ｜ win and keeps earlier ｜ as literal text', () => {
  assert.deepEqual(tokenize('a｜b｜c《r》'), [
    { kind: 'text', raw: 'a｜b', text: 'a｜b' },
    { kind: 'rubyExplicit', raw: '｜c《r》', base: 'c', reading: 'r' },
  ]);
});

test('tokenize detects an implicit ruby base by class walk-back', () => {
  const toks = tokenize('前置き漢字《かんじ》');
  assert.deepEqual(toks, [
    { kind: 'text', raw: '前置き', text: '前置き' },
    { kind: 'rubyImplicit', raw: '漢字《かんじ》', base: '漢字', reading: 'かんじ' },
  ]);
});

test('tokenize treats an empty 《》 as literal text (no ruby)', () => {
  assert.deepEqual(tokenize('漢字《》です'), [
    { kind: 'text', raw: '漢字《》です', text: '漢字《》です' },
  ]);
});

test('tokenize classifies a postfix emphasis annotation', () => {
  const toks = tokenize('対象［＃「対象」に傍点］');
  assert.deepEqual(toks, [
    { kind: 'text', raw: '対象', text: '対象' },
    {
      kind: 'emphasisPostfix',
      raw: '［＃「対象」に傍点］',
      target: '対象',
      variant: '傍点',
    },
  ]);
});

test('tokenize classifies の左に postfix and keeps the 左に in the variant', () => {
  const toks = tokenize('対象［＃「対象」の左に傍点］');
  assert.deepEqual(toks[1], {
    kind: 'emphasisPostfix',
    raw: '［＃「対象」の左に傍点］',
    target: '対象',
    variant: '左に傍点',
  });
});

test('tokenize classifies emphasis span start and end (cross-line stream)', () => {
  const toks = tokenize('a［＃傍点］b\nc［＃傍点終わり］d');
  assert.deepEqual(kinds(toks), [
    'text',
    'emphasisSpanStart',
    'text', // "b\nc"
    'emphasisSpanEnd',
    'text',
  ]);
  assert.equal((toks[1] as { variant: string }).variant, '傍点');
  assert.equal((toks[3] as { variant: string }).variant, '傍点');
});

test('tokenize maps ［＃改ページ］ to a pageBreak token', () => {
  const toks = tokenize('前［＃改ページ］後');
  assert.deepEqual(kinds(toks), ['text', 'pageBreak', 'text']);
  assert.equal(toks[1]?.raw, '［＃改ページ］');
});

test('tokenize routes the 傍線 family and any unknown bracket to a comment', () => {
  const toks = tokenize('文［＃「文」に傍線］［＃ここから2字下げ］');
  assert.deepEqual(kinds(toks), ['text', 'comment', 'comment']);
  assert.equal((toks[1] as { inner: string }).inner, '「文」に傍線');
  assert.equal((toks[2] as { inner: string }).inner, 'ここから2字下げ');
});

test('tokenize closes at the FIRST ］; inner (incl. a ［＃-looking run) is not re-scanned', () => {
  // The first ］ closes the annotation; the leftover "］" after it is literal text.
  const toks = tokenize('［＃注 ［＃ネスト］あと］');
  assert.deepEqual(kinds(toks), ['comment', 'text']);
  assert.equal((toks[0] as { inner: string }).inner, '注 ［＃ネスト');
  assert.equal((toks[1] as { text: string }).text, 'あと］');
});

// --------------------------------------------------------------- broken ［＃ (line-bounded)

test('tokenize turns an unmatched ［＃ into a brokenAnnotation swallowed to end of input', () => {
  assert.deepEqual(tokenize('これは［＃壊れた'), [
    { kind: 'text', raw: 'これは', text: 'これは' },
    { kind: 'brokenAnnotation', raw: '［＃壊れた' },
  ]);
});

test('a broken ［＃ swallows only to the line end; the next line tokenizes fresh', () => {
  assert.deepEqual(tokenize('壊れ［＃注\n次'), [
    { kind: 'text', raw: '壊れ', text: '壊れ' },
    { kind: 'brokenAnnotation', raw: '［＃注' },
    { kind: 'text', raw: '\n次', text: '\n次' },
  ]);
});

test('a ］ on a LATER line does not close a ［＃ (no cross-line pairing)', () => {
  assert.deepEqual(kinds(tokenize('［＃注\n終わり］')), ['brokenAnnotation', 'text']);
  assert.equal(tokenize('［＃注\n終わり］')[1]?.raw, '\n終わり］'); // the lone ］ stays literal text
});

test('multiple ［＃ in one swallowed tail collapse into ONE brokenAnnotation', () => {
  assert.deepEqual(tokenize('［＃あ［＃い'), [{ kind: 'brokenAnnotation', raw: '［＃あ［＃い' }]);
});

test('a bare ［＃ at end of line / end of input is a brokenAnnotation of just ［＃', () => {
  assert.deepEqual(tokenize('［＃'), [{ kind: 'brokenAnnotation', raw: '［＃' }]);
  assert.deepEqual(tokenize('［＃\n次'), [
    { kind: 'brokenAnnotation', raw: '［＃' },
    { kind: 'text', raw: '\n次', text: '\n次' },
  ]);
});

test('CRLF: the \\r of a \\r\\n terminator is never swallowed into the broken raw', () => {
  assert.deepEqual(tokenize('［＃注\r\n次'), [
    { kind: 'brokenAnnotation', raw: '［＃注' },
    { kind: 'text', raw: '\r\n次', text: '\r\n次' },
  ]);
});

test('a closed ［＃…］ on the same line still parses normally (no regression)', () => {
  assert.deepEqual(kinds(tokenize('前［＃見出し］後')), ['text', 'comment', 'text']);
});

test('a standalone ］ with no opener is ordinary text (no error, no token split)', () => {
  assert.deepEqual(tokenize('閉じ括弧だけの］行'), [
    { kind: 'text', raw: '閉じ括弧だけの］行', text: '閉じ括弧だけの］行' },
  ]);
});

test('findBrokenAnnotations reports the exact [start, end) source spans', () => {
  assert.deepEqual(findBrokenAnnotations('本［＃こわれ'), [{ start: 1, end: 6 }]);
  assert.deepEqual(findBrokenAnnotations('closed［＃注］ok'), []);
  assert.deepEqual(findBrokenAnnotations('a［＃x\nb［＃y'), [
    { start: 1, end: 4 },
    { start: 6, end: 9 },
  ]);
  // CRLF: the span ends before the \r.
  assert.deepEqual(findBrokenAnnotations('［＃注\r\n次'), [{ start: 0, end: 3 }]);
});

// --------------------------------------------------------------- lenient 《 (line-bounded)

test('tokenize recovers leniently from an unmatched 《 (emit literally)', () => {
  assert.deepEqual(tokenize('これは《壊れた'), [
    { kind: 'text', raw: 'これは《壊れた', text: 'これは《壊れた' },
  ]);
});

test('a 》 on a LATER line does not pair with a 《 (both stay literal, no error)', () => {
  assert.deepEqual(tokenize('例《。\nルビ》'), [
    { kind: 'text', raw: '例《。\nルビ》', text: '例《。\nルビ》' },
  ]);
});

test('a ｜ base marker does not survive a line break (no cross-line explicit ruby)', () => {
  assert.deepEqual(tokenize('｜語\n《ルビ》'), [
    { kind: 'text', raw: '｜語\n《ルビ》', text: '｜語\n《ルビ》' },
  ]);
});

test('same-line ruby after a broken-annotation line still parses', () => {
  const toks = tokenize('［＃こわれ\n漢字《かんじ》');
  assert.deepEqual(kinds(toks), ['brokenAnnotation', 'text', 'rubyImplicit']);
  assert.deepEqual(toks[2], { kind: 'rubyImplicit', raw: '漢字《かんじ》', base: '漢字', reading: 'かんじ' });
});
