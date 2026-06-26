/**
 * CJS/ESM default-interop shim. The stock textlint rule packages (and the text plugin) are
 * Babel-compiled CommonJS: some expose the rule as `module.exports` directly, others as
 * `module.exports.default`. esbuild and Node's native loader unwrap that `.default` inconsistently,
 * so normalize HERE — `unwrapDefault` returns the inner value whether or not it was wrapped, so the
 * production bundle and the native-loader tests both hand the kernel a real rule/plugin.
 */
export function unwrapDefault<T>(mod: T | { readonly default: T }): T {
  const wrapped = mod as { default?: T };
  return wrapped.default ?? (mod as T);
}
