/**
 * Custom textlint rule: cap the number of 読点 (、) per sentence. Ships in-tree because the stock
 * `textlint-rule-max-ten` pulls kuromoji transitively, which Phase 1 forbids.
 *
 * Kuromoji-free by design: "sentence" is delimited purely by terminators (。！？ and their ASCII
 * twins) within each Str node, so no morphological analysis is needed. Counting resets at every
 * terminator; the (max+1)-th 、 of a sentence is reported once, on that comma.
 */
import type { TextlintRuleModule } from '@textlint/types';

const TOUTEN = '、';
const SENTENCE_ENDERS = new Set(['。', '！', '？', '!', '?']);
const DEFAULT_MAX = 3;

interface MaxTenOptions {
  readonly max?: number;
}

const maxTen: TextlintRuleModule<MaxTenOptions> = (context, options = {}) => {
  const { Syntax, RuleError, report, getSource, locator } = context;
  const max = options.max ?? DEFAULT_MAX;
  return {
    [Syntax.Str](node) {
      const text = getSource(node);
      let count = 0;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        if (ch === TOUTEN) {
          count += 1;
          if (count === max + 1) {
            // padding is node-relative; the kernel resolves it to an absolute stream offset, which
            // the driver then maps to source. The message text is discarded (we stamp our own code).
            report(node, new RuleError('too many 、 in one sentence', { padding: locator.at(i) }));
          }
        } else if (SENTENCE_ENDERS.has(ch)) {
          count = 0;
        }
      }
    },
  };
};

export default maxTen;
