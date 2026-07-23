/**
 * Binds each catalog rule id to HOW it runs: a textlint kernel rule (optionally with fixed options)
 * or a pure pre-scan. This is the ONLY module that value-imports textlint rule packages, so the
 * bundle's rule surface is auditable in one place.
 *
 * `satisfies Record<CatalogId, RuleImpl>` makes the catalog and the implementations a compile-time
 * pair: a rule added to `catalog.ts` without an entry here (or vice-versa) fails to build. Threshold
 * rules consume the normalized `{ max }` option (sentence-length, max-kanji, and the custom maxTen
 * all read `options.max`); a few boolean rules carry FIXED options here (e.g. the novel-style
 * rule's allowed line-head characters) since they are not user-tunable in Phase 1.
 */
import sentenceLength from 'textlint-rule-sentence-length';
import maxKanjiContinuousLen from 'textlint-rule-max-kanji-continuous-len';
import noHankakuKana from 'textlint-rule-no-hankaku-kana';
import noNfd from 'textlint-rule-no-nfd';
import noZeroWidthSpaces from 'textlint-rule-no-zero-width-spaces';
import noInvalidControlCharacter from '@textlint-rule/textlint-rule-no-invalid-control-character';
import jaUnnaturalAlphabet from 'textlint-rule-ja-unnatural-alphabet';
import generalNovelStyle from 'textlint-rule-general-novel-style-ja';
import noUnmatchedPair from '@textlint-rule/textlint-rule-no-unmatched-pair';
import jaNoMixedPeriod from 'textlint-rule-ja-no-mixed-period';
import type { TextlintRuleModule } from '@textlint/types';

import { DASH_CHARS } from '../../shared/compiler/layout.ts';
import type { CatalogId } from '../../shared/lint/catalog.ts';

import { unwrapDefault } from './interop.ts';
import maxTen from './rules/maxTen.ts';
import { dashScan, fullWidthSpaceScan, minusPositionScan, rubyKanaScan } from './prescan.ts';
import type { PreScan } from './prescan.ts';

// Each CJS rule, normalized past its `.default` wrapper exactly once (see interop.ts). `maxTen` is a
// real ESM default and passes through untouched.
const sentenceLengthRule = unwrapDefault(sentenceLength);
const maxKanjiRule = unwrapDefault(maxKanjiContinuousLen);
const noHankakuKanaRule = unwrapDefault(noHankakuKana);
const noNfdRule = unwrapDefault(noNfd);
const noZeroWidthRule = unwrapDefault(noZeroWidthSpaces);
const noControlCharRule = unwrapDefault(noInvalidControlCharacter);
const jaUnnaturalAlphabetRule = unwrapDefault(jaUnnaturalAlphabet);
const generalNovelStyleRule = unwrapDefault(generalNovelStyle);
const noUnmatchedPairRule = unwrapDefault(noUnmatchedPair);
const jaNoMixedPeriodRule = unwrapDefault(jaNoMixedPeriod);

/** Full-width space + opening brackets allowed at a paragraph head (general-novel-style-ja). */
const LEADING_PARAGRAPH_CHARS = '　「『（【〈';
/** Sentence-ending marks accepted besides 。 (ja-no-mixed-period). Every dash spelling and … are
 *  real enders; 」』 mean the "sentence" was a quotation (セリフ) — not a missing-句点 case — so a
 *  「…」 line is never flagged. */
const ALLOWED_PERIOD_MARKS = [...DASH_CHARS, '…', '」', '』'];

/**
 * How a rule executes:
 *  - `kernel`  — a textlint rule run via `TextlintKernel.lintText`. Boolean rules pass `true` unless
 *                they carry fixed `options`; threshold rules pass the normalized `{ max }`. `insertAfter`
 *                overrides the rule's own fix with an INSERT of that text after the message (e.g. 。).
 *  - `prescan` — a pure scanner over the stream's clean text (may carry its own `fix`).
 */
export type RuleImpl =
  | {
    readonly kind: 'kernel';
    readonly rule: TextlintRuleModule;
    readonly options?: Record<string, unknown>;
    readonly insertAfter?: string;
  }
  | {
    readonly kind: 'prescan';
    readonly scan: PreScan;
    /** Scan each contiguous source piece alone: a run interrupted by markup is two runs, not one. */
    readonly perPiece?: boolean;
  };

/** Catalog id -> implementation. The `Record<CatalogId, …>` type requires exactly the catalog ids
 *  (a missing/extra impl fails to compile) and keeps `options` reachable on the kernel variant. */
export const RULE_IMPL: Record<CatalogId, RuleImpl> = {
  // common
  sentenceLength: { kind: 'kernel', rule: sentenceLengthRule },
  maxTen: { kind: 'kernel', rule: maxTen },
  maxKanjiRun: { kind: 'kernel', rule: maxKanjiRule },
  dash: { kind: 'prescan', scan: dashScan, perPiece: true },
  noUnmatchedPair: { kind: 'kernel', rule: noUnmatchedPairRule },
  noHankakuKana: { kind: 'kernel', rule: noHankakuKanaRule },
  noNfd: { kind: 'kernel', rule: noNfdRule },
  noZeroWidth: { kind: 'kernel', rule: noZeroWidthRule },
  noControlChar: { kind: 'kernel', rule: noControlCharRule },
  jaNoSpaceBetweenFullWidth: { kind: 'prescan', scan: fullWidthSpaceScan },
  jaUnnaturalAlphabet: { kind: 'kernel', rule: jaUnnaturalAlphabetRule },
  minusPosition: { kind: 'prescan', scan: minusPositionScan },
  // narration
  generalNovelStyle: {
    kind: 'kernel',
    rule: generalNovelStyleRule,
    // `even_number_dashes` off: the `dash` rule owns dash parity and would double-report.
    options: { chars_leading_paragraph: LEADING_PARAGRAPH_CHARS, even_number_dashes: false },
  },
  jaNoMixedPeriod: {
    kind: 'kernel',
    rule: jaNoMixedPeriodRule,
    options: { allowPeriodMarks: ALLOWED_PERIOD_MARKS },
    insertAfter: '。',
  },
  // ruby
  kana: { kind: 'prescan', scan: rubyKanaScan },
};
