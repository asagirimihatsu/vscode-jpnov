/**
 * Integration test for the `Japanese Novel: Init Workspace` command.
 *
 * NOT wired into `npm test` (test/client is authored-only). Run with a `vscode`
 * resolution shim present (see test/client/README.md):
 *   node --test --experimental-test-module-mocks "test/client/**\/*.test.ts"
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildVscode, createMockState, resetMockState, Uri, FileType } from './_vscodeMock.ts';

// Install the vscode mock ONCE, bound to a single shared state, BEFORE importing the SUT.
const state = createMockState();
mock.module('vscode', { namedExports: buildVscode(state) });

const { registerInitWorkspace } = await import('../../src/client/initWorkspace.ts');

const ROOT = '/root';

beforeEach(() => {
  resetMockState(state);
});

/** Register the command and return its handler. */
function handler(): () => Promise<void> {
  registerInitWorkspace();
  const fn = state.registeredCommands.get('jpnov.initWorkspace');
  assert.ok(fn, 'jpnov.initWorkspace is registered');
  return fn as () => Promise<void>;
}

function singleFolder(path = ROOT): void {
  state.workspaceFolders = [{ uri: Uri.file(path), name: 'root', index: 0 }];
}

/** Seed an existing fs entry the guard will probe. */
function seed(path: string, type: number = FileType.File): void {
  state.fsEntries.set(Uri.file(path).toString(), type);
}

function written(suffix: string): string | undefined {
  return state.writtenFiles.find((f) => f.uri.endsWith(suffix))?.content;
}

/** Queue answers for a full run: Q1 (disable AI), chars, lines, Q3 (avoidLineBreaks). */
function answer(opts: { disableAi: boolean; chars: string; lines: string; avoid: boolean }): void {
  state.quickPickQueue.push({ value: opts.disableAi }, { value: opts.avoid });
  state.inputBoxQueue.push(opts.chars, opts.lines);
}

test('registers the jpnov.initWorkspace command', () => {
  registerInitWorkspace();
  assert.ok(state.registeredCommands.has('jpnov.initWorkspace'));
});

test('no folder open: errors and writes nothing', async () => {
  state.workspaceFolders = undefined;
  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.equal(state.quickPickCalls.length, 0, 'no prompts shown');
  assert.equal(state.errorMessages.length, 1);
  assert.match(state.errorMessages[0] ?? '', /open a folder first/);
});

test('happy path, disable AI = yes: writes all 6 files with correct content', async () => {
  singleFolder();
  answer({ disableAi: true, chars: '40', lines: '34', avoid: false });

  await handler()();

  assert.equal(state.writtenFiles.length, 6);

  // settings.json — exact AI-disable payload.
  const settings = written('.vscode/settings.json');
  assert.ok(settings);
  assert.deepEqual(JSON.parse(settings), {
    'github.copilot.enable': { '*': false },
    'editor.inlineSuggest.enabled': false,
  });

  // launch.json — the two build configs.
  const launch = written('.vscode/launch.json');
  assert.ok(launch);
  const launchObj = JSON.parse(launch) as { version: string; configurations: unknown[] };
  assert.equal(launchObj.version, '0.2.0');
  assert.equal(launchObj.configurations.length, 2);

  // novel.jp.json — from DEFAULT + answers, avoidLineBreaks omitted when off.
  const config = written('novel.jp.json');
  assert.ok(config);
  assert.deepEqual(JSON.parse(config), {
    sourceDir: './src',
    charsPerLine: 40,
    linesPerPage: 34,
    outDir: 'dist',
  });

  // filelist lists the one chapter.
  assert.equal(written('src/volume1.filelist'), 'first-chapter.jpnov\n');

  // .gitignore created with the build output dir.
  assert.equal(written('.gitignore'), 'dist/\n');

  // dirs created; sample chapter opened; success toast.
  assert.ok(state.createdDirs.some((d) => d.endsWith('/.vscode')));
  assert.ok(state.createdDirs.some((d) => d.endsWith('/src')));
  assert.ok(state.openedDocs.some((d) => d.endsWith('src/first-chapter.jpnov')));
  assert.equal(state.infoMessages.length, 1);
  assert.match(state.infoMessages[0] ?? '', /initialized/);
});

test('disable AI = no: omits settings.json (5 files)', async () => {
  singleFolder();
  answer({ disableAi: false, chars: '40', lines: '34', avoid: false });

  await handler()();

  assert.equal(state.writtenFiles.length, 5);
  assert.equal(written('.vscode/settings.json'), undefined);
  assert.ok(written('.vscode/launch.json'));
});

test('avoidLineBreaks = yes is written into novel.jp.json', async () => {
  singleFolder();
  answer({ disableAi: false, chars: '20', lines: '40', avoid: true });

  await handler()();

  const config = written('novel.jp.json');
  assert.ok(config);
  assert.deepEqual(JSON.parse(config), {
    sourceDir: './src',
    charsPerLine: 20,
    linesPerPage: 40,
    avoidLineBreaks: true,
    outDir: 'dist',
  });
});

test('aborts (no prompts, no writes) when novel.jp.json already exists', async () => {
  singleFolder();
  seed(`${ROOT}/novel.jp.json`);
  answer({ disableAi: true, chars: '40', lines: '34', avoid: false });

  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.equal(state.createdDirs.length, 0);
  assert.equal(state.quickPickCalls.length, 0, 'guard #1 fails fast before any prompt');
  assert.match(state.errorMessages[0] ?? '', /novel\.jp\.json already exists/);
});

test('aborts when a non-json config (novel.jp.ts) already exists', async () => {
  singleFolder();
  seed(`${ROOT}/novel.jp.ts`);

  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.match(state.errorMessages[0] ?? '', /novel\.jp\.ts already exists/);
});

test('aborts when a write target (.vscode/launch.json) already exists', async () => {
  singleFolder();
  seed(`${ROOT}/.vscode/launch.json`);

  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.match(state.errorMessages[0] ?? '', /launch\.json already exists/);
});

test('Esc at Q1 aborts silently (no writes, no error)', async () => {
  singleFolder();
  state.quickPickQueue.push(undefined); // Q1 cancelled

  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.equal(state.errorMessages.length, 0, 'cancel is silent');
  assert.equal(state.quickPickCalls.length, 1);
});

test('numeric validateInput enforces per-field integer ranges', async () => {
  singleFolder();
  answer({ disableAi: false, chars: '40', lines: '34', avoid: false });

  await handler()();

  // Q: charsPerLine — [16..80] (the preview's fit-to-viewport font bounds).
  const chars = state.inputBoxCalls[0]?.options as {
    validateInput?: (v: string) => string | undefined;
  };
  assert.ok(chars.validateInput);
  assert.equal(chars.validateInput('40'), undefined);
  assert.equal(chars.validateInput('16'), undefined);
  assert.equal(chars.validateInput('80'), undefined);
  assert.match(chars.validateInput('15') ?? '', /whole number from 16 to 80/);
  assert.match(chars.validateInput('81') ?? '', /whole number from 16 to 80/);
  assert.match(chars.validateInput('1.5') ?? '', /whole number/);
  assert.match(chars.validateInput('abc') ?? '', /whole number/);

  // Q: linesPerPage — keeps the generic [1..1000].
  const lines = state.inputBoxCalls[1]?.options as {
    validateInput?: (v: string) => string | undefined;
  };
  assert.ok(lines.validateInput);
  assert.equal(lines.validateInput('1'), undefined);
  assert.equal(lines.validateInput('1000'), undefined);
  assert.match(lines.validateInput('0') ?? '', /whole number from 1 to 1000/);
  assert.match(lines.validateInput('1001') ?? '', /whole number from 1 to 1000/);
});

test('multi-root: scaffolds into the picked folder', async () => {
  state.workspaceFolders = [
    { uri: Uri.file('/multi-a'), name: 'a', index: 0 },
    { uri: Uri.file('/multi-b'), name: 'b', index: 1 },
  ];
  state.workspaceFolderPickResult = { uri: Uri.file('/multi-b') };
  answer({ disableAi: false, chars: '40', lines: '34', avoid: false });

  await handler()();

  assert.equal(state.writtenFiles.length, 5);
  assert.ok(
    state.writtenFiles.every((f) => f.uri.includes('/multi-b/')),
    'every file lands under the picked folder',
  );
});

test('multi-root: Esc on the folder pick aborts silently', async () => {
  state.workspaceFolders = [
    { uri: Uri.file('/m-a'), name: 'a', index: 0 },
    { uri: Uri.file('/m-b'), name: 'b', index: 1 },
  ];
  state.workspaceFolderPickResult = undefined; // Esc

  await handler()();

  assert.equal(state.writtenFiles.length, 0);
  assert.equal(state.errorMessages.length, 0);
});

test('.gitignore: appends dist/ to an existing file, preserving content', async () => {
  singleFolder();
  const gitignore = Uri.file(`${ROOT}/.gitignore`).toString();
  state.fsEntries.set(gitignore, FileType.File);
  state.fsContent.set(gitignore, 'node_modules/\n');
  answer({ disableAi: false, chars: '40', lines: '34', avoid: false });

  await handler()();

  assert.equal(written('.gitignore'), 'node_modules/\ndist/\n');
});

test('.gitignore: no-op when dist/ is already ignored', async () => {
  singleFolder();
  const gitignore = Uri.file(`${ROOT}/.gitignore`).toString();
  state.fsEntries.set(gitignore, FileType.File);
  state.fsContent.set(gitignore, 'dist/\n');
  answer({ disableAi: false, chars: '40', lines: '34', avoid: false });

  await handler()();

  // Existing dist/ entry → init does not rewrite .gitignore.
  assert.equal(written('.gitignore'), undefined);
});
