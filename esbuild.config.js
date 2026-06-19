import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  // The VS Code extension host (and the forked Node language server) run their own
  // bundled Node; node20 is a conservative, host-safe floor for the emitted JS.
  target: 'node20',
  // `vscode` is injected into the client by the host at runtime and has no npm
  // package to bundle. (The server never imports it.)
  external: ['vscode'],
  sourcemap: production ? false : 'linked',
  minify: production,
  treeShaking: true,
  logLevel: 'info',
  // vscode-languageclient@10 / vscode-languageserver@10 ship CommonJS builds that
  // perform dynamic `require(...)`. ESM output has no global `require`, so recreate
  // it from import.meta.url — otherwise the bundles crash on first load with
  // "Dynamic require of … is not supported". Required for BOTH bundles.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...base,
    entryPoints: ['src/client/extension.ts'],
    outfile: 'dist/client/extension.js',
  },
  {
    ...base,
    entryPoints: ['src/server/server.ts'],
    outfile: 'dist/server/server.js',
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((opts) => esbuild.context(opts)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('[esbuild] watching both client + server for changes…');
} else {
  await Promise.all(builds.map((opts) => esbuild.build(opts)));
  console.log('[esbuild] build complete (client + server)');
}
