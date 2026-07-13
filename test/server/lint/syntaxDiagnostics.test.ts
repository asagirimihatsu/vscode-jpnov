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

// --------------------------------------------------------------- block pairing Warnings

test('an unterminated ここから block yields one Warning over the ここから body', () => {
  const diags = annotationDiagnostics(doc('［＃ここから２字下げ］\n本文だけで終わる'));
  assert.equal(diags.length, 1);
  const d = diags[0];
  assert.ok(d);
  assert.equal(d.severity, DiagnosticSeverity.Warning);
  assert.deepEqual(d.data, { code: 'syntax.unterminatedBlock' });
  assert.equal(d.message, 'unterminated block annotation (missing ［＃ここで…終わり］)');
  assert.deepEqual(d.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 11 }, // ［＃ここから２字下げ］
  });
});

test('a dangling ここで…終わり yields one Warning over the 終わり body', () => {
  const diags = annotationDiagnostics(doc('本文\n［＃ここで字下げ終わり］'));
  assert.equal(diags.length, 1);
  const d = diags[0];
  assert.ok(d);
  assert.equal(d.severity, DiagnosticSeverity.Warning);
  assert.deepEqual(d.data, { code: 'syntax.danglingBlockEnd' });
  assert.equal(d.message, 'block-end annotation without a matching start');
  assert.deepEqual(d.range, {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 12 }, // ［＃ここで字下げ終わり］
  });
});

test('a balanced block pair yields no diagnostics', () => {
  assert.deepEqual(
    annotationDiagnostics(doc('［＃ここから２字下げ］\n本文\n［＃ここで字下げ終わり］')),
    [],
  );
});

test('a same-channel re-open replaces the slot (last-wins) — balanced, no Warning', () => {
  // ２字下げ → ４字下げ is a legal amount change (render is last-wins); one ここで clears it.
  // A stack model would wrongly flag the first ここから as unterminated (diagnostic ≠ render).
  assert.deepEqual(
    annotationDiagnostics(
      doc('［＃ここから２字下げ］\n本文\n［＃ここから４字下げ］\n本文\n［＃ここで字下げ終わり］'),
    ),
    [],
  );
});

test('lexical Errors come first, then block Warnings', () => {
  const diags = annotationDiagnostics(doc('［＃ここから太字］\n壊れ［＃こわれ'));
  assert.deepEqual(
    diags.map((d) => d.severity),
    [DiagnosticSeverity.Error, DiagnosticSeverity.Warning],
  );
});

// --------------------------------------------------------------- 縦中横 Warnings

test('縦中横 structural issues surface as Warnings with their codes', () => {
  const unterminated = annotationDiagnostics(doc('序［＃縦中横］12'));
  assert.equal(unterminated.length, 1);
  const d = unterminated[0];
  assert.ok(d);
  assert.equal(d.severity, DiagnosticSeverity.Warning);
  assert.deepEqual(d.data, { code: 'syntax.unterminatedTcy' });
  assert.deepEqual(annotationDiagnostics(doc('［＃縦中横終わり］'))[0]?.data, {
    code: 'syntax.danglingTcyEnd',
  });
  assert.deepEqual(annotationDiagnostics(doc('［＃縦中横］1234［＃縦中横終わり］'))[0]?.data, {
    code: 'syntax.tcyTooLong',
  });
  assert.deepEqual(annotationDiagnostics(doc('令和［＃縦中横］12［＃縦中横終わり］年')), []);
});

// --------------------------------------------------------------- postfix target Warnings (#12)

test('an unresolved postfix target yields one Warning over the annotation, carrying the target', () => {
  const diags = annotationDiagnostics(doc('別の文［＃「無」に傍点］'));
  assert.equal(diags.length, 1);
  const d = diags[0];
  assert.ok(d);
  assert.equal(d.severity, DiagnosticSeverity.Warning);
  assert.equal(d.source, 'jpnov');
  assert.deepEqual(d.data, { code: 'syntax.postfixTargetMissing', args: ['無'] });
  assert.equal(d.message, 'annotation target "無" not found or not aligned on this line');
  assert.deepEqual(d.range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 12 }, // ［＃「無」に傍点］
  });
});

test('a boundary-unaligned target warns; whole-unit and plain-text matches stay silent', () => {
  // 字 cuts into the atomic ruby unit 漢字 → Warning (the mark is not applied).
  assert.equal(annotationDiagnostics(doc('漢字《かんじ》［＃「字」に傍点］')).length, 1);
  // Whole-unit coverage and plain-prose substrings are aligned → clean.
  assert.deepEqual(annotationDiagnostics(doc('漢字《かんじ》［＃「漢字」に傍点］')), []);
  assert.deepEqual(annotationDiagnostics(doc('文字［＃「字」に傍点］')), []);
});
