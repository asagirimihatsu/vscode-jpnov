/**
 * The process-wide server context, plus the standard-LSP workspace-folder list
 * (initialize + `workspace/didChangeWorkspaceFolders`) the live `.jpbook` features use to
 * resolve root-relative entries. Per-root CONFIG state deliberately does NOT live here:
 * `projectDirs` rides each build/listBooks request, and the vocabulary store carries its
 * own root keys.
 *
 * vscode-free: only `import type` of the language-server types is used; the runtime
 * `Connection` is injected by server.ts.
 */
import type { Connection } from 'vscode-languageserver/node';

import type { RuleSelection } from '#/shared/lint/select.ts';

import { normalizeRootUri } from './fsUri.ts';
import type { HighlightStore } from './highlight/vocabulary.ts';

/** The workspace-folder set, answering "which root owns this URI" by longest prefix. */
export interface WorkspaceRoots {
  /** Full replacement (the `initialize` snapshot). */
  replace(uris: readonly string[]): void;
  /** Incremental update (`workspace/didChangeWorkspaceFolders`). */
  change(added: readonly string[], removed: readonly string[]): void;
  /** The longest root containing `uri` (normalized, no trailing slash), or null. */
  rootOf(uri: string): string | null;
}

export function createWorkspaceRoots(): WorkspaceRoots {
  let roots: string[] = [];
  return {
    replace(uris) {
      roots = uris.map(normalizeRootUri);
    },
    change(added, removed) {
      const gone = new Set(removed.map(normalizeRootUri));
      roots = roots.filter((r) => !gone.has(r)).concat(added.map(normalizeRootUri));
    },
    rootOf(uri) {
      let best: string | null = null;
      for (const root of roots) {
        if ((uri === root || uri.startsWith(`${root}/`)) && (best === null || root.length > best.length)) {
          best = root;
        }
      }
      return best;
    },
  };
}

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
  /** Per-root narration vocabulary (characters/keywords), fed by the client's `jpnov.editor.highlight.*` pushes. */
  readonly highlight: HighlightStore;
  /** Workspace folders (standard LSP), for root-relative `.jpbook` entry resolution. */
  readonly roots: WorkspaceRoots;
}
