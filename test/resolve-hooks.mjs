/**
 * Module-resolution hooks (registered by `register.mjs`) that make every suite runnable under
 * plain `node --test`: Node's ESM loader rejects the `#/` prefix of the package.json
 * `imports` map outright, so `#/…` resolves against `src/` here; bare `vscode` has no npm
 * package (the extension host injects it at runtime), so it resolves to the inert shim that
 * `mock.module('vscode', …)` then overlays per test.
 */
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
