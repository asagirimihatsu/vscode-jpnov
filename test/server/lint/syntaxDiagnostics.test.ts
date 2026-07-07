/**
 * Editor-surface tests for src/server/syntax.ts — the always-on unclosed-［＃ Error diagnostics
 * that publishFindings merges ahead of the lint findings. Pure + import-light (relative imports
 * only in the graph), so it runs on Node's native test loader inside the `test/server/lint/**`
 * npm-test glob. The span logic itself is covered in test/shared/compiler/tokenizer.test.ts via
 * `findBrokenAnnotations`; these tests pin the LSP mapping (Range / severity / code / source).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { annotationDiagnostics } from '../../../src/server/syntax.ts';

const doc = (text: string): TextDocument =>
  TextDocument.create('mem://x.jpnov', 'novel-jp', 1, text);

test('a clean document yields no syntax diagnostics', () => {
  assert.deepEqual(annotationDiagnostics(doc('本文［＃見出し］と《るび》。')), []);
});

test('an unclosed ［＃ yields one Error covering ［＃…-to-line-end', () => {
  const diags = annotationDiagnostics(doc('本［＃こわれ\n次の行'));
  assert.equal(diags.length, 1);
  const d = diags[0];
  assert.ok(d);
  assert.equal(d.severity, DiagnosticSeverity.Error);
  assert.equal(d.source, 'jpnov');
  assert.deepEqual(d.data, { code: 'syntax.unclosedAnnotation' });
  assert.equal(d.message, 'unterminated ［＃ annotation (missing ］)');
  assert.deepEqual(d.range, {
    start: { line: 0, character: 1 },
    end: { line: 0, character: 6 }, // just past こわれ, before the \n
  });
});

test('the Error range excludes the \\r of a CRLF terminator', () => {
  const diags = annotationDiagnostics(doc('［＃注\r\n次'));
  assert.deepEqual(diags[0]?.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 3 },
  });
});

test('one Error per broken line; lone ］ / 《 / 》 raise nothing', () => {
  const diags = annotationDiagnostics(doc('a［＃x\nb［＃y\n単独の］と《ひらき\nルビ》'));
  assert.equal(diags.length, 2);
  assert.deepEqual(diags.map((d) => d.range.start.line), [0, 1]);
});

test('an unclosed ［＃ at end of input (no trailing newline) spans to the document end', () => {
  const diags = annotationDiagnostics(doc('これは［＃壊れた'));
  assert.deepEqual(diags[0]?.range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 8 },
  });
});
