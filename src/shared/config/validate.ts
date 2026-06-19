/**
 * Resolves a user-supplied relative path against a workspace-root URI, refusing any
 * value that escapes the root or names an absolute / home-relative location.
 *
 * Pure + vscode-free: `rootUri` and the returned `abs` are URI strings
 * (e.g. `file:///Users/x/proj`). On success `abs` is guaranteed to be at or below
 * `rootUri`. `label` only flavors the rejection message (e.g. `"sourceDir"`).
 *
 * Rejected:
 * - `""` and whitespace-only
 * - `"."` (the root itself — a config field must name a *sub*path)
 * - any `..` segment that would climb above the root
 * - absolute paths (`/foo`, `C:\foo`, `\\server\share`, or a `scheme:` URI)
 * - a leading `~` (home-relative)
 */
export function resolveContained(
  rootUri: string,
  rel: string,
  label: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const trimmed = rel.trim();

  if (trimmed === '') {
    return { ok: false, reason: `${label} must not be empty` };
  }
  if (trimmed === '.') {
    return { ok: false, reason: `${label} must name a subpath, not the root "."` };
  }
  if (trimmed.startsWith('~')) {
    return { ok: false, reason: `${label} must not start with "~" (home-relative)` };
  }

  // Reject absolute POSIX paths, Windows drive/UNC paths, and full URIs (scheme:).
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)
  ) {
    return { ok: false, reason: `${label} must be a relative path, not absolute` };
  }

  // Resolve against the root using URL semantics (handles ./ and ../ collapsing).
  // A trailing slash on the base makes the relative path resolve *inside* the root.
  const base = rootUri.endsWith('/') ? rootUri : `${rootUri}/`;
  let resolved: URL;
  try {
    resolved = new URL(trimmed.split('\\').join('/'), base);
  } catch {
    return { ok: false, reason: `${label} is not a valid path` };
  }

  const baseUrl = new URL(base);
  // Containment: same origin/scheme, and the resolved path is at or under the base.
  const basePath = baseUrl.pathname;
  const containedPath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  if (
    resolved.protocol !== baseUrl.protocol ||
    resolved.host !== baseUrl.host ||
    !(
      resolved.pathname === basePath.replace(/\/$/, '') ||
      resolved.pathname === basePath ||
      resolved.pathname.startsWith(containedPath)
    )
  ) {
    return { ok: false, reason: `${label} must not escape the workspace root` };
  }

  // Equal to the root after collapsing (e.g. "foo/..") is also a rejection: a config
  // field must name a real subpath.
  const rootNoSlash = basePath.replace(/\/$/, '');
  if (resolved.pathname === rootNoSlash || resolved.pathname === basePath) {
    return { ok: false, reason: `${label} must name a subpath, not the root` };
  }

  return { ok: true, abs: resolved.href.replace(/\/$/, '') };
}
