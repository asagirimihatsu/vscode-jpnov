import type { LabelId, MsgCode } from '#/shared/protocol.ts';

/** Failure of {@link resolveContained}: a `path.*` code plus the config-field label it concerns. */
export interface ContainmentError {
  ok: false;
  code: MsgCode;
  args: readonly [LabelId];
}

/**
 * Resolves a user-supplied relative path against a workspace-root URI, refusing any
 * value that escapes the root or names an absolute / home-relative location.
 *
 * Pure + vscode-free: `rootUri` and the returned `abs` are URI strings
 * (e.g. `file:///Users/x/proj`). On success `abs` is guaranteed to be at or below
 * `rootUri`. On failure it returns a `path.*` {@link MsgCode} plus `label` as the sole arg;
 * the CLIENT renders the localized text (the server fills the English diagnostic fallback).
 *
 * Rejected:
 * - `""` and whitespace-only
 * - `"."` (the root itself — a config field must name a *sub*path)
 * - any `..` segment that would climb above the root
 * - absolute paths (`/foo`, `C:\foo`, `\\server\share`, or a `scheme:` URI)
 * - a leading `~` (home-relative)
 */
/**
 * True when the value names an absolute location a root-relative field must reject:
 * a POSIX `/…` path, a Windows drive or UNC path, or a full `scheme:` URI. Shared with
 * the panel's file-name input so the two ends of the pipeline can't drift.
 */
export function isAbsoluteLocation(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  );
}

export function resolveContained(
  rootUri: string,
  rel: string,
  label: LabelId,
): { ok: true; abs: string } | ContainmentError {
  const trimmed = rel.trim();

  if (trimmed === '') {
    return { ok: false, code: 'path.empty', args: [label] };
  }
  if (trimmed === '.') {
    return { ok: false, code: 'path.rootDot', args: [label] };
  }
  if (trimmed.startsWith('~')) {
    return { ok: false, code: 'path.homeRelative', args: [label] };
  }

  if (isAbsoluteLocation(trimmed)) {
    return { ok: false, code: 'path.absolute', args: [label] };
  }

  // Resolve against the root using URL semantics (handles ./ and ../ collapsing).
  // A trailing slash on the base makes the relative path resolve *inside* the root.
  const base = rootUri.endsWith('/') ? rootUri : `${rootUri}/`;
  let resolved: URL;
  try {
    resolved = new URL(trimmed.split('\\').join('/'), base);
  } catch {
    return { ok: false, code: 'path.invalid', args: [label] };
  }

  const baseUrl = new URL(base);
  // The root path in both spellings (with/without the trailing slash), derived once for the
  // two checks below. `base` ends with '/', so `pathname` normally does too.
  const rootDir = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const rootPath = rootDir.slice(0, -1);

  // Containment: same origin/scheme, and the resolved path is at or under the base.
  if (
    resolved.protocol !== baseUrl.protocol ||
    resolved.host !== baseUrl.host ||
    !(resolved.pathname === rootPath || resolved.pathname.startsWith(rootDir))
  ) {
    return { ok: false, code: 'path.escapesRoot', args: [label] };
  }

  // Equal to the root after collapsing (e.g. "foo/..") is also a rejection: a config
  // field must name a real subpath. (Shares `path.rootDot` with the literal "." case.)
  if (resolved.pathname === rootPath || resolved.pathname === rootDir) {
    return { ok: false, code: 'path.rootDot', args: [label] };
  }

  return { ok: true, abs: resolved.href.replace(/\/$/, '') };
}
