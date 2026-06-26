/**
 * The prose-lint driver: turns a document + the active {@link RuleSelection} into {@link LintFinding}s
 * (a diagnostic plus, when the rule is auto-fixable, a source-mapped fix).
 *
 * Flow: extract the three clean streams once, then per stream run the enabled pre-scans (sync) and a
 * SINGLE `TextlintKernel.lintText` pass over the joined stream text (the text plugin, selected by the
 * `.txt` ext, parses our already-clean text). Every textlint message / pre-scan span is mapped back
 * to a SOURCE range by `mapRange` and stamped with the rule's own diagnostic code via the shared
 * `diagnostic()` factory — textlint's own message/severity are discarded so all output is uniform.
 *
 * Fixes ride along: `lintText` already attaches `message.fix` ({stream-range, text}) for fixable rules
 * (no-hankaku-kana, no-nfd, no-zero-width, no-invalid-control-character), and a pre-scan may carry its
 * own (`span.fix`); each fix range is mapped to source the SAME way (the replacement text is a
 * context-free character substitution, so it applies verbatim). We never `fixText`+reassemble — the
 * streams are lossy (collapsed dialogue, stripped ruby), so fixes must map back individually.
 *
 * Relative imports only (native test loader). The vscode-free invariant holds: nothing here imports
 * `vscode`; `selection` arrives as plain data from `select.ts`.
 */
import { TextlintKernel } from '@textlint/kernel';
import type { TextlintKernelOptions } from '@textlint/kernel';
// Plain-text plugin: `module.exports = { default: { Processor } }` (no __esModule), so the real
// plugin sits at `.default` — normalized via the same interop shim the rules use.
import textPluginModule from '@textlint/textlint-plugin-text';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic, Range } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { LintCode } from '../../shared/lint/catalog.ts';
import { isSelectionEmpty } from '../../shared/lint/select.ts';
import type { ActiveRule, RuleSelection } from '../../shared/lint/select.ts';

import { diagnostic } from '../diagnostics.ts';
import { unwrapDefault } from './interop.ts';
import { RULE_IMPL } from './modules.ts';
import { extractStreams, mapFixRange, mapRange } from './streams.ts';
import type { Stream } from './streams.ts';

/** A single auto-fix edit, already mapped to SOURCE coordinates. */
export interface LintFix {
  readonly range: Range;
  readonly newText: string;
}

/** One lint result: the diagnostic to publish, plus its fix when the rule is auto-fixable. */
export interface LintFinding {
  readonly diagnostic: Diagnostic;
  readonly fix?: LintFix;
}

/** One kernel for the process; `lintText` carries no state between calls. */
const kernel = new TextlintKernel();

/** The plain-text plugin, selected by the `.txt` ext — our streams are already clean text. */
const PLUGINS: NonNullable<TextlintKernelOptions['plugins']> = [
  { pluginId: 'text', plugin: unwrapDefault(textPluginModule) },
];

const WARNING = DiagnosticSeverity.Warning;

/** Pair a diagnostic with an optional fix, omitting `fix` entirely when absent (exactOptional…). */
function finding(diag: Diagnostic, fix: LintFix | undefined): LintFinding {
  return fix !== undefined ? { diagnostic: diag, fix } : { diagnostic: diag };
}

/** Lints one stream: pre-scans synchronously; all enabled kernel rules in a single `lintText` pass. */
async function lintStream(
  stream: Stream,
  rules: readonly ActiveRule[],
  doc: TextDocument,
): Promise<LintFinding[]> {
  const out: LintFinding[] = [];
  const kernelRules: NonNullable<TextlintKernelOptions['rules']> = [];
  const codeByRuleId = new Map<string, LintCode>();
  const insertAfterByRuleId = new Map<string, string>();

  for (const rule of rules) {
    const impl = RULE_IMPL[rule.id];
    if (impl.kind === 'prescan') {
      for (const span of impl.scan(stream.text, rule.options)) {
        // Diagnostic squiggle covers the span; the fix uses mapFixRange so an empty (insert) span
        // stays a zero-width insert and a replace covers exactly its characters.
        const fix =
          span.fix !== undefined
            ? { range: mapFixRange(stream, doc, span.start, span.end), newText: span.fix }
            : undefined;
        out.push(finding(diagnostic(mapRange(stream, doc, span.start, span.end), { code: rule.code }, WARNING), fix));
      }
    } else {
      // kernel rule: register under the catalog id so message.ruleId round-trips to the rule's code.
      // Boolean rules pass their fixed options (if any) or `true`; threshold rules pass `{ max }`.
      codeByRuleId.set(rule.id, rule.code);
      if (impl.insertAfter !== undefined) {
        insertAfterByRuleId.set(rule.id, impl.insertAfter);
      }
      const options = rule.options === true ? (impl.options ?? true) : rule.options;
      kernelRules.push({ ruleId: rule.id, rule: impl.rule, options });
    }
  }

  if (kernelRules.length > 0 && stream.text !== '') {
    const result = await kernel.lintText(stream.text, { ext: '.txt', plugins: PLUGINS, rules: kernelRules });
    for (const msg of result.messages) {
      const code = codeByRuleId.get(msg.ruleId);
      if (code === undefined) {
        continue;
      }
      // `insertAfter` rules (e.g. append 。) override the rule's own fix with a zero-width INSERT at
      // the END of the message — mapFixRange keeps it before any trailing newline. Otherwise the
      // rule's own `message.fix` (a replacement) is mapped the same way.
      const insertAfter = insertAfterByRuleId.get(msg.ruleId);
      let fix: LintFix | undefined;
      if (insertAfter !== undefined) {
        fix = { range: mapFixRange(stream, doc, msg.range[1], msg.range[1]), newText: insertAfter };
      } else if (msg.fix !== undefined) {
        fix = { range: mapFixRange(stream, doc, msg.fix.range[0], msg.fix.range[1]), newText: msg.fix.text };
      }
      out.push(finding(diagnostic(mapRange(stream, doc, msg.range[0], msg.range[1]), { code }, WARNING), fix));
    }
  }
  return out;
}

/**
 * Computes prose-lint findings for `text` under `selection`. Returns `[]` SYNCHRONOUSLY when no rule
 * is enabled (the all-off default costs nothing — no extraction, no kernel); otherwise a Promise
 * resolving once the ≤3 kernel passes finish.
 */
export function computeLintFindings(
  text: string,
  selection: RuleSelection,
  doc: TextDocument,
): LintFinding[] | Promise<LintFinding[]> {
  if (isSelectionEmpty(selection)) {
    return [];
  }
  const streams = extractStreams(text);
  return (async () => {
    const groups = await Promise.all([
      lintStream(streams.narration, selection.narration, doc),
      lintStream(streams.dialogue, selection.dialogue, doc),
      lintStream(streams.ruby, selection.ruby, doc),
    ]);
    return groups.flat();
  })();
}
