/**
 * Resolves the user's raw lint settings into the enabled-only {@link RuleSelection} the server acts
 * on. This is the ONE place enablement, threshold clamping, option normalization, and code
 * derivation happen — `server/lint/kernel.ts` only reads the result (it re-filters nothing).
 *
 * Pure + import-light: it consumes the {@link RULES} catalog and the wire config type, references NO
 * rule modules and NO `vscode`/textlint, so it is safe to import from the vscode-free server (and to
 * run on Node's native test loader). The rule MODULE join happens later, keyed by {@link ActiveRule.id}.
 */
import type { RawLintConfigWire } from '../protocol.ts';

import { RULES, diagCode, settingKey } from './catalog.ts';
import type { CatalogId, LintCode, Stream } from './catalog.ts';

/** The flat, IPC-safe settings snapshot the client ships (setting key -> primitive). */
export type RawLintConfig = RawLintConfigWire;

/**
 * One enabled rule, ready for the driver. `options` is normalized: booleans -> `true`; thresholds
 * -> `{ max }` (already clamped); enums -> `{ mode }` (the chosen non-off value). Every threshold
 * rule reads `options.max` directly (`sentence-length` / `max-kanji-continuous-len` and the custom
 * `maxTen` all do), so no per-rule option-key adapter is needed in `server/lint/modules.ts`.
 */
export interface ActiveRule {
  /** Catalog id; the key into `RULE_IMPL`. */
  readonly id: CatalogId;
  /** Normalized options: `true` (boolean), `{ max }` (threshold), or `{ mode }` (enum). */
  readonly options: true | { readonly max: number } | { readonly mode: string };
  /** The diagnostic code stamped on every message this rule produces. */
  readonly code: LintCode;
}

/** Enabled rules grouped by the stream they run on. */
export type RuleSelection = Readonly<Record<Stream, readonly ActiveRule[]>>;

/** Clamp `n` (rounded to an integer) into `[min, max]`. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Filters {@link RULES} to the rules the user has enabled in `raw`, producing one {@link ActiveRule}
 * per enabled row grouped by stream. A boolean rule is enabled iff its key is exactly `true`; a
 * threshold rule is enabled iff its key is a finite number (then clamped to the rule's bounds).
 * Absent / `null` / wrong-typed values leave a rule OFF — every rule ships off by default.
 */
export function selectRules(raw: RawLintConfig): RuleSelection {
  const narration: ActiveRule[] = [];
  const dialogue: ActiveRule[] = [];
  const ruby: ActiveRule[] = [];
  const bucket: Record<Stream, ActiveRule[]> = { narration, dialogue, ruby };

  for (const rule of RULES) {
    const value = raw[settingKey(rule)];
    let options: ActiveRule['options'] | undefined;
    if (rule.kind === 'boolean') {
      if (value === true) {
        options = true;
      }
    } else if (rule.kind === 'threshold') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        // A threshold rule always carries min/max in the catalog (enforced by `as const satisfies`).
        options = { max: clamp(value, rule.min, rule.max) };
      }
    } else {
      // enum: enabled when the value is a non-off member of the rule's choices.
      const values: readonly string[] = rule.values;
      if (typeof value === 'string' && value !== values[0] && values.includes(value)) {
        options = { mode: value };
      }
    }
    if (options === undefined) {
      continue;
    }
    const active: ActiveRule = { id: rule.id, options, code: diagCode(rule) };
    // `common` rules run on BOTH narration and dialogue; the rest run on their own stream.
    if (rule.scope === 'common') {
      narration.push(active);
      dialogue.push(active);
    } else {
      bucket[rule.scope].push(active);
    }
  }

  return { narration, dialogue, ruby };
}

/** True when no rule is enabled — the server's fast path skips stream extraction entirely. */
export function isSelectionEmpty(selection: RuleSelection): boolean {
  return (
    selection.narration.length === 0 &&
    selection.dialogue.length === 0 &&
    selection.ruby.length === 0
  );
}
