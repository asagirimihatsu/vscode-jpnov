/**
 * Drift guard: the tmLanguage variant alternations + the single-line 字下げ ^-anchor must match
 * the emphasis.ts mapper. Canonical order = length desc, code-unit asc. On drift it prints the
 * exact string to paste into syntaxes/novel-jp.tmLanguage.json — the alternation is never
 * hand-edited (see the grammar file's header comment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { styleVariantsByChannel } from '../../../src/shared/compiler/emphasis.ts';

const canonical = (vs: readonly string[]): string =>
  [...new Set(vs)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).join('|');

const grammar = JSON.parse(
  readFileSync(new URL('../../../syntaxes/novel-jp.tmLanguage.json', import.meta.url), 'utf8'),
) as { repository: { annotation: { patterns: { match?: string }[] } } };
const matches: string[] = grammar.repository.annotation.patterns
  .map((p) => p.match)
  .filter((m): m is string => typeof m === 'string');

test('tmLanguage dot+line alternation == emphasis.ts variants (canonical order)', () => {
  const { emph, line } = styleVariantsByChannel();
  const needle = canonical([...emph, ...line]);
  const hits = matches.filter((m) => m.includes('傍点')); // span END/START + postfix carry it
  assert.ok(hits.length >= 3, `expected >=3 patterns carrying the dot|line alternation, got ${String(hits.length)}`);
  for (const m of hits) {
    assert.ok(m.includes(needle), `stale dot|line alternation in:\n${m}\nPASTE:\n${needle}`);
  }
});

test('tmLanguage 太字|斜体 alternation == emphasis.ts variants', () => {
  const { weight, style } = styleVariantsByChannel();
  const needle = canonical([...weight, ...style]); // '太字|斜体'
  const hits = matches.filter((m) => m.includes('太字'));
  assert.ok(hits.length >= 3, 'expected block + span + postfix rules for 太字|斜体');
  for (const m of hits) {
    assert.ok(m.includes(needle), `stale 太字|斜体 alternation in:\n${m}\nPASTE:\n${needle}`);
  }
});

test('every dot|line rule carries the optional direction prefix (の左に|左に)', () => {
  // The direction prefix is repeated across three grammar rules (span END/START + postfix) and
  // mirrored by emphasis.ts resolveStyle / semanticTokens directionLen — pin the grammar side
  // so a new side alias cannot land in one rule and drift from the others.
  for (const m of matches.filter((x) => x.includes('傍点'))) {
    assert.ok(m.includes('(の左に|左に)?'), `missing direction prefix in:\n${m}`);
  }
});

test('the single-line 字下げ rule is line-head anchored and full-width-only', () => {
  const m = matches.find((x) => x.includes('字下げ') && !x.includes('ここ')); // the non-block indent rule
  assert.ok(m, 'single-line 字下げ rule not found');
  assert.ok(m.startsWith('^'), 'must anchor ^ (a mid-line 字下げ degrades to comment — zero-fight)');
  assert.ok(m.includes('[０-９]') && !m.includes('[0-9'), 'full-width digits only (locked spec)');
});
