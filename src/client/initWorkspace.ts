/**
 * The `Japanese Novel: Init Workspace` command (`jpnov.initWorkspace`). Scaffolds a fresh novel
 * project into the chosen workspace folder after a short Q&A, then opens the sample chapter. It is
 * the manual replacement for the old silent launch.json seeding: nothing is written until every
 * prompt is answered AND a final "targets-only" guard confirms none of the files it would create
 * already exist (so it never overwrites — an unrelated pre-existing `.vscode/` or `src/` is fine).
 * The sole exception is `.gitignore`, which is appended to (never overwritten) so build output
 * (`dist/`) stays out of version control even in a folder that already has one.
 *
 * All user-facing strings go through {@link vscode.l10n.t}; English is the in-source base and a
 * Japanese-locale VS Code reads `l10n/bundle.l10n.ja.json`. The command takes no `ExtensionContext`
 * (no persisted state — the guard, not a one-shot flag, is what stops a re-init) and depends on no
 * config/server round-trip, so it works in an empty workspace where the extension was activated
 * purely by invoking this command.
 */
import * as vscode from 'vscode';

import {
  CHARS_MAX,
  CHARS_MIN,
  DEFAULT,
  type RawNovelConfig,
} from '#/shared/config/types.ts';

import { BUILD_CONFIGS } from './buildDebug.ts';
import { command } from './commands.ts';

/** Fixed scaffold names. The source directory stays the config default (`./src`). */
const SOURCE_DIR_NAME = 'src';
const CHAPTER_FILE = 'first-chapter.jpnov';
const FILELIST_FILE = 'volume1.filelist';
const CONFIG_FILE = 'novel.jp.json';
const LAUNCH_FILE = 'launch.json';
const SETTINGS_FILE = 'settings.json';
const GITIGNORE_FILE = '.gitignore';

/** Every `novel.jp.*` basename — any one present means the folder is already a project. */
const CONFIG_BASENAMES = [
  'novel.jp.json',
  'novel.jp.js',
  'novel.jp.cjs',
  'novel.jp.mjs',
  'novel.jp.ts',
] as const;

/** The starter chapter: a tasteful welcome that also demos ruby / emphasis / indent / page-break. */
const CHAPTER_CONTENT = `　ようこそ、小説の執筆へ。
　このファイルは、書き味をひと目で確かめるためのサンプルです。
　主に賞や文学出版物への投稿を想定し、縦書き原稿を作成するための機能を備えています。
　漢字にはルビを振れます。たとえば物語《ものがたり》や、｜青空《あおぞら》のように。
　ここぞという言葉には傍点［＃「傍点」に傍点］を打てますし、傍線［＃「傍線」に傍線］や太字［＃「太字」は太字］も使えます。
［＃ここから２字下げ］
　引用や補足は、このように一段下げてまとめられます。
［＃ここで字下げ終わり］
　ファイルの拡張子は「.jpnov」です。ファイルネームは自由ですが、「.filelist」にもチェックし、章のファイルを列挙してください。
［＃改ページ］
　あなたの物語を書き始めましょう。
`;

export function registerInitWorkspace(): vscode.Disposable {
  return command('jpnov.initWorkspace', () => runInit());
}

async function runInit(): Promise<void> {
  const root = await pickFolder();
  if (root === undefined) {
    return;
  }

  // Guard #1 — fail fast before prompting. Skips settings.json (only known after Q1); guard #2
  // re-checks the full set authoritatively.
  const early = await checkTargets(root, false);
  if (early !== null) {
    // UI notification: showErrorMessage never rejects, so void is safe.
    void vscode.window.showErrorMessage(early);
    return;
  }

  const disableAi = await askDisableAi();
  if (disableAi === undefined) {
    return;
  }
  const charsPerLine = await askNumber(
    vscode.l10n.t('Characters per line'),
    DEFAULT.charsPerLine,
    CHARS_MIN,
    CHARS_MAX,
  );
  if (charsPerLine === undefined) {
    return;
  }
  const linesPerPage = await askNumber(
    vscode.l10n.t('Lines per page'),
    DEFAULT.linesPerPage,
    CHARS_MIN,
    CHARS_MAX,
  );
  if (linesPerPage === undefined) {
    return;
  }
  const avoidLineBreaks = await askAvoidLineBreaks();
  if (avoidLineBreaks === undefined) {
    return;
  }

  // Guard #2 — authoritative TOCTOU re-check with the real answers (now including settings.json).
  const conflict = await checkTargets(root, disableAi);
  if (conflict !== null) {
    // UI notification: showErrorMessage never rejects, so void is safe.
    void vscode.window.showErrorMessage(conflict);
    return;
  }

  const written = await writeScaffold(root, {
    disableAi,
    charsPerLine,
    linesPerPage,
    avoidLineBreaks,
  });
  if (!written) {
    return;
  }

  const chapterUri = vscode.Uri.joinPath(root, SOURCE_DIR_NAME, CHAPTER_FILE);
  try {
    const document = await vscode.workspace.openTextDocument(chapterUri);
    await vscode.window.showTextDocument(document);
  } catch {
    // Opening the sample chapter is a nicety; a failure here doesn't undo a successful scaffold.
  }
  // UI notification: showInformationMessage never rejects, so void is safe.
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Japanese Novel: workspace initialized. Start writing in {0}.',
      `${SOURCE_DIR_NAME}/${CHAPTER_FILE}`,
    ),
  );
}

/** Resolve the folder to scaffold: error on none, the single folder, or a pick across many. */
async function pickFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    // UI notification: showErrorMessage never rejects, so void is safe.
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Japanese Novel: open a folder first, then run Init Workspace.'),
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0]?.uri;
  }
  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: vscode.l10n.t('Pick the folder to initialize as a Japanese Novel project.'),
  });
  return picked?.uri;
}

interface BoolPickItem extends vscode.QuickPickItem {
  readonly value: boolean;
}

/** Q1 — disable AI assistants? Default (first) item is "yes". */
async function askDisableAi(): Promise<boolean | undefined> {
  const items: BoolPickItem[] = [
    {
      label: vscode.l10n.t('Yes — disable AI in this workspace'),
      detail: vscode.l10n.t(
        'Writes .vscode/settings.json turning off Copilot and inline suggestions.',
      ),
      value: true,
    },
    { label: vscode.l10n.t('No — leave AI settings unchanged'), value: false },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Disable AI assistants (Copilot, etc.) in this workspace?'),
    ignoreFocusOut: true,
  });
  return picked?.value;
}

/** Q3 — enable 禁則処理? Default (first) item is "no". */
async function askAvoidLineBreaks(): Promise<boolean | undefined> {
  const items: BoolPickItem[] = [
    {
      label: vscode.l10n.t('No (default)'),
      detail: vscode.l10n.t('Line breaks are not adjusted.'),
      value: false,
    },
    {
      label: vscode.l10n.t('Yes — enable kinsoku shori'),
      detail: vscode.l10n.t(
        'Keeps closing brackets/punctuation off line start and opening brackets off line end.',
      ),
      value: true,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Enable kinsoku shori (avoid awkward line breaks)?'),
    ignoreFocusOut: true,
  });
  return picked?.value;
}

/** Q2 — a single numeric field with the default pre-filled and live [min..max] validation. */
async function askNumber(
  prompt: string,
  value: number,
  min: number,
  max: number,
): Promise<number | undefined> {
  const raw = await vscode.window.showInputBox({
    prompt,
    value: String(value),
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      const n = Number(trimmed);
      if (!/^\d+$/.test(trimmed) || !Number.isInteger(n) || n < min || n > max) {
        return vscode.l10n.t('Enter a whole number from {0} to {1}.', min, max);
      }
      return undefined;
    },
  });
  return raw === undefined ? undefined : Number(raw.trim());
}

type ProbeResult = 'absent' | 'file' | 'dir' | 'error';

/** stat one URI: absent (FileNotFound), a file, a directory, or an unexpected error. Never throws. */
async function probe(uri: vscode.Uri): Promise<ProbeResult> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0 ? 'dir' : 'file';
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return 'absent';
    }
    return 'error';
  }
}

interface Target {
  readonly uri: vscode.Uri;
  readonly rel: string;
}

function target(root: vscode.Uri, segments: string[]): Target {
  return { uri: vscode.Uri.joinPath(root, ...segments), rel: segments.join('/') };
}

/**
 * Targets-only guard. Returns a localized error if any file we would create already exists (or if
 * `.vscode`/`src` is occupied by a regular file, or a path can't be inspected), else `null`.
 * `includeSettings` adds `.vscode/settings.json` to the set (it's only written when Q1 = yes).
 */
async function checkTargets(root: vscode.Uri, includeSettings: boolean): Promise<string | null> {
  // `.vscode` and `src` must not exist AS FILES — we createDirectory + write into them.
  for (const dir of ['.vscode', SOURCE_DIR_NAME]) {
    const verdict = await probe(vscode.Uri.joinPath(root, dir));
    if (verdict === 'file') {
      return vscode.l10n.t('Japanese Novel: {0} exists as a file; a directory is needed.', dir);
    }
    if (verdict === 'error') {
      return vscode.l10n.t('Japanese Novel: cannot inspect {0}.', dir);
    }
  }

  const occupants: Target[] = [
    ...CONFIG_BASENAMES.map((name) => target(root, [name])),
    target(root, ['.vscode', LAUNCH_FILE]),
    target(root, [SOURCE_DIR_NAME, CHAPTER_FILE]),
    target(root, [SOURCE_DIR_NAME, FILELIST_FILE]),
  ];
  if (includeSettings) {
    occupants.push(target(root, ['.vscode', SETTINGS_FILE]));
  }
  for (const occupant of occupants) {
    const verdict = await probe(occupant.uri);
    if (verdict === 'file' || verdict === 'dir') {
      return vscode.l10n.t(
        'Japanese Novel: {0} already exists; initialization aborted.',
        occupant.rel,
      );
    }
    if (verdict === 'error') {
      return vscode.l10n.t('Japanese Novel: cannot inspect {0}.', occupant.rel);
    }
  }
  return null;
}

interface InitAnswers {
  readonly disableAi: boolean;
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  readonly avoidLineBreaks: boolean;
}

interface WriteOp {
  readonly rel: string;
  readonly run: () => Thenable<unknown>;
}

/** Write the scaffold in dependency order (config last). Surfaces the first failure and stops. */
async function writeScaffold(root: vscode.Uri, answers: InitAnswers): Promise<boolean> {
  const fs = vscode.workspace.fs;
  const ops: WriteOp[] = [
    { rel: '.vscode', run: () => fs.createDirectory(vscode.Uri.joinPath(root, '.vscode')) },
    writeOp(target(root, ['.vscode', LAUNCH_FILE]), launchJson()),
    ...(answers.disableAi ? [writeOp(target(root, ['.vscode', SETTINGS_FILE]), settingsJson())] : []),
    {
      rel: SOURCE_DIR_NAME,
      run: () => fs.createDirectory(vscode.Uri.joinPath(root, SOURCE_DIR_NAME)),
    },
    writeOp(target(root, [SOURCE_DIR_NAME, CHAPTER_FILE]), CHAPTER_CONTENT),
    writeOp(target(root, [SOURCE_DIR_NAME, FILELIST_FILE]), `${CHAPTER_FILE}\n`),
    // Keep build output out of version control (append-safe; never overwrites an existing file).
    { rel: GITIGNORE_FILE, run: () => ensureGitignore(root) },
    // novel.jp.json last: it triggers activation/config-resolve, which should see a complete tree.
    writeOp(target(root, [CONFIG_FILE]), configJson(answers)),
  ];

  for (const op of ops) {
    try {
      await op.run();
    } catch {
      // UI notification: showErrorMessage never rejects, so void is safe.
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Japanese Novel: failed to write {0}.', op.rel),
      );
      return false;
    }
  }
  return true;
}

function writeOp(file: Target, content: string): WriteOp {
  return {
    rel: file.rel,
    run: () => vscode.workspace.fs.writeFile(file.uri, Buffer.from(content, 'utf8')),
  };
}

/**
 * Create or update `.gitignore` so build output (`dist/`) is never committed — important for
 * non-programmer authors. Appends `dist/` to an existing file (preserving its content) and is a
 * no-op when `dist/` is already ignored.
 */
async function ensureGitignore(root: vscode.Uri): Promise<void> {
  const uri = vscode.Uri.joinPath(root, GITIGNORE_FILE);
  const existing = await readTextIfExists(uri);
  if (existing === null) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from('dist/\n', 'utf8'));
    return;
  }
  const alreadyIgnored = existing.split(/\r?\n/).some((line) => /^\/?dist\/?$/.test(line.trim()));
  if (alreadyIgnored) {
    return;
  }
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`${existing}${separator}dist/\n`, 'utf8'));
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | null> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return null;
    }
    throw err;
  }
}

function launchJson(): string {
  return stringify({ version: '0.2.0', configurations: BUILD_CONFIGS.map((c) => ({ ...c })) });
}

function settingsJson(): string {
  return stringify({
    'github.copilot.enable': { '*': false },
    'editor.inlineSuggest.enabled': false,
  });
}

/** Build `novel.jp.json` from the shared DEFAULT + the answers (avoidLineBreaks omitted when off). */
function configJson(answers: InitAnswers): string {
  const config: RawNovelConfig = {
    sourceDir: DEFAULT.sourceDir,
    charsPerLine: answers.charsPerLine,
    linesPerPage: answers.linesPerPage,
    ...(answers.avoidLineBreaks ? { avoidLineBreaks: true } : {}),
    ...(DEFAULT.outDir === undefined ? {} : { outDir: DEFAULT.outDir }),
  };
  return stringify(config);
}

/** Pretty JSON with a trailing newline, matching the repo's file convention. */
function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
