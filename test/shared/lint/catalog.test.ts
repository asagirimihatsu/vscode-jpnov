/** Invariants of the rule catalog (the single source of truth). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RULES, allSettingKeys, diagCode, settingKey } from '../../../src/shared/lint/catalog.ts';

test('rule ids are unique within each scope', () => {
  const seen = new Set<string>();
  for (const r of RULES) {
    const key = `${r.scope}.${r.id}`;
    assert.ok(!seen.has(key), `duplicate (scope, id): ${key}`);
    seen.add(key);
  }
});

test('settingKey and diagCode derive from scope + id', () => {
  for (const r of RULES) {
    assert.equal(settingKey(r), `jpnov.lint.${r.scope}.${r.id}`);
    assert.equal(diagCode(r), `lint.${r.scope}.${r.id}`);
  }
});

test('the ruby enum lists "off" as its first (default) value', () => {
  for (const r of RULES) {
    if (r.kind === 'enum') {
      assert.equal(r.values[0], 'off', `${r.id} first value must be the off default`);
    }
  }
});

test('allSettingKeys lists every rule exactly once', () => {
  const keys = allSettingKeys();
  assert.equal(keys.length, RULES.length);
  assert.equal(new Set(keys).size, RULES.length);
});

test('threshold rules carry sane, ordered bounds (booleans have none by type)', () => {
  for (const r of RULES) {
    if (r.kind === 'threshold') {
      assert.equal(typeof r.min, 'number', `${r.id} min`);
      assert.equal(typeof r.max, 'number', `${r.id} max`);
      assert.equal(typeof r.suggested, 'number', `${r.id} suggested`);
      assert.ok(r.min <= r.suggested && r.suggested <= r.max, `${r.id} suggested in range`);
    }
  }
});
