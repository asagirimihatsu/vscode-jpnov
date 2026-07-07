/**
 * Cancellation semantics: `shouldCancel` is polled between chunks; flipping it aborts the run
 * with LintCancelled (not a result, not a generic error), and it is never polled for a run
 * that fits one chunk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { computeLintFindings, LintCancelled } from '../../../src/server/lint/kernel.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';

const SELECTION = selectRules({ 'jpnov.lint.common.sentenceLength': 10 });

test('shouldCancel=true between chunks rejects with LintCancelled', async () => {
  const src = '　この文はわざと長くしてあり検査対象になる。\n'.repeat(30);
  const doc = TextDocument.create('mem://cancel.jpnov', 'novel-jp', 1, src);
  let polls = 0;
  const result = computeLintFindings(src, SELECTION, doc, {
    shouldCancel: () => {
      polls++;
      return true;
    },
    chunking: { target: 64, max: 10_000_000 },
  });
  assert.ok(!Array.isArray(result), 'a rule is enabled — expected the async path');
  await assert.rejects(result, LintCancelled);
  assert.ok(polls >= 1, 'shouldCancel was never polled');
});

test('a single-chunk run never polls shouldCancel and resolves normally', async () => {
  const src = '　この文はわざと長くしてあり検査対象になる。\n';
  const doc = TextDocument.create('mem://cancel1.jpnov', 'novel-jp', 1, src);
  let polls = 0;
  const result = computeLintFindings(src, SELECTION, doc, {
    shouldCancel: () => {
      polls++;
      return true;
    },
  });
  assert.ok(!Array.isArray(result));
  const findings = await result;
  assert.equal(polls, 0);
  assert.ok(findings.length >= 1, 'the over-length sentence should be flagged');
});
