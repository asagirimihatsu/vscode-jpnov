import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '**/*.vsix', '.scratch/'],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // A leaked value-import of `vscode` crashes the forked Node language server
    // (there is no `vscode` module outside the extension host). Only src/client/**
    // may value-import it; shared + server stay vscode-free. `import type` is fine.
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
        },
      ],
    },
  },
  {
    // node:test's top-level `test()` returns a promise tracked by the runner;
    // not awaiting it is the intended, safe pattern.
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // Config/build scripts are plain JS outside the TS program — no type-aware rules.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
