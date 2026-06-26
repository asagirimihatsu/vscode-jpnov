/**
 * Holds package.json + the nls bundles in sync with the catalog. The expected configuration is
 * DERIVED from RULES (see _configSchema.ts); if a rule is added/changed without regenerating the
 * committed `contributes.configuration`, this fails and prints the diff to paste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expectedConfiguration, expectedNlsKeys } from './_configSchema.ts';

const ROOT = new URL('../../../', import.meta.url); // repo root, from test/shared/lint/

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8')) as Record<string, unknown>;
}

test('package.json contributes.configuration matches the catalog', () => {
  const pkg = readJson('package.json');
  const contributes = pkg.contributes as { configuration: unknown };
  assert.deepEqual(contributes.configuration, expectedConfiguration());
});

test('every referenced nls key is defined in both the EN and JA bundles', () => {
  const en = readJson('package.nls.json');
  const ja = readJson('package.nls.ja.json');
  for (const key of expectedNlsKeys()) {
    assert.ok(key in en, `missing EN nls key: ${key}`);
    assert.ok(key in ja, `missing JA nls key: ${key}`);
  }
});
