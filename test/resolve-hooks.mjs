/**
 * Module-resolution hooks (registered by `register.mjs`) that make every suite runnable under
 * plain `node --test`: Node's ESM loader rejects the `#/` prefix of the package.json
 * `imports` map outright, so `#/…` resolves against `src/` here; bare `vscode` has no npm
 * package (the extension host injects it at runtime), so it resolves to the inert shim that
 * `mock.module('vscode', …)` then overlays per test.
 */
// NOTE for A/B or mutation work: this is THIS FILE's repo, not the importing module's tree.
// A module copied elsewhere and imported by URL still gets the pristine `src/` for its `#/`
// imports — give each tree under test its own copy of these hooks, or the run comes out
// falsely clean.
const projectRoot = new URL('../', import.meta.url);
const vscodeShim = new URL('./client/_vscodeShim.mjs', import.meta.url);

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('#/')) {
    return nextResolve(new URL(`src/${specifier.slice(2)}`, projectRoot).href, context);
  }
  if (specifier === 'vscode') {
    return nextResolve(vscodeShim.href, context);
  }
  return nextResolve(specifier, context);
}
