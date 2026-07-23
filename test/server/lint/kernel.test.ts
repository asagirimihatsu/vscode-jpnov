/**
 * End-to-end driver tests: a real `TextlintKernel` runs over the extracted streams, and every hit is
 * checked for (a) the right diagnostic code and (b) a source range that slices back to the offending
 * text. Exercises kernel rules, pre-scans, the common fan-out, and stream separation together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { computeLintFindings } from '../../../src/server/lint/kernel.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';
import type { RawLintConfigWire } from '../../../src/shared/protocol.ts';

interface Hit {
  readonly code: string;
  readonly text: string;
  readonly fix?: { readonly text: string; readonly newText: string };
}

/** Run the driver and project each finding to { code, flagged source text, optional fix }. */
async function lintAll(src: string, raw: RawLintConfigWire): Promise<Hit[]> {
  const doc = TextDocument.create('mem://x.jpnov', 'jpnov', 1, src);
  const result = computeLintFindings(src, selectRules(raw), doc);
  const findings = Array.isArray(result) ? result : await result;
  const slice = (r: { start: { line: number; character: number }; end: { line: number; character: number } }): string =>
    src.slice(doc.offsetAt(r.start), doc.offsetAt(r.end));
  return findings.map((f) => ({
    code: (f.diagnostic.data as { code: string }).code,
    text: slice(f.diagnostic.range),
    ...(f.fix ? { fix: { text: slice(f.fix.range), newText: f.fix.newText } } : {}),
  }));
}

/** Just the { code, text } of each finding (fix-agnostic tests). */
async function lint(src: string, raw: RawLintConfigWire): Promise<{ code: string; text: string }[]> {
  return (await lintAll(src, raw)).map(({ code, text }) => ({ code, text }));
}

/** Apply every fix (right-to-left so offsets stay valid) and return the resulting source — the real
 *  "does the fix corrupt the text?" check (no deleted chars, no eaten newlines). */
async function applied(src: string, raw: RawLintConfigWire): Promise<string> {
  const doc = TextDocument.create('mem://x.jpnov', 'jpnov', 1, src);
  const result = computeLintFindings(src, selectRules(raw), doc);
  const findings = Array.isArray(result) ? result : await result;
  const edits = findings
    .flatMap((f) =>
      f.fix ? [{ s: doc.offsetAt(f.fix.range.start), e: doc.offsetAt(f.fix.range.end), t: f.fix.newText }] : [],
    )
    .sort((a, b) => b.s - a.s);
  let out = src;
  for (const ed of edits) {
    out = out.slice(0, ed.s) + ed.t + out.slice(ed.e);
  }
  return out;
}

/** The ダッシュ rule on its shipped default (HORIZONTAL BAR ―). */
const DASH_BAR: RawLintConfigWire = { 'jpnov.lint.common.dash': 'horizontalBar' };

test('no rules enabled -> synchronous empty result', () => {
  const doc = TextDocument.create('mem://x.jpnov', 'jpnov', 1, '　半 角 が あ る。');
  const result = computeLintFindings(doc.getText(), selectRules({}), doc);
  assert.deepEqual(result, []); // not a Promise
});

// --- the common fan-out: one setting runs on BOTH narration and dialogue ---

test('a common rule sees content INSIDE 「」 (dialogue stream)', async () => {
  assert.deepEqual(await lint('「彼は—と」', DASH_BAR), [{ code: 'lint.common.dash', text: '—' }]);
});

test('a prescan message reaches Diagnostic.data whole, args included', async () => {
  // renderEnglish substitutes a missing arg with '', so a dropped arg would surface only here
  const doc = TextDocument.create('mem://x.jpnov', 'jpnov', 1, '彼は——と');
  const result = computeLintFindings(doc.getText(), selectRules(DASH_BAR), doc);
  const findings = Array.isArray(result) ? result : await result;
  assert.deepEqual(
    findings.map((f) => f.diagnostic.data as unknown),
    [{ code: 'lint.common.dash', args: ['―'] }],
  );
  assert.equal(findings[0]?.diagnostic.message, 'use the configured dash character (―)');
});

test('a common rule fires in BOTH streams (narration + dialogue) under one code', async () => {
  // first — is narration, the second is inside the quote
  const hits = await lint('—と「—」', DASH_BAR);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.code === 'lint.common.dash' && h.text === '—'));
});

test('common maxTen counts the (max+1)-th 読点 of a sentence', async () => {
  assert.deepEqual(await lint('あ、い、う、え、お。', { 'jpnov.lint.common.maxTen': 3 }), [
    { code: 'lint.common.maxTen', text: '、' },
  ]);
});

test('common maxTen also counts within a dialogue utterance', async () => {
  assert.deepEqual(await lint('「あ、い、う、え、お」', { 'jpnov.lint.common.maxTen': 3 }), [
    { code: 'lint.common.maxTen', text: '、' },
  ]);
});

test('common sentenceLength fires on an over-long sentence', async () => {
  const hits = await lint('あいうえおかきくけこ。', { 'jpnov.lint.common.sentenceLength': 5 });
  assert.ok(hits.some((h) => h.code === 'lint.common.sentenceLength'));
});

test('common noUnmatchedPair flags an unclosed bracket', async () => {
  const hits = await lint('「あ', { 'jpnov.lint.common.noUnmatchedPair': true });
  assert.ok(hits.length >= 1 && hits.every((h) => h.code === 'lint.common.noUnmatchedPair'));
});

test('common noHankakuKana carries a fix mapping the source kana to full-width', async () => {
  assert.deepEqual(await lintAll('はｱだ', { 'jpnov.lint.common.noHankakuKana': true }), [
    { code: 'lint.common.noHankakuKana', text: 'ｱ', fix: { text: 'ｱ', newText: 'ア' } },
  ]);
});

test('common jaNoSpaceBetweenFullWidth fixes the space to a full-width space (not deletion)', async () => {
  assert.deepEqual(await lintAll('あ いう', { 'jpnov.lint.common.jaNoSpaceBetweenFullWidth': true }), [
    { code: 'lint.common.jaNoSpaceBetweenFullWidth', text: ' ', fix: { text: ' ', newText: '　' } },
  ]);
  assert.equal(await applied('あ いう', { 'jpnov.lint.common.jaNoSpaceBetweenFullWidth': true }), 'あ　いう');
});

// --- fix correctness: inserts must not delete chars; line-end fixes must keep the newline ---

test('generalNovelStyle fix INSERTS the indent (does not overwrite the first character)', async () => {
  assert.equal(await applied('、句点。', { 'jpnov.lint.narration.generalNovelStyle': true }), '　、句点。');
  assert.equal(await applied('普通の段落。', { 'jpnov.lint.narration.generalNovelStyle': true }), '　普通の段落。');
});

test('dash fix pairs an odd run and rewrites a foreign glyph in place', async () => {
  assert.equal(await applied('彼は—と', DASH_BAR), '彼は――と');
  assert.equal(await applied('彼は——と', DASH_BAR), '彼は――と'); // same length, chosen glyph
  assert.equal(await applied('彼は―――と', DASH_BAR), '彼は――――と'); // odd rounds up
  assert.equal(await applied('彼は――と', { 'jpnov.lint.common.dash': 'boxDrawing' }), '彼は──と');
  assert.equal(await applied('彼は―と', { 'jpnov.lint.common.dash': 'off' }), '彼は―と');
});

test('generalNovelStyle leaves dash parity to the dash rule (ellipsis parity stays its own)', async () => {
  const both = { ...DASH_BAR, 'jpnov.lint.narration.generalNovelStyle': true };
  // one warning for the odd dash run, from the dash rule — not two
  const dashHits = (await lint('　彼は―――と言った。', both)).filter((h) => h.text.includes('―'));
  assert.deepEqual(dashHits, [{ code: 'lint.common.dash.parity', text: '―――' }]);
  const leaderHits = await lint('　彼は…と言った。', both);
  assert.ok(leaderHits.some((h) => h.code === 'lint.narration.generalNovelStyle'));
});

/** Every ［＃…］ annotation, ｜ and 《…》 in `src`, in order — the markup a fix must never touch. */
function markup(src: string): string[] {
  return src.match(/［＃[^］]*］|《[^》]*》|｜/g) ?? [];
}

test('no auto-fix overwrites the markup between two clean characters', async () => {
  // Every fixable rule sees a CLEAN stream, where markup contributes no text: `―［＃…］―` arrives
  // as `――`. A fix range spanning that gap maps back to one contiguous source range and would
  // delete the annotation — silently, since SourceFixAll runs on save.
  const cases: [string, RawLintConfigWire][] = [
    ['あ―［＃ここから太字］――い［＃ここで太字終わり］', DASH_BAR],
    ['あ―［＃改丁］――い', DASH_BAR],
    ['あ――｜―《ダ》い', DASH_BAR],
    ['｜巳一《みはつ》は――［＃ここから太字］―と。［＃ここで太字終わり］', DASH_BAR],
    ['あ ［＃「z」に傍点］ い', { 'jpnov.lint.common.jaNoSpaceBetweenFullWidth': true }],
    ['あ ｜漢《かん》 い', { 'jpnov.lint.common.jaNoSpaceBetweenFullWidth': true }],
    ['　あ。［＃「z」に傍点］。い', { 'jpnov.lint.narration.generalNovelStyle': true }],
    ['　あー［＃「z」に傍点］ーい', { 'jpnov.lint.narration.generalNovelStyle': true }],
    ['　あ、［＃改丁］、い', { 'jpnov.lint.narration.generalNovelStyle': true }],
    ['はｱ［＃「z」に傍点］ｲだ', { 'jpnov.lint.common.noHankakuKana': true }],
    ['好き［＃「好き」に傍点］', { 'jpnov.lint.narration.jaNoMixedPeriod': true }],
  ];
  for (const [src, raw] of cases) {
    assert.deepEqual(markup(await applied(src, raw)), markup(src), src);
  }
});

test('only the dash rule is scanned per piece — the rest keep their neighbours', async () => {
  // A scanner that reads the character next to its hit misjudges the one at a piece edge, so
  // only a rule whose notion of a run must match the renderer's opts in.
  const MINUS = { 'jpnov.lint.common.minusPosition': true };
  const SPACE = { 'jpnov.lint.common.jaNoSpaceBetweenFullWidth': true };
  assert.deepEqual(await lint('気温は−［＃縦中横］１０［＃縦中横終わり］度。', MINUS), []);
  assert.deepEqual(await lint('あ ｜漢《かん》い', SPACE), [
    { code: 'lint.common.jaNoSpaceBetweenFullWidth', text: ' ' },
  ]);
  // …and the markup between two hits still costs only the FIX, never the warning
  assert.equal(await applied('あ ［＃「z」に傍点］ い', SPACE), 'あ ［＃「z」に傍点］ い');
  assert.equal((await lint('あ ［＃「z」に傍点］ い', SPACE)).length, 1);
});

test('a dash run split by markup is two runs — matching how it renders', async () => {
  // A fix may not reach across the markup, so the run ends at the gap and each piece pairs alone.
  assert.equal(await applied('あ―［＃改丁］―い', DASH_BAR), 'あ――［＃改丁］――い');
  assert.deepEqual(await lint('あ―［＃改丁］―い', DASH_BAR), [
    { code: 'lint.common.dash.parity', text: '―' },
    { code: 'lint.common.dash.parity', text: '―' },
  ]);
});

test('jaNoMixedPeriod fix appends 。 at the end WITHOUT eating the trailing newline', async () => {
  assert.equal(await applied('好き', { 'jpnov.lint.narration.jaNoMixedPeriod': true }), '好き。');
  assert.equal(await applied('好き\nおわり。', { 'jpnov.lint.narration.jaNoMixedPeriod': true }), '好き。\nおわり。');
});

test('jaNoMixedPeriod does not warn on a 「」 line, …/― endings, or blank lines', async () => {
  // every dash spelling ends a sentence — ALLOWED_PERIOD_MARKS derives from DASH_CHARS
  for (const src of ['「〇」', '好き…', '好き—', '好き―', '好き─', '文。\n\n文。']) {
    assert.deepEqual(await lint(src, { 'jpnov.lint.narration.jaNoMixedPeriod': true }), [], src);
  }
});

test('common minusPosition flags a stray minus but not a signed number', async () => {
  assert.deepEqual(await lint('－あ', { 'jpnov.lint.common.minusPosition': true }), [
    { code: 'lint.common.minusPosition', text: '－' },
  ]);
  assert.deepEqual(await lint('－5', { 'jpnov.lint.common.minusPosition': true }), []);
});

// --- narration-only rules don't run on dialogue ---

test('narration generalNovelStyle flags a paragraph not starting with indent/opening bracket', async () => {
  const hits = await lint('、いきなり始まる。', { 'jpnov.lint.narration.generalNovelStyle': true });
  assert.ok(hits.some((h) => h.code === 'lint.narration.generalNovelStyle'));
});

// --- 字下げ-covered lines read as indented (synthetic 　, streams.ts) ---

test('a line opened by ［＃N字下げ］ (N ≥ 1) is not flagged as un-indented', async () => {
  assert.deepEqual(await lint('［＃２字下げ］引用の行だ。\n', { 'jpnov.lint.narration.generalNovelStyle': true }), []);
});

test('［＃０字下げ］ renders un-indented, so the flag (and its insert fix) stays', async () => {
  assert.equal(
    await applied('［＃０字下げ］内容だ。\n', { 'jpnov.lint.narration.generalNovelStyle': true }),
    '［＃０字下げ］　内容だ。\n',
  );
});

test('every line inside a ここから…ここで block is covered; lines after the end are not', async () => {
  const src = '［＃ここから２字下げ］\n引用一だ。\n引用二だ。\n［＃ここで字下げ終わり］\n戻りの行だ。\n';
  assert.deepEqual(await lint(src, { 'jpnov.lint.narration.generalNovelStyle': true }), [
    { code: 'lint.narration.generalNovelStyle', text: '戻りの行だ。' },
  ]);
});

test('last-wins reopen keeps coverage; the line after the end is flagged', async () => {
  const src = '［＃ここから２字下げ］\n二字の行だ。\n［＃ここから４字下げ］\n四字の行だ。\n［＃ここで字下げ終わり］\n外の行だ。\n';
  assert.deepEqual(await lint(src, { 'jpnov.lint.narration.generalNovelStyle': true }), [
    { code: 'lint.narration.generalNovelStyle', text: '外の行だ。' },
  ]);
});

test('an inline ［＃０字下げ］ cancels the block for its line (renders flush)', async () => {
  const src = '［＃ここから２字下げ］\n［＃０字下げ］素の行だ。\n［＃ここで字下げ終わり］\n';
  assert.deepEqual(await lint(src, { 'jpnov.lint.narration.generalNovelStyle': true }), [
    { code: 'lint.narration.generalNovelStyle', text: '素の行だ。' },
  ]);
});

test('text on the ここから line keeps its pre-block indent (flagged); following lines are covered', async () => {
  const src = '［＃ここから２字下げ］同じ行だ。\n次の行だ。\n［＃ここで字下げ終わり］\n';
  assert.deepEqual(await lint(src, { 'jpnov.lint.narration.generalNovelStyle': true }), [
    { code: 'lint.narration.generalNovelStyle', text: '同じ行だ。' },
  ]);
});

test('ranges and fixes over a synthetic-first stream map back without positional drift', async () => {
  // The synthetic 　 is narration[0] here; each hit slices back to the exact source text —
  // never the command bytes, never off by one unit.
  assert.deepEqual(
    await lint('［＃３字下げ］あいうえおかきくけこ。\n', { 'jpnov.lint.common.sentenceLength': 5 }),
    [{ code: 'lint.common.sentenceLength', text: 'あいうえおかきくけこ。' }],
  );
  assert.deepEqual(await lint('［＃３字下げ］あ、い、う、え、お。\n', { 'jpnov.lint.common.maxTen': 2 }), [
    { code: 'lint.common.maxTen', text: '、' },
  ]);
  assert.deepEqual(await lintAll('［＃３字下げ］はｱだ。\n', { 'jpnov.lint.common.noHankakuKana': true }), [
    { code: 'lint.common.noHankakuKana', text: 'ｱ', fix: { text: 'ｱ', newText: 'ア' } },
  ]);
});

test('narration jaNoMixedPeriod flags a sentence with no period', async () => {
  const hits = await lint('これは文', { 'jpnov.lint.narration.jaNoMixedPeriod': true });
  assert.ok(hits.some((h) => h.code === 'lint.narration.jaNoMixedPeriod'));
});

// --- ruby drop-down ---

test('ruby kana=hiragana flags a reading that is not all hiragana', async () => {
  assert.deepEqual(await lint('巳一《みハつ》と一郎《いちろう》', { 'jpnov.lint.ruby.kana': 'hiragana' }), [
    { code: 'lint.ruby.kana', text: 'みハつ' },
  ]);
});

test('ruby kana=katakana flags a hiragana reading', async () => {
  assert.deepEqual(await lint('名《メイ》前《まえ》', { 'jpnov.lint.ruby.kana': 'katakana' }), [
    { code: 'lint.ruby.kana', text: 'まえ' },
  ]);
});

test('ruby kana=off leaves all readings alone', async () => {
  assert.deepEqual(await lint('名《メイ》前《まえ》', { 'jpnov.lint.ruby.kana': 'off' }), []);
});
