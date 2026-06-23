/**
 * Parity guard for the two message renderers. `renderEnglish` (src/shared/messages.ts, used by the
 * vscode-free server to fill the English Diagnostic.message fallback) and `renderMessage`
 * (src/client/messages.ts, `vscode.l10n.t` whose English literal is the bundle KEY) MUST share
 * byte-identical English templates, or a JA-locale user and the English fallback would диverge.
 *
 * Under the vscode mock, `l10n.t` passes the English source through (substituting {0}/{1}), so
 * `renderMessage` in "English locale" must equal `renderEnglish` for every code + args.
 *
 * NOT wired into `npm test` (test/client is authored-only). Run with the vscode resolution shim
 * (see test/client/README.md):
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { renderEnglish } from '../../src/shared/messages.ts';
import type { MsgCode } from '../../src/shared/protocol.ts';
import { buildVscode, createMockState } from './_vscodeMock.ts';

mock.module('vscode', { namedExports: buildVscode(createMockState()) });

const { renderMessage } = await import('../../src/client/messages.ts');

// Representative args per code. `Record<MsgCode, ...>` forces an entry for EVERY code, so adding a
// new MsgCode without a case here is a COMPILE error — keeping the guard exhaustive.
const ARGS: Record<MsgCode, readonly (string | number)[]> = {
  'config.execNeedsFileScheme': ['mjs'],
  'config.execNeedsTrust': ['ts'],
  'config.loadFailed': ['Unexpected token }'],
  'book.entryNeedsFileScheme': ['a.jpnov'],
  'book.entryFileNotFound': ['a.jpnov'],
  'book.entryReadFailed': ['a.jpnov', 'EACCES: permission denied'],
  'build.outPathCollision': ['vol1', 'a.filelist, b.filelist'],
  'build.failed': ['boom'],
  'filelist.backslashSeparator': ['sub\\a.jpnov'],
  'filelist.notJpnov': ['note.md'],
  'filelist.duplicateEntry': ['a.jpnov'],
  'filelist.entryIsDirectory': ['adir.jpnov'],
  'filelist.fileNotFound': ['missing.jpnov'],
  'path.empty': ['sourceDir'],
  'path.rootDot': ['outDir'],
  'path.homeRelative': ['filelistEntry'], // exercises the localized-label branch
  'path.absolute': ['sourceDir'],
  'path.invalid': ['outDir'],
  'path.escapesRoot': ['sourceDir'],
  'lint.halfWidthSpace': [],
};

test('renderEnglish and renderMessage share byte-identical English templates', () => {
  for (const code of Object.keys(ARGS) as MsgCode[]) {
    const args = ARGS[code];
    assert.equal(
      renderMessage({ code, args }),
      renderEnglish(code, args),
      `English mismatch for code ${code}`,
    );
  }
});
