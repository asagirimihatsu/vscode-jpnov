/**
 * Maps a 傍点 (emphasis-dot) variant name DIRECTLY to its CSS class name, and supplies the
 * class's CSS rule for the stylesheet. The compiler emits `<span class="emph-…">`, never an
 * inline `style=` attribute: class rules live inside the webview's nonce-able `<style>`,
 * which inline style attributes cannot (the CSP strips them — that was the preview 傍点 bug).
 * There is no intermediate CSS-value representation — a variant is translated to a class in
 * one step. Pure + vscode-free.
 *
 * The nine dot kinds (locked spec):
 *   傍点             emph-fs  filled sesame
 *   白ゴマ傍点        emph-os  open sesame
 *   丸傍点           emph-fc  filled circle
 *   白丸傍点          emph-oc  open circle
 *   二重丸傍点        emph-fd  filled double-circle
 *   蛇の目傍点        emph-od  open double-circle
 *   黒三角傍点        emph-ft  filled triangle
 *   白三角傍点        emph-ot  open triangle
 *   ばつ傍点 / ×傍点   emph-x   the literal full-width "×"
 *
 * A leading 左に or の左に adds an `-l` suffix (`text-emphasis-position:left`), valid on all
 * nine. The line family (傍線/二重傍線/鎖線/破線/波線) is intentionally absent, so it falls
 * through to `null` and the caller degrades it to an HTML comment.
 *
 * The `text-emphasis-style` CSS values live in ONE place — the rule table built from {@link
 * DOTS}. Slugs are a PRIVATE compiler detail (free to rename), not a public theming contract.
 * NOTE: the slug `x` is an HTML abbreviation; its emitted CSS value is the real full-width ×
 * glyph, never the ASCII letter.
 */

interface Dot {
  /** Variant name(s) selecting this dot kind (ばつ傍点 / ×傍点 share one). */
  readonly variants: readonly string[];
  /** Short class slug, used as `emph-<slug>`. */
  readonly slug: string;
  /** The `text-emphasis-style` CSS value. */
  readonly css: string;
}

const DOTS: readonly Dot[] = [
  { variants: ['傍点'], slug: 'fs', css: 'filled sesame' },
  { variants: ['白ゴマ傍点'], slug: 'os', css: 'open sesame' },
  { variants: ['丸傍点'], slug: 'fc', css: 'filled circle' },
  { variants: ['白丸傍点'], slug: 'oc', css: 'open circle' },
  { variants: ['二重丸傍点'], slug: 'fd', css: 'filled double-circle' },
  { variants: ['蛇の目傍点'], slug: 'od', css: 'open double-circle' },
  { variants: ['黒三角傍点'], slug: 'ft', css: 'filled triangle' },
  { variants: ['白三角傍点'], slug: 'ot', css: 'open triangle' },
  // The CSS <string> is single-quoted so the value stays well-formed wherever it is emitted.
  { variants: ['ばつ傍点', '×傍点'], slug: 'x', css: "'×'" },
];

/** Variant name → class slug. Built once from {@link DOTS}. */
const VARIANT_TO_SLUG: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const dot of DOTS) {
    for (const variant of dot.variants) {
      m.set(variant, dot.slug);
    }
  }
  return m;
})();

/** Class name → full CSS rule. The ONLY place the `text-emphasis-style` values live. */
const RULES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const dot of DOTS) {
    m.set(`emph-${dot.slug}`, `.emph-${dot.slug}{text-emphasis-style:${dot.css}}`);
    m.set(
      `emph-${dot.slug}-l`,
      `.emph-${dot.slug}-l{text-emphasis-style:${dot.css};text-emphasis-position:left}`,
    );
  }
  return m;
})();

/**
 * The CSS class name for an emphasis variant, or `null` for any non-dot / unknown variant
 * (the 傍線 line family etc., which the caller degrades to a comment). A leading 左に / の左に
 * yields the `-l` (left-position) class.
 */
export function emphasisClass(variant: string): string | null {
  let name = variant;
  let left = false;

  // 左に / の左に prefix => emphasis on the left side. Strip the longer alias first.
  if (name.startsWith('の左に')) {
    name = name.slice('の左に'.length);
    left = true;
  } else if (name.startsWith('左に')) {
    name = name.slice('左に'.length);
    left = true;
  }

  const slug = VARIANT_TO_SLUG.get(name);
  if (slug === undefined) {
    return null;
  }
  return left ? `emph-${slug}-l` : `emph-${slug}`;
}

/** The CSS rule string for an emphasis class name, or '' for an unknown class. */
export function emphasisClassRule(className: string): string {
  return RULES.get(className) ?? '';
}
