import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../../../src/shared/ast/parse.ts';
import { printSource } from '../../../src/shared/ast/print.ts';
import { concatBookText } from '../../../src/shared/compiler/document.ts';
import type { AutoTcyMode } from '../../../src/shared/config/types.ts';

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
