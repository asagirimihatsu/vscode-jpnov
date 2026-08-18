/**
 * Shared types of the native lint engine — the LEAF of the lint module graph (walker, rules,
 * modules and the engine all import from here; this file imports nothing but types), so rules and
 * the walker can never form a cycle.
 *
 * The shape of a document, as rules see it: one {@link LintLine} per SOURCE line (never merged —
 * a multi-line utterance stays one line per line). A line carries pieces + context flags + three
 * lazy prose VIEWS:
 *   - `prose()`     every prose character, in order — markup elided but ADJACENCY kept, so a rule
 *                   reading neighbours sees `聴覚視覚［＃太字］区分装置` as one 8-kanji run.
 *   - `narration()` depth-0 prose with each top-level utterance interior collapsed to one 〇
 *                   sentinel unit (`piece: null` — reported on, never fixed).
 *   - `dialogue()`  utterance interiors only, one '\n' separator unit between utterances.
 *
 * FIX SAFETY (a silent-data-loss class of bug — a fix once deleted the markup between two clean
 * characters): a replacement {@link FixSpec} can only name ONE {@link Piece}, and a piece is by
 * construction a contiguous source slice, so a replacement spanning elided markup is impossible to
 * express. Inserts name an explicit source offset and are zero-width. The only runtime check left
 * is the view-scan adapter's same-piece test (rules/adapt.ts).
 *
 * Relative imports only (native test loader); vscode-free.
 */
import type { HeadingLevel } from '../../shared/compiler/tokenizer.ts';
import type { ActiveRule } from '../../shared/lint/select.ts';
import type { LocalizableMessage } from '../../shared/protocol.ts';

/**
 * A maximal run of prose that is CONTIGUOUS in the source and constant in dialogue depth.
 * `text.charAt(k)` came from source offset `srcStart + k` (UTF-16 units, matching
 * `TextDocument.positionAt`; astral characters occupy two consecutive units). Piece boundaries
 * fall at elided markup (annotations, ruby readings, the ｜ base marker), at line breaks, and at
 * every depth change (an utterance corner).
 */
export interface Piece {
  readonly text: string;
  /** Absolute source UTF-16 offset of `text.charAt(0)`. */
  readonly srcStart: number;
  /** Utterance nesting depth: 0 = 地の文 (top-level 「」『』 corners included), ≥1 = inside. */
  readonly depth: number;
}

/** One ruby reading (the 《…》 interior) on its line; `srcStart` is the reading's first unit. */
export interface RubyReading {
  readonly text: string;
  readonly srcStart: number;
}

/** One view character: its source offset and owning piece. `piece` is null for a synthetic unit
 *  (the narration 〇 sentinel, the dialogue '\n' separator) — synthetic units are never a fix
 *  carrier. */
export interface ProseUnit {
  readonly src: number;
  readonly piece: Piece | null;
  readonly indexInPiece: number;
  readonly depth: number;
}

/** An index-aligned prose view: `text.charAt(k)` ↔ `units[k]`. */
export interface ProseView {
  readonly text: string;
  readonly units: readonly ProseUnit[];
}

/**
 * One source line, fully contextualized. `indent` and `heading` are in lockstep with the rendered
 * `Row` of layout.ts `buildRows` (twin-machine guard in walker.test.ts); `directiveOnly` marks a
 * line whose tokens produce no prose (a ここから/ここで own-line directive, 改ページ, a bare
 * comment); `blank` marks a line with no tokens at all. `openDepthAtEnd` > 0 means the line ends
 * inside an utterance (a multi-line 台詞).
 */
export interface LintLine {
  /** 0-based source line ('\n'-counted, CRLF-aware — matches LSP line numbering). */
  readonly srcLine: number;
  /** Source offset of the line's first unit. */
  readonly srcStart: number;
  /** Source offset just past the line's last content unit (the terminator, or EOF). */
  readonly srcEnd: number;
  /** Rendered 字下げ of this line (line-head ［＃N字下げ］ override, else the open block's N). */
  readonly indent: number;
  /** The line's 見出し level, when a heading postfix/span/block covers it. */
  readonly heading: HeadingLevel | undefined;
  readonly directiveOnly: boolean;
  readonly blank: boolean;
  readonly openDepthAtEnd: number;
  readonly pieces: readonly Piece[];
  readonly rubies: readonly RubyReading[];
  prose(): ProseView;
  narration(): ProseView;
  dialogue(): ProseView;
}

/** A half-open absolute source span `[start, end)` — the shape every report names. */
export interface SrcSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * An auto-fix, in the only two safe shapes: replace a range INSIDE one piece (cannot span elided
 * markup by construction), or insert at an explicit source offset (zero-width, overwrites nothing).
 */
export type FixSpec =
  | {
    readonly replace: {
      readonly piece: Piece;
      /** Half-open `[start, end)` UTF-16 range into `piece.text`. */
      readonly start: number;
      readonly end: number;
    };
    readonly text: string;
  }
  | { readonly insertAt: number; readonly text: string };

/** What a rule instance is handed: its resolved options and the report sink. `message` overrides
 *  the default `{ code: rule.code }` (sub-codes like `lint.common.dash.parity`). */
export interface RuleContext {
  readonly options: ActiveRule['options'];
  report(
    span: SrcSpan,
    extra?: { readonly message?: LocalizableMessage; readonly fix?: FixSpec },
  ): void;
}

/** A per-document rule instance: fed every {@link LintLine} in order, then `end()` at EOF (the
 *  flush point for cross-line state — an unclosed bracket, a run counter). */
export interface LineRule {
  line(line: LintLine): void;
  end?(): void;
}
