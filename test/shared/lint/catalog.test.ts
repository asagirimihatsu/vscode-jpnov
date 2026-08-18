/** Invariants of the rule catalog (the single source of truth). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DASH_BY_MODE } from '../../../src/shared/chars.ts';
import { DASH_MODES, LAYOUT_DEFAULT } from '../../../src/shared/config/types.ts';
import { RULES, allSettingKeys, diagCode, settingKey } from '../../../src/shared/lint/catalog.ts';
import type { RuleMeta } from '../../../src/shared/lint/catalog.ts';

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
    // A dotless id is what lets a rule carry `<its code>.<suffix>` sub-codes (protocol.ts) that
    // cannot collide with another rule's code.
    assert.ok(!r.id.includes('.'), `${r.id} must not contain a dot`);
  }
});

test('every enum defaults to one of its own values', () => {
  const rules: readonly RuleMeta[] = RULES;
  for (const r of rules) {
    if (r.kind === 'enum') {
      // 'off' is the spelling select.ts keys enablement off; its position in `values` is free,
      // and a list without it (dash) makes the rule always-on.
      const values = r.values ?? [];
      assert.ok(
        values.includes(String(r.default ?? values[0])),
        `${r.id} default must be one of its values`,
      );
    }
  }
});

test('every dash choice maps to a glyph the scanner targets and the layout translates', () => {
  // The drop-down values, DASH_MODES and DASH_BY_MODE are separate homes for one fact (the
  // catalog stays import-free); a value with no glyph would make the rule a silent no-op. The
  // catalog default and the render resolver's fallback are the same lockstep.
  const dash = (RULES as readonly RuleMeta[]).find((r) => r.id === 'dash');
  assert.deepEqual(dash?.values, Object.keys(DASH_BY_MODE));
  assert.deepEqual(dash.values, [...DASH_MODES]);
  assert.equal(dash.default, LAYOUT_DEFAULT.dash);
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
