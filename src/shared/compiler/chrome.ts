/**
 * The rendering "chrome" vocabulary (page furniture): line numbers, edge rules, page
 * numbers, and the page header. Shared by the preview + build renderers, the wire
 * protocol, and the settings resolver. Import-free (no `#/`, no vscode) so it loads
 * anywhere, including Node's native test runner.
 *
 * The compiler OWNS this vocabulary; `protocol.ts` and `config/settings.ts` import from
 * here (never the other way round — the compiler must not depend on the wire).
 *
 * Every shape below is the RESOLVED form: all fields present, no optionals. The settings
 * resolver fills defaults and clamps before one of these is constructed; renderer inputs
 * are required, so "off" is always an explicit value (`lineNumbers: false`,
 * `edgeLine: 'none'`, `pageNumber: 'none'`, `header: ''`).
 */

export const EDGE_LINE_STYLES = ['none', 'text', 'red'] as const;
export type EdgeLineStyle = (typeof EDGE_LINE_STYLES)[number];

/**
 * Folio placement, default first — hand-typed in `.jpbook` front matter, so the members are
 * terse: `right`/`left` pin one side; `rightLeft`/`leftRight` alternate per page starting
 * on the named side.
 */
export const PAGE_NUMBER_POSITIONS = [
  'right',
  'left',
  'rightLeft',
  'leftRight',
  'none',
] as const;
export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number];

/** Resolved preview chrome. */
export interface PreviewChrome {
  /** Line-head numbers, restarting at 1 after every ［＃改ページ］ marker. */
  readonly lineNumbers: boolean;
  /** Inter-column rules; `text` draws in the text colour (currentColor), all rules at 80% alpha. */
  readonly edgeLine: EdgeLineStyle;
}

/** Resolved HTML-build chrome. */
export interface BuildChrome {
  /** Line-head numbers, restarting at 1 on every page. */
  readonly lineNumbers: boolean;
  /** Inter-column rules + a matching page frame; `text` draws in the text colour (currentColor), all rules at 80% alpha. */
  readonly edgeLine: EdgeLineStyle;
  readonly pageNumber: PageNumberPosition;
  /**
   * Page-number format; `{page}` / `{totalPage}` are the only variables. A format
   * that is blank after trim suppresses the folio entirely (renderBook normalizes it
   * to `pageNumber: 'none'`).
   */
  readonly pageNumberFormat: string;
  /** Single-line header text centered at the physical top of every page; '' = none (band stays reserved). */
  readonly header: string;
}
