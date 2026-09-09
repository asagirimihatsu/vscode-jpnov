/**
 * The exhaustive fix-safety guard: NO auto-fix may overwrite the markup between two clean
 * characters (a fix once silently deleted an annotation — a data-loss bug class).
 *
 * `FIX_CORPUS` is a `Record<CatalogId, …>`, so adding a catalog rule without deciding its entry is
 * a COMPILE error: list at least one corpus that produces a fix, or declare `null` (rule has no
 * fix). For every corpus the guard (a) asserts the plain text yields ≥ 1 fix (a dead corpus would
 * guard nothing), then (b) inserts an annotation between EVERY adjacent character pair and asserts
 * that applying all fixes leaves the markup sequence intact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { computeLintFindings } from '../../../src/server/lint/engine.ts';
import { RULES, settingKey } from '../../../src/shared/lint/catalog.ts';
import type { CatalogId } from '../../../src/shared/lint/catalog.ts';
import { selectRules } from '../../../src/shared/lint/select.ts';
import type { RawLintConfigWire } from '../../../src/shared/protocol.ts';

/** Fix-producing corpora per rule; `null` = the rule never emits a fix. */
const FIX_CORPUS: Record<CatalogId, readonly string[] | null> = {
  sentenceLength: null,
  maxTen: null,
  maxKanjiRun: null,
  dash: ['あ―――い', 'あ—い'],
  ellipsis: ['　沈黙…だ。', '　沈黙。。。だ。', '　えっ、、だ。', '　中黒・・・だ。', '　二点‥だ。'],
  exclamationSpace: ['　驚いた！そのまま。', '「なに？と続く」'],
  exclamationRun: ['　なに！？だ。', '「うそ！！」', '　だめだ!と。'],
  arabicDigits: null,
  noTrailingSpace: ['好き　', '　　'],
  blankRun: ['あ。\n\n\nい。'],
  noUnmatchedPair: null,
  noHankakuKana: ['　はｱｲだ。', '　はｶﾞだ。'],
  noNfd: ['　か\u3099き。'],
  noZeroWidth: ['　あ\u200bい。'],
  noControlChar: ['　あ\u0007い。'],
  shiftJisSafe: null,
  jaNoSpaceBetweenFullWidth: ['　あ いう。'],
  jaUnnaturalAlphabet: null,
  minusPosition: null,
  indent: ['これは地の文。'],
  endPeriod: ['　これは文'],
  closingPunct: ['「そうだ。」'],
  noIndent: ['　「台詞だ」'],
  kana: null,
};

/** The markup the fixes must never touch (annotations / ruby readings / the base marker). */
function markup(src: string): string[] {
  return src.match(/［＃[^］]*］|《[^》]*》|｜/g) ?? [];
}

/** The enabling snapshot for one rule. */
function enable(id: CatalogId): RawLintConfigWire {
  const rule = RULES.find((r) => r.id === id);
  if (rule === undefined) {
    throw new Error(`no catalog rule ${id}`);
  }
  if (rule.kind === 'boolean') {
    return { [settingKey(rule)]: true };
  }
  if (rule.kind === 'threshold') {
    return { [settingKey(rule)]: rule.suggested };
  }
  const value = rule.values.find((v) => v !== 'off') ?? '';
  return { [settingKey(rule)]: value };
}

/** Apply every fix (right-to-left) and return the result. */
function applied(src: string, raw: RawLintConfigWire): { out: string; fixes: number } {
  const doc = TextDocument.create('mem://x.jpnov', 'jpnov', 1, src);
  const findings = computeLintFindings(src, selectRules(raw), doc);
  const edits = findings
    .flatMap((f) =>
      f.fix ? [{ s: doc.offsetAt(f.fix.range.start), e: doc.offsetAt(f.fix.range.end), t: f.fix.newText }] : [],
    )
    .sort((a, b) => b.s - a.s);
  let out = src;
  for (const ed of edits) {
    out = out.slice(0, ed.s) + ed.t + out.slice(ed.e);
  }
  return { out, fixes: edits.length };
}

/** A postfix annotation whose target is never in the corpora — pure elided markup for lint. */
const WEDGE = '［＃「z」に傍点］';

for (const rule of RULES) {
  const corpora = FIX_CORPUS[rule.id];
  if (corpora === null) {
    continue;
  }
  test(`fix safety: ${rule.id}`, () => {
    const raw = enable(rule.id);
    for (const corpus of corpora) {
      // (a) the corpus is alive: the plain text yields at least one fix
      assert.ok(applied(corpus, raw).fixes >= 1, `dead corpus for ${rule.id}: ${corpus}`);
      // (b) markup wedged between any two characters survives every fix
      for (let at = 1; at < corpus.length; at += 1) {
        const variant = corpus.slice(0, at) + WEDGE + corpus.slice(at);
        const { out } = applied(variant, raw);
        assert.deepEqual(markup(out), markup(variant), `${rule.id} @${String(at)}: ${variant}`);
      }
    }
  });
}
