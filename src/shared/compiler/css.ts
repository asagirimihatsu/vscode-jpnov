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
 * invariant). `indent-N` (字下げ) and `tcy` (縦中横) are generated here — they are layout
 * geometry, not style-table entries; the indent suffix check is defence in depth (emitLine only
 * ever emits positive N_eff). Every other class (emph-* / dec-* / b / i) is forwarded to
 * emphasis.ts's {@link styleRule}, the single home of the style CSS values.
 */
function classRule(name: string): string {
  if (name.startsWith('indent-')) {
    const n = name.slice('indent-'.length);
    return /^[1-9][0-9]*$/.test(n) ? `.indent-${n}{padding-inline-start:${n}em}` : '';
  }
  if (name.startsWith('rh-')) {
    // Stretched ruby: the box grows to the unit's true advance — the SAME N layout.ts accounts
    // as cells — and the lane flex below spreads the base across it, like native ruby.
    const n = name.slice('rh-'.length);
    return /^[1-9][0-9]*$/.test(n) ? `.rh-${n}{min-height:${n}em}` : '';
  }
  if (name === 'tcy') {
    // 縦中横: combine the cell's chars upright in one square. Media-independent (pure text
    // combination, no geometry), so the one rule serves preview and build alike.
    return '.tcy{text-combine-upright:all}';
  }
  if (name === 'hang') {
    // ぶら下げ: negative letter-spacing cancels the hung 句読点's own advance, so only its
    // INK reaches past the last cell into the 0.35em EDGE_INSET reserve. Ink overflow never
    // extends the scrollable area — an inline-block/overflow box here would grow the
    // preview's scrollHeight past the exact-fill viewport and summon a scrollbar.
    return '.hang{letter-spacing:-1em}';
  }
  if (name === 'rr' || name === 'lr' || name === 'br') {
    // Ruby lanes (rr right / lr left / br both) — every ruby renders here: Chrome has no
    // working double-sided ruby (ruby-position on an <rt> is ignored; a second <rt> stacks
    // under the base) and native's fractional advance breaks the whole-cell grid. The <ruby>
    // is an inline-flex distributing its base spans; each <rt> is an absolute 0.5em
    // vertical-rl lane — centre-anchored (top:50% + translateY(-50%)), min-height:100% (% of
    // the ruby box), shifted ±1.5em of its own em (= ±0.75em base: base half + rt half), both
    // sides spanning 2.0em inside the 2.25em LINE_PITCH. The flex space-around on box and
    // lanes reproduces native ruby-align (kana distribute, a Latin word centres, an over-long
    // reading overhangs symmetrically); channel classes must stay unpositioned (emphasis.ts
    // RULES) or they would capture the <rt>s.
    const shared =
      `ruby.${name}{display:inline-flex;flex-direction:row;justify-content:space-around;position:relative}` +
      `ruby.${name}>rt{position:absolute;top:50%;left:50%;min-height:100%;` +
      'display:flex;flex-direction:row;justify-content:space-around;' +
      'writing-mode:vertical-rl;font-size:0.5em;line-height:1;white-space:nowrap}';
    if (name === 'rr') {
      // The single <rt> IS the right reading (the conventional ruby side).
      return `${shared}ruby.rr>rt{transform:translate(-50%,-50%) translateX(1.5em)}`;
    }
    if (name === 'lr') {
      // The single <rt> IS the left reading.
      return `${shared}ruby.lr>rt{transform:translate(-50%,-50%) translateX(-1.5em)}`;
    }
    // 両側: the class-less <rt> is the right reading, rt.rt-l the left.
    return (
      `${shared}ruby.br>rt{transform:translate(-50%,-50%) translateX(1.5em)}` +
      'ruby.br>rt.rt-l{transform:translate(-50%,-50%) translateX(-1.5em)}'
    );
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
