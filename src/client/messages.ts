/**
 * Client-side renderer for server-origin {@link LocalizableMessage}s (build errors, config-state
 * errors, and — via the diagnostic middleware in `extension.ts` — diagnostics).
 *
 * The English literals passed to `vscode.l10n.t()` here are the l10n bundle KEYS (vscode.l10n uses
 * the English message as the lookup key); Japanese lives in `l10n/bundle.l10n.ja.json`. They MUST
 * match `src/shared/messages.ts` `renderEnglish()` byte-for-byte — a unit test asserts parity.
 */
import * as vscode from 'vscode';

import type { LabelId, LocalizableMessage } from '#/shared/protocol.ts';

/**
 * Localized text for a label id. `sourceDir`/`outDir` name the user's literal JSON key and render
 * verbatim; `filelistEntry` is prose and is translated. Built per-call — `vscode.l10n` is ready by
 * the time anything renders.
 */
function labelText(label: LabelId): string {
  switch (label) {
    case 'sourceDir':
      return 'sourceDir';
    case 'outDir':
      return 'outDir';
    case 'filelistEntry':
      return vscode.l10n.t('filelist entry');
  }
}

/** Runtime guard for an `LSPAny` (a Diagnostic's `data`, or a custom-payload field). */
export function isLocalizableMessage(value: unknown): value is LocalizableMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** Render a server {@link LocalizableMessage} to localized UI text. Exhaustive over `MsgCode`. */
export function renderMessage(msg: LocalizableMessage): string {
  const a = msg.args ?? [];
  const s = (i: number): string => String(a[i] ?? '');
  switch (msg.code) {
    case 'config.execNeedsFileScheme':
      return vscode.l10n.t('executable config ({0}) requires a file:// workspace', s(0));
    case 'config.execNeedsTrust':
      return vscode.l10n.t('executable config ({0}) is not loaded in an untrusted workspace', s(0));
    case 'config.loadFailed':
      return vscode.l10n.t('cannot load config: {0}', s(0));
    case 'book.entryNeedsFileScheme':
      return vscode.l10n.t('cannot read "{0}": book files require a file:// workspace', s(0));
    case 'book.entryFileNotFound':
      return vscode.l10n.t('cannot read "{0}": file not found', s(0));
    case 'book.entryReadFailed':
      return vscode.l10n.t('cannot read "{0}": {1}', s(0), s(1));
    case 'build.outPathCollision':
      return vscode.l10n.t('output path "{0}" is claimed by multiple filelists: {1}', s(0), s(1));
    case 'build.failed':
      return vscode.l10n.t('build failed: {0}', s(0));
    case 'filelist.backslashSeparator':
      return vscode.l10n.t('use "/" as the path separator, not "\\": {0}', s(0));
    case 'filelist.notJpnov':
      return vscode.l10n.t('filelist entries must be .jpnov files: {0}', s(0));
    case 'filelist.duplicateEntry':
      return vscode.l10n.t('duplicate entry "{0}" (already listed above)', s(0));
    case 'filelist.entryIsDirectory':
      return vscode.l10n.t('"{0}" is a directory, not a .jpnov file', s(0));
    case 'filelist.fileNotFound':
      return vscode.l10n.t('file not found: {0}', s(0));
    case 'path.empty':
      return vscode.l10n.t('{0} must not be empty', labelText(a[0] as LabelId));
    case 'path.rootDot':
      return vscode.l10n.t('{0} must name a subpath, not the root "."', labelText(a[0] as LabelId));
    case 'path.homeRelative':
      return vscode.l10n.t('{0} must not start with "~" (home-relative)', labelText(a[0] as LabelId));
    case 'path.absolute':
      return vscode.l10n.t('{0} must be a relative path, not absolute', labelText(a[0] as LabelId));
    case 'path.invalid':
      return vscode.l10n.t('{0} is not a valid path', labelText(a[0] as LabelId));
    case 'path.escapesRoot':
      return vscode.l10n.t('{0} must not escape the workspace root', labelText(a[0] as LabelId));
    case 'lint.halfWidthSpace':
      return vscode.l10n.t('half-width space; use a full-width space in Japanese prose');
    default: {
      const exhaustive: never = msg.code;
      throw new Error(`renderMessage: unhandled code ${String(exhaustive)}`);
    }
  }
}
