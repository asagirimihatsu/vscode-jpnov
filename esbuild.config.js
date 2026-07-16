import { readFile } from 'node:fs/promises';

import * as esbuild from 'esbuild';

import { styleSourcePaths, writeStylesModule } from './scripts/gen-styles.ts';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Regenerate the styles module up front so every build (dev, prod, and watch's first pass)
// bundles fresh fragments; the styles-codegen plugin keeps --watch rebuilds fresh thereafter.
await writeStylesModule();

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  // The VS Code extension host (and the forked Node language server) run their own
  // bundled Node; the engines floor (VS Code ^1.129) bundles Node 24.
  target: 'node24',
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

/**
 * Phase-1 forbids dictionary-backed lint rules. If a textlint rule ever pulls a morphological
 * analyzer (kuromoji/kuromojin) or its IPADIC/MeCab dictionary into the SERVER bundle, fail the build
 * loudly here rather than silently shipping a ~15 MB dictionary. Scoped to the server build (the only
 * one that bundles textlint).
 */
const kuromojiTripwire = {
  name: 'kuromoji-tripwire',
  /** @param {import('esbuild').PluginBuild} build */
  setup(build) {
    build.onResolve({ filter: /kuromoji|ipadic|mecab/ }, (args) => ({
      errors: [
        {
          text: `[kuromoji-tripwire] Phase-1 forbids dictionary deps, but "${args.path}" was imported by "${args.importer}". Drop the offending rule or move it to a later opt-in pack.`,
        },
      ],
    }));
  },
};

/**
 * Re-runs the styles codegen when a fragment changes: loading the generated module registers
 * the authored `styles/*.css` files as watch dependencies, so in --watch a raw `.css` edit
 * regenerates `styles.generated.ts` and re-triggers the (server-only — the client bundle never
 * imports it) rebuild. Non-watch builds are covered by the up-front writeStylesModule() call.
 * @type {import('esbuild').Plugin}
 */
const stylesCodegen = {
  name: 'styles-codegen',
  setup(build) {
    build.onLoad({ filter: /styles[/\\]styles\.generated\.ts$/ }, async (args) => {
      await writeStylesModule();
      return {
        contents: await readFile(args.path, 'utf8'),
        loader: 'ts',
        watchFiles: await styleSourcePaths(),
      };
    });
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
    plugins: [kuromojiTripwire, stylesCodegen],
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
