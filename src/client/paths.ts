/**
 * Tiny URI helpers shared by the host-side client modules.
 */
import * as vscode from 'vscode';

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
