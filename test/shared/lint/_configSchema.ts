/**
 * Derives the expected `contributes.configuration` block + its nls keys from the rule catalog and
 * the render-settings constants. Used by config-codegen.test.ts to hold package.json honest (the
 * deepEqual doubles as the "package.json defaults == resolver constants" lock), and by the one-off
 * generator that produced that block. NOT a test file (no `.test` suffix), so the runner skips it.
 *
 * Section order in the Settings UI (the `order` field, locked by the deepEqual):
 * Layout(1) > HTML Output(2) > Preview(3) > Lint(4, all scopes merged) > Project(5) >
 * Highlighting(6).
 */
import { EDGE_LINE_STYLES, PAGE_NUMBER_POSITIONS } from '../../../src/shared/compiler/chrome.ts';
import {
  BUILD_CHROME_DEFAULT,
  PREVIEW_CHROME_DEFAULT,
} from '../../../src/shared/config/settings.ts';
import {
  AUTO_TCY_MODES,
  CHARS_MAX,
  CHARS_MIN,
  LAYOUT_DEFAULT,
  PROJECT_DEFAULT,
} from '../../../src/shared/config/types.ts';
import { RULES, settingKey } from '../../../src/shared/lint/catalog.ts';
import type { RuleMeta, Scope } from '../../../src/shared/lint/catalog.ts';

/**
 * Rule ordering inside the merged Lint section (scopes with no rules, e.g. `dialogue`,
 * contribute nothing). Every rule gets an explicit per-property `order` so the merged
 * section keeps the common → narration → ruby clustering in the Settings UI.
 */
export const SCOPES: readonly Scope[] = ['common', 'narration', 'dialogue', 'ruby'];

/** nls key for one rule's setting description. */
export function ruleDescriptionKey(rule: RuleMeta): string {
  return `${settingKey(rule)}.description`;
}

/** nls key for one enum choice's drop-down label (enum rules only). */
export function enumValueKey(rule: RuleMeta, value: string): string {
  return `${settingKey(rule)}.${value}`;
}

/** The JSON-schema property for one rule (boolean / nullable-integer threshold / string enum). */
function propertyFor(rule: RuleMeta, order: number): Record<string, unknown> {
  const markdownDescription = `%${ruleDescriptionKey(rule)}%`;
  if (rule.kind === 'boolean') {
    return { type: 'boolean', default: false, order, markdownDescription };
  }
  if (rule.kind === 'threshold') {
    return {
      type: ['integer', 'null'],
      default: null,
      minimum: rule.min,
      maximum: rule.max,
      order,
      markdownDescription,
    };
  }
  const values = rule.values ?? [];
  return {
    type: 'string',
    enum: values,
    default: values[0],
    enumDescriptions: values.map((v) => `%${enumValueKey(rule, v)}%`),
    order,
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
 * The render-settings sections (layout / html / preview), derived from the same constants
 * the resolver uses — the codegen deepEqual is what locks package.json's defaults to them.
 */
function renderSections(): unknown[] {
  return [
    {
      title: '%jpnov.layout.title%',
      order: 1,
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
        'jpnov.layout.avoidLineBreaks': {
          type: 'boolean',
          default: LAYOUT_DEFAULT.avoidLineBreaks,
          markdownDescription: '%jpnov.layout.avoidLineBreaks.description%',
        },
        'jpnov.layout.autoTateChuYoko': {
          type: 'string',
          enum: [...AUTO_TCY_MODES],
          default: LAYOUT_DEFAULT.autoTcy,
          enumDescriptions: AUTO_TCY_MODES.map((v) => `%jpnov.layout.autoTateChuYoko.${v}%`),
          markdownDescription: '%jpnov.layout.autoTateChuYoko.description%',
        },
      },
    },
    {
      title: '%jpnov.html.title%',
      order: 2,
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
    {
      title: '%jpnov.preview.title%',
      order: 3,
      properties: {
        'jpnov.preview.lineNumbers': {
          type: 'boolean',
          default: PREVIEW_CHROME_DEFAULT.lineNumbers,
          markdownDescription: '%jpnov.preview.lineNumbers.description%',
        },
        'jpnov.preview.edgeLine': edgeLineProperty('jpnov.preview.edgeLine'),
      },
    },
  ];
}

/** The single merged Lint section: every rule, ordered common → narration → ruby. */
function lintSection(): unknown {
  const properties: Record<string, unknown> = {};
  let order = 1;
  for (const scope of SCOPES) {
    for (const rule of RULES.filter((r) => r.scope === scope)) {
      properties[settingKey(rule)] = propertyFor(rule, order);
      order += 1;
    }
  }
  return { title: '%jpnov.lint.title%', order: 4, properties };
}

/**
 * The Project section: the per-folder (`scope: resource`) output path — the only setting
 * that is a file location rather than rendering/proofing behavior.
 */
function projectSection(): unknown {
  return {
    title: '%jpnov.project.title%',
    order: 5,
    properties: {
      'jpnov.project.outDir': {
        type: 'string',
        default: PROJECT_DEFAULT.outDir,
        scope: 'resource',
        markdownDescription: '%jpnov.project.outDir.description%',
      },
    },
  };
}

/**
 * The Highlighting section: the per-folder (`scope: resource`) narration vocabulary. Plain
 * string arrays with NO `uniqueItems` — dedup/empty-drop is the server normalizer's single
 * job, and the descriptions say so ("empty and duplicate items are ignored").
 */
function highlightSection(): unknown {
  return {
    title: '%jpnov.highlight.title%',
    order: 6,
    properties: {
      'jpnov.highlight.characters': {
        type: 'array',
        items: { type: 'string' },
        default: [],
        scope: 'resource',
        markdownDescription: '%jpnov.highlight.characters.description%',
      },
      'jpnov.highlight.keywords': {
        type: 'array',
        items: { type: 'string' },
        default: [],
        scope: 'resource',
        markdownDescription: '%jpnov.highlight.keywords.description%',
      },
    },
  };
}

/** The nls keys the render sections reference (titles + descriptions + enum labels). */
function renderNlsKeys(): string[] {
  return [
    'jpnov.layout.title',
    'jpnov.preview.title',
    'jpnov.html.title',
    'jpnov.layout.charsPerLine.description',
    'jpnov.layout.linesPerPage.description',
    'jpnov.layout.avoidLineBreaks.description',
    'jpnov.layout.autoTateChuYoko.description',
    ...AUTO_TCY_MODES.map((v) => `jpnov.layout.autoTateChuYoko.${v}`),
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
    'jpnov.project.title',
    'jpnov.project.outDir.description',
    'jpnov.highlight.title',
    'jpnov.highlight.characters.description',
    'jpnov.highlight.keywords.description',
  ];
}

/**
 * The full `contributes.configuration` array — render sections, then the merged Lint
 * section, then Project (array position mirrors the `order` fields).
 */
export function expectedConfiguration(): unknown[] {
  return [...renderSections(), lintSection(), projectSection(), highlightSection()];
}

/** Every nls key the configuration block references (section titles + descriptions + enum labels). */
export function expectedNlsKeys(): string[] {
  const keys: string[] = ['jpnov.lint.title'];
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
