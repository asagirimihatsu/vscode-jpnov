/**
 * Integration tests for the impure `*.filelist` editor features (diagnostics, completion,
 * document links) against real `file:` fixtures. Authored for the server stage; NOT wired
 * into `npm test`. Run with:
 *   node --test --experimental-test-module-mocks "test/server/filelist.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CompletionItemKind, DiagnosticSeverity } from 'vscode-languageserver/node';

import {
  completeFilelist,
  diagnoseFilelist,
  documentLinksForFilelist,
} from '../../src/server/filelist.ts';
import { makeTmpWorkspace, writeUnder } from './helpers.ts';

test('diagnoseFilelist flags missing / directory / backslash / non-.jpnov as Error and dupes as Warning', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'src/vol1/ok.jpnov', 'x');
    writeUnder(ws.dir, 'src/vol1/adir.jpnov/keep', 'x'); // makes adir.jpnov a directory
    const uri = `${ws.uri}/src/vol1/index.filelist`;
    const text = ['ok.jpnov', 'missing.jpnov', 'adir.jpnov', 'sub\\bad.jpnov', 'note.md', 'ok.jpnov'].join('\n');

    const diags = await diagnoseFilelist(uri, text);
    // Diagnostic.message is `string | MarkupContent` in LSP types; ours are always strings.
    const messages = diags.map((d) => (typeof d.message === 'string' ? d.message : d.message.value));

    assert.equal(diags.length, 5, 'ok.jpnov (first) produces no diagnostic');
    assert.equal(diags.filter((d) => d.severity === DiagnosticSeverity.Error).length, 4);
    assert.equal(diags.filter((d) => d.severity === DiagnosticSeverity.Warning).length, 1);
    assert.ok(messages.some((m) => m.includes('not found')));
    assert.ok(messages.some((m) => m.includes('directory')));
    assert.ok(messages.some((m) => m.includes('\\')));
    assert.ok(messages.some((m) => m.includes('.jpnov') && m.includes('note.md')));
    assert.ok(messages.some((m) => m.includes('duplicate')));
  } finally {
    ws.cleanup();
  }
});

test('diagnoseFilelist does not check existence off the file: scheme (syntax-only)', async () => {
  // A valid-but-missing path on a virtual scheme: existence unverifiable, so no Error.
  const diags = await diagnoseFilelist('vscode-vfs://host/src/vol1/index.filelist', 'missing.jpnov');
  assert.equal(diags.length, 0);
});

test('completeFilelist offers matching .jpnov files and drillable subdirs; hides .filelist', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
    writeUnder(ws.dir, 'src/vol1/chapter2.jpnov', 'x');
    writeUnder(ws.dir, 'src/vol1/sub/inner.jpnov', 'x'); // makes sub a directory
    const uri = `${ws.uri}/src/vol1/index.filelist`;

    const ch = await completeFilelist(uri, 'ch', { line: 0, character: 2 });
    assert.deepEqual(ch.map((i) => i.label).sort(), ['chapter1.jpnov', 'chapter2.jpnov']);

    const all = await completeFilelist(uri, '', { line: 0, character: 0 });
    const sub = all.find((i) => i.label === 'sub');
    assert.ok(sub);
    assert.equal(sub.kind, CompletionItemKind.Folder);
    assert.equal(sub.textEdit?.newText, 'sub/');
    assert.ok(!all.some((i) => i.label === 'index.filelist'), '.filelist files are hidden');
  } finally {
    ws.cleanup();
  }
});

test('completeFilelist suppresses suggestions when the whole line already names a file', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
    const uri = `${ws.uri}/src/vol1/index.filelist`;
    const items = await completeFilelist(uri, 'chapter1.jpnov', { line: 0, character: 14 });
    assert.equal(items.length, 0);
  } finally {
    ws.cleanup();
  }
});

test('completeFilelist returns nothing off the file: scheme', async () => {
  const items = await completeFilelist('vscode-vfs://host/y/index.filelist', 'ch', { line: 0, character: 2 });
  assert.equal(items.length, 0);
});

test('completeFilelist handles "./", absolute "/", and digit-leading names', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'src/vol1/01-intro.jpnov', 'x');
    writeUnder(ws.dir, 'src/vol1/chapter1.jpnov', 'x');
    writeUnder(ws.dir, 'src/vol1/sub/inner.jpnov', 'x'); // makes sub a directory
    const uri = `${ws.uri}/src/vol1/index.filelist`;

    // "./" lists the filelist's own directory (previously returned nothing).
    const dot = await completeFilelist(uri, './', { line: 0, character: 2 });
    assert.deepEqual(dot.map((i) => i.label).sort(), ['01-intro.jpnov', 'chapter1.jpnov', 'sub']);

    // "./0" filters the current dir by a digit-leading segment.
    const dotDigit = await completeFilelist(uri, './0', { line: 0, character: 3 });
    assert.deepEqual(dotDigit.map((i) => i.label), ['01-intro.jpnov']);

    // A bare digit-leading prefix resolves correctly (auto-trigger is editor-side; content is right).
    const digit = await completeFilelist(uri, '0', { line: 0, character: 1 });
    assert.deepEqual(digit.map((i) => i.label), ['01-intro.jpnov']);

    // Absolute paths offer nothing (previously wrongly listed the current dir).
    assert.equal((await completeFilelist(uri, '/', { line: 0, character: 1 })).length, 0);
    assert.equal((await completeFilelist(uri, '/etc', { line: 0, character: 4 })).length, 0);
  } finally {
    ws.cleanup();
  }
});

test('documentLinksForFilelist links every valid line (existence not required) to its resolved URI', () => {
  // Pure URI resolution — no fs needed, so a literal filelist URI suffices.
  const uri = 'file:///proj/src/vol1/index.filelist';
  const links = documentLinksForFilelist(uri, 'chapter1.jpnov\nmissing.jpnov\n\nnote.md');
  // chapter1.jpnov + missing.jpnov link (both syntactically ok); blank + note.md (non-.jpnov) do not.
  const targets = links.map((l) => l.target);
  assert.equal(links.length, 2);
  assert.ok(targets[0]?.endsWith('/src/vol1/chapter1.jpnov'));
  assert.ok(targets[1]?.endsWith('/src/vol1/missing.jpnov'));
});
