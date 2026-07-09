/**
 * Assembles the document stylesheet — vertical-rl (縦書き) in both modes — from the static
 * fragments authored in `styles/*.css` (compiled to strings in `styles.generated.ts` by
 * `scripts/gen-styles.ts`) plus the small dynamic residue TypeScript still owns:
 *
 * - the `:root{}` variable block (`--cpl`/`--lpp`/`--htop` numbers, `--edge` base colour) the
 *   fragments' static `calc(var())` geometry reads — a RULE inside the document's one
 *   `<style>`, never a `style=` attribute (the webview CSP strips those);
 * - the `@page` at-rule (BUILD): its size is computed from geometry.ts numbers because
 *   `@page` cannot read `var()` portably (the build artifact must stay portable);
 * - the on-demand `indent-N` (字下げ — unbounded N) and emphasis class rules (usedClasses).
 *
 * Mode and chrome conditionality is FRAGMENT INCLUSION — zero dead rules: a disabled
 * feature's selectors are entirely absent from the output, exactly like the old
 * string-conditional behaviour:
 * - paginate=true (BUILD): buildBase (+anchor +ln +edge +header +folio) — the explicit
 *   `.book > .page > .line` skeleton the layout engine emits, one printed sheet per `.page`;
 * - paginate=false (PREVIEW): previewBase (+anchor +ln +edge) — a single continuous flow of
 *   the SAME `.line` columns grouped into per-break `.segment` blocks, fit-to-viewport, with
 *   ［＃改ページ］ as a labelled marker between segments.
 *
 * In BOTH modes the edge rules are pure paint: the EDGE_INSET gap is reserved and the pitch
 * is LINE_PITCH whether edgeLine is on or off, so toggling it never moves a glyph, a line
 * number, or a page boundary. Chrome sub-elements (`.pn` / `.hd` / `.ln` / `.line::before`)
 * are horizontal-tb INSIDE a vertical-rl container and are positioned with PHYSICAL
 * properties only — the per-rule rationale lives as comments on the owning fragment.
 *
 * Pure + vscode-free.
 */

import type { BuildChrome, EdgeLineStyle, PreviewChrome } from './chrome.ts';
import { styleRule } from './emphasis.ts';
import {
  EDGE_RED,
  FOLIO_BAND,
  HEADER_BAND,
  LINENUM_BAND,
  LINE_PITCH,
  PRINT_MARGIN,
} from './geometry.ts';
import * as S from './styles/styles.generated.ts';

/**
 * The CSS rule for one used class name, or '' for an unknown one (keeps the "no stray rules"
 * invariant). `indent-N` (字下げ) is generated here — it is layout geometry, not a style-table
 * entry; the suffix check is defence in depth (emitLine only ever emits positive N_eff). Every
 * other class (emph-* / dec-* / b / i) is forwarded to emphasis.ts's {@link styleRule}, the
 * single home of the style CSS values.
 */
function classRule(name: string): string {
  if (name.startsWith('indent-')) {
    const n = name.slice('indent-'.length);
    return /^[1-9][0-9]*$/.test(n) ? `.indent-${n}{padding-inline-start:${n}em}` : '';
  }
  return styleRule(name);
}

/**
 * Edge BASE colour for `--edge`, or null for 'none' (include no edge fragment, inject no
 * variable). One policy for both media: `red` is the semantic 赤 (EDGE_RED), `text` bases on
 * currentColor — the rules always match the surrounding text (theme foreground in the
 * preview, ink on the build's white sheet). The 80%-alpha `color-mix` recipe lives ONCE in
 * the edge fragments; this picks only the base colour it mixes.
 */
function edgeBase(edge: EdgeLineStyle): string | null {
  switch (edge) {
    case 'none':
      return null;
    case 'red':
      return EDGE_RED;
    case 'text':
      return 'currentColor';
  }
}

/** The `:root{}` dynamic-values rule (insertion order — deterministic output). */
function rootVars(vars: Record<string, string | number>): string {
  const decls = Object.entries(vars)
    .map(([name, value]) => `${name}:${String(value)}`)
    .join(';');
  return `:root{${decls}}`;
}

/**
 * The one dynamic at-rule (BUILD): one print sheet = the column grid grown by the chrome
 * bands plus a uniform paper margin, computed here from the geometry.ts constants. The
 * margin lives on the SHEET (`@media print` in build.base.css), never on `@page`: browsers
 * render their own print header/footer (date, URL, their page numbers) into the `@page`
 * margin boxes, so zero `@page` margins are what keeps that furniture off the paper.
 */
function atPage(charsPerLine: number, linesPerPage: number, hTop: number): string {
  const block = linesPerPage * LINE_PITCH + 2 * PRINT_MARGIN;
  const inline = charsPerLine + hTop + FOLIO_BAND + 2 * PRINT_MARGIN;
  return `@page{size:${String(block)}em ${String(inline)}em;margin:0;}`;
}

type StylesheetOptions =
  | {
      readonly paginate: true;
      readonly charsPerLine: number;
      readonly linesPerPage: number;
      readonly chrome: BuildChrome;
      readonly usedClasses?: readonly string[];
    }
  | {
      readonly paginate: false;
      readonly charsPerLine: number;
      readonly chrome: PreviewChrome;
      readonly usedClasses?: readonly string[];
    };

/**
 * Renders the stylesheet for one document. `usedClasses` is the on-demand class sink
 * (callers pass it pre-sorted, lexicographic by class name, for deterministic output);
 * chrome features select their fragment in a fixed order (anchor → line numbers → edge →
 * header → folio), followed by the `:root` variables and (BUILD) the `@page` rule, so the
 * output stays deterministic.
 */
export function stylesheet(opts: StylesheetOptions): string {
  const edge = edgeBase(opts.chrome.edgeLine); // null ⟺ no edge fragment, no --edge
  const anchor = opts.chrome.lineNumbers || edge !== null; // .line{position:relative} needed?
  const tail = (opts.usedClasses ?? []).map(classRule);

  if (opts.paginate) {
    const { chrome } = opts;
    const hTop = HEADER_BAND + (chrome.lineNumbers ? LINENUM_BAND : 0);
    const vars: Record<string, string | number> = {
      '--cpl': opts.charsPerLine,
      '--lpp': opts.linesPerPage,
      '--htop': hTop,
    };
    if (edge !== null) {
      vars['--edge'] = edge;
    }
    return [
      S.buildBase,
      anchor ? S.buildAnchor : '',
      chrome.lineNumbers ? S.buildLn : '',
      edge !== null ? S.buildEdge : '',
      chrome.header !== '' ? S.buildHeader : '',
      chrome.pageNumberPosition !== 'none' ? S.buildFolio : '',
      rootVars(vars),
      atPage(opts.charsPerLine, opts.linesPerPage, hTop),
      ...tail,
    ].join('');
  }

  const vars: Record<string, string | number> = { '--cpl': opts.charsPerLine };
  if (edge !== null) {
    vars['--edge'] = edge;
  }
  return [
    S.previewBase,
    anchor ? S.previewAnchor : '',
    opts.chrome.lineNumbers ? S.previewLn : '',
    edge !== null ? S.previewEdge : '',
    rootVars(vars),
    ...tail,
  ].join('');
}
