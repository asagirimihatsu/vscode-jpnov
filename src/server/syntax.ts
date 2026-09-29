/**
 * The always-on syntax diagnostics of an open .jpnov buffer: the AST's structural findings, plus
 * the one judgement made here — a 縦中横 cell holding too much. They publish under every lint
 * configuration and stay out of the lint findings cache: there is no quick fix to offer.
 *
 * An unclosed ［＃ is an Error, like an unterminated string literal; everything else is a Warning,
 * the markup being well-formed and the render lenient about it.
 *
 * Relative imports only (native test loader; see test/server/lint/syntaxDiagnostics.test.ts).
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { Ast, Issue, Span } from '../shared/ast/nodes.ts';
import { bySource } from '../shared/ast/span.ts';
import { composeKana } from '../shared/chars.ts';
import type { LocalizableMessage } from '../shared/protocol.ts';

import { diagnostic } from './diagnostics.ts';

/** Combined cells squish visibly beyond this many code points (measured in headless Chrome). */
const TCY_MAX = 3;

interface Finding {
  readonly span: Span;
  readonly message: LocalizableMessage;
}

function tooLong(text: string): boolean {
  return Array.from(text).length > TCY_MAX;
}

function messageOf(issue: Issue): LocalizableMessage {
  switch (issue.kind) {
    case 'unclosedAnnotation':
      return { code: 'syntax.unclosedAnnotation' };
    case 'unterminatedSpan':
      return { code: issue.block ? 'syntax.unterminatedBlock' : 'syntax.unterminatedSpan' };
    case 'danglingSpanEnd':
      return { code: issue.block ? 'syntax.danglingBlockEnd' : 'syntax.danglingSpanEnd' };
    case 'unterminatedTcy':
      return { code: 'syntax.unterminatedTcy' };
    case 'danglingTcyEnd':
      return { code: 'syntax.danglingTcyEnd' };
    case 'postfixTargetMissing':
      return { code: 'syntax.postfixTargetMissing', args: [issue.target] };
    case 'rubyBaseMissing':
      return { code: 'syntax.rubyBaseMissing', args: [issue.reading] };
    case 'rubyReadingEmpty':
      return { code: 'syntax.rubyReadingEmpty' };
  }
}

/**
 * Every 縦中横 holding more than {@link TCY_MAX} characters: a span over what it holds, a
 * postfix over its target, bound or not.
 */
function tcyTooLong(ast: Ast): Finding[] {
  const message: LocalizableMessage = { code: 'syntax.tcyTooLong' };
  const out: Finding[] = [];
  for (const line of ast.lines) {
    for (const node of line.syntax) {
      const held = node.kind === 'tcySpanStart' ? ast.held.get(node) : undefined;
      if (held !== undefined && tooLong(held.text)) {
        out.push({ span: held.span, message });
      } else if (node.kind === 'tcyPostfix' && tooLong(composeKana(node.target.text))) {
        out.push({ span: node.target.span, message });
      }
    }
  }
  return out;
}

/** The syntax diagnostics of `doc`, in source order; `ast` is the parse of its text. */
export function annotationDiagnostics(doc: TextDocument, ast: Ast): Diagnostic[] {
  const findings: Finding[] = [
    ...ast.issues.map((issue) => ({ span: issue.span, message: messageOf(issue) })),
    ...tcyTooLong(ast),
  ];
  return findings
    .sort(bySource)
    .map(({ span, message }) =>
      diagnostic(
        { start: doc.positionAt(span.start), end: doc.positionAt(span.end) },
        message,
        message.code === 'syntax.unclosedAnnotation' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      ),
    );
}
