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
 * Localized text for a label id. `jpbookEntry` (the only label) is prose and is
 * translated. Built per-call — `vscode.l10n` is ready by the time anything renders.
 */
function labelText(label: LabelId): string {
  const texts: Record<LabelId, string> = { jpbookEntry: vscode.l10n.t('book entry') };
  return texts[label];
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
    case 'book.entryNeedsFileScheme':
      return vscode.l10n.t('cannot read "{0}": book files require a file:// workspace', s(0));
    case 'book.entryFileNotFound':
      return vscode.l10n.t('cannot read "{0}": file not found', s(0));
    case 'book.entryReadFailed':
      return vscode.l10n.t('cannot read "{0}": {1}', s(0), s(1));
    case 'build.outPathCollision':
      return vscode.l10n.t('output path "{0}" is claimed by multiple book files: {1}', s(0), s(1));
    case 'build.failed':
      return vscode.l10n.t('build failed: {0}', s(0));
    case 'jpbook.backslashSeparator':
      return vscode.l10n.t('use "/" as the path separator, not "\\": {0}', s(0));
    case 'jpbook.notJpnov':
      return vscode.l10n.t('book entries must be .jpnov files: {0}', s(0));
    case 'jpbook.duplicateEntry':
      return vscode.l10n.t('duplicate entry "{0}" (already listed above)', s(0));
    case 'jpbook.entryIsDirectory':
      return vscode.l10n.t('"{0}" is a directory, not a .jpnov file', s(0));
    case 'jpbook.fileNotFound':
      return vscode.l10n.t('file not found: {0}', s(0));
    case 'jpbook.metaNotKeyValue':
      return vscode.l10n.t('metadata lines must be "key: value": {0}', s(0));
    case 'jpbook.metaUnknownKey':
      return vscode.l10n.t('unknown metadata key "{0}" (known keys: {1})', s(0), s(1));
    case 'jpbook.metaDuplicateKey':
      return vscode.l10n.t('duplicate metadata key "{0}" (the first value wins)', s(0));
    case 'jpbook.metaBadEnum':
      return vscode.l10n.t('invalid value "{1}" for {0} (allowed: {2})', s(0), s(1), s(2));
    case 'jpbook.metaUnterminated':
      return vscode.l10n.t('unterminated metadata block (missing a closing ---)');
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
    case 'syntax.unclosedAnnotation':
      return vscode.l10n.t('unterminated ［＃ annotation (missing ］)');
    case 'syntax.unterminatedBlock':
      return vscode.l10n.t('unterminated block annotation (missing ［＃ここで…終わり］)');
    case 'syntax.danglingBlockEnd':
      return vscode.l10n.t('block-end annotation without a matching start');
    case 'syntax.postfixTargetMissing':
      return vscode.l10n.t('annotation target "{0}" not found or not aligned on this line', s(0));
    case 'syntax.unterminatedTcy':
      return vscode.l10n.t('unterminated 縦中横 (missing ［＃縦中横終わり］ before the line end)');
    case 'syntax.danglingTcyEnd':
      return vscode.l10n.t('［＃縦中横終わり］ without a matching ［＃縦中横］');
    case 'syntax.tcyTooLong':
      return vscode.l10n.t('縦中横 is too long (3 characters or fewer avoid distortion)');
    // --- prose lint (kept byte-identical to renderEnglish). ---
    case 'lint.common.sentenceLength':
      return vscode.l10n.t('this sentence is too long');
    case 'lint.common.maxTen':
      return vscode.l10n.t('too many commas (、) in one sentence');
    case 'lint.common.maxKanjiRun':
      return vscode.l10n.t('too many consecutive kanji');
    case 'lint.common.dash':
      return vscode.l10n.t('use the configured dash character ({0})', s(0));
    case 'lint.common.dash.parity':
      return vscode.l10n.t('use an even number of dashes');
    case 'lint.common.noUnmatchedPair':
      return vscode.l10n.t('unmatched bracket or quote');
    case 'lint.common.noHankakuKana':
      return vscode.l10n.t('half-width kana; use full-width kana');
    case 'lint.common.noNfd':
      return vscode.l10n.t('decomposed (NFD) characters; use composed (NFC) form');
    case 'lint.common.noZeroWidth':
      return vscode.l10n.t('zero-width space');
    case 'lint.common.noControlChar':
      return vscode.l10n.t('invalid control character');
    case 'lint.common.jaNoSpaceBetweenFullWidth':
      return vscode.l10n.t('space between full-width characters');
    case 'lint.common.jaUnnaturalAlphabet':
      return vscode.l10n.t('unnatural alphabet usage');
    case 'lint.common.minusPosition':
      return vscode.l10n.t('a minus sign is allowed only before a number');
    case 'lint.narration.generalNovelStyle':
      return vscode.l10n.t('does not follow Japanese novel style (paragraph indent / line head)');
    case 'lint.narration.jaNoMixedPeriod':
      return vscode.l10n.t('this sentence does not end with a period (。)');
    case 'lint.ruby.kana':
      return vscode.l10n.t('ruby reading should be all hiragana or all katakana');
    case 'server.unexpected':
      return vscode.l10n.t('unexpected error: {0}', s(0));
    default: {
      const exhaustive: never = msg.code;
      throw new Error(`renderMessage: unhandled code ${String(exhaustive)}`);
    }
  }
}
