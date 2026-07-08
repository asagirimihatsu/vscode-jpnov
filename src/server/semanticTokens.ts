/**
 * Unified highlighter: ONE layered pipeline produces a single semantic-token stream that colours
 * BOTH Aozora markup and the author's narration (cast names + coined keywords), so colouring lives
 * in one place and the syntax is parsed only once.
 *
 *   Layer 1  tokenize(src)          -> structural tokens (text / ruby / annotation / emphasis)
 *   Layer 2  recognizer.recognize() -> cast/keyword spans over the reconstructed body-text runs
 *   merge    -> one ordered SemanticTokens stream
 *
 * A ruby BASE is real body text, so it FLOWS into the recognized run together with the surrounding
 * text — only the ｜《》 markers and the 読み reading are "holes" skipped from recognition. This keeps
 * okurigana-split ruby (立《た》ち) correct: the run is "立ち" and a recognised span around the 《た》 hole
 * is emitted across its two source pieces. A run is flushed at a newline or an annotation (［＃…］),
 * so recognition stays roughly line-sized. Markup needs no config (emitted with or without the
 * recognizer); cast/keyword colours are added once a recognizer is configured.
 *
 * Dialogue 「」『』 is tracked by a STACK as body text is appended (NOT by scanning the raw source:
 * ［＃「対象」に傍点］ reuses 「」 as an emphasis-target delimiter, which a raw scan would miscount and let
 * an inner 』 wrongly flip the rest of a quote back to narration). The delimiters are coloured as
 * markers; their content is masked so the recognizer never colours inside dialogue. The stack lives
 * at document scope and persists across line flushes — Aozora dialogue may span lines.
 *
 * Coloring is driven by ONE table ({@link HIGHLIGHTS}); the DISTINCT lsp values form the legend and
 * the protocol indices derive from it. Call sites use the semantic kind ('marker', 'character', …);
 * the kind->lsp->index step (forced by the LSP legend being an index array) lives only in
 * {@link tokenTypeIndex}.
 */
import type { SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver/node';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

// Relative (not `#/shared/...`) on purpose: this is a runtime value import, and `npm test` runs
// semanticTokens.test.ts on Node's native loader, which rejects `#/`-prefixed specifiers. A
// relative path keeps the test in the default suite. See test/server/highlight/semanticTokens.test.ts.
import { tokenize } from '../shared/compiler/tokenizer.ts';

import type { Recognizer } from './highlight/recognizer.ts';

/**
 * Single source of truth. Each row = one highlight kind and the LSP token type a theme colours it
 * as. Several kinds may share one lsp (e.g. direction reads as plain body text); the legend is the
 * DISTINCT lsp set and kind→index maps through it, so those kinds collapse onto one colour by design.
 * Add a row to introduce a new highlight — nothing else changes. Most lsp values are standard LSP
 * types a theme already colours. `'plain'` is intentionally not a real
 * type and is left uncontributed, so it renders as the default foreground.
 *
 * The recognizer's span kinds ('character' / 'keyword') ARE rows here, so its output flows in with no
 * remapping; removing either row would make that assignment fail to type-check.
 */
const HIGHLIGHTS = [
  { kind: 'marker', lsp: 'comment' }, // ｜ 《 》 ［＃ ］ + ここから・ここで・終わり scaffolding + 「」『』 dialogue delimiters (greyed)
  { kind: 'directive', lsp: 'keyword' }, // style variant names / 改ページ / ○字下げ (command word only; ここから・ここで・終わり demote to marker)
  { kind: 'direction', lsp: 'comment' }, // の?左に
  { kind: 'character', lsp: 'variable' }, // a cast member recognised as a narration subject (prominent)
  { kind: 'keyword', lsp: 'operator' }, // a coined keyword — bold, default colour
] as const;

export type TokenType = (typeof HIGHLIGHTS)[number]['kind'];

/** Distinct LSP token types, first-seen order — the legend the client receives. */
const LSP_TYPES = [...new Set(HIGHLIGHTS.map((h) => h.lsp))];

export const SEMANTIC_LEGEND: SemanticTokensLegend = {
  tokenTypes: LSP_TYPES,
  tokenModifiers: [],
};

/** Highlight kind -> its index in the deduped legend, via its lsp (many kinds may share one). */
const TYPE_INDEX = new Map<TokenType, number>(
  HIGHLIGHTS.map((h) => [h.kind, LSP_TYPES.indexOf(h.lsp)]),
);

/**
 * The legend index for a highlight kind. Multiple kinds may share an index (kinds mapping to the
 * same lsp are coloured identically); reference a kind by name through this — never a hard-coded
 * number — so reordering or adding {@link HIGHLIGHTS} rows cannot silently break them.
 */
export function tokenTypeIndex(kind: TokenType): number {
  return TYPE_INDEX.get(kind) ?? -1;
}

const ANNOT_OPEN = 2; // ［＃
const ONE = 1; // any single full-width marker: ｜ 《 》 「 」 『 』 ］

/** Opening dialogue corner brackets mapped to the closer that pops them. */
const DIALOGUE_CLOSER = new Map<string, string>([
  ['「', '」'],
  ['『', '』'],
]);

interface Span {
  readonly start: number; // source UTF-16 offset
  readonly len: number;
  readonly type: TokenType;
}

/** Length (UTF-16 units) of a leading の左に / 左に direction prefix, else 0. */
function directionLen(variant: string): number {
  if (variant.startsWith('の左に')) {
    return 'の左に'.length;
  }
  if (variant.startsWith('左に')) {
    return '左に'.length;
  }
  return 0;
}

export function buildSemanticTokens(
  document: TextDocument,
  recognizer: Recognizer | undefined,
): SemanticTokens {
  const src = document.getText();
  const spans: Span[] = [];

  // The body-text run being accumulated: its text, the source offset each UTF-16 unit came from (text
  // and ruby bases are contiguous in the run but jump over markers/readings in source), and whether
  // each unit sits inside dialogue (so the recognizer never colours dialogue content).
  let runText = '';
  let runSrc: number[] = [];
  let runMask: boolean[] = [];

  // Dialogue nesting, by expected closer. Document-scoped so it persists across run flushes (a 「…」
  // may span lines); driven ONLY from body text in appendBody (never from raw src — see file header).
  const dialogue: string[] = [];

  const mark = (start: number, len: number, type: TokenType): void => {
    if (len > 0) {
      spans.push({ start, len, type });
    }
  };

  const flushRun = (): void => {
    if (recognizer !== undefined && runText !== '') {
      for (const sp of recognizer.recognize(runText)) {
        if (runMask[sp.start] === true) {
          continue; // inside dialogue — body text keeps its default colour
        }
        // Split the span into runs that are contiguous in the SOURCE (a hole appears where a ruby
        // reading/markers sat between a base and its okurigana).
        let i = sp.start;
        const end = sp.start + sp.len;
        while (i < end) {
          const segStart = runSrc[i] ?? 0;
          let j = i + 1;
          while (j < end && (runSrc[j] ?? -1) === (runSrc[j - 1] ?? -2) + 1) {
            j++;
          }
          spans.push({ start: segStart, len: (runSrc[j - 1] ?? segStart) - segStart + 1, type: sp.kind });
          i = j;
        }
      }
    }
    runText = '';
    runSrc = [];
    runMask = [];
  };

  /** Append body text [srcStart, …) to the current run, tracking dialogue and flushing at line breaks. */
  const appendBody = (text: string, srcStart: number): void => {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === '\n' || ch === '\r') {
        flushRun();
        continue; // the line break itself is not body
      }
      const at = srcStart + i;
      const closer = DIALOGUE_CLOSER.get(ch);
      if (closer !== undefined) {
        dialogue.push(closer);
        mark(at, ONE, 'marker'); // opening 「 / 『
      } else if (ch === dialogue[dialogue.length - 1]) {
        dialogue.pop();
        mark(at, ONE, 'marker'); // matching closing 」 / 』 (a lone/mismatched closer stays default text)
      }
      runText += ch;
      runSrc.push(at);
      runMask.push(dialogue.length > 0);
    }
  };

  let offset = 0; // UTF-16 offset of the current token's `raw` in `src`
  for (const token of tokenize(src)) {
    const raw = token.raw.length;
    const last = offset + raw - ONE; // position of the closing ］ / 》

    // Whole inner = one directive: 改ページ and the line-head single-line ［＃○字下げ］ — a lone
    // command word with no ここから/ここで/終わり scaffolding to demote.
    const markDirective = (): void => {
      flushRun();
      mark(offset, ANNOT_OPEN, 'marker'); // ［＃
      mark(offset + ANNOT_OPEN, raw - ANNOT_OPEN - ONE, 'directive'); // inner, whole
      mark(last, ONE, 'marker'); // ］
    };

    switch (token.kind) {
      case 'text': {
        appendBody(token.text, offset);
        break;
      }
      case 'rubyExplicit': {
        mark(offset, ONE, 'marker'); // ｜
        appendBody(token.base, offset + ONE); // 親文字 base flows into the recognized run
        mark(offset + ONE + token.base.length, ONE + token.reading.length, 'marker'); // 《ルビ
        mark(last, ONE, 'marker'); // 》 ( reading kept default, not recognized )
        break;
      }
      case 'rubyImplicit': {
        appendBody(token.base, offset); // base flows into the recognized run
        mark(offset + token.base.length, ONE + token.reading.length, 'marker'); // 《ルビ
        mark(last, ONE, 'marker'); // 》
        break;
      }
      case 'pageBreak': {
        markDirective(); // 改ページ
        break;
      }
      case 'indent': {
        markDirective(); // ［＃○字下げ］ (the tokenizer emits this kind only at a line head)
        break;
      }
      case 'indentBlockStart': {
        flushRun();
        mark(offset, ANNOT_OPEN, 'marker'); // ［＃
        const ds = offset + ANNOT_OPEN;
        const from = 'ここから'.length;
        mark(ds, from, 'marker'); // ここから (demoted to comment-level, like the postfix connector)
        mark(ds + from, raw - ANNOT_OPEN - from - ONE, 'directive'); // ○字下げ (digits + 字下げ; length from raw, never amount)
        mark(last, ONE, 'marker'); // ］
        break;
      }
      case 'indentBlockEnd': {
        flushRun();
        mark(offset, ANNOT_OPEN, 'marker'); // ［＃
        const ds = offset + ANNOT_OPEN;
        const to = 'ここで'.length;
        mark(ds, to, 'marker'); // ここで (demoted)
        mark(ds + to, '字下げ'.length, 'directive'); // 字下げ
        mark(ds + to + '字下げ'.length, '終わり'.length, 'marker'); // 終わり (demoted)
        mark(last, ONE, 'marker'); // ］
        break;
      }
      case 'emphasisSpanStart': {
        flushRun();
        mark(offset, ANNOT_OPEN, 'marker'); // ［＃
        const ds = offset + ANNOT_OPEN;
        if (token.block === true) {
          const from = 'ここから'.length;
          mark(ds, from, 'marker'); // ここから (demoted to comment-level)
          mark(ds + from, token.variant.length, 'directive'); // 太字/斜体
          mark(last, ONE, 'marker'); // ］
          break;
        }
        const dir = directionLen(token.variant);
        mark(ds, dir, 'direction'); // の?左に
        mark(ds + dir, token.variant.length - dir, 'directive'); // variant name
        mark(last, ONE, 'marker'); // ］
        break;
      }
      case 'emphasisSpanEnd': {
        flushRun();
        mark(offset, ANNOT_OPEN, 'marker'); // ［＃
        const ds = offset + ANNOT_OPEN;
        if (token.block === true) {
          const to = 'ここで'.length;
          mark(ds, to, 'marker'); // ここで (demoted)
          mark(ds + to, token.variant.length, 'directive'); // 太字/斜体
          mark(ds + to + token.variant.length, '終わり'.length, 'marker'); // 終わり (demoted)
          mark(last, ONE, 'marker'); // ］
          break;
        }
        const dir = directionLen(token.variant);
        mark(ds, dir, 'direction'); // の?左に
        mark(ds + dir, token.variant.length - dir, 'directive'); // variant name
        mark(ds + token.variant.length, raw - ANNOT_OPEN - token.variant.length - ONE, 'marker'); // 終わり (demoted)
        mark(last, ONE, 'marker'); // ］
        break;
      }
      case 'emphasisPostfix': {
        flushRun();
        mark(offset, ANNOT_OPEN, 'marker'); // ［＃
        const openCorner = offset + ANNOT_OPEN;
        mark(openCorner, ONE, 'marker'); // 「 (annotation-internal — never touches the dialogue stack)
        const closeCorner = openCorner + ONE + token.target.length; // ( 対象 kept default )
        mark(closeCorner, ONE, 'marker'); // 」
        const afterCorner = closeCorner + ONE;
        const conn = raw - (afterCorner - offset) - token.variant.length - ONE; // に / は (0 or 1)
        mark(afterCorner, conn, 'marker');
        const vs = afterCorner + conn;
        const dir = directionLen(token.variant);
        mark(vs, dir, 'direction'); // の?左に
        mark(vs + dir, token.variant.length - dir, 'directive'); // variant name
        mark(last, ONE, 'marker'); // ］
        break;
      }
      case 'comment': {
        flushRun();
        mark(offset, raw, 'marker'); // whole ［＃ … ］ greyed
        break;
      }
      case 'brokenAnnotation': {
        flushRun();
        // Unclosed ［＃… greyed to its line end — the same span the Error diagnostic covers. The
        // raw never enters appendBody, so a swallowed 「 cannot corrupt the dialogue stack; it
        // never contains a line break, so this emits as a single-line token.
        mark(offset, raw, 'marker');
        break;
      }
      default: {
        const exhaustive: never = token;
        throw new Error(`buildSemanticTokens: unhandled token ${JSON.stringify(exhaustive)}`);
      }
    }
    offset += raw;
  }
  flushRun(); // trailing run

  // Emit in source order (markup + recognized spans interleave), splitting any span at line breaks.
  spans.sort((a, b) => a.start - b.start);
  const builder = new SemanticTokensBuilder();
  for (const span of spans) {
    const index = tokenTypeIndex(span.type);
    let s = span.start;
    const end = span.start + span.len;
    while (s < end) {
      let nl = src.indexOf('\n', s);
      if (nl === -1 || nl > end) {
        nl = end;
      }
      if (nl > s) {
        const p = document.positionAt(s);
        builder.push(p.line, p.character, nl - s, index, 0);
      }
      s = nl + 1;
    }
  }
  return builder.build();
}
