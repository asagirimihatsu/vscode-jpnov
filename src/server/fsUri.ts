/**
 * Tiny URI string helpers shared across the server's filesystem seams (configLoad / build /
 * filelist). PURE string ops: no `node:fs`, no `vscode-languageserver` imports — a true leaf,
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
