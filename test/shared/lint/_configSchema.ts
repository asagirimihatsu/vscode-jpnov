/**
 * Derives the expected `contributes.configuration` block + its nls keys from the rule catalog and
 * the render-settings constants. Used by config-codegen.test.ts to hold package.json honest (the
 * deepEqual doubles as the "package.json defaults == resolver constants" lock), and by the one-off
 * generator that produced that block. NOT a test file (no `.test` suffix), so the runner skips it.
 *
 * Section order in the Settings UI (the `order` field, locked by the deepEqual):
 * Layout & Output(1) > Lint(2) > Editor(3). Every property carries an explicit in-section `order`.
 */
import { EDGE_LINE_STYLES } from '../../../src/shared/compiler/chrome.ts';
import {
  BUILD_CHROME_DEFAULT,
  PREVIEW_CHROME_DEFAULT,
} from '../../../src/shared/config/settings.ts';
import {
  AUTO_TCY_MODES,
  CHARS_MAX,
  CHARS_MIN,
  KINSOKU_MODES,
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

/** nls key for one enum choice's drop-down label (`enumItemLabels`, enum rules only). */
export function enumLabelKey(rule: RuleMeta, value: string): string {
  return `${settingKey(rule)}.${value}.label`;
}

/** nls key for one enum choice's drop-down sub-text (`enumDescriptions`, enum rules only). */
export function enumDescriptionKey(rule: RuleMeta, value: string): string {
  return `${settingKey(rule)}.${value}.description`;
}

/** The JSON-schema property for one rule (boolean / nullable-integer threshold / string enum). */
function propertyFor(rule: RuleMeta, order: number): Record<string, unknown> {
  const markdownDescription = `%${ruleDescriptionKey(rule)}%`;
  if (rule.kind === 'boolean') {
    return { type: 'boolean', default: rule.default ?? false, order, markdownDescription };
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
    enumItemLabels: values.map((v) => `%${enumLabelKey(rule, v)}%`),
    enumDescriptions: values.map((v) => `%${enumDescriptionKey(rule, v)}%`),
    order,
    markdownDescription,
  };
}

/** An `edgeLine` enum property (shared shape between the preview and html slices). */
function edgeLineProperty(keyPrefix: string, order: number): Record<string, unknown> {
  return {
    type: 'string',
    enum: [...EDGE_LINE_STYLES],
    default: 'none',
    enumItemLabels: EDGE_LINE_STYLES.map((v) => `%${keyPrefix}.${v}.label%`),
    enumDescriptions: EDGE_LINE_STYLES.map((v) => `%${keyPrefix}.${v}.description%`),
    order,
    markdownDescription: `%${keyPrefix}.description%`,
  };
}

/**
 * The Layout & Output section: the shared layout core, then the preview / html render slices
 * (derived from the same constants the resolver uses — the codegen deepEqual is what locks
 * package.json's defaults to them), then the two output-side paths. `outDir` is per-folder
 * (`scope: resource`); `browserPath` is machine-specific and client-only (never sent to the
 * resolver), so its default is a bare literal here.
 */
function layoutSection(): unknown {
  return {
    title: '%jpnov.layout.title%',
    order: 1,
    properties: {
      'jpnov.layout.charsPerLine': {
        type: 'integer',
        default: LAYOUT_DEFAULT.charsPerLine,
        minimum: CHARS_MIN,
        maximum: CHARS_MAX,
        order: 1,
        markdownDescription: '%jpnov.layout.charsPerLine.description%',
      },
      'jpnov.layout.linesPerPage': {
        type: 'integer',
        default: LAYOUT_DEFAULT.linesPerPage,
        minimum: CHARS_MIN,
        maximum: CHARS_MAX,
        order: 2,
        markdownDescription: '%jpnov.layout.linesPerPage.description%',
      },
      'jpnov.layout.kinsoku': {
        type: 'string',
        enum: [...KINSOKU_MODES],
        default: LAYOUT_DEFAULT.kinsoku,
        enumItemLabels: KINSOKU_MODES.map((v) => `%jpnov.layout.kinsoku.${v}.label%`),
        enumDescriptions: KINSOKU_MODES.map((v) => `%jpnov.layout.kinsoku.${v}.description%`),
        order: 3,
        markdownDescription: '%jpnov.layout.kinsoku.description%',
      },
      'jpnov.layout.autoTcy': {
        type: 'string',
        enum: [...AUTO_TCY_MODES],
        default: LAYOUT_DEFAULT.autoTcy,
        enumItemLabels: AUTO_TCY_MODES.map((v) => `%jpnov.layout.autoTcy.${v}.label%`),
        enumDescriptions: AUTO_TCY_MODES.map((v) => `%jpnov.layout.autoTcy.${v}.description%`),
        order: 4,
        markdownDescription: '%jpnov.layout.autoTcy.description%',
      },
      'jpnov.layout.preview.lineNumbers': {
        type: 'boolean',
        default: PREVIEW_CHROME_DEFAULT.lineNumbers,
        order: 5,
        markdownDescription: '%jpnov.layout.preview.lineNumbers.description%',
      },
      'jpnov.layout.preview.edgeLine': edgeLineProperty('jpnov.layout.preview.edgeLine', 6),
      // Page furniture (ヘッダー/ノンブル) is deliberately NOT here: it is book identity, carried
      // by each `.jpbook`'s front matter (parsed in shared/book/jpbook.ts), never a setting.
      'jpnov.layout.html.lineNumbers': {
        type: 'boolean',
        default: BUILD_CHROME_DEFAULT.lineNumbers,
        order: 7,
        markdownDescription: '%jpnov.layout.html.lineNumbers.description%',
      },
      'jpnov.layout.html.edgeLine': edgeLineProperty('jpnov.layout.html.edgeLine', 8),
      'jpnov.layout.outDir': {
        type: 'string',
        default: PROJECT_DEFAULT.outDir,
        scope: 'resource',
        order: 9,
        markdownDescription: '%jpnov.layout.outDir.description%',
      },
      'jpnov.layout.browserPath': {
        type: 'string',
        default: '',
        scope: 'machine-overridable',
        order: 10,
        markdownDescription: '%jpnov.layout.browserPath.description%',
      },
    },
  };
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
  return { title: '%jpnov.lint.title%', order: 2, properties };
}

const UPDATE_REFS_MODES = ['prompt', 'always', 'never'] as const;

/**
 * The Editor section: typing behavior and in-editor aids, all client-only (never sent to the
 * resolver), so defaults are bare literals here — `autoIndent` mirrored in
 * `client/editor/autoIndent.ts`, the `updateRefsOnFileMove` triad in `client/book/tracking.ts`.
 * The highlight vocabulary is per-folder (`scope: resource`), plain string arrays with NO
 * `uniqueItems` — dedup/empty-drop is the server normalizer's single job, and the descriptions
 * say so ("empty and duplicate items are ignored").
 */
function editorSection(): unknown {
  return {
    title: '%jpnov.editor.title%',
    order: 3,
    properties: {
      'jpnov.editor.autoIndent': {
        type: 'boolean',
        default: true,
        order: 1,
        markdownDescription: '%jpnov.editor.autoIndent.description%',
      },
      'jpnov.editor.highlight.characters': {
        type: 'array',
        items: { type: 'string' },
        default: [],
        scope: 'resource',
        order: 2,
        markdownDescription: '%jpnov.editor.highlight.characters.description%',
      },
      'jpnov.editor.highlight.keywords': {
        type: 'array',
        items: { type: 'string' },
        default: [],
        scope: 'resource',
        order: 3,
        markdownDescription: '%jpnov.editor.highlight.keywords.description%',
      },
      'jpnov.editor.updateRefsOnFileMove': {
        type: 'string',
        enum: [...UPDATE_REFS_MODES],
        default: 'prompt',
        enumItemLabels: UPDATE_REFS_MODES.map(
          (v) => `%jpnov.editor.updateRefsOnFileMove.${v}.label%`,
        ),
        enumDescriptions: UPDATE_REFS_MODES.map(
          (v) => `%jpnov.editor.updateRefsOnFileMove.${v}.description%`,
        ),
        order: 4,
        markdownDescription: '%jpnov.editor.updateRefsOnFileMove.description%',
      },
    },
  };
}

/** The `.label` + `.description` key pair for one enum choice. */
function enumChoiceKeys(choiceKey: string): string[] {
  return [`${choiceKey}.label`, `${choiceKey}.description`];
}

/** The nls keys the Layout & Output and Editor sections reference (titles + descriptions + enum labels). */
function staticNlsKeys(): string[] {
  return [
    'jpnov.layout.title',
    'jpnov.layout.charsPerLine.description',
    'jpnov.layout.linesPerPage.description',
    'jpnov.layout.kinsoku.description',
    ...KINSOKU_MODES.flatMap((v) => enumChoiceKeys(`jpnov.layout.kinsoku.${v}`)),
    'jpnov.layout.autoTcy.description',
    ...AUTO_TCY_MODES.flatMap((v) => enumChoiceKeys(`jpnov.layout.autoTcy.${v}`)),
    'jpnov.layout.preview.lineNumbers.description',
    'jpnov.layout.preview.edgeLine.description',
    ...EDGE_LINE_STYLES.flatMap((v) => enumChoiceKeys(`jpnov.layout.preview.edgeLine.${v}`)),
    'jpnov.layout.html.lineNumbers.description',
    'jpnov.layout.html.edgeLine.description',
    ...EDGE_LINE_STYLES.flatMap((v) => enumChoiceKeys(`jpnov.layout.html.edgeLine.${v}`)),
    'jpnov.layout.outDir.description',
    'jpnov.layout.browserPath.description',
    'jpnov.editor.title',
    'jpnov.editor.autoIndent.description',
    'jpnov.editor.highlight.characters.description',
    'jpnov.editor.highlight.keywords.description',
    'jpnov.editor.updateRefsOnFileMove.description',
    ...UPDATE_REFS_MODES.flatMap((v) => enumChoiceKeys(`jpnov.editor.updateRefsOnFileMove.${v}`)),
  ];
}

/**
 * The full `contributes.configuration` array — Layout & Output, the merged Lint section,
 * then Editor (array position mirrors the `order` fields).
 */
export function expectedConfiguration(): unknown[] {
  return [layoutSection(), lintSection(), editorSection()];
}

/** Every nls key the configuration block references (section titles + descriptions + enum labels). */
export function expectedNlsKeys(): string[] {
  const keys: string[] = ['jpnov.lint.title'];
  for (const rule of RULES) {
    keys.push(ruleDescriptionKey(rule));
    if (rule.kind === 'enum') {
      for (const v of rule.values) {
        keys.push(enumLabelKey(rule, v), enumDescriptionKey(rule, v));
      }
    }
  }
  return [...keys, ...staticNlsKeys()];
}
