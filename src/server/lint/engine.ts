/**
 * The prose-lint driver: turns a document + the active {@link RuleSelection} into
 * {@link LintFinding}s (a diagnostic plus, when the rule is auto-fixable, a source-mapped fix).
 *
 * ONE synchronous pass: instantiate every enabled `line` rule, feed each {@link LintLine} from the
 * single-walk {@link walkLines} to every instance, flush with `end()`, then run the `raw` rules
 * over the source. Everything here is O(n) in the document — the walker is one pass over the
 * parsed manuscript and no rule does super-linear work per line (the invariant that lets this
 * stay synchronous; the per-line loop is the natural seam should a yield ever need to come back).
 *
 * Fix materialization is the only place a {@link FixSpec} becomes an LSP range. A `replace` names
 * one SLICE (contiguous source by construction, so a fix can never overwrite elided markup). An
 * insert names a prose UNIT and a side (zero-width; the offset is resolved through the piece's
 * outer extents, past a ruby's reading or a closing annotation, and never eats a newline). An
 * `erase` covers whole blank lines and is checked to hold nothing but line terminators.
 * Out-of-slice arithmetic, an insert on a synthetic unit, or an erase over content is a
 * programming error and throws.
 *
 * A `raw` rule can restate a prose rule's finding over the same characters (an unencodable
 * character that is ALSO decomposed, invisible, …). The prose rule is the more specific one and
 * often carries a fix, so it keeps that range — same-range raw findings are dropped.
 *
 * Relative imports only (native test loader). The vscode-free invariant holds: nothing here
 * imports `vscode`; `selection` arrives as plain data from `select.ts`.
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { Ast, Span } from '../../shared/ast/nodes.ts';
import { isSelectionEmpty } from '../../shared/lint/select.ts';
import type { ActiveRule, RuleSelection } from '../../shared/lint/select.ts';
import type { LocalizableMessage } from '../../shared/protocol.ts';

import { diagnostic } from '../diagnostics.ts';
import { TargetIndex, rangeKey, rangeOf } from '../targets.ts';
import type { SyncedEdit } from '../targets.ts';
import { RULE_IMPL } from './modules.ts';
import type { PreScan } from './prescan.ts';
import type { FixSpec, LineRule, ProseUnit } from './types.ts';
import { walkLines } from './walker.ts';

/**
 * A single auto-fix edit, already mapped to SOURCE coordinates. `within` names every 対象文字列
 * the edit lands inside, with the edit as it falls there: applied together (codeActions.ts), the
 * annotation keeps naming the text it names.
 */
export type LintFix = SyncedEdit;

/** One lint result: the diagnostic to publish, plus its fix when the rule is auto-fixable. */
export interface LintFinding {
  readonly diagnostic: Diagnostic;
  readonly fix?: LintFix;
}

const WARNING = DiagnosticSeverity.Warning;

/** Pair a diagnostic with an optional fix, omitting `fix` entirely when absent (exactOptional…). */
function finding(diag: Diagnostic, fix: LintFix | undefined): LintFinding {
  return fix !== undefined ? { diagnostic: diag, fix } : { diagnostic: diag };
}

/** The source offset an insert anchored on `unit` resolves to: inside a piece the neighbour is
 *  source-adjacent; at an edge the piece's outer extent skips the markup wrapping it. */
function insertOffset(unit: ProseUnit, side: 'before' | 'after'): number {
  const piece = unit.piece;
  if (piece === null) {
    throw new Error(`lint fix anchors an insert on a synthetic unit at ${String(unit.src)}`);
  }
  if (side === 'before') {
    return unit.indexInPiece > 0 ? unit.src : piece.outerStart;
  }
  return unit.indexInPiece + 1 < piece.text.length ? unit.src + 1 : piece.outerEnd;
}

/** The source span a {@link FixSpec} edits and the text it writes there (see the module header
 *  for why the three shapes are the only safe ones). */
function fixSpan(spec: FixSpec, doc: TextDocument): { span: Span; text: string } {
  if ('insert' in spec) {
    const at = insertOffset(spec.insert, spec.side);
    return { span: { start: at, end: at }, text: spec.text };
  }
  if ('erase' in spec) {
    if (!/^[\r\n]*$/.test(doc.getText(rangeOf(doc, spec.erase)))) {
      throw new Error(`lint fix erases content: [${String(spec.erase.start)}, ${String(spec.erase.end)})`);
    }
    return { span: spec.erase, text: '' };
  }
  const { slice, start, end } = spec.replace;
  if (start < 0 || end < start || end > slice.text.length) {
    throw new Error(`lint fix out of slice bounds: [${String(start)}, ${String(end)})`);
  }
  return { span: { start: slice.srcStart + start, end: slice.srcStart + end }, text: spec.text };
}

/** Materializes a {@link FixSpec} into source coordinates, with the 対象文字列 it lands inside. */
function materializeFix(spec: FixSpec, doc: TextDocument, targets: TargetIndex): LintFix {
  const { span, text } = fixSpan(spec, doc);
  const range = rangeOf(doc, span);
  return { range, newText: text, within: targets.within(doc, range.start.line, span, text) };
}

/**
 * Computes the prose-lint findings of `doc` under `selection` — synchronously; the all-off
 * default costs nothing (no walk, no scans). `ast` is the editor's parse of its text.
 */
export function computeLintFindings(doc: TextDocument, ast: Ast, selection: RuleSelection): LintFinding[] {
  if (isSelectionEmpty(selection)) {
    return [];
  }
  const text = doc.getText();
  const targets = new TargetIndex(ast, text);
  const prose: LintFinding[] = [];
  const instances: LineRule[] = [];
  const rawRules: { readonly rule: ActiveRule; readonly scan: PreScan }[] = [];
  for (const rule of selection) {
    const impl = RULE_IMPL[rule.id];
    if (impl.kind === 'raw') {
      rawRules.push({ rule, scan: impl.scan });
      continue;
    }
    instances.push(
      impl.create({
        options: rule.options,
        ast,
        report(span: Span, extra?: { message?: LocalizableMessage; fix?: FixSpec }): void {
          const range = rangeOf(doc, span);
          const message = extra?.message ?? { code: rule.code };
          const fix = extra?.fix === undefined ? undefined : materializeFix(extra.fix, doc, targets);
          prose.push(finding(diagnostic(range, message, WARNING), fix));
        },
      }),
    );
  }

  if (instances.length > 0) {
    for (const line of walkLines(ast)) {
      for (const instance of instances) {
        instance.line(line);
      }
    }
    for (const instance of instances) {
      instance.end?.();
    }
  }

  const taken = new Set(prose.map((f) => rangeKey(f.diagnostic.range)));
  const raw: LintFinding[] = [];
  for (const { rule, scan } of rawRules) {
    for (const span of scan(text, rule.options)) {
      const range = rangeOf(doc, span);
      if (taken.has(rangeKey(range))) {
        continue;
      }
      raw.push(finding(diagnostic(range, span.message ?? { code: rule.code }, WARNING), undefined));
    }
  }
  return [...raw, ...prose];
}
