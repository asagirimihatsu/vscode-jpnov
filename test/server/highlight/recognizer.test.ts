/**
 * The narration recognizer: cast-name splitting and the subject/keyword match rules. Pure + sync,
 * so these run directly on Node's native loader (no #/ value imports, no dictionary).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecognizer,
  splitCharacterSurfaces,
  type Recognizer,
} from '../../../src/server/highlight/recognizer.ts';

/** `kind:surface@start` for each span, sorted by start — compact, order-independent assertions. */
const spans = (r: Recognizer, text: string): string[] =>
  [...r.recognize(text)]
    .sort((a, b) => a.start - b.start)
    .map((s) => `${s.kind}:${text.slice(s.start, s.start + s.len)}@${String(s.start)}`);

test('splitCharacterSurfaces yields each part, the no-space join, and the spaced full', () => {
  const s = splitCharacterSurfaces(['朝霧　巳一', 'Arill Stains']);
  assert.ok(s.includes('朝霧')); // surname
  assert.ok(s.includes('巳一')); // given
  assert.ok(s.includes('朝霧巳一')); // join (JP body text)
  assert.ok(s.includes('朝霧　巳一')); // verbatim spaced full
  assert.ok(s.includes('Arill') && s.includes('Stains') && s.includes('Arill Stains'));
});

test('splitCharacterSurfaces dedups a part shared across entries', () => {
  const s = splitCharacterSurfaces(['朝霧　巳一', '朝霧　郁']);
  assert.equal(s.filter((x) => x === '朝霧').length, 1);
});

test('a name + subject particle highlights as a character; the particle is excluded', () => {
  const r = createRecognizer(['朝霧　巳一'], []);
  assert.deepEqual(spans(r, '巳一は走った'), ['character:巳一は@0']);
  assert.deepEqual(spans(r, '朝霧巳一が来た'), ['character:朝霧巳一が@0']);
});

test('an honorific between the name and particle is highlighted together with the name', () => {
  const r = createRecognizer(['朝霧　巳一'], []);
  assert.deepEqual(spans(r, '朝霧先生が頷いた'), ['character:朝霧先生が@0']);
  assert.deepEqual(spans(r, '巳一ちゃんは笑った'), ['character:巳一ちゃんは@0']);
});

test('a name with no subject particle (の / を) is not highlighted', () => {
  const r = createRecognizer(['朝霧　巳一'], []);
  assert.deepEqual(spans(r, '巳一の本'), []);
  assert.deepEqual(spans(r, '巳一を見た'), []);
});

test('built-in pronouns are recognised, gated by a subject particle', () => {
  const r = createRecognizer([], ['無関係']); // pronouns are built in, independent of characters
  assert.deepEqual(spans(r, '私は彼女が'), ['character:私は@0', 'character:彼女が@2']);
  assert.deepEqual(spans(r, '私の本'), []); // bare pronoun → nothing
});

test('keywords match exactly and are bolded', () => {
  const r = createRecognizer([], ['黒剣', '境無']);
  assert.deepEqual(spans(r, '黒剣を抜く'), ['keyword:黒剣@0']);
});

test('a surface in both lists: subject form → character, bare → keyword', () => {
  const r = createRecognizer(['境無'], ['境無']);
  assert.deepEqual(spans(r, '境無は強い'), ['character:境無は@0']); // subject wins
  assert.deepEqual(spans(r, '黒剣境無の力'), ['keyword:境無@2']); // bare → keyword
});
