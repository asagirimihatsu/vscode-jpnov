/**
 * The exhaustive fix-safety guard: NO auto-fix may overwrite the markup between two clean
 * characters (a fix once silently deleted an annotation — a data-loss bug class), and NO insert
 * may land inside a ruby or an annotation span (an inserted 。 once split 山田《やまだ》 — #72). The
 * noNfd and noControlChar fixes are the edits allowed inside markup, each only as its own
 * operation: the markup nodes are compared modulo {@link composeKana}, and for noControlChar
 * modulo the control characters it deletes. A corpus whose fix changes what the markup MEANS (a
 * decomposed keyword becoming a real annotation) belongs in engine.test.ts, not here.
 *
 * A fix may WRITE markup of its own (exclamationTcy writes the 縦中横 annotation): what it wrote
 * is set aside by where it landed, must read back as the markup it is, and counts as an insert
 * where it sits in the edit.
 *
 * `FIX_CORPUS` is a `Record<CatalogId, …>`, so adding a catalog rule without deciding its entry is
 * a COMPILE error: list at least one corpus that produces a fix, or declare `null` (rule has no
 * fix). For every corpus the guard (a) asserts the plain text yields ≥ 1 fix (a dead corpus would
 * guard nothing), then (b) slips a stand-alone annotation between EVERY adjacent character pair,
 * line ends included, and (c) wraps EVERY single character in a ruby / a span; after every fix is
 * applied, each variant must keep its markup nodes and every insert outside the wedge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isControlChar } from '../../../src/server/lint/rules/chars.ts';
import type { Span } from '../../../src/shared/ast/nodes.ts';
import { composeKana } from '../../../src/shared/chars.ts';
import { RULES, settingKey } from '../../../src/shared/lint/catalog.ts';
import type { CatalogId } from '../../../src/shared/lint/catalog.ts';
import type { RawLintConfigWire } from '../../../src/shared/protocol.ts';
import { nodesOf } from '../../shared/ast/_shape.ts';
import { applyLintFixes } from '../helpers.ts';
import type { LintEdit } from '../helpers.ts';

/** Fix-producing corpora per rule; `null` = the rule never emits a fix. */
const FIX_CORPUS: Record<CatalogId, readonly string[] | null> = {
  sentenceLength: null,
  maxTen: null,
  maxKanjiRun: null,
  dash: ['あ―――い', 'あ—い'],
  ellipsis: ['　沈黙…だ。', '　沈黙。。。だ。', '　えっ、、だ。', '　中黒・・・だ。', '　二点‥だ。'],
  exclamationSpace: ['　驚いた！そのまま。', '「なに？と続く」'],
  exclamationRun: ['　なに！？だ。', '「うそ！！」', '　だめだ!と。'],
  exclamationTcy: ['　えっ!?次の文。', '「何だと!?」', '　彼は叫んだ!!'],
  arabicDigits: null,
  noTrailingSpace: ['好き　', '　　'],
  blankRun: ['あ。\n\n\nい。'],
  noUnmatchedPair: null,
  noHankakuKana: ['　はｱｲだ。', '　はｶﾞだ。'],
  noNfd: [
    '　か\u3099き。',
    '　山田《やまた\u3099》。',
    '　た\u3099め［＃「た\u3099め」に傍点］。',
    '　聖剣《せいけん》［＃「聖剣」の左に「つるき\u3099」のルビ］。',
  ],
  noZeroWidth: ['　あ\u200bい。'],
  noControlChar: [
    '　あ\u0007い。',
    '　あ\uFFFEい。',
    '　山田《やま\u0007だ》。',
    '　聖剣［＃「聖\u0007剣」に傍点］。',
    '　あ［＃メ\u0007モ］い。',
    '　あ［＃メ\u0085モ］い。',
  ],
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

/** A markup node: what it is, and where it sits. */
interface Markup {
  readonly label: string;
  readonly span: Span;
}

/** What a rule's fix may change inside markup: kana composition, unless the rule is listed here. */
const NORMALIZE: Partial<Record<CatalogId, (text: string) => string>> = {
  noControlChar: (text) => Array.from(text).filter((ch) => !isControlChar(ch.codePointAt(0) ?? 0)).join(''),
};

/** The markup of `src`: every node but the text, by kind and source text — modulo `normalize`,
 *  the one edit the rule's fix makes inside markup. A ruby's base is text (a fix may
 *  legitimately rewrite its characters); what kind of ruby its reading closes is markup. */
function markup(src: string, normalize: (text: string) => string): Markup[] {
  return nodesOf(src).flatMap((node) => {
    if (node.kind === 'text') {
      return [];
    }
    const kind = node.kind === 'rubyReading' && node.implicit ? 'rubyReading(implicit)' : node.kind;
    return [{ label: `${kind}:${normalize(node.text)}`, span: node.span }];
  });
}

/** The edits in the order of the result, each with where its text sits there, as
 *  {@link applyLintFixes} applies them: at one offset the insert lands before the wider edit. */
function landings(edits: readonly LintEdit[]): { edit: LintEdit; span: Span }[] {
  let shift = 0;
  return edits
    .toSorted((a, b) => a.s - b.s || a.e - b.e)
    .map((edit) => {
      const start = edit.s + shift;
      shift += edit.t.length - (edit.e - edit.s);
      return { edit, span: { start, end: start + edit.t.length } };
    });
}

/** A wedge: markup `open`…`close` around `wraps` characters of the corpus (0 = slipped between
 *  two characters). */
interface Wedge {
  readonly open: string;
  readonly close: string;
  readonly wraps: number;
}

/** Between two characters: a postfix (its target is never in the corpora) and a comment. Around
 *  one: an explicit ruby, and the 縦中横 / 傍点 / 丸傍点 / block 太字 spans. */
const WEDGES: readonly Wedge[] = [
  { open: '［＃「z」に傍点］', close: '', wraps: 0 },
  { open: '［＃メモ］', close: '', wraps: 0 },
  { open: '｜', close: '《z》', wraps: 1 },
  { open: '｜', close: '［＃メモ］《z》', wraps: 1 }, // a ｜ base holding an annotation
  { open: '｜［＃メモ］', close: '《z》', wraps: 1 },
  { open: '［＃縦中横］', close: '［＃縦中横終わり］', wraps: 1 },
  { open: '［＃傍点］', close: '［＃傍点終わり］', wraps: 1 },
  { open: '［＃丸傍点］', close: '［＃丸傍点終わり］', wraps: 1 },
  { open: '［＃ここから太字］', close: '［＃ここで太字終わり］', wraps: 1 },
];

/** Every variant of `corpus` under `wedge`, each with the wedge's own `[start, end)`. A wrapper is
 *  line-local, so a line terminator is never wrapped. */
function variants(corpus: string, wedge: Wedge): { variant: string; start: number; end: number }[] {
  const out: { variant: string; start: number; end: number }[] = [];
  for (let at = 0; at + wedge.wraps <= corpus.length; at += 1) {
    const inner = corpus.slice(at, at + wedge.wraps);
    if (inner.includes('\n')) {
      continue;
    }
    const variant = corpus.slice(0, at) + wedge.open + inner + wedge.close + corpus.slice(at + wedge.wraps);
    out.push({ variant, start: at, end: at + wedge.open.length + inner.length + wedge.close.length });
  }
  return out;
}

for (const rule of RULES) {
  const corpora = FIX_CORPUS[rule.id];
  if (corpora === null) {
    continue;
  }
  test(`fix safety: ${rule.id}`, () => {
    const raw = enable(rule.id);
    const normalize = NORMALIZE[rule.id] ?? composeKana;
    const shape = (src: string): string[] => markup(src, normalize).map((node) => node.label);
    for (const corpus of corpora) {
      // (a) the corpus is alive: the plain text yields at least one fix
      assert.ok(applyLintFixes(corpus, raw).edits.length >= 1, `dead corpus for ${rule.id}: ${corpus}`);
      // (b)+(c) markup wedged anywhere survives every fix, and no insert lands inside it
      for (const wedge of WEDGES) {
        for (const { variant, start, end } of variants(corpus, wedge)) {
          const { out, edits } = applyLintFixes(variant, raw);
          const label = `${rule.id}: ${variant}`;
          const landed = landings(edits);
          const written = ({ span }: Markup): boolean =>
            landed.some((at) => at.span.start <= span.start && span.end <= at.span.end);
          const after = markup(out, normalize);
          assert.deepEqual(
            after.filter((node) => !written(node)).map((node) => node.label),
            shape(variant),
            `${label} — markup changed`,
          );
          assert.deepEqual(
            after.filter(written).map((node) => node.label),
            landed.flatMap(({ edit }) => shape(edit.t)),
            `${label} — what a fix wrote does not read back as the markup it is`,
          );
          for (const ed of edits) {
            // What an edit adds, in source offsets: an insert at its own, written markup where it
            // sits in the edit.
            const adds = ed.s === ed.e ? [ed.s] : markup(ed.t, normalize).map(({ span }) => ed.s + Math.min(span.start, ed.e - ed.s));
            for (const at of adds) {
              assert.ok(at <= start || at >= end, `${label} — insert at ${String(at)} lands inside the wedge`);
            }
          }
        }
      }
    }
  });
}
