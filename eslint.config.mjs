import tseslint from 'typescript-eslint';

import { houseConfig } from './eslint.house.mjs';

export default tseslint.config(
  ...houseConfig({
    tsconfigRootDir: import.meta.dirname,
    // Generated modules (gitignored, produced by `npm run gen`) are machine-written string
    // blobs — never hand-edited, so never linted (the JSON-encoded bundles use double quotes).
    // website/ is its own npm project with its own ESLint config (website/eslint.config.mjs).
    ignores: ['dist/', 'node_modules/', '**/*.vsix', '.scratch/', '**/*.generated.ts', 'media/codicon/', 'website/'],
  }),
  {
    // A leaked value-import of `vscode` crashes the forked Node language server
    // (there is no `vscode` module outside the extension host). Only src/client/**
    // may value-import it; shared + server stay vscode-free. `import type` is fine.
    // The AST is read through its front doors; what it is built with stays inside it.
    files: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'vscode must not be value-imported in shared/server (type-only import type is fine)',
            },
          ],
          patterns: [
            {
              regex: '/ast/(cells|classify|lists|parts)\\.ts$',
              message: 'internal to src/shared/ast: read the AST through nodes, notation, scan, resolve, parse, print or span',
            },
          ],
        },
      ],
    },
  },
  {
    // The AST is a layer of its own: an allow-list of its own modules and ../chars.ts. This
    // block replaces the one above for these files (vscode is outside the list).
    files: ['src/shared/ast/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./[^/]+$)(?!\\.\\./chars\\.ts$)',
              message: 'src/shared/ast may import only ../chars.ts and its own modules',
            },
          ],
        },
      ],
    },
  },
  {
    // What the AST stands on is a leaf.
    files: ['src/shared/chars.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '.', message: 'src/shared/chars.ts imports nothing: the AST layer stands on it' }] },
      ],
    },
  },
);
