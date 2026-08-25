/**
 * Tiny URI string helpers shared across the server's filesystem seams (build / jpbook).
 * PURE string ops: no `node:fs`, no `vscode-languageserver` imports — a true leaf,
 * so any server module can pull it in without dragging dependencies along.
 *
 * Scheme handling is deliberately a prefix test, not URL parsing: the server only ever
 * distinguishes `file:` (real disk via `node:fs`) from "anything else" (virtual fs over the
 * client bridge), and every URI here is already-encoded by the LSP/vscode layer.
 */

/** True iff `uri` is on the `file:` scheme (the only scheme the server reads via `node:fs`). */
export function isFileScheme(uri: string): boolean {
  return uri.startsWith('file:');
}

/** Joins a directory URI and a child name into a child URI (no double slash). */
export function childUri(dirUri: string, name: string): string {
  return dirUri.endsWith('/') ? `${dirUri}${name}` : `${dirUri}/${name}`;
}

/** Strips a single trailing slash so root URIs compare/hash consistently. */
export function normalizeRootUri(uri: string): string {
  return uri.endsWith('/') ? uri.slice(0, -1) : uri;
}

/** The longest of `roots` (normalized, no trailing slash) that is `uri` or a `/`-bounded prefix of it, or null. */
export function longestPrefixRoot(roots: Iterable<string>, uri: string): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if ((uri === root || uri.startsWith(`${root}/`)) && (best === null || root.length > best.length)) {
      best = root;
    }
  }
  return best;
}
