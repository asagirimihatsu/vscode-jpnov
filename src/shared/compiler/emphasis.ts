/**
 * The CSS of the decoration variants: each variant's class and that class's rule. The compiler
 * emits `<span class="…">`, never an inline `style=` attribute: class rules live inside the
 * nonce'd `<style>`, which the webview CSP allows and inline style attributes cannot. Pure +
 * vscode-free.
 *
 * FOUR ORTHOGONAL presentation channels — one CSS property family each, so all four can sit on
 * one `<span>` together:
 *   emph    傍点     text-emphasis-style     emph-<slug> / emph-<slug>-l
 *   line    傍線     text-decoration-*       dec-<slug>  / dec-<slug>-l
 *   weight  太字     font-weight:bold        b
 *   style   斜体     font-style:italic       i
 *
 * The variant names and their channels live in ast/notation.ts; {@link CSS} is keyed by them, so
 * a variant without a class fails to compile.
 */
import type { Mark } from '../ast/nodes.ts';
import { EMPHASIS_VARIANTS } from '../ast/notation.ts';
import type { Channel, EmphasisVariant } from '../ast/notation.ts';

interface VariantCss {
  /** Base class; emph/line append `-l` for the left side. */
  readonly className: string;
  /** text-emphasis-style (emph) / text-decoration-style (line); '' for weight/style. */
  readonly css: string;
}

const CSS: Record<EmphasisVariant, VariantCss> = {
  傍点: { className: 'emph-fs', css: 'filled sesame' },
  白ゴマ傍点: { className: 'emph-os', css: 'open sesame' },
  丸傍点: { className: 'emph-fc', css: 'filled circle' },
  白丸傍点: { className: 'emph-oc', css: 'open circle' },
  二重丸傍点: { className: 'emph-fd', css: 'filled double-circle' },
  蛇の目傍点: { className: 'emph-od', css: 'open double-circle' },
  黒三角傍点: { className: 'emph-ft', css: 'filled triangle' },
  白三角傍点: { className: 'emph-ot', css: 'open triangle' },
  // The slug `x` abbreviates; the emitted value is the full-width × glyph, never the ASCII letter.
  // The CSS <string> is single-quoted so the value stays well-formed wherever it is emitted.
  ばつ傍点: { className: 'emph-x', css: "'×'" },
  '×傍点': { className: 'emph-x', css: "'×'" },
  傍線: { className: 'dec-solid', css: 'solid' },
  二重傍線: { className: 'dec-double', css: 'double' },
  鎖線: { className: 'dec-dotted', css: 'dotted' },
  破線: { className: 'dec-dashed', css: 'dashed' },
  波線: { className: 'dec-wavy', css: 'wavy' },
  太字: { className: 'b', css: '' },
  斜体: { className: 'i', css: '' },
};

/**
 * Class name → full CSS rule. The ONLY place the style CSS values live.
 * INVARIANT: no channel class may declare `position`/`transform` — a positioned channel span
 * would capture the ruby lanes' absolutely positioned reading spans (`rt>span`; pinned in
 * emphasis.test.ts).
 */
const RULES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [variant, channel] of Object.entries(EMPHASIS_VARIANTS) as [EmphasisVariant, Channel][]) {
    const { className: cn, css } = CSS[variant];
    switch (channel) {
      case 'emph':
        // `-l`: a bare `left` is INVALID CSS (`[ over | under ] && [ right | left ]?` — the browser
        // drops the whole declaration); `under` is the horizontal fallback, matching JP convention.
        m.set(cn, `.${cn}{text-emphasis-style:${css}}`);
        m.set(
          `${cn}-l`,
          `.${cn}-l{text-emphasis-style:${css};text-emphasis-position:under left}`,
        );
        break;
      case 'line':
        // `text-underline-position:right` is pinned: Chromium draws vertical-rl underlines on the
        // LEFT by default; `-l` uses `left`.
        m.set(
          cn,
          `.${cn}{text-decoration-line:underline;text-decoration-style:${css};text-underline-position:right}`,
        );
        m.set(
          `${cn}-l`,
          `.${cn}-l{text-decoration-line:underline;text-decoration-style:${css};text-underline-position:left}`,
        );
        break;
      case 'weight':
        m.set(cn, `.${cn}{font-weight:bold}`); // no -l variant (太字 has no side)
        break;
      case 'style':
        // Relies on the browser synthesising an oblique for JP fonts: never set `font-synthesis:none`.
        m.set(cn, `.${cn}{font-style:italic}`); // no -l variant (斜体 has no side)
        break;
    }
  }
  return m;
})();

/** The CSS class of a decoration mark: the variant's class, `-l` on the left side. */
export function markClass(mark: Mark): string {
  const base = CSS[mark.variant].className;
  return mark.left ? `${base}-l` : base;
}

/**
 * The full CSS rule for a style class name (emph-* / dec-* incl. `-l`, plus b / i), or '' for an
 * unknown one. The SINGLE home of all text-emphasis / text-decoration / font-* values: css.ts's
 * classRule generates only indent-* itself and forwards every other used class here.
 */
export function styleRule(className: string): string {
  return RULES.get(className) ?? '';
}
