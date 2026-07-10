/**
 * The process-wide server context. Workspace-folder tracking used to live here (per-root
 * config-file state, watches, longest-prefix routing); the settings migration made the
 * client's pushes the single source of per-root state — `projectDirs` rides each
 * build/listBooks request, and the vocabulary store carries its own root keys — so only the
 * shared context object remains.
 *
 * vscode-free: only `import type` of the language-server types is used; the runtime
 * `Connection` is injected by server.ts.
 */
import type { Connection } from 'vscode-languageserver/node';

import type { RuleSelection } from '#/shared/lint/select.ts';

import type { HighlightStore } from './highlight/vocabulary.ts';

/**
 * Mutable, process-wide server state threaded through every server module. It is a
 * single object shared by reference, so writes (e.g. a lint-selection swap) are
 * visible everywhere.
 */
export interface ServerContext {
  readonly connection: Connection;
  /** Enabled prose-lint rules, resolved from the client's `jpnov.lint.*` settings snapshot. Workspace-
   *  (not root-) scoped, so it lives on the context rather than per root. */
  lintSelection: RuleSelection;
  /** Per-root narration vocabulary (characters/keywords), fed by the client's `jpnov.highlight.*` pushes. */
  readonly highlight: HighlightStore;
}
