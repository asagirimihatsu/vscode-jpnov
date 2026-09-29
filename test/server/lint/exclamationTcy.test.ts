/**
 * exclamationTcy: a half-width pair with no 縦中横 annotation is flagged, and the fix writes
 * it. What the rule reports follows what the resolver decided, so the cases run the
 * engine on a parse, and the fixes run the way the editor applies them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CodeActionKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { tcyAnnotation } from '../../../src/shared/ast/notation.ts';
import { parse } from '../../../src/shared/ast/parse.ts';
import type { RawLintConfigWire } from '../../../src/shared/protocol.ts';
import { buildCodeActions } from '../../../src/server/lint/codeActions.ts';
import { D } from '../../shared/_kana.ts';
import { manuscripts } from '../../shared/ast/_fuzz.ts';
import { contentOf } from '../../shared/ast/_shape.ts';
import { lintFindings } from '../helpers.ts';

const TCY: RawLintConfigWire = { 'jpnov.lint.common.exclamationTcy': true };

interface Hit {
  readonly code: string;
  readonly args: readonly unknown[];
  readonly text: string;
  readonly fix?: string;
}

/** Each finding of the rule as its code, its args, the source it flags and what the fix writes there. */
function lint(src: string): Hit[] {
  const { doc, findings } = lintFindings(src, TCY);
  return findings.map((f) => {
    const data = f.diagnostic.data as { code: string; args?: readonly unknown[] };
    return {
      code: data.code,
      args: data.args ?? [],
      text: doc.getText(f.diagnostic.range),
      ...(f.fix === undefined ? {} : { fix: f.fix.newText }),
    };
  });
}

/** The source after the editor's fix-all under `raw`: the action's edits, applied as LSP applies them. */
function fixed(src: string, raw: RawLintConfigWire = TCY): string {
  const { doc, findings } = lintFindings(src, raw);
  const whole = { start: doc.positionAt(0), end: doc.positionAt(src.length) };
  const [action] = buildCodeActions(doc.uri, findings, whole, [CodeActionKind.SourceFixAll]);
  return TextDocument.applyEdits(doc, action?.edit?.changes?.[doc.uri] ?? []);
}

const wrap = (pair: string): string => pair + tcyAnnotation(pair);

test('a pair is flagged over its two marks, and the fix writes the annotation after it', () => {
  assert.deepEqual(lint('えっ!?と叫んだ。'), [
    { code: 'lint.common.exclamationTcy', args: ['!?'], text: '!?', fix: '!?［＃「!?」は縦中横］' },
  ]);
  assert.equal(fixed('えっ!?と叫んだ。'), 'えっ!?［＃「!?」は縦中横］と叫んだ。');
  assert.deepEqual(contentOf(fixed('えっ!?')), [['chars えっ', 'tcy !?']]);
});

test('every pair on a line gets its own annotation, wherever it sits', () => {
  assert.equal(fixed('あ!!い!?う!!'), `あ${wrap('!!')}い${wrap('!?')}う${wrap('!!')}`);
  assert.equal(fixed('!!です'), `${wrap('!!')}です`);
  assert.equal(fixed('（!?）'), `（${wrap('!?')}）`);
  assert.equal(fixed('「!?」'), `「${wrap('!?')}」`);
  assert.equal(fixed('What?!'), `What${wrap('?!')}`);
  assert.equal(fixed('!?［＃太字］'), `${wrap('!?')}［＃太字］`);
  assert.equal(fixed('えっ!?\r\n次'), `えっ${wrap('!?')}\r\n次`);
});

test('a pair that is 縦中横 already is left alone', () => {
  for (const src of [
    'えっ!?［＃「!?」は縦中横］」と叫んだ',
    '［＃縦中横］!?［＃縦中横終わり］',
    'なに!?［＃「なに!?」は縦中横］', // a longer 縦中横 holds it
  ]) {
    assert.deepEqual(lint(src), [], src);
  }
  // A span ends with its line: the pair on the next one is a pair again.
  assert.equal(fixed('［＃縦中横］!?\nまた!?'), `［＃縦中横］!?\nまた${wrap('!?')}`);
});

test('a run is two half-width marks, no more: the full-width ones beside it do not count', () => {
  for (const src of ['わっ!!!', 'え????', 'お!?!だ', '!!!!', 'え！？', 'あ!か']) {
    assert.deepEqual(lint(src), [], src);
  }
  assert.equal(fixed('え!!？'), `え${wrap('!!')}？`);
  // Markup between two marks ends the run.
  assert.equal(fixed('!［＃太字］!?'), `!［＃太字］${wrap('!?')}`);
});

test('a pair a ruby holds is left alone: a base, a reading, what a left ruby takes as its base', () => {
  for (const src of [
    '｜!?《はてな》',
    '｜!?［＃x］《はてな》',
    '漢《!?》',
    'なに!?｜語［＃「なに!?」の左に「ナニ」のルビ］《ご》',
    `にか${D}!?［＃「が!?」の左に「よみ」のルビ］`,
    '𠮷!?［＃「𠮷!?」の左に「よし」のルビ］',
  ]) {
    assert.deepEqual(lint(src), [], src);
  }
  const held = 'なに!?［＃「なに!?」の左に「ナニ」のルビ］と叫んだ!?';
  assert.equal(fixed(held), `なに!?［＃「なに!?」の左に「ナニ」のルビ］と叫んだ${wrap('!?')}`);
  // The left ruby takes the last occurrence: the one before it is body text.
  assert.equal(
    fixed('なに!?となに!?［＃「なに!?」の左に「ナニ」のルビ］'),
    `なに${wrap('!?')}となに!?［＃「なに!?」の左に「ナニ」のルビ］`,
  );
  // A left ruby that takes no effect holds nothing.
  assert.equal(
    fixed('なに!?［＃「別文!?」の左に「よみ」のルビ］'),
    `なに${wrap('!?')}［＃「別文!?」の左に「よみ」のルビ］`,
  );
});

test('a pair inside a 《…》 that made no ruby is left alone: an annotation there prints as characters', () => {
  for (const src of ['《!?》と叫んだ。', '｜［＃メモ］《!?》', '《あ!?い?!》', '《!?［＃「!?」は縦中横］》と叫んだ。']) {
    assert.deepEqual(lint(src), [], src);
  }
  assert.equal(fixed('!?《!?》!?'), `${wrap('!?')}《!?》${wrap('!?')}`);
  // A 《 with no 》 after it is a character like any other.
  assert.equal(fixed('《!?と叫んだ。'), `《${wrap('!?')}と叫んだ。`);
});

test('an annotation that takes the whole pair still takes effect once the pair is one cell', () => {
  const emphasis = fixed('なに!?［＃「に!?」に傍点］');
  assert.equal(emphasis, `なに${wrap('!?')}［＃「に!?」に傍点］`);
  assert.deepEqual(contentOf(emphasis), [['chars な', 'chars に emph=傍点', 'tcy !? emph=傍点']]);
  assert.deepEqual(contentOf(fixed('なに!?［＃「なに!?」は太字］')), [['chars なに weight=太字', 'tcy !? weight=太字']]);
  const heading = fixed('王都!?［＃「王都!?」は大見出し］');
  assert.equal(parse(heading).lines[0]?.heading, 1);
  for (const src of [emphasis, heading]) {
    assert.deepEqual(parse(src).issues, [], src);
  }
});

test('a pair that an annotation takes one mark of is flagged without a fix, by the target that cuts it', () => {
  const cases: readonly (readonly [src: string, target: string])[] = [
    ['なに!?［＃「に!」に傍点］', 'に!'],
    ['なに!?［＃「?」は太字］', '?'],
    ['なに!?［＃「に!」は縦中横］', 'に!'],
    ['なに!?［＃「なに!」の左に「ナニ」のルビ］', 'なに!'],
    ['王都!?［＃「都!」は大見出し］', '都!'],
    // The marks are the span's on both sides of the cut: only what the postfix bound to tells.
    ['［＃傍点］なに!?［＃「に!」に傍点］［＃傍点終わり］', 'に!'],
    // The editor resolves without values: the field shows its name.
    ['［＃ここに「タイトル」の値を表示］!?［＃「ル!」は縦中横］', 'ル!'],
    ['［＃ここに「タイトル」の値を表示］!?［＃「ル!」に傍点］', 'ル!'],
  ];
  for (const [src, target] of cases) {
    assert.deepEqual(lint(src), [{ code: 'lint.common.exclamationTcy.cut', args: [target, '!?'], text: '!?' }], src);
    assert.equal(fixed(src), src);
  }
});

test('the fix sits between the pair and what another fix adds beside it', () => {
  const space: RawLintConfigWire = { ...TCY, 'jpnov.lint.common.exclamationSpace': true };
  assert.equal(fixed('　えっ!?次の文。', space), `　えっ${wrap('!?')}　次の文。`);
  assert.equal(fixed('　えっ!?［＃太字］次の文。［＃太字終わり］', space), `　えっ${wrap('!?')}　［＃太字］次の文。［＃太字終わり］`);
  const trailing: RawLintConfigWire = { ...TCY, 'jpnov.lint.common.noTrailingSpace': true };
  assert.equal(fixed('　叫んだ!?　', trailing), `　叫んだ${wrap('!?')}`);
  const indent: RawLintConfigWire = { ...TCY, 'jpnov.lint.narration.indent': true };
  assert.equal(fixed('!?と叫んだ。', indent), `　${wrap('!?')}と叫んだ。`);
});

test('a full-width double takes two rounds: the width first, then the annotation', () => {
  const both: RawLintConfigWire = { ...TCY, 'jpnov.lint.common.exclamationRun': true };
  const once = fixed('「なに！？」', both);
  assert.equal(once, '「なに!?」');
  const twice = fixed(once, both);
  assert.equal(twice, `「なに${wrap('!?')}」`);
  assert.equal(fixed(twice, both), twice);
});

test('over any manuscript: the fixes leave nothing to fix, and no annotation stops taking effect', () => {
  for (const src of manuscripts()) {
    const out = fixed(src);
    assert.deepEqual(lint(out).filter((hit) => hit.fix !== undefined), [], JSON.stringify(src));
    assert.deepEqual(
      parse(out).issues.map((issue) => issue.kind),
      parse(src).issues.map((issue) => issue.kind),
      JSON.stringify(src),
    );
  }
});

test('a line of any length is read once', () => {
  const many = 50_000;
  for (const [unit, found] of [
    ['あ!?', many], // one text node
    ['あ!?［＃メモ］', many], // a piece and a comment each
    ['。《!?》', 0], // a 《…》 that made no ruby each
    ['に!?［＃「に!」に傍点］', many], // a cut each
  ] as const) {
    assert.equal(lint(unit.repeat(many)).length, found, unit);
  }
});
