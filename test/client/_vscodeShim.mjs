// Inert stand-in `resolve-hooks.mjs` maps bare `vscode` to; it only satisfies module
// resolution — `mock.module('vscode', …)` layers the behavioral mock on top per test.
export {};
