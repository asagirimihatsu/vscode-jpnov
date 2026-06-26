/**
 * Ambient declarations for the stock textlint rule packages we bundle. None ship their own types;
 * each exposes a single {@link TextlintRuleModule} (a reporter function or a `{ linter, fixer }`
 * object) as its CommonJS default export. esbuild resolves the CJS/`__esModule` default interop at
 * bundle time, so a plain `import rule from '…'` yields the rule at runtime and type-checks here.
 *
 * Kept narrow on purpose: only the modules `modules.ts` actually imports are declared, so an
 * accidental import of an unvetted (possibly kuromoji-pulling) rule stays a compile error.
 */
declare module 'textlint-rule-sentence-length' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-max-kanji-continuous-len' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-no-hankaku-kana' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-no-nfd' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-no-zero-width-spaces' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module '@textlint-rule/textlint-rule-no-invalid-control-character' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-ja-unnatural-alphabet' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-general-novel-style-ja' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module '@textlint-rule/textlint-rule-no-unmatched-pair' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
declare module 'textlint-rule-ja-no-mixed-period' {
  const rule: import('@textlint/types').TextlintRuleModule;
  export default rule;
}
