/**
 * The unified highlighter: one semantic-token stream covering Aozora markup + narration (cast names
 * and coined keywords) with standard LSP types. A ruby BASE flows into recognition (a name stays a
 * name while ｜《》 + 読み stay markup), correct UTF-16 offsets across markup and astral characters,
 * markup + dialogue emitted without a recognizer, and multi-line spans split per line.
 *
 * Token types are referenced by KIND via tokenTypeIndex(...) — never a hard-coded number — so the
 * tests survive reordering or adding HIGHLIGHTS rows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRecognizer } from '../../../src/server/highlight/recognizer.ts';
import {
  buildSemanticTokens,
  tokenTypeIndex,
} from '../../../src/server/semanticTokens.ts';
import { at, covers, decode, doc } from './tokens.ts';

// A small project: 朝霧 巳一 as cast, 黒剣 as a coined keyword.
const rec = createRecognizer(['朝霧　巳一'], ['黒剣']);

const MARKER = tokenTypeIndex('marker');
const CHARACTER = tokenTypeIndex('character');
const KEYWORD = tokenTypeIndex('keyword');

test('legend is the distinct LSP types in first-seen order', () => {
  // Distinct kinds get distinct indices; the custom cast/keyword types differ from the default 'plain'.
  assert.notEqual(tokenTypeIndex('character'), tokenTypeIndex('keyword'));
  assert.notEqual(tokenTypeIndex('character'), tokenTypeIndex('direction')); // characterName != plain
  assert.notEqual(tokenTypeIndex('marker'), tokenTypeIndex('directive')); // comment != keyword
});

// ----------------------------------------------------------------------- narration

test('a narration subject 巳一は -> character; the は particle is not coloured', () => {
  const toks = decode(buildSemanticTokens(doc('巳一は走った'), rec).data);
  assert.deepEqual(at(toks, 0, 0), { line: 0, char: 0, len: 3, type: CHARACTER }); // 巳一は
});

test('a coined keyword is bolded (coinedKeyword)', () => {
  const toks = decode(buildSemanticTokens(doc('黒剣を抜いた'), rec).data);
  assert.deepEqual(at(toks, 0, 0), { line: 0, char: 0, len: 2, type: KEYWORD }); // 黒剣
});

// ----------------------------------------------------------------------- dialogue

test('dialogue 「」 are markers; their content keeps the body colour', () => {
  // 「(0) 巳(1) 一(2) は(3) 」(4) — 巳一は would be a subject in narration, but is masked here.
  const toks = decode(buildSemanticTokens(doc('「巳一は」'), rec).data);
  assert.equal(at(toks, 0, 0)?.type, MARKER); // 「
  assert.equal(at(toks, 0, 4)?.type, MARKER); // 」
  assert.ok(!covers(toks, 1, CHARACTER));
});

// ----------------------------------------------------------------------- ruby

test('ruby base flows into recognition; ｜《》 are markers, the reading is not coloured', () => {
  // ｜(0) 巳(1) 一(2) 《(3) み(4) い(5) ち(6) 》(7) は(8)
  const toks = decode(buildSemanticTokens(doc('｜巳一《みいち》は'), rec).data);
  assert.equal(at(toks, 0, 1)?.type, CHARACTER); // 巳一 base recognised
  assert.equal(at(toks, 0, 1)?.len, 2);
  assert.equal(at(toks, 0, 0)?.type, MARKER); // ｜
  assert.equal(at(toks, 0, 3)?.type, MARKER); // 《
  assert.equal(at(toks, 0, 7)?.type, MARKER); // 》
  assert.ok(!covers(toks, 4, CHARACTER)); // み (reading) not recognised
});

test('a recognised span splits across a ruby reading hole', () => {
  // 巳(0) 《(1) み(2) 》(3) 一(4) は(5): the name 巳一 spans the base + the post-reading 一.
  const toks = decode(buildSemanticTokens(doc('巳《み》一は'), rec).data);
  assert.equal(at(toks, 0, 0)?.type, CHARACTER); // 巳
  assert.equal(at(toks, 0, 4)?.type, CHARACTER); // 一, across the 《み》 hole
  assert.ok(!covers(toks, 2, CHARACTER)); // the reading み is not coloured
});

// ----------------------------------------------------------------------- markup (unchanged)

test('［＃改ページ］: brackets marker, 改ページ directive', () => {
  const toks = decode(buildSemanticTokens(doc('［＃改ページ］'), rec).data);
  assert.deepEqual(at(toks, 0, 0), { line: 0, char: 0, len: 2, type: MARKER }); // ［＃
  assert.deepEqual(at(toks, 0, 2), { line: 0, char: 2, len: 4, type: tokenTypeIndex('directive') }); // 改ページ
  assert.deepEqual(at(toks, 0, 6), { line: 0, char: 6, len: 1, type: MARKER }); // ］
});

test('emphasis span: variant -> directive, 左に -> direction', () => {
  const left = decode(buildSemanticTokens(doc('［＃左に傍点］'), rec).data);
  assert.deepEqual(at(left, 0, 2), { line: 0, char: 2, len: 2, type: tokenTypeIndex('direction') }); // 左に
  assert.deepEqual(at(left, 0, 4), { line: 0, char: 4, len: 2, type: tokenTypeIndex('directive') }); // 傍点
});

test('emphasis postfix: 「対象」 target keeps default colour; variant is a directive', () => {
  // ［＃(0,1) 「(2) 本(3) 」(4) に(5) 傍点(6,7) ］(8)
  const toks = decode(buildSemanticTokens(doc('［＃「本」に傍点］'), rec).data);
  assert.ok(toks.some((t) => t.type === tokenTypeIndex('directive'))); // 傍点
  assert.equal(at(toks, 0, 2)?.type, MARKER); // 「
  assert.equal(at(toks, 0, 4)?.type, MARKER); // 」
  assert.ok(!toks.some((t) => t.char <= 3 && t.char + t.len > 3)); // 本 uncovered
});

test('markup and dialogue are emitted without a recognizer (undefined)', () => {
  const toks = decode(buildSemanticTokens(doc('「猫」｜字《じ》'), undefined).data);
  assert.ok(toks.some((t) => t.type === MARKER)); // dialogue + ruby markers present
  assert.ok(!toks.some((t) => t.type === CHARACTER || t.type === KEYWORD)); // nothing recognised
});

test('a multi-line ［＃…］ comment is split into one token per line', () => {
  const toks = decode(buildSemanticTokens(doc('［＃ab\ncd］'), rec).data);
  assert.equal(at(toks, 0, 0)?.type, MARKER);
  assert.equal(at(toks, 1, 0)?.type, MARKER);
  assert.ok(toks.every((t) => t.type === MARKER));
});

test('offsets stay within bounds across an astral character (𠮷)', () => {
  const text = '𠮷「あ」'; // 𠮷 = 2 UTF-16 units; the 「」 markers must land at the right offsets
  const toks = decode(buildSemanticTokens(doc(text), rec).data);
  assert.ok(toks.length > 0);
  for (const t of toks) {
    assert.ok(t.char + t.len <= text.length, `in bounds: ${JSON.stringify(t)}`);
  }
  assert.equal(at(toks, 0, 2)?.type, MARKER); // 「 sits just after the astral char
});

test('punctuation-only body yields no tokens', () => {
  assert.deepEqual(buildSemanticTokens(doc('、。'), rec).data, []);
});
