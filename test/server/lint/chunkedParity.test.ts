/**
 * Golden parity: chunked linting must produce EXACTLY the findings of an unchunked run —
 * same codes, same source ranges, same fixes — over adversarial seam material (sentences
 * across newlines, parens across newlines, dialogue runs, blank lines) and real fixtures.
 * `opts.chunking` is the test seam: a huge target degenerates to one chunk (the unchunked
 * baseline), a tiny target forces many chunks through the same code path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { computeLintFindings } from '../../../src/server/lint/kernel.ts';
import type { LintFinding, LintRunOptions } from '../../../src/server/lint/kernel.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';
import type { RawLintConfig } from '../../../src/shared/lint/select.ts';

/** Both quadratic rules + a fixable rule + a threshold rule — the seam-sensitive set. */
const RULES: RawLintConfig = {
  'jpnov.lint.common.sentenceLength': 30,
  'jpnov.lint.common.noUnmatchedPair': true,
  'jpnov.lint.common.maxTen': 2,
  'jpnov.lint.common.noHankakuKana': true,
  'jpnov.lint.narration.jaNoMixedPeriod': true,
};

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../test-fixtures/novel/${name}`, import.meta.url), 'utf8');

async function lintWith(src: string, chunking: LintRunOptions['chunking']): Promise<LintFinding[]> {
  const doc = TextDocument.create('mem://parity.jpnov', 'novel-jp', 1, src);
  const result = computeLintFindings(src, selectRules(RULES), doc, chunking !== undefined ? { chunking } : undefined);
  return Array.isArray(result) ? result : await result;
}

/** Order-independent projection: findings sorted by position, then code. */
function normalized(findings: LintFinding[]): unknown[] {
  return findings
    .map((f) => ({
      code: (f.diagnostic.data as { code: string }).code,
      range: f.diagnostic.range,
      fix: f.fix ?? null,
    }))
    .sort((x, y) => {
      const byLine = x.range.start.line - y.range.start.line;
      const byChar = x.range.start.character - y.range.start.character;
      return byLine !== 0 ? byLine : byChar !== 0 ? byChar : x.code.localeCompare(y.code);
    });
}

/** One chunk (target larger than any test input) == the pre-chunking behaviour. */
const UNCHUNKED = { target: 10_000_000, max: 10_000_000 } as const;
/** Aggressive chunking, but max kept huge so no FORCED seam can introduce the documented divergence. */
const TINY = { target: 64, max: 10_000_000 } as const;

test('parity on the seam-adversarial fixture', async () => {
  const src = fixture('seams.jpnov');
  assert.deepEqual(
    normalized(await lintWith(src, TINY)),
    normalized(await lintWith(src, UNCHUNKED)),
  );
});

test('parity on the construct showcase fixture', async () => {
  const src = fixture('showcase.jpnov');
  assert.deepEqual(
    normalized(await lintWith(src, TINY)),
    normalized(await lintWith(src, UNCHUNKED)),
  );
});

test('parity on a generated large corpus (many chunks, violations near seams)', async () => {
  const para =
    '　これは長い文でありまして、読点、が、いくつも、続き、そして半角のｶﾅも紛れ込む上に長さの上限も超えるのです。\n' +
    '「開いた括弧（が閉じないままの台詞」\n' +
    '未終端の行が\nここまで続いて終わる。\n\n';
  const src = para.repeat(50);
  const tiny = normalized(await lintWith(src, TINY));
  const whole = normalized(await lintWith(src, UNCHUNKED));
  assert.ok(tiny.length > 0, 'corpus produced no findings — rules not exercised');
  assert.deepEqual(tiny, whole);
});

test('parity with block annotations straddling many chunk seams', async () => {
  // Block 字下げ + block 太字 contribute zero prose (they vanish at stream extraction), so a
  // seam can never bisect a ここから/ここで pair — assert it stays true across ~50 forced seams.
  const para =
    '［＃ここから２字下げ］\n' +
    '　これは長い段落でありまして、読点、が、続いて、句点で終わる。\n' +
    '［＃ここから太字］この一節は太字。［＃ここで太字終わり］\n' +
    '「開いた括弧の台詞」\n' +
    '［＃ここで字下げ終わり］\n\n';
  const src = para.repeat(50);
  const tiny = normalized(await lintWith(src, TINY));
  const whole = normalized(await lintWith(src, UNCHUNKED));
  assert.ok(tiny.length > 0, 'corpus produced no findings — rules not exercised');
  assert.deepEqual(tiny, whole);
});

test('default chunking (no opts) also matches the unchunked baseline on a >target corpus', async () => {
  const para = '　この段落は既定の目標長を確実に超えるためだけに存在する、読点、多め、の、文章。\n'.repeat(80);
  assert.deepEqual(
    normalized(await lintWith(para, undefined)),
    normalized(await lintWith(para, UNCHUNKED)),
  );
});

test('forced seam still yields bounded, well-formed findings (documented divergence, no crash)', async () => {
  // One giant terminator-less "sentence" over many lines: chunking must force seams and
  // stay linear. Findings may legitimately differ from unchunked at forced seams — assert
  // only structural sanity, not parity.
  const src = 'この行に終端はなく\n'.repeat(400);
  const doc = TextDocument.create('mem://forced.jpnov', 'novel-jp', 1, src);
  const result = computeLintFindings(src, selectRules(RULES), doc, { chunking: { target: 64, max: 256 } });
  const findings = Array.isArray(result) ? result : await result;
  for (const f of findings) {
    assert.ok(f.diagnostic.range.start.line >= 0);
    assert.ok(f.diagnostic.range.end.line < 401);
  }
});
