import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeComment, escapeHtml } from '../../../src/shared/compiler/escape.ts';

test('escapeHtml escapes & < > " (ampersand first, no double-escape)', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('<tag>'), '&lt;tag&gt;');
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
});

test('escapeHtml leaves full-width spaces and CJK untouched', () => {
  assert.equal(escapeHtml('　　本文'), '　　本文');
});

test('escapeComment neutralizes -- (to "- -") so it cannot close the comment', () => {
  assert.equal(escapeComment('a--b'), 'a- -b');
  assert.equal(escapeComment('----'), '- -- -');
});

test('escapeComment defuses a stray > but leaves other chars verbatim', () => {
  assert.equal(escapeComment('x > y'), 'x &gt; y');
  assert.equal(escapeComment('「対象」に傍線'), '「対象」に傍線');
});
