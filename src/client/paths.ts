/**
 * Tiny URI/path helpers shared by the host-side client modules.
 */
import * as vscode from 'vscode';

/**
 * Exclude glob for every client-side `findFiles` sweep — mirrors the server's discovery
 * (the arbiter of what a build sees). An explicit exclude also keeps the user's
 * `files.exclude`/`search.exclude` values out of the search.
 */
export const FIND_FILES_EXCLUDE = '**/{node_modules,.*}/**';

/** Splits a root-relative path into filename and containing directory (`''` at the root). */
export function splitRelPath(rel: string): { name: string; dir: string } {
  const cut = rel.lastIndexOf('/');
  return { name: rel.slice(cut + 1), dir: cut >= 0 ? rel.slice(0, cut) : '' };
}

/**
 * The last path segment of a URI (trailing slashes stripped), e.g. `file:///a/b/` → `b`. Falls back
 * to the whole input when it can't be parsed or has no segment — a compact, always-safe label.
 */
export function lastPathSegment(uri: string): string {
  try {
    const path = vscode.Uri.parse(uri).path.replace(/\/+$/, '');
    const seg = path.slice(path.lastIndexOf('/') + 1);
    return seg.length > 0 ? seg : uri;
  } catch {
    return uri;
  }
}
