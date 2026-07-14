/**
 * Locks the shipped lint experience: with no user overrides, exactly the four data-hygiene rules run
 * and every other rule is off. Reads the real package.json `default`s and drives the real
 * `selectRules`, so a flipped manifest default (or a mis-scoped rule) fails here — the schema-shape
 * lock in config-codegen.test.ts never exercises this defaults-to-selection path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RULES, settingKey } from '../../../src/shared/lint/catalog.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';
import type { RawLintConfig } from '../../../src/shared/lint/select.ts';

const ROOT = new URL('../../../', import.meta.url); // repo root, from test/shared/lint/

/** Every jpnov.lint.* setting mapped to its shipped package.json `default`. null/false/'off' are kept
 *  in: `selectRules` treats them as off, the same outcome the client's snapshot filter produces. */
function shippedLintDefaults(): RawLintConfig {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', ROOT)), 'utf8'),
  ) as { contributes: { configuration: { properties?: Record<string, { default: unknown }> }[] } };
  const raw: Record<string, boolean | number | string | null> = {};
  for (const rule of RULES) {
    const key = settingKey(rule);
    for (const section of pkg.contributes.configuration) {
      const prop = section.properties?.[key];
      if (prop !== undefined) {
        raw[key] = prop.default as boolean | number | string | null;
      }
    }
  }
  return raw;
}

test('shipped defaults enable exactly the four data-hygiene rules on both prose streams', () => {
  const selection = selectRules(shippedLintDefaults());
  const codes = (rules: readonly { readonly code: string }[]): string[] =>
    rules.map((r) => r.code).sort();
  // Alphabetically sorted to match `codes`; these `common` rules fan onto narration AND dialogue.
  const hygiene = [
    'lint.common.noControlChar',
    'lint.common.noHankakuKana',
    'lint.common.noNfd',
    'lint.common.noZeroWidth',
  ];
  assert.deepEqual(codes(selection.narration), hygiene);
  assert.deepEqual(codes(selection.dialogue), hygiene);
  assert.deepEqual(selection.ruby, []); // nothing ships on the 読み stream
});
