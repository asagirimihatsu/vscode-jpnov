/**
 * Derives the expected `contributes.configuration` block + its nls keys from the rule catalog. Used
 * by config-codegen.test.ts to hold package.json honest, and by the one-off generator that produced
 * that block. NOT a test file (no `.test` suffix), so the runner skips it.
 */
import { RULES, settingKey } from '../../../src/shared/lint/catalog.ts';
import type { RuleMeta, Scope } from '../../../src/shared/lint/catalog.ts';

/** Section order in the Settings UI; scopes with no rules (e.g. `dialogue`) are skipped. */
export const SCOPES: readonly Scope[] = ['common', 'narration', 'dialogue', 'ruby'];

/** nls key for a section's title. */
export function sectionTitleKey(scope: Scope): string {
  return `jpnov.lint.${scope}.title`;
}

/** nls key for one rule's setting description. */
export function ruleDescriptionKey(rule: RuleMeta): string {
  return `${settingKey(rule)}.description`;
}

/** nls key for one enum choice's drop-down label (enum rules only). */
export function enumValueKey(rule: RuleMeta, value: string): string {
  return `${settingKey(rule)}.${value}`;
}

/** The JSON-schema property for one rule (boolean / nullable-integer threshold / string enum). */
function propertyFor(rule: RuleMeta): Record<string, unknown> {
  const markdownDescription = `%${ruleDescriptionKey(rule)}%`;
  if (rule.kind === 'boolean') {
    return { type: 'boolean', default: false, markdownDescription };
  }
  if (rule.kind === 'threshold') {
    return {
      type: ['integer', 'null'],
      default: null,
      minimum: rule.min,
      maximum: rule.max,
      markdownDescription,
    };
  }
  const values = rule.values ?? [];
  return {
    type: 'string',
    enum: values,
    default: values[0],
    enumDescriptions: values.map((v) => `%${enumValueKey(rule, v)}%`),
    markdownDescription,
  };
}

/** The full `contributes.configuration` array — one section per non-empty scope, rules in order. */
export function expectedConfiguration(): unknown[] {
  const sections: unknown[] = [];
  for (const scope of SCOPES) {
    const rules = RULES.filter((r) => r.scope === scope);
    if (rules.length === 0) {
      continue;
    }
    const properties: Record<string, unknown> = {};
    for (const rule of rules) {
      properties[settingKey(rule)] = propertyFor(rule);
    }
    sections.push({ title: `%${sectionTitleKey(scope)}%`, properties });
  }
  return sections;
}

/** Every nls key the configuration block references (section titles + descriptions + enum labels). */
export function expectedNlsKeys(): string[] {
  const keys: string[] = [];
  for (const scope of SCOPES) {
    if (RULES.some((r) => r.scope === scope)) {
      keys.push(sectionTitleKey(scope));
    }
  }
  for (const rule of RULES) {
    keys.push(ruleDescriptionKey(rule));
    if (rule.kind === 'enum') {
      for (const v of rule.values) {
        keys.push(enumValueKey(rule, v));
      }
    }
  }
  return keys;
}
