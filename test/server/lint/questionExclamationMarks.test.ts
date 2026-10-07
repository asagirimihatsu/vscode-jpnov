/**
 * questionExclamationMarks: a half-width pair with no 縦中横 annotation is flagged, and the fix
 * sets it in one cell: `fullWidth` replaces it with one character, `tcy` writes the annotation.
 * What the rule reports follows what the resolver decided, so the cases run the engine on a
 * parse, and the fixes run the way the editor applies them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tcyAnnotation } from '../../../src/shared/ast/notation.ts';
import { parse } from '../../../src/shared/ast/parse.ts';
import type { RawLintConfigWire } from '../../../src/shared/protocol.ts';
import { D } from '../../shared/_kana.ts';
import { manuscripts } from '../../shared/ast/_fuzz.ts';
import { contentOf } from '../../shared/ast/_shape.ts';
import { applyFixAll, lintFindings } from '../helpers.ts';

const KEY = 'jpnov.lint.common.questionExclamationMarks';
const TCY: RawLintConfigWire = { [KEY]: 'tcy' };
const FULL: RawLintConfigWire = { [KEY]: 'fullWidth' };
const MODES = [TCY, FULL];
const CODE = 'lint.common.questionExclamationMarks';

interface Hit {
  readonly code: string;
  readonly args: readonly unknown[];
  readonly text: string;
  readonly fix?: string;
}

/** Each finding under `raw` as its code, its args, the source it flags and what the fix writes there. */
function lint(src: string, raw: RawLintConfigWire = TCY): Hit[] {
  const { doc, findings } = lintFindings(src, raw);
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

/** The source after the editor's fix-all under `raw`. */
const fixed = (src: string, raw: RawLintConfigWire = TCY): string => applyFixAll(src, raw);

const wrap = (pair: string): string => pair + tcyAnnotation(pair);

/** Nothing is reported for `src`, whatever the setting. */
function silent(src: string): void {
  for (const raw of MODES) {
    assert.deepEqual(lint(src, raw), [], src);
  }
}

test('tcy: a pair is flagged over its two marks, and the fix writes the annotation after it', () => {
  assert.deepEqual(lint('えっ!?と叫んだ。'), [
    { code: `${CODE}.tcy`, args: ['!?'], text: '!?', fix: '!?［＃「!?」は縦中横］' },
  ]);
  assert.equal(fixed('えっ!?と叫んだ。'), 'えっ!?［＃「!?」は縦中横］と叫んだ。');
  assert.deepEqual(contentOf(fixed('えっ!?')), [['chars えっ', 'tcy !?']]);
});

test('fullWidth: a pair is flagged over its two marks, and the fix replaces it with its character', () => {
  assert.deepEqual(lint('えっ!?と叫んだ。', FULL), [{ code: CODE, args: ['!?', '⁉'], text: '!?', fix: '⁉' }]);
  assert.equal(fixed('えっ!?と叫んだ。', FULL), 'えっ⁉と叫んだ。');
  assert.equal(fixed('あ!!い??う?!え!?', FULL), 'あ‼い⁇う⁈え⁉');
  assert.equal(fixed('「!?」\r\nWhat?!', FULL), '「⁉」\r\nWhat⁈');
  assert.deepEqual(lint('えっ⁉と叫んだ。', FULL), []);
});

test('tcy: every pair on a line gets its own annotation, wherever it sits', () => {
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
    silent(src);
  }
  // A span ends with its line: the pair on the next one is a pair again.
  assert.equal(fixed('［＃縦中横］!?\nまた!?'), `［＃縦中横］!?\nまた${wrap('!?')}`);
  assert.equal(fixed('［＃縦中横］!?\nまた!?', FULL), '［＃縦中横］!?\nまた⁉');
});

test('a run is two half-width marks, no more: the full-width ones beside it do not count', () => {
  for (const src of ['わっ!!!', 'え????', 'お!?!だ', '!!!!', 'え！？', 'あ!か']) {
    silent(src);
  }
  assert.equal(fixed('え!!？'), `え${wrap('!!')}？`);
  assert.equal(fixed('え!!？', FULL), 'え‼？');
  // Markup between two marks ends the run.
  assert.equal(fixed('!［＃太字］!?'), `!［＃太字］${wrap('!?')}`);
  assert.equal(fixed('!［＃太字］!?', FULL), '!［＃太字］⁉');
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
    silent(src);
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
    silent(src);
  }
  assert.equal(fixed('!?《!?》!?'), `${wrap('!?')}《!?》${wrap('!?')}`);
  assert.equal(fixed('!?《!?》!?', FULL), '⁉《!?》⁉');
  // A 《 with no 》 after it is a character like any other.
  assert.equal(fixed('《!?と叫んだ。'), `《${wrap('!?')}と叫んだ。`);
});

test('tcy: an annotation that takes the whole pair still takes effect once the pair is one cell', () => {
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

test('tcy: a pair that an annotation takes one mark of is flagged without a fix, by the target that cuts it', () => {
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
    assert.deepEqual(lint(src), [{ code: `${CODE}.cut`, args: [target, '!?'], text: '!?' }], src);
    assert.equal(fixed(src), src);
  }
});

test('fullWidth: a pair an annotation names is replaced like any other, and the annotation then misses its target', () => {
  for (const src of ['なに!?［＃「なに!?」に傍点］', 'なに!?［＃「に!」に傍点］', '王都!?［＃「都!」は大見出し］']) {
    assert.deepEqual(lint(src, FULL), [{ code: CODE, args: ['!?', '⁉'], text: '!?', fix: '⁉' }], src);
    const out = fixed(src, FULL);
    assert.equal(out, src.replace('!?', '⁉'));
    assert.deepEqual(parse(src).issues, [], src);
    assert.deepEqual(parse(out).issues.map((issue) => issue.kind), ['postfixTargetMissing'], src);
  }
});

test('tcy: the fix sits between the pair and what another fix adds beside it', () => {
  const space: RawLintConfigWire = { ...TCY, 'jpnov.lint.common.exclamationSpace': true };
  assert.equal(fixed('　えっ!?次の文。', space), `　えっ${wrap('!?')}　次の文。`);
  assert.equal(fixed('　えっ!?［＃太字］次の文。［＃太字終わり］', space), `　えっ${wrap('!?')}　［＃太字］次の文。［＃太字終わり］`);
  const trailing: RawLintConfigWire = { ...TCY, 'jpnov.lint.common.noTrailingSpace': true };
  assert.equal(fixed('　叫んだ!?　', trailing), `　叫んだ${wrap('!?')}`);
  const indent: RawLintConfigWire = { ...TCY, 'jpnov.lint.narration.indent': true };
  assert.equal(fixed('!?と叫んだ。', indent), `　${wrap('!?')}と叫んだ。`);
});

test('fullWidth: the replacement lands with what another fix adds beside it', () => {
  const space: RawLintConfigWire = { ...FULL, 'jpnov.lint.common.exclamationSpace': true };
  assert.equal(fixed('　えっ!?次の文。', space), '　えっ⁉　次の文。');
  const trailing: RawLintConfigWire = { ...FULL, 'jpnov.lint.common.noTrailingSpace': true };
  assert.equal(fixed('　叫んだ!?　', trailing), '　叫んだ⁉');
  const indent: RawLintConfigWire = { ...FULL, 'jpnov.lint.narration.indent': true };
  assert.equal(fixed('!?と叫んだ。', indent), '　⁉と叫んだ。');
});

test('a full-width double takes two rounds: the width first, then the form the setting names', () => {
  for (const [raw, last] of [[TCY, `「なに${wrap('!?')}」`], [FULL, '「なに⁉」']] as const) {
    const both: RawLintConfigWire = { ...raw, 'jpnov.lint.common.exclamationRun': true };
    const once = fixed('「なに！？」', both);
    assert.equal(once, '「なに!?」');
    const twice = fixed(once, both);
    assert.equal(twice, last);
    assert.equal(fixed(twice, both), twice);
  }
});

test('tcy, over any manuscript: the fixes leave nothing to fix, and no annotation stops taking effect', () => {
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

test('fullWidth, over any manuscript: the fixes leave nothing to report, and all they cost is an annotation its target', () => {
  const others = (src: string): string[] => parse(src).issues.map((issue) => issue.kind).filter((kind) => kind !== 'postfixTargetMissing');
  for (const src of manuscripts()) {
    const out = fixed(src, FULL);
    assert.deepEqual(lint(out, FULL), [], JSON.stringify(src));
    assert.deepEqual(others(out), others(src), JSON.stringify(src));
    assert.ok(parse(out).issues.length >= parse(src).issues.length, JSON.stringify(src));
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
    for (const raw of MODES) {
      assert.equal(lint(unit.repeat(many), raw).length, found, unit);
    }
  }
});
