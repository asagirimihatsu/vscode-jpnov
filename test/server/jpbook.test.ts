/**
 * Integration tests for the impure `*.jpbook` editor features (diagnostics, completion,
 * document links) against real `file:` fixtures. Authored for the server stage; NOT wired
 * into `npm test`. Run with:
 *   node --test --experimental-test-module-mocks "test/server/jpbook.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CompletionItemKind, DiagnosticSeverity } from 'vscode-languageserver/node';

import { parseJpbook } from '../../src/shared/book/jpbook.ts';
import {
  completeJpbook,
  diagnoseJpbook,
  documentLinksForJpbook,
} from '../../src/server/jpbook.ts';
import { makeTmpWorkspace, writeUnder } from './helpers.ts';

/** Single-line completion helper: the parse and the line are the same one-liner. */
function completeLine(uri: string, line: string, character: number): ReturnType<typeof completeJpbook> {
  return completeJpbook(uri, parseJpbook(line), line, { line: 0, character });
}

test('diagnoseJpbook flags missing / directory / backslash / non-.jpnov as Error and dupes as Warning', async () => {
  await using ws = await makeTmpWorkspace();
  await writeUnder(ws.dir, 'src/vol1/ok.jpnov', 'x');
  await writeUnder(ws.dir, 'src/vol1/adir.jpnov/keep', 'x'); // makes adir.jpnov a directory
  const uri = `${ws.uri}/src/vol1/index.jpbook`;
  const text = ['ok.jpnov', 'missing.jpnov', 'adir.jpnov', 'sub\\bad.jpnov', 'note.md', 'ok.jpnov'].join('\n');

  const diags = await diagnoseJpbook(uri, parseJpbook(text));
  // The localized text lives client-side; each diagnostic carries its {code,args} in `.data`.
  const codes = diags.map((d) => (d.data as { code: string }).code);

  assert.equal(diags.length, 5, 'ok.jpnov (first) produces no diagnostic');
  assert.equal(diags.filter((d) => d.severity === DiagnosticSeverity.Error).length, 4);
  assert.equal(diags.filter((d) => d.severity === DiagnosticSeverity.Warning).length, 1);
  assert.ok(codes.includes('jpbook.fileNotFound')); // missing.jpnov
  assert.ok(codes.includes('jpbook.entryIsDirectory')); // adir.jpnov
  assert.ok(codes.includes('jpbook.backslashSeparator')); // sub\bad.jpnov
  assert.ok(codes.includes('jpbook.notJpnov')); // note.md
  assert.ok(codes.includes('jpbook.duplicateEntry')); // 2nd ok.jpnov
  const notJp = diags.find((d) => (d.data as { code: string }).code === 'jpbook.notJpnov');
  assert.deepEqual((notJp?.data as { args: unknown[] }).args, ['note.md']);
});

test('diagnoseJpbook surfaces front-matter warnings/errors with the metadata severities', async () => {
  await using ws = await makeTmpWorkspace();
  await writeUnder(ws.dir, 'src/vol1/ok.jpnov', 'x');
  const uri = `${ws.uri}/src/vol1/index.jpbook`;
  const text = ['---', 'title: 一', 'author: x', 'title: 二', 'no colon here', '---', 'ok.jpnov'].join('\n');

  const diags = await diagnoseJpbook(uri, parseJpbook(text));
  const byCode = new Map(diags.map((d) => [(d.data as { code: string }).code, d]));

  assert.equal(diags.length, 3, 'valid meta lines, fences, and the ok chapter stay silent');
  assert.equal(byCode.get('jpbook.metaUnknownKey')?.severity, DiagnosticSeverity.Warning);
  assert.equal(byCode.get('jpbook.metaDuplicateKey')?.severity, DiagnosticSeverity.Warning);
  assert.equal(byCode.get('jpbook.metaNotKeyValue')?.severity, DiagnosticSeverity.Error);
});

test('diagnoseJpbook flags an unterminated front matter on the opening fence', async () => {
  await using ws = await makeTmpWorkspace();
  const uri = `${ws.uri}/index.jpbook`;
  const diags = await diagnoseJpbook(uri, parseJpbook('---\ntitle: t'));
  assert.equal(diags.length, 1);
  const only = diags[0];
  assert.ok(only);
  assert.equal((only.data as { code: string }).code, 'jpbook.metaUnterminated');
  assert.equal(only.range.start.line, 0);
  assert.equal(only.severity, DiagnosticSeverity.Error);
});

test('diagnoseJpbook does not check existence off the file: scheme (syntax-only)', async () => {
  // A valid-but-missing path on a virtual scheme: existence unverifiable, so no Error.
  const diags = await diagnoseJpbook('vscode-vfs://host/src/vol1/index.jpbook', parseJpbook('missing.jpnov'));
  assert.equal(diags.length, 0);
});

test('completeJpbook offers matching .jpnov files and drillable subdirs; hides .jpbook', async () => {
  await using ws = await makeTmpWorkspace();
  await writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
  await writeUnder(ws.dir, 'src/vol1/chapter2.jpnov', 'x');
  await writeUnder(ws.dir, 'src/vol1/sub/inner.jpnov', 'x'); // makes sub a directory
  const uri = `${ws.uri}/src/vol1/index.jpbook`;

  const ch = await completeLine(uri, 'ch', 2);
  assert.deepEqual(ch.map((i) => i.label).sort(), ['chapter1.jpnov', 'chapter2.jpnov']);

  const all = await completeLine(uri, '', 0);
  const sub = all.find((i) => i.label === 'sub');
  assert.ok(sub);
  assert.equal(sub.kind, CompletionItemKind.Folder);
  assert.equal(sub.textEdit?.newText, 'sub/');
  assert.ok(!all.some((i) => i.label === 'index.jpbook'), '.jpbook files are hidden');
});

test('completeJpbook routes front-matter lines to key/value completion (fs-free)', async () => {
  const uri = 'vscode-vfs://host/y/index.jpbook'; // meta completion must work off file: too
  const parsed = parseJpbook('---\npage\n---\na.jpnov');

  const keys = await completeJpbook(uri, parsed, 'page', { line: 1, character: 4 });
  assert.deepEqual(keys.map((i) => i.label), ['pageNumber', 'pageNumberFormat']);
  const firstKey = keys[0];
  assert.ok(firstKey);
  assert.equal(firstKey.kind, CompletionItemKind.Property);
  assert.equal(firstKey.textEdit?.newText, 'pageNumber: ');

  const vals = await completeJpbook(uri, parsed, 'pageNumber: n', { line: 1, character: 13 });
  assert.deepEqual(vals.map((i) => i.label), ['none']);
  assert.equal(vals[0]?.kind, CompletionItemKind.EnumMember);

  // On the fences themselves: nothing.
  assert.equal((await completeJpbook(uri, parsed, '---', { line: 0, character: 3 })).length, 0);
  assert.equal((await completeJpbook(uri, parsed, '---', { line: 2, character: 3 })).length, 0);
});

test('completeJpbook keeps offering keys inside an UNTERMINATED front matter', async () => {
  const parsed = parseJpbook('---\nti');
  const items = await completeJpbook('file:///proj/index.jpbook', parsed, 'ti', { line: 1, character: 2 });
  assert.deepEqual(items.map((i) => i.label), ['title']);
});

test('completeJpbook suppresses suggestions when the whole line already names a file', async () => {
  await using ws = await makeTmpWorkspace();
  await writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
  const uri = `${ws.uri}/src/vol1/index.jpbook`;
  const items = await completeLine(uri, 'chapter1.jpnov', 14);
  assert.equal(items.length, 0);
});

test('completeJpbook returns nothing off the file: scheme (chapter lines)', async () => {
  const items = await completeLine('vscode-vfs://host/y/index.jpbook', 'ch', 2);
  assert.equal(items.length, 0);
});

test('completeJpbook handles "./", absolute "/", and digit-leading names', async () => {
  await using ws = await makeTmpWorkspace();

  await writeUnder(ws.dir, 'src/vol1/01-intro.jpnov', 'x');
  await writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
  await writeUnder(ws.dir, 'src/vol1/sub/inner.jpnov', 'x'); // makes sub a directory
  const uri = `${ws.uri}/src/vol1/index.jpbook`;

  // "./" lists the book file's own directory (previously returned nothing).
  const dot = await completeLine(uri, './', 2);
  assert.deepEqual(dot.map((i) => i.label).sort(), ['01-intro.jpnov', 'chapter1.jpnov', 'sub']);

  // "./0" filters the current dir by a digit-leading segment.
  const dotDigit = await completeLine(uri, './0', 3);
  assert.deepEqual(dotDigit.map((i) => i.label), ['01-intro.jpnov']);

  // A bare digit-leading prefix resolves correctly (auto-trigger is editor-side; content is right).
  const digit = await completeLine(uri, '0', 1);
  assert.deepEqual(digit.map((i) => i.label), ['01-intro.jpnov']);

  // Absolute paths offer nothing (previously wrongly listed the current dir).
  assert.equal((await completeLine(uri, '/', 1)).length, 0);
  assert.equal((await completeLine(uri, '/etc', 4)).length, 0);
});

test('documentLinksForJpbook links every valid chapter line (existence not required); meta lines never link', () => {
  // Pure URI resolution — no fs needed, so a literal jpbook URI suffices.
  const uri = 'file:///proj/src/vol1/index.jpbook';
  const links = documentLinksForJpbook(
    uri,
    parseJpbook('---\ntitle: link.jpnov\n---\nchapter1.jpnov\nmissing.jpnov\n\nnote.md'),
  );
  // chapter1.jpnov + missing.jpnov link (both syntactically ok); the meta value, blank, and
  // note.md (non-.jpnov) do not.
  const targets = links.map((l) => l.target);
  assert.equal(links.length, 2);
  assert.ok(targets[0]?.endsWith('/src/vol1/chapter1.jpnov'));
  assert.ok(targets[1]?.endsWith('/src/vol1/missing.jpnov'));
});
