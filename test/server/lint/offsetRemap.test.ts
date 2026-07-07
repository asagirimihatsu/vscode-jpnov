/**
 * Guards the `+ a` chunk-offset rebase in kernel.ts: a violation sitting in a LATER chunk must
 * map back to exactly its source characters (diagnostic range and fix range), same as chunk one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { computeLintFindings } from '../../../src/server/lint/kernel.ts';
import type { LintFinding } from '../../../src/server/lint/kernel.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';

const CHUNKING = { chunking: { target: 40, max: 10_000_000 } } as const;

async function lint(src: string): Promise<{ doc: TextDocument; findings: LintFinding[] }> {
  const doc = TextDocument.create('mem://remap.jpnov', 'novel-jp', 1, src);
  const result = computeLintFindings(
    src,
    selectRules({ 'jpnov.lint.common.noHankakuKana': true }),
    doc,
    CHUNKING,
  );
  return { doc, findings: Array.isArray(result) ? result : await result };
}

test('a violation in a later chunk maps to exactly its source characters', async () => {
  // Filler paragraphs end with 。\n so seams exist; both ｱ sit well past the 40-unit target.
  const filler = '　これは埋め草の文でしかない。\n';
  const src = `${filler.repeat(4)}　半角のｱがある。\n${filler.repeat(4)}　もう一つのｱもある。\n`;
  const { doc, findings } = await lint(src);

  const hits = findings.map((f) => ({
    text: src.slice(doc.offsetAt(f.diagnostic.range.start), doc.offsetAt(f.diagnostic.range.end)),
    start: doc.offsetAt(f.diagnostic.range.start),
    fix: f.fix,
  }));
  assert.equal(hits.length, 2);

  const expected = [src.indexOf('ｱ'), src.indexOf('ｱ', src.indexOf('ｱ') + 1)];
  assert.deepEqual(hits.map((h) => h.start).sort((a, b) => a - b), expected);
  for (const hit of hits) {
    assert.equal(hit.text, 'ｱ'); // the squiggle covers the offending char, nothing more
    assert.ok(hit.fix !== undefined, 'no-hankaku-kana is fixable — fix missing');
    assert.equal(doc.offsetAt(hit.fix.range.start), hit.start);
    assert.equal(doc.offsetAt(hit.fix.range.end), hit.start + 1);
    assert.equal(hit.fix.newText, 'ア');
  }
});

test('violations in chunk one are unaffected by chunking (offset zero rebase)', async () => {
  const src = '　先頭付近のｱ。\n　これは埋め草の文でしかない。\n'.repeat(3);
  const { doc, findings } = await lint(src);
  assert.ok(findings.length >= 1);
  const first = findings[0];
  assert.ok(first !== undefined);
  assert.equal(
    src.slice(doc.offsetAt(first.diagnostic.range.start), doc.offsetAt(first.diagnostic.range.end)),
    'ｱ',
  );
});
