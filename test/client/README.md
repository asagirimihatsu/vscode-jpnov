# Client integration tests

These exercise the host-side client modules (`src/client/**`) against an in-memory
`vscode` mock (`_vscodeMock.ts`). They are **authored but intentionally NOT wired into
`npm test`** this round — `npm test` runs only the vscode-free `test/shared/**` suite.

## Running

The client modules `import * as vscode from 'vscode'`, but `vscode` has no installable
npm package (the extension host injects it at runtime; esbuild marks it `external`). So
the bare specifier needs to *resolve* to something before `node:test`'s `mock.module`
can layer the real mock on top.

Provide a one-file resolution shim at the project root, then run the suite:

```sh
# 1. Resolution shim (build- and runtime-irrelevant; esbuild keeps vscode external).
mkdir -p node_modules/vscode
printf '{"name":"vscode","version":"0.0.0-test-shim","type":"module","main":"index.js","exports":{".":"./index.js"}}\n' > node_modules/vscode/package.json
printf 'export {};\n' > node_modules/vscode/index.js

# 2. Run the client suite (Node >= 22 for --experimental-test-module-mocks).
node --test --experimental-test-module-mocks "test/client/**/*.test.ts"
```

`mock.module('vscode', { namedExports: buildVscode(state) })` overrides the shim with a
behavioral mock per test; the shim only satisfies module resolution.

> The shim lives under `node_modules/` and is recreated by `npm install`-clobbering, so
> it is deliberately not committed. Re-run step 1 if `vscode` fails to resolve.
