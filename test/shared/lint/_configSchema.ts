/**
 * Derives the expected `contributes.configuration` block + its nls keys from the rule catalog and
 * the render-settings constants. Used by config-codegen.test.ts to hold package.json honest (the
 * deepEqual doubles as the "package.json defaults == resolver constants" lock), and by the one-off
 * generator that produced that block. NOT a test file (no `.test` suffix), so the runner skips it.
 */
import { EDGE_LINE_STYLES, PAGE_NUMBER_POSITIONS } from '../../../src/shared/compiler/chrome.ts';
import {
  BUILD_CHROME_DEFAULT,
  PREVIEW_CHROME_DEFAULT,
} from '../../../src/shared/config/settings.ts';
import { CHARS_MAX, CHARS_MIN, LAYOUT_DEFAULT } from '../../../src/shared/config/types.ts';
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

/** An `edgeLine` enum property (shared shape between the preview and html sections). */
function edgeLineProperty(keyPrefix: string): Record<string, unknown> {
  return {
    type: 'string',
    enum: [...EDGE_LINE_STYLES],
    default: 'none',
    enumDescriptions: EDGE_LINE_STYLES.map((v) => `%${keyPrefix}.${v}%`),
    markdownDescription: `%${keyPrefix}.description%`,
  };
}

/**
 * The render-settings sections (layout / preview / html), derived from the same constants
 * the resolver uses — the codegen deepEqual is what locks package.json's defaults to them.
 */
function renderSections(): unknown[] {
  return [
    {
      title: '%jpnov.layout.title%',
      properties: {
        'jpnov.layout.charsPerLine': {
          type: 'integer',
          default: LAYOUT_DEFAULT.charsPerLine,
          minimum: CHARS_MIN,
          maximum: CHARS_MAX,
          markdownDescription: '%jpnov.layout.charsPerLine.description%',
        },
        'jpnov.layout.linesPerPage': {
          type: 'integer',
          default: LAYOUT_DEFAULT.linesPerPage,
          minimum: CHARS_MIN,
          maximum: CHARS_MAX,
          markdownDescription: '%jpnov.layout.linesPerPage.description%',
        },
      },
    },
    {
      title: '%jpnov.preview.title%',
      properties: {
        'jpnov.preview.lineNumbers': {
          type: 'boolean',
          default: PREVIEW_CHROME_DEFAULT.lineNumbers,
          markdownDescription: '%jpnov.preview.lineNumbers.description%',
        },
        'jpnov.preview.edgeLine': edgeLineProperty('jpnov.preview.edgeLine'),
      },
    },
    {
      title: '%jpnov.html.title%',
      properties: {
        'jpnov.html.lineNumbers': {
          type: 'boolean',
          default: BUILD_CHROME_DEFAULT.lineNumbers,
          markdownDescription: '%jpnov.html.lineNumbers.description%',
        },
        'jpnov.html.edgeLine': edgeLineProperty('jpnov.html.edgeLine'),
        'jpnov.html.pageNumber.position': {
          type: 'string',
          enum: [...PAGE_NUMBER_POSITIONS],
          default: BUILD_CHROME_DEFAULT.pageNumberPosition,
          enumDescriptions: PAGE_NUMBER_POSITIONS.map(
            (v) => `%jpnov.html.pageNumber.position.${v}%`,
          ),
          markdownDescription: '%jpnov.html.pageNumber.position.description%',
        },
        'jpnov.html.pageNumber.template': {
          type: 'string',
          default: BUILD_CHROME_DEFAULT.pageNumberTemplate,
          markdownDescription: '%jpnov.html.pageNumber.template.description%',
        },
        'jpnov.html.header': {
          type: 'string',
          default: BUILD_CHROME_DEFAULT.header,
          markdownDescription: '%jpnov.html.header.description%',
        },
      },
    },
  ];
}

/** The nls keys the render sections reference (titles + descriptions + enum labels). */
function renderNlsKeys(): string[] {
  return [
    'jpnov.layout.title',
    'jpnov.preview.title',
    'jpnov.html.title',
    'jpnov.layout.charsPerLine.description',
    'jpnov.layout.linesPerPage.description',
    'jpnov.preview.lineNumbers.description',
    'jpnov.preview.edgeLine.description',
    ...EDGE_LINE_STYLES.map((v) => `jpnov.preview.edgeLine.${v}`),
    'jpnov.html.lineNumbers.description',
    'jpnov.html.edgeLine.description',
    ...EDGE_LINE_STYLES.map((v) => `jpnov.html.edgeLine.${v}`),
    'jpnov.html.pageNumber.position.description',
    ...PAGE_NUMBER_POSITIONS.map((v) => `jpnov.html.pageNumber.position.${v}`),
    'jpnov.html.pageNumber.template.description',
    'jpnov.html.header.description',
  ];
}

/**
 * The full `contributes.configuration` array — one section per non-empty lint scope (rules in
 * order), then the render-settings sections.
 */
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
  return [...sections, ...renderSections()];
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
  return [...keys, ...renderNlsKeys()];
}
