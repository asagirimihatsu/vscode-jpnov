/**
 * Locks the `.txt` codec. The Shift JIS table is derived from the runtime's own decoder, so the
 * digest is the drift alarm — if a future ICU changes the legacy index, an author's bytes change
 * silently and this fails first. A count alone would not catch it — two tables can agree on size
 * and disagree on bytes — so the assertions below pin every decision the builder makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  encodeTxt,
  isShiftJisEncodable,
  TXT_ENCODINGS,
  TXT_ENCODING_DEFAULT,
  unencodableChars,
  type TxtEncoding,
} from '../../src/shared/encoding.ts';

/** The bytes one string encodes to, as lower-case hex — the shape every assertion reads in. */
function hex(text: string, encoding: TxtEncoding = 'shiftJis'): string {
  return [...encodeTxt(text, encoding).bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Every encodable code point, in order, canonicalized as `cp:bytes`. */
function tableEntries(): string[] {
  const out: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) {
      continue; // lone surrogates are not code points a manuscript can hold
    }
    if (isShiftJisEncodable(cp)) {
      out.push(`${cp.toString(16)}:${hex(String.fromCodePoint(cp)).replaceAll(' ', '')}`);
    }
  }
  return out;
}

test('the Shift JIS table is byte-for-byte what it was when this shipped', () => {
  const entries = tableEntries();
  assert.equal(entries.length, 7527);
  assert.equal(
    createHash('sha256').update(entries.join('\n')).digest('hex'),
    'e39e70de58bddf46afea3efb42109924b2d26a9a2247eea5464632b809390487',
  );
});

test('a JIS-side spelling encodes to the same cell as its CP932 partner', () => {
  // The decoder reports only the Microsoft spelling of each shared JIS X 0208 cell, so without the
  // alias overlay every left-hand character below would become 〓 — including the em dash that
  // `jpnov.lint.common.dash` offers.
  const pairs: readonly (readonly [string, string])[] = [
    ['—', '―'], ['〜', '～'], ['‖', '∥'], ['−', '－'], ['¢', '￠'], ['£', '￡'], ['¬', '￢'],
  ];
  for (const [jis, ms] of pairs) {
    assert.equal(hex(jis), hex(ms), `${jis} and ${ms} share a cell`);
  }
  assert.equal(hex('—'), '81 5c');
  assert.equal(hex('〜'), '81 60');
});

test('duplicated kanji take the IBM cell, not the NEC-selected one', () => {
  // Dropping index pointers 8272..8835 is what puts these in the 0xFA-0xFC block; skip it and they
  // encode to 0xED/0xEE, which Windows and Word read as a different character.
  assert.equal(hex('髙'), 'fb fc');
  assert.equal(hex('﨑'), 'fa b1');
  assert.equal(hex('ⅰ'), 'fa 40');
  // NEC row 13 is a legitimate CP932 block and must survive that exclusion.
  assert.equal(hex('①'), '87 40');
});

test("ASCII is identity, so the decoder's control-byte rotation stays out of the table", () => {
  assert.equal(hex('abc\r\n'), '61 62 63 0d 0a');
  assert.equal(hex('\x7f'), '7f');
  assert.equal(hex('\x1c'), '1c');
  assert.equal(hex('\x1a'), '1a');
  // The two encoder-only specials sit on bytes ASCII would otherwise claim.
  assert.equal(hex('¥'), '5c');
  assert.equal(hex('‾'), '7e');
});

test('Japanese prose encodes to its expected cells', () => {
  assert.equal(hex('あ'), '82 a0');
  assert.equal(hex('。'), '81 42');
  assert.equal(hex('〓'), '81 ac');
  assert.equal(hex('ｱ'), 'b1'); // half-width katakana is one byte
  assert.equal(hex('─'), '84 9f'); // the boxDrawing dash
});

test('an unencodable character becomes one 〓 and is counted', () => {
  for (const ch of ['𠮷', '😀', 'é']) {
    const result = encodeTxt(ch, 'shiftJis');
    assert.equal(hex(ch), '81 ac', `${ch} -> 〓`);
    // Astral characters are two UTF-16 units but ONE code point, so they cost exactly one 〓.
    assert.equal(result.substitutions, 1);
  }
  assert.equal(encodeTxt('あ😀い😀', 'shiftJis').substitutions, 2);
  assert.equal(encodeTxt('あいう', 'shiftJis').substitutions, 0);
});

test('characters with no Shift JIS cell stay unencodable', () => {
  // A best-fit table added later would silently change an author's text; these guard against one.
  for (const ch of ['¦', '–', '‑', '∣', '¯', '𠮷', '😀']) {
    assert.equal(isShiftJisEncodable(ch.codePointAt(0) ?? 0), false, ch);
  }
  for (const ch of ['あ', '髙', '①', '—', '〜', '−', 'A']) {
    assert.equal(isShiftJisEncodable(ch.codePointAt(0) ?? 0), true, ch);
  }
});

test('UTF-8 passes everything through, with the BOM only when asked', () => {
  assert.equal(hex('あ😀', 'utf8'), 'e3 81 82 f0 9f 98 80');
  assert.equal(hex('あ😀', 'utf8Bom'), 'ef bb bf e3 81 82 f0 9f 98 80');
  assert.equal(encodeTxt('😀', 'utf8').substitutions, 0);
  assert.equal(encodeTxt('😀', 'utf8Bom').substitutions, 0);
});

test('the default encoding is a member of the enum', () => {
  assert.ok(TXT_ENCODINGS.includes(TXT_ENCODING_DEFAULT));
  assert.equal(TXT_ENCODING_DEFAULT, 'shiftJis');
});

test('one written character costs one 〓, however many code points it took', () => {
  // A fixed-width vertical grid gives each written character one square, so a cluster that cannot
  // be written at all must not expand into several 〓 and shove the rest of the line along.
  const clusters: readonly (readonly [string, string])[] = [
    ['emoji presentation', '\u2764\uFE0F'],
    ['skin tone', '\u{1F44D}\u{1F3FD}'],
    ['flag', '\u{1F1EF}\u{1F1F5}'],
    ['ZWJ family', '\u{1F468}\u200D\u{1F469}\u200D\u{1F466}'],
  ];
  for (const [name, s] of clusters) {
    const result = encodeTxt(s, 'shiftJis');
    assert.equal(hex(s), '81 ac', name);
    assert.equal(result.substitutions, 1, name);
  }
});

test('whatever of a cluster can be written is written', () => {
  // 辻 is representable and its variation selector is not, so the kanji survives and only the
  // glyph-variant request is dropped — 〓 would cost a square AND lose the character.
  assert.equal(hex('\u8FBB\u{E0100}'), '92 d2');
  assert.equal(encodeTxt('\u8FBB\u{E0100}', 'shiftJis').substitutions, 0);
  // Same rule, sharper consequence: a decomposed kana loses its mark rather than the whole
  // character. `noNfd` ships on and auto-fixes this upstream; `shiftJisSafe` reports it either way.
  assert.equal(hex('\u304B\u3099'), '82 a9'); // か + combining dakuten -> か
  assert.equal(hex('\u304C'), '82 aa'); // precomposed が is unaffected
});

test('a cluster is reported once, quoting the whole character', () => {
  const [heart] = unencodableChars('\u2764\uFE0F');
  assert.ok(heart);
  assert.equal(heart.cluster, '\u2764\uFE0F'); // what the author sees
  assert.equal(heart.cp, 0x2764); // the code point the range lands on
  assert.equal(heart.length, 1);
  assert.equal(unencodableChars('\u{1F468}\u200D\u{1F469}\u200D\u{1F466}').length, 1);
  // The kanji is fine; the cluster is still reported, because its variant selection is lost.
  const [tsuji] = unencodableChars('\u8FBB\u{E0100}');
  assert.ok(tsuji);
  assert.equal(tsuji.cluster, '\u8FBB\u{E0100}');
  assert.equal(tsuji.cp, 0xe0100);
  assert.equal(tsuji.offset, 1); // the selector, not the kanji
  assert.deepEqual(unencodableChars('\u3042\u3044\u3046'), []);
});
