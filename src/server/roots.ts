/**
 * The standard-LSP workspace-folder list (initialize + `workspace/didChangeWorkspaceFolders`)
 * the live `.jpbook` features use to resolve root-relative entries.
 */
import { longestPrefixRoot, normalizeRootUri } from './fsUri.ts';

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
      return longestPrefixRoot(roots, uri);
    },
  };
}
