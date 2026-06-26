/**
 * The lint rule catalog — the SINGLE SOURCE OF TRUTH for every Phase-1 prose-lint rule.
 *
 * One {@link RuleMeta} row = one `(scope, id)` pair = one diagnostic code (`lint.<scope>.<id>`)
 * = one vscode setting key (`jpnov.lint.<scope>.<id>`). Everything else conforms to this list:
 *   - {@link LintCode} (and thus `MsgCode` in protocol.ts) is DERIVED from these rows, so adding a
 *     rule here extends the message union automatically — there is no hand-listed union to drift.
 *   - the server's rule selection (`select.ts`) filters these rows by the user's settings.
 *   - the server's rule implementations (`server/lint/modules.ts`) are keyed by `id` and checked
 *     against {@link CatalogId} with `Record<CatalogId, …>`, so a missing/extra impl fails to compile.
 *   - the package.json `contributes.configuration` block and its nls keys are asserted to match
 *     these rows by `test/shared/lint/config-codegen.test.ts`.
 *
 * SCOPE vs STREAM: a rule's {@link Scope} is where the USER toggles it. `common` means "applies to
 * BOTH 地の文 and 台詞" — `select.ts` fans a `common` rule out onto the narration AND dialogue
 * {@link Stream}s (the buckets the driver actually runs). `narration`/`dialogue` are prose-specific;
 * `ruby` is the 読み.
 *
 * Pure data, import-free (it must load on Node's native test loader): no `#/` specifiers, no
 * `vscode`, no textlint. Rule MODULES live server-side only — this file never references them.
 */

/** Where the user toggles a rule. `common` runs on both narration + dialogue (see `select.ts`). */
export type Scope = 'common' | 'narration' | 'dialogue' | 'ruby';

/** The prose streams the driver runs against (a `common` rule is fanned onto narration + dialogue). */
export type Stream = 'narration' | 'dialogue' | 'ruby';

/**
 * One rule's static metadata. `kind` fixes the setting shape:
 *   - `boolean`   -> `jpnov.lint.…` is a `boolean` (default `false`).
 *   - `threshold` -> `jpnov.lint.…` is `integer | null` (default `null` = off); a number is clamped
 *     to `[min, max]`. `suggested` is the recommended value shown to the user (NOT a default).
 *   - `enum`      -> `jpnov.lint.…` is a string drop-down; `values[0]` is the off/default choice.
 */
export interface RuleMeta {
  /** Unique WITHIN a scope; the tail of both the setting key and the diagnostic code. */
  readonly id: string;
  readonly scope: Scope;
  readonly kind: 'boolean' | 'threshold' | 'enum';
  /** Threshold rules only: inclusive clamp bounds + the recommended (non-default) value. */
  readonly min?: number;
  readonly max?: number;
  readonly suggested?: number;
  /** Enum rules only: the drop-down choices; `values[0]` is the off/default. */
  readonly values?: readonly string[];
}

/**
 * Every Phase-1 rule. `common` rules are global typography/structure checks meaningful in both 地の文
 * and 台詞; `narration` rules are prose-specific; the single `ruby` rule is a 3-way drop-down.
 *
 * Phase 1 is deliberately DICTIONARY-FREE: no kuromoji (morphological) rules and no prh/word-list
 * rules. 読点上限 (`maxTen`) ships as a custom kuromoji-free rule because the stock
 * `textlint-rule-max-ten` pulls kuromoji transitively.
 *
 * `as const satisfies …` keeps the literal `id`/`scope` types (so {@link LintCode} can derive the
 * exact code union) while still type-checking each row against {@link RuleMeta}.
 */
export const RULES = [
  // --- common (地の文 + 台詞): global typography / structure ------------------
  { id: 'sentenceLength', scope: 'common', kind: 'threshold', min: 1, max: 1000, suggested: 100 },
  { id: 'maxTen', scope: 'common', kind: 'threshold', min: 1, max: 20, suggested: 3 },
  { id: 'maxKanjiRun', scope: 'common', kind: 'threshold', min: 1, max: 20, suggested: 6 },
  { id: 'noEmDash', scope: 'common', kind: 'boolean' },
  { id: 'noUnmatchedPair', scope: 'common', kind: 'boolean' },
  { id: 'noHankakuKana', scope: 'common', kind: 'boolean' },
  { id: 'noNfd', scope: 'common', kind: 'boolean' },
  { id: 'noZeroWidth', scope: 'common', kind: 'boolean' },
  { id: 'noControlChar', scope: 'common', kind: 'boolean' },
  { id: 'jaNoSpaceBetweenFullWidth', scope: 'common', kind: 'boolean' },
  { id: 'jaUnnaturalAlphabet', scope: 'common', kind: 'boolean' },
  { id: 'minusPosition', scope: 'common', kind: 'boolean' },
  // --- narration (地の文) only: prose-specific -----------------------------
  { id: 'generalNovelStyle', scope: 'narration', kind: 'boolean' },
  { id: 'jaNoMixedPeriod', scope: 'narration', kind: 'boolean' },
  // --- ruby (ルビ / 読み): one drop-down ------------------------------------
  { id: 'kana', scope: 'ruby', kind: 'enum', values: ['off', 'hiragana', 'katakana'] },
] as const satisfies readonly RuleMeta[];

/** Every `id` that appears in {@link RULES} (the keys `server/lint/modules.ts` must implement). */
export type CatalogId = (typeof RULES)[number]['id'];

/**
 * One rule row -> its diagnostic code. Written as a DISTRIBUTIVE conditional (naked `R`) so that,
 * applied to the union of rows, each row's `scope`/`id` stay PAIRED — a bare
 * `` `lint.${…['scope']}.${…['id']}` `` over the union would cross-product every scope with every id.
 */
type CodeOf<R> = R extends RuleMeta ? `lint.${R['scope']}.${R['id']}` : never;

/**
 * The exact set of diagnostic codes, derived from {@link RULES}. `MsgCode` in protocol.ts includes
 * this, so the message renderers stay exhaustive over exactly these codes and a rule added to the
 * catalog forces a new render arm to be added (or compilation fails).
 */
export type LintCode = CodeOf<(typeof RULES)[number]>;

/** Setting-key prefix; the only place the `jpnov.lint.` namespace is spelled. */
const SETTING_PREFIX = 'jpnov.lint.';

/** The vscode setting key for a rule, e.g. `jpnov.lint.common.maxTen`. */
export function settingKey(rule: RuleMeta): string {
  return `${SETTING_PREFIX}${rule.scope}.${rule.id}`;
}

/** The diagnostic code for a rule, e.g. `lint.common.maxTen` (always `settingKey` minus `jpnov.`). */
export function diagCode(rule: RuleMeta): LintCode {
  return `lint.${rule.scope}.${rule.id}` as LintCode;
}

/** Every setting key, in catalog order — the client reads exactly these to snapshot the config. */
export function allSettingKeys(): string[] {
  return RULES.map(settingKey);
}
