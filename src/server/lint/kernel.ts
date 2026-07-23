/**
 * The prose-lint driver: turns a document + the active {@link RuleSelection} into {@link LintFinding}s
 * (a diagnostic plus, when the rule is auto-fixable, a source-mapped fix).
 *
 * Flow: extract the three clean streams once, then per stream run the enabled pre-scans (sync) and a
 * CHUNKED series of `TextlintKernel.lintText` passes over bounded slices of the stream text (see
 * chunking.ts — bounding each call bounds sentence-splitter's quadratic cost; the text plugin,
 * selected by the `.txt` ext, parses our already-clean text). Each chunk's message offsets are
 * rebased onto the stream, then every textlint message / pre-scan span is mapped back to a SOURCE
 * range by `mapRange` and stamped with the rule's own diagnostic code via the shared `diagnostic()`
 * factory — textlint's own message/severity are discarded so all output is uniform.
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
import { chunkRanges } from './chunking.ts';
import { unwrapDefault } from './interop.ts';
import { RULE_IMPL } from './modules.ts';
import { contiguousPieces, extractStreams, isContiguous, mapFixRange, mapRange } from './streams.ts';
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

/**
 * Thrown between chunks when the caller's `shouldCancel` reports the run is superseded (a newer
 * edit, a cancelled request). Callers match with `instanceof` and treat it as "no result", never
 * as an error — the superseding run publishes instead.
 */
export class LintCancelled extends Error {
  constructor() {
    super('lint run superseded');
    this.name = 'LintCancelled';
  }
}

/** Caller-facing knobs for one lint run. */
export interface LintRunOptions {
  /** Polled between chunks; `true` aborts the run by throwing {@link LintCancelled}. */
  readonly shouldCancel?: () => boolean;
  /** Chunk-size override — exposed for tests (seam parity / cancellation); production callers omit it. */
  readonly chunking?: { readonly target: number; readonly max: number };
}

/** One kernel for the process; `lintText` carries no state between calls. */
const kernel = new TextlintKernel();

/** The plain-text plugin, selected by the `.txt` ext — our streams are already clean text. */
const PLUGINS: NonNullable<TextlintKernelOptions['plugins']> = [
  { pluginId: 'text', plugin: unwrapDefault(textPluginModule) },
];

const WARNING = DiagnosticSeverity.Warning;

/** The whole stream as one piece — the shape a non-`perPiece` scanner is handed. */
const WHOLE = (stream: Stream): readonly { readonly text: string; readonly base: number }[] => [
  { text: stream.text, base: 0 },
];

/** Pair a diagnostic with an optional fix, omitting `fix` entirely when absent (exactOptional…). */
function finding(diag: Diagnostic, fix: LintFix | undefined): LintFinding {
  return fix !== undefined ? { diagnostic: diag, fix } : { diagnostic: diag };
}

/** Lints one stream: pre-scans synchronously; all enabled kernel rules chunk-wise (see chunking.ts). */
async function lintStream(
  stream: Stream,
  rules: readonly ActiveRule[],
  doc: TextDocument,
  opts?: LintRunOptions,
): Promise<LintFinding[]> {
  const out: LintFinding[] = [];
  let pieces: ReturnType<typeof contiguousPieces> | undefined; // only a perPiece scanner needs them
  const kernelRules: NonNullable<TextlintKernelOptions['rules']> = [];
  const codeByRuleId = new Map<string, LintCode>();
  const insertAfterByRuleId = new Map<string, string>();

  for (const rule of rules) {
    const impl = RULE_IMPL[rule.id];
    if (impl.kind === 'prescan') {
      // `perPiece` scanners see one contiguous piece at a time; the rest see the whole stream,
      // because a scanner that reads its neighbours would misjudge the character at a piece edge.
      const scanned = impl.perPiece === true ? (pieces ??= contiguousPieces(stream)) : WHOLE(stream);
      for (const piece of scanned) {
        for (const span of impl.scan(piece.text, rule.options)) {
          const start = piece.base + span.start;
          const end = piece.base + span.end;
          // The fix uses mapFixRange so an empty (insert) span stays a zero-width insert and a
          // replace covers exactly its characters — but only when those characters are contiguous
          // in SOURCE; a span reaching across elided markup would overwrite it.
          const fix =
            span.fix !== undefined && isContiguous(stream, start, end)
              ? { range: mapFixRange(stream, doc, start, end), newText: span.fix }
              : undefined;
          const message = span.message ?? { code: rule.code };
          out.push(finding(diagnostic(mapRange(stream, doc, start, end), message, WARNING), fix));
        }
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
    // The kernel pass runs per bounded chunk: sentence-splitter (sentence-length /
    // no-unmatched-pair) is quadratic in the text of ONE lintText call, so bounding the call
    // bounds the cost. The awaited gap between chunks yields the event loop (an in-flight lint
    // cannot starve other LSP traffic) and is the cancellation seam. Message offsets are
    // chunk-relative; `+ a` rebases them onto the parent stream so the ONE existing source
    // mapping (mapRange/mapFixRange over the parent srcMap) applies unchanged.
    const chunks =
      opts?.chunking !== undefined
        ? chunkRanges(stream.text, opts.chunking.target, opts.chunking.max)
        : chunkRanges(stream.text);
    let first = true;
    for (const [a, b] of chunks) {
      if (!first) {
        if (opts?.shouldCancel?.() === true) {
          throw new LintCancelled();
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
      first = false;
      const result = await kernel.lintText(stream.text.slice(a, b), { ext: '.txt', plugins: PLUGINS, rules: kernelRules });
      for (const msg of result.messages) {
        const code = codeByRuleId.get(msg.ruleId);
        if (code === undefined) {
          continue;
        }
        // `insertAfter` rules (e.g. append 。) override the rule's own fix with a zero-width INSERT at
        // the END of the message — mapFixRange keeps it before any trailing newline. Otherwise the
        // rule's own `message.fix` (a replacement) is mapped the same way.
        // A kernel rule sees the clean stream too, so `。［＃…］。` arrives as `。。`; a
        // replacement spanning that gap would delete the markup, so it is dropped.
        const insertAfter = insertAfterByRuleId.get(msg.ruleId);
        let fix: LintFix | undefined;
        if (insertAfter !== undefined) {
          fix = { range: mapFixRange(stream, doc, a + msg.range[1], a + msg.range[1]), newText: insertAfter };
        } else if (msg.fix !== undefined && isContiguous(stream, a + msg.fix.range[0], a + msg.fix.range[1])) {
          fix = { range: mapFixRange(stream, doc, a + msg.fix.range[0], a + msg.fix.range[1]), newText: msg.fix.text };
        }
        out.push(finding(diagnostic(mapRange(stream, doc, a + msg.range[0], a + msg.range[1]), { code }, WARNING), fix));
      }
    }
  }
  return out;
}

/**
 * Computes prose-lint findings for `text` under `selection`. Returns `[]` SYNCHRONOUSLY when no rule
 * is enabled (the all-off default costs nothing — no extraction, no kernel); otherwise a Promise
 * resolving once the ≤3 chunked kernel passes finish — or rejecting with {@link LintCancelled} when
 * `opts.shouldCancel` reports the run superseded between chunks.
 */
export function computeLintFindings(
  text: string,
  selection: RuleSelection,
  doc: TextDocument,
  opts?: LintRunOptions,
): LintFinding[] | Promise<LintFinding[]> {
  if (isSelectionEmpty(selection)) {
    return [];
  }
  const streams = extractStreams(text);
  return (async () => {
    // Promise.all subscribes to every stream's promise, so a LintCancelled from one stream
    // rejects the whole run while the siblings' own (identical) rejections stay handled.
    const groups = await Promise.all([
      lintStream(streams.narration, selection.narration, doc, opts),
      lintStream(streams.dialogue, selection.dialogue, doc, opts),
      lintStream(streams.ruby, selection.ruby, doc, opts),
    ]);
    return groups.flat();
  })();
}
