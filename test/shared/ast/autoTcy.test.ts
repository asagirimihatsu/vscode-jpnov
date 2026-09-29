import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VALUE_NAMES, annotation, valueAnnotation } from '../../../src/shared/ast/notation.ts';
import { parse } from '../../../src/shared/ast/parse.ts';
import { printSource } from '../../../src/shared/ast/print.ts';
import { concatBookText } from '../../../src/shared/compiler/document.ts';
import type { AutoTcyMode } from '../../../src/shared/config/types.ts';
import { D } from '../_kana.ts';

import { contentOf } from './_shape.ts';

const PAIRS = { autoTcy: 'punctuationPairs' } as const;

/** The source as every output reads it under `mode`, printed back. */
const applyAutoTcy = (src: string, mode: AutoTcyMode): string =>
  printSource(parse(src, { autoTcy: mode }));

/** The source with every qualifying pair wrapped — what the `.txt` build writes. */
const wrapPairs = (src: string): string => applyAutoTcy(src, 'punctuationPairs');

test('E1: every exactly-2 pair on a line is wrapped, each binding its own run', () => {
  assert.equal(
    wrapPairs('あ!!い!?う!!'),
    'あ!!［＃「!!」は縦中横］い!?［＃「!?」は縦中横］う!!［＃「!!」は縦中横］',
  );
});

test('E2: a pair at the line head wraps without creating a line-head annotation hazard', () => {
  assert.equal(wrapPairs('!!です'), '!!［＃「!!」は縦中横］です');
});

test('E3/E4: pairs inside brackets and dialogue wrap; the delimiters stay untouched', () => {
  assert.equal(wrapPairs('（!?）'), '（!?［＃「!?」は縦中横］）');
  assert.equal(wrapPairs('「!?」'), '「!?［＃「!?」は縦中横］」');
});

test('E5: a pair adjacent to an unrelated annotation still wraps, order preserved', () => {
  assert.equal(wrapPairs('!?［＃太字］'), '!?［＃「!?」は縦中横］［＃太字］');
});

test('E6: idempotent over the postfix form (a materialized txt round-trips unchanged)', () => {
  const once = wrapPairs('えっ!?」と叫んだ');
  assert.equal(once, 'えっ!?［＃「!?」は縦中横］」と叫んだ');
  assert.equal(wrapPairs(once), once);
  // A hand-written adjacent postfix counts as already marked too.
  assert.equal(wrapPairs('!?［＃「!?」は縦中横］'), '!?［＃「!?」は縦中横］');
});

test('E7: pairs inside a manual ［＃縦中横］ span are already marked (手動 > 自動)', () => {
  const src = '［＃縦中横］!?［＃縦中横終わり］';
  assert.equal(wrapPairs(src), src);
  // The manual span is line-local: a pair on the NEXT line is fair game again.
  assert.equal(
    wrapPairs('［＃縦中横］!?\nまた!?'),
    '［＃縦中横］!?\nまた!?［＃「!?」は縦中横］',
  );
});

test('E8/E9: runs of 3+ are never touched — not even split into pairs', () => {
  for (const src of ['わっ!!!', 'え????', 'お!?!だ', '!!!!']) {
    assert.equal(wrapPairs(src), src);
  }
});

test('E10: full-width ！？ never trigger (half-width 0x21/0x3F only)', () => {
  assert.equal(wrapPairs('え！？'), 'え！？');
});

test('E11: a pair serving as a ruby base or reading is not body text — untouched', () => {
  const explicitBase = '｜!?《はてな》';
  assert.equal(wrapPairs(explicitBase), explicitBase);
  const heldBase = '｜!?［＃x］《はてな》'; // a ｜ base holding an annotation is a base all the same
  assert.equal(wrapPairs(heldBase), heldBase);
  const insideReading = '漢《!?》';
  assert.equal(wrapPairs(insideReading), insideReading);
});

test('a pair inside a 《…》 that made no ruby stays as typed', () => {
  const kept = [
    '《!?》と叫んだ。',
    '｜［＃メモ］《!?》',
    '《あ!?い?!》',
    '《!?［＃「!?」は縦中横］》と叫んだ。', // the characters of an annotation too
  ];
  for (const src of kept) {
    assert.equal(wrapPairs(src), src);
  }
  assert.deepEqual(contentOf('《!?》と叫んだ。', PAIRS), [['chars 《!?》と叫んだ。']]);
  assert.equal(wrapPairs('!?《!?》!?'), '!?［＃「!?」は縦中横］《!?》!?［＃「!?」は縦中横］');
  // A 《 with no 》 after it is a character like any other.
  assert.equal(wrapPairs('《!?と叫んだ。'), '《!?［＃「!?」は縦中横］と叫んだ。');
});

test('a pair inside what a left ruby takes as its base stays as typed; the others are wrapped', () => {
  const src = 'なに!?［＃「なに!?」の左に「ナニ」のルビ］と叫んだ!?';
  assert.equal(wrapPairs(src), 'なに!?［＃「なに!?」の左に「ナニ」のルビ］と叫んだ!?［＃「!?」は縦中横］');
  assert.deepEqual(contentOf(src, PAIRS), [['ruby なに!?〈ナニ〉', 'chars と叫んだ', 'tcy !?']]);
  assert.deepEqual(parse(src, PAIRS).issues, []);
  assert.deepEqual(contentOf('!?［＃「!?」の左に「はてな」のルビ］', PAIRS), [['ruby !?〈はてな〉']]);
  // The left ruby takes the last occurrence: the one before it is body text.
  assert.equal(
    wrapPairs('なに!?となに!?［＃「なに!?」の左に「ナニ」のルビ］'),
    'なに!?［＃「!?」は縦中横］となに!?［＃「なに!?」の左に「ナニ」のルビ］',
  );
  // Written inside a ｜ base, it binds as if written after it.
  const inside = 'なに!?｜語［＃「なに!?」の左に「ナニ」のルビ］《ご》';
  assert.equal(wrapPairs(inside), inside);
  assert.deepEqual(contentOf(inside, PAIRS), [['ruby なに!?〈ナニ〉', 'ruby 語《ご》']]);
});

test('a left ruby that takes no effect keeps no pair as typed', () => {
  assert.equal(
    wrapPairs('なに!?［＃「別文!?」の左に「よみ」のルビ］'),
    'なに!?［＃「!?」は縦中横］［＃「別文!?」の左に「よみ」のルビ］',
  );
  const mixed = '聖剣《せいけん》!?［＃「聖剣!?」の左に「よみ」のルビ］';
  assert.deepEqual(contentOf(mixed, PAIRS), [['ruby 聖剣《せいけん》', 'tcy !?', 'comment 「聖剣!?」の左に「よみ」のルビ']]);
  // It binds as typed, but not once the first pair is one cell: 「?あ」 misses there, so 「あい」
  // binds and cuts into 「いう!?」.
  const src = '!?あいう!?［＃「?あ」は縦中横］［＃「あい」は縦中横］［＃「いう!?」の左に「よみ」のルビ］';
  const once = wrapPairs(src);
  assert.equal(
    once,
    '!?［＃「!?」は縦中横］あいう!?［＃「!?」は縦中横］［＃「?あ」は縦中横］［＃「あい」は縦中横］［＃「いう!?」の左に「よみ」のルビ］',
  );
  assert.equal(wrapPairs(once), once);
});

test('a wrapped pair is one cell: an annotation whose target takes one of its marks takes no effect', () => {
  for (const inner of ['「に!」に傍点', '「?」は太字', '「に!」は縦中横', '「なに!」の左に「ナニ」のルビ']) {
    const src = `なに!?${annotation(inner)}`;
    assert.deepEqual(contentOf(src, PAIRS), [['chars なに', 'tcy !?', `comment ${inner}`]], src);
    assert.deepEqual(parse(src, PAIRS).issues.map((issue) => issue.kind), ['postfixTargetMissing'], src);
    assert.deepEqual(parse(src).issues, [], src); // as typed, the pair is two characters
  }
  assert.equal(parse('王都!?［＃「都!」は大見出し］', PAIRS).lines[0]?.heading, undefined);
  // A left ruby over the whole pair cannot make up for one that cut into it.
  assert.deepEqual(contentOf('なに!?［＃「なに!」の左に「よみ」のルビ］［＃「なに!?」の左に「ナニ」のルビ］', PAIRS), [
    ['chars なに', 'tcy !?', 'comment 「なに!」の左に「よみ」のルビ', 'comment 「なに!?」の左に「ナニ」のルビ'],
  ]);
});

test('an annotation whose target takes the whole pair takes effect on the wrapped cell', () => {
  assert.deepEqual(contentOf('なに!?［＃「に!?」に傍点］', PAIRS), [['chars な', 'chars に emph=傍点', 'tcy !? emph=傍点']]);
  assert.deepEqual(contentOf('なに!?［＃「なに!?」は太字］', PAIRS), [['chars なに weight=太字', 'tcy !? weight=太字']]);
  assert.deepEqual(contentOf('なに!?［＃「なに!?」は縦中横］', PAIRS), [['tcy なに!?']]);
  assert.equal(parse('王都!?［＃「王都!?」は大見出し］', PAIRS).lines[0]?.heading, 1);
});

test('a left ruby over a value and a pair binds by the values in hand', () => {
  const field = valueAnnotation(VALUE_NAMES.title);
  const src = `${field}!?［＃「作品名!?」の左に「さくひんめい」のルビ］`;
  const values = new Map([[VALUE_NAMES.title, '作品名']]);
  assert.equal(printSource(parse(src, { ...PAIRS, values })), src);
  assert.deepEqual(contentOf(src, { ...PAIRS, values }), [['ruby 作品名!?〈さくひんめい〉']]);
  // Without them the field shows its default, and the target is not on the line.
  assert.equal(wrapPairs(src), `${field}!?［＃「!?」は縦中横］［＃「作品名!?」の左に「さくひんめい」のルビ］`);
  // Every piece of a value sits where its field does: two bases may share that stretch.
  const shared = `${field}!?［＃「トル!?」の左に「よみ」のルビ］［＃「タイ」の左に「よみ」のルビ］`;
  assert.equal(wrapPairs(shared), shared);
});

test('a left ruby base holds its pair behind decomposed kana, an astral character, on every line ending', () => {
  const composed = `にか${D}!?［＃「が!?」の左に「よみ」のルビ］`;
  assert.equal(wrapPairs(composed), composed);
  assert.equal(
    wrapPairs(`にか${D}!?［＃「か${D}!」の左に「よみ」のルビ］`),
    `にか${D}!?［＃「!?」は縦中横］［＃「か${D}!」の左に「よみ」のルビ］`,
  );
  const astral = '𠮷!?［＃「𠮷!?」の左に「よし」のルビ］';
  assert.equal(wrapPairs(astral), astral);
  for (const eol of ['\n', '\r\n', '\r']) {
    assert.equal(
      wrapPairs(`なに!?［＃「なに!?」の左に「ナニ」のルビ］${eol}えっ!?${eol}《!?》`),
      `なに!?［＃「なに!?」の左に「ナニ」のルビ］${eol}えっ!?［＃「!?」は縦中横］${eol}《!?》`,
    );
  }
});

test('E12: single marks never trigger; no gate on adjacent Latin (What?! combines)', () => {
  assert.equal(wrapPairs('あ!か'), 'あ!か');
  // No Latin-flank gate: an English-context pair combines like any other.
  assert.equal(wrapPairs('What?!'), 'What?!［＃「?!」は縦中横］');
});

test('autoTcy off prints the source byte for byte; punctuationPairs wraps the pair', () => {
  const src = 'えっ!?';
  assert.equal(applyAutoTcy(src, 'none'), src);
  assert.equal(applyAutoTcy(src, 'punctuationPairs'), 'えっ!?［＃「!?」は縦中横］');
});

test('concatBookText materializes per file under punctuationPairs and round-trips', () => {
  const book = {
    files: [
      { name: 'a.jpnov', src: '驚き!!だ\n' },
      { name: 'b.jpnov', src: '次!?\n' },
    ],
  };
  const txt = concatBookText(book, 'punctuationPairs', 40);
  assert.equal(txt, '驚き!!［＃「!!」は縦中横］だ\n\n次!?［＃「!?」は縦中横］');
  // Feeding the materialized txt back through the pass changes nothing (idempotent).
  assert.equal(wrapPairs(txt), txt);
  // none keeps the byte-faithful concat (chapters separated by the one blank glue line).
  assert.equal(concatBookText(book, 'none', 40), '驚き!!だ\n\n次!?');
});

test('CRLF: the rewrite keeps the \\r; the postfix lands before it', () => {
  const once = wrapPairs('えっ!?\r\n次');
  assert.equal(once, 'えっ!?［＃「!?」は縦中横］\r\n次');
  assert.equal(wrapPairs(once), once);
});
