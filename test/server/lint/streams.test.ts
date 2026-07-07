/**
 * Stream-separation + offset-mapping tests for src/server/lint/streams.ts. Pure + import-light, so
 * they run on Node's native test loader (no `#/` specifiers in the module graph).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { extractStreams, mapRange } from '../../../src/server/lint/streams.ts';
import type { Stream } from '../../../src/server/lint/streams.ts';

/** The exact source substring a `[a, b)` hit on `stream` maps back to. */
function mapped(src: string, stream: Stream, a: number, b: number): string {
  const doc = TextDocument.create('mem://x.jpnov', 'novel-jp', 1, src);
  const r = mapRange(stream, doc, a, b);
  return src.slice(doc.offsetAt(r.start), doc.offsetAt(r.end));
}

test('plain narration is identity; other streams empty', () => {
  const s = extractStreams('あいうえお。');
  assert.equal(s.narration.text, 'あいうえお。');
  assert.equal(s.dialogue.text, '');
  assert.equal(s.ruby.text, '');
  assert.equal(s.narration.srcMap.length, s.narration.text.length);
});

test('dialogue interior collapses to 〇 in narration and forms the dialogue stream', () => {
  const src = '「ヤッホー」と、巳一は言った。';
  const s = extractStreams(src);
  assert.equal(s.narration.text, '「〇」と、巳一は言った。');
  assert.equal(s.dialogue.text, 'ヤッホー');
  assert.equal(mapped(src, s.dialogue, 0, 4), 'ヤッホー');
  const i = s.narration.text.indexOf('巳一');
  assert.equal(mapped(src, s.narration, i, i + 2), '巳一');
});

test('ruby: base flows into narration, reading into the ruby stream', () => {
  const src = '巳一《みはつ》は言った。';
  const s = extractStreams(src);
  assert.equal(s.narration.text, '巳一は言った。');
  assert.equal(s.ruby.text, 'みはつ');
  assert.equal(mapped(src, s.ruby, 0, 3), 'みはつ');
});

test('ruby inside dialogue: base -> dialogue, reading -> ruby, narration 〇', () => {
  const src = '「漢字《かんじ》」';
  const s = extractStreams(src);
  assert.equal(s.narration.text, '「〇」');
  assert.equal(s.dialogue.text, '漢字');
  assert.equal(s.ruby.text, 'かんじ');
  assert.equal(mapped(src, s.dialogue, 0, 2), '漢字');
});

test('［＃「対象」に傍点］ is an annotation, not dialogue (the Aozora trap)', () => {
  const src = '本当に［＃「当」に傍点］走った。';
  const s = extractStreams(src);
  assert.equal(s.narration.text, '本当に走った。'); // emphasis annotation contributes no prose
  assert.equal(s.dialogue.text, ''); // 「当」 inside ［＃…］ never enters the dialogue stack
});

test('inline emphasis span keeps the enclosed prose contiguous', () => {
  const s = extractStreams('彼は［＃傍点］本当に［＃傍点終わり］走った。');
  assert.equal(s.narration.text, '彼は本当に走った。');
});

test('an unclosed opener still collapses in narration and captures its utterance', () => {
  const s = extractStreams('「あ');
  assert.equal(s.narration.text, '「〇'); // no closer in source -> no-unmatched-pair flags this on narration
  assert.equal(s.dialogue.text, 'あ');
});

test('a broken ［＃ contributes no prose to any lint stream (malformed markup is not linted)', () => {
  const s = extractStreams('地の文［＃こわれ\n次の行');
  assert.equal(s.narration.text, '地の文\n次の行'); // the swallowed tail is absent
  assert.equal(s.dialogue.text, '');
  assert.equal(s.ruby.text, '');
});

test('a 「 swallowed by a broken ［＃ never enters the dialogue stack', () => {
  const s = extractStreams('［＃「未\nあと');
  assert.equal(s.dialogue.text, '');
  assert.equal(s.narration.text, '\nあと');
});

test('consecutive dialogues are newline-joined (independent utterances)', () => {
  const src = '「A」「BC」';
  const s = extractStreams(src);
  assert.equal(s.dialogue.text, 'A\nBC');
  const i = s.dialogue.text.indexOf('BC');
  assert.equal(mapped(src, s.dialogue, i, i + 2), 'BC');
});

test('empty dialogue emits no 〇 and no utterance', () => {
  const s = extractStreams('「」だ');
  assert.equal(s.narration.text, '「」だ');
  assert.equal(s.dialogue.text, '');
});

test('astral chars map by UTF-16 unit without bleeding across removed markup', () => {
  const src = '𠮷《よし》さん';
  const s = extractStreams(src);
  assert.equal(s.narration.text, '𠮷さん');
  // 𠮷 alone (two UTF-16 units) maps to exactly 𠮷 — end anchors on the last included unit.
  assert.equal(mapped(src, s.narration, 0, 2), '𠮷');
  // 𠮷 + さ spans the collapsed ruby, so the source range covers the gap up to さ's end.
  assert.equal(mapped(src, s.narration, 0, 3), '𠮷《よし》さ');
  assert.equal(s.ruby.text, 'よし');
  assert.equal(mapped(src, s.ruby, 0, 2), 'よし');
});

test('newlines are preserved in narration (line structure intact)', () => {
  const s = extractStreams('一行目。\n「セリフ」\n三行目。');
  assert.equal(s.narration.text, '一行目。\n「〇」\n三行目。');
  assert.equal(s.dialogue.text, 'セリフ');
});
