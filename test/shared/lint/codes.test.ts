/**
 * The lint codes round-trip: every catalog rule has a renderable diagnostic code, and the code is
 * exactly its setting key minus the `jpnov.` prefix (one mental model, no lookup table).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RULES, diagCode, settingKey } from '../../../src/shared/lint/catalog.ts';
import { renderEnglish } from '../../../src/shared/messages.ts';

test('every rule code renders to non-empty English (renderEnglish stays exhaustive)', () => {
  for (const r of RULES) {
    const text = renderEnglish(diagCode(r));
    assert.ok(typeof text === 'string' && text.length > 0, `empty render for ${diagCode(r)}`);
  }
});

test('diagnostic code === setting key without the jpnov. prefix', () => {
  for (const r of RULES) {
    assert.equal(diagCode(r), settingKey(r).slice('jpnov.'.length));
  }
});
