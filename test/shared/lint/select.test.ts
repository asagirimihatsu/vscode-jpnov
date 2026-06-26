/** Enablement / clamping / common-fan-out / enum behaviour of selectRules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSelectionEmpty, selectRules } from '../../../src/shared/lint/select.ts';

test('empty config leaves every stream empty (default off)', () => {
  const sel = selectRules({});
  assert.ok(isSelectionEmpty(sel));
  assert.deepEqual(sel, { narration: [], dialogue: [], ruby: [] });
});

test('a common rule is fanned onto BOTH narration and dialogue under one code', () => {
  const sel = selectRules({ 'jpnov.lint.common.noEmDash': true });
  const expected = { id: 'noEmDash', options: true, code: 'lint.common.noEmDash' };
  assert.deepEqual(sel.narration, [expected]);
  assert.deepEqual(sel.dialogue, [expected]);
  assert.deepEqual(sel.ruby, []);
});

test('a common threshold rule clamps to bounds and lands in both streams', () => {
  const sel = selectRules({ 'jpnov.lint.common.maxTen': 999 });
  const expected = { id: 'maxTen', options: { max: 20 }, code: 'lint.common.maxTen' };
  assert.deepEqual(sel.narration, [expected]);
  assert.deepEqual(sel.dialogue, [expected]);
});

test('a boolean rule enables only on exactly true', () => {
  assert.ok(isSelectionEmpty(selectRules({ 'jpnov.lint.common.noEmDash': false })));
  assert.ok(isSelectionEmpty(selectRules({ 'jpnov.lint.common.noEmDash': 1 })));
});

test('a narration-only rule stays out of dialogue', () => {
  const sel = selectRules({ 'jpnov.lint.narration.generalNovelStyle': true });
  assert.deepEqual(sel.narration, [
    { id: 'generalNovelStyle', options: true, code: 'lint.narration.generalNovelStyle' },
  ]);
  assert.deepEqual(sel.dialogue, []);
});

test('the ruby enum resolves a mode; off / unknown values stay off', () => {
  assert.deepEqual(selectRules({ 'jpnov.lint.ruby.kana': 'hiragana' }).ruby, [
    { id: 'kana', options: { mode: 'hiragana' }, code: 'lint.ruby.kana' },
  ]);
  assert.ok(isSelectionEmpty(selectRules({ 'jpnov.lint.ruby.kana': 'off' })));
  assert.ok(isSelectionEmpty(selectRules({ 'jpnov.lint.ruby.kana': 'romaji' })));
});
