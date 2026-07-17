/**
 * E2E smoke over the BUNDLED server: drives `dist/server/server.js` over LSP stdio exactly
 * like the extension host does, so it catches bundling regressions (createRequire banner,
 * tripwires, protocol wiring) the in-process suites cannot. `npm run test:e2e` builds first
 * via `pretest:e2e`. The final leg renders the built page in a headless Chromium and asserts
 * the vertical-flow metrics; without a discoverable browser it skips, unless
 * `JPNOV_E2E_REQUIRE_BROWSER=1` (CI) makes the absence a failure.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveBrowserExecutable } from '../../src/client/browser.ts';
import type {
  BuildResult,
  HtmlSettings,
  ListBooksResult,
  PreviewSettings,
  RenderFileResult,
} from '../../src/shared/protocol.ts';

import { LspClient } from './lsp.ts';

const SERVER_MODULE = fileURLToPath(new URL('../../dist/server/server.js', import.meta.url));

const PREVIEW_SETTINGS: PreviewSettings = {
  charsPerLine: 40,
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
  lineNumbers: true,
  edgeLine: 'none',
};

const HTML_SETTINGS: HtmlSettings = {
  charsPerLine: 40,
  linesPerPage: 34,
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
  lineNumbers: false,
  edgeLine: 'none',
};

/** Exercises ruby, explicit + automatic (half-width pair) 縦中横, and 改ページ in one pass. */
const CHAPTER_TEXT = [
  '｜夜霧《よぎり》の街を行く。',
  '［＃縦中横］12［＃縦中横終わり］時の鐘が鳴る。',
  '走った!?',
  '［＃改ページ］',
  '二章の本文。',
  '',
].join('\n');

const browser = resolveBrowserExecutable({
  env: process.env,
  platform: process.platform,
  exists: existsSync,
});
const browserRequired = process.env.JPNOV_E2E_REQUIRE_BROWSER === '1';

let client: LspClient | undefined;
const cleanups: string[] = [];
let builtHtml: string | undefined;

const conn = (): LspClient => {
  assert.ok(client, 'LSP client not started');
  return client;
};

before(async () => {
  assert.ok(
    existsSync(SERVER_MODULE),
    `missing ${SERVER_MODULE} — run \`npm run build:dev\` first (\`npm run test:e2e\` does)`,
  );
  client = new LspClient(SERVER_MODULE);
  await client.request('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
    initializationOptions: { lintConfig: {} },
  });
  client.notify('initialized', {});
});

after(async () => {
  if (client) {
    await client.dispose();
  }
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
});

test('jpnov/renderFile renders ruby, 縦中横, and the pagebreak marker over the wire', async () => {
  const { html } = await conn().request<RenderFileResult>('jpnov/renderFile', {
    uri: 'file:///e2e/preview.jpnov',
    text: CHAPTER_TEXT,
    settings: PREVIEW_SETTINGS,
  });

  assert.ok(html.includes('<ruby class="rr">'), 'ruby must render on the custom right lane');
  assert.ok(
    html.includes('<rt><span>よ</span><span>ぎ</span><span>り</span></rt>'),
    'the reading must survive as per-character cells',
  );
  assert.ok(!html.includes('《'), 'the Aozora reading brackets must be consumed');
  assert.ok(html.includes('<span class="tcy">12</span>'), 'explicit 縦中横 span must combine');
  assert.ok(html.includes('<span class="tcy">!?</span>'), 'autoTcy must combine the half-width !? pair');
  assert.ok(html.includes('vertical-rl'), 'vertical flow CSS must be inlined');
  assert.ok(html.includes('text-combine-upright'), 'the on-demand tcy fragment must be gated in');
  assert.ok(html.includes('pagebreak'), '改ページ must surface as the preview pagebreak marker');
});

test('jpnov/listBooks + jpnov/build round-trip a real workspace over the wire', async () => {
  const wsDir = await mkdtemp(join(tmpdir(), 'jpnov-e2e-ws-'));
  cleanups.push(wsDir);
  const wsUri = pathToFileURL(wsDir).href.replace(/\/$/, '');
  await writeFile(join(wsDir, 'hon.jpnov'), CHAPTER_TEXT, 'utf8');
  await writeFile(join(wsDir, 'hon.jpbook'), '---\ntitle: 試験本\n---\nhon.jpnov\n', 'utf8');
  const projectDirs = { [wsUri]: { outDir: 'dist' } };

  const list = await conn().request<ListBooksResult>('jpnov/listBooks', { projectDirs });
  assert.equal(list.books.length, 1);
  const book = list.books[0];
  assert.ok(book);
  assert.equal(book.outRel, 'hon');
  assert.equal(book.title, '試験本');

  const result = await conn().request<BuildResult>('jpnov/build', {
    settings: HTML_SETTINGS,
    projectDirs,
  });
  assert.equal(result.ok, true);
  assert.ok(result.artifacts);
  assert.equal(result.artifacts.length, 2);

  const htmlArtifact = result.artifacts.find((a) => a.path.endsWith('.html'));
  assert.ok(htmlArtifact);
  assert.equal(htmlArtifact.path, `${wsUri}/dist/hon.html`);
  assert.ok(htmlArtifact.content.includes('class="page"'), 'built HTML must paginate');
  assert.ok(htmlArtifact.content.includes('class="line"'), 'built HTML must emit line columns');
  assert.ok(htmlArtifact.content.includes('<ruby'), 'built HTML must keep the ruby markup');

  const txtArtifact = result.artifacts.find((a) => a.path.endsWith('.txt'));
  assert.ok(txtArtifact);
  assert.equal(txtArtifact.path, `${wsUri}/dist/hon.txt`);
  assert.ok(txtArtifact.content.includes('夜霧'), 'the .txt artifact carries the raw Aozora source');

  builtHtml = htmlArtifact.content;
});

const MARKER = 'data-verify';

/**
 * Runs SYNCHRONOUSLY at parse time (getBoundingClientRect forces layout), because
 * `--dump-dom` serializes right at document load — a load/rAF listener would fire too late
 * to make it into the dump.
 */
const MEASURE_SCRIPT = `<script>
(() => {
  const page = document.querySelector('.page');
  const line = document.querySelector('.line');
  let painted = 0;
  if (line) {
    const range = document.createRange();
    range.selectNodeContents(line);
    painted = Math.round(range.getBoundingClientRect().height);
  }
  document.documentElement.setAttribute('${MARKER}', JSON.stringify({
    writingMode: page ? getComputedStyle(page).writingMode : 'missing',
    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
    lineCount: document.querySelectorAll('.line').length,
    paintedExtent: painted,
    rubyCount: document.querySelectorAll('ruby').length,
    tcyCount: document.querySelectorAll('.tcy').length,
  }));
})();
</script>`;

interface VerifyMetrics {
  readonly writingMode: string;
  readonly rootFontSize: number;
  readonly lineCount: number;
  readonly paintedExtent: number;
  readonly rubyCount: number;
  readonly tcyCount: number;
}

/** The serializer escapes the attribute value; only `"` and `&` can occur in the JSON. */
const unescapeAttr = (s: string): string => s.replaceAll('&quot;', '"').replaceAll('&amp;', '&');

/**
 * Dumps the page DOM headlessly and extracts the marker attribute. The browser process
 * lingers after dumping, so poll the collected stdout for the complete marker, then kill.
 */
async function dumpMarker(browserPath: string, pageUrl: string, profileDir: string): Promise<string> {
  const ciFlags = process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const child = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    ...ciFlags,
    `--user-data-dir=${profileDir}`,
    '--window-size=900,700',
    '--timeout=3000',
    '--dump-dom',
    pageUrl,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: string) => {
    out += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    err += chunk;
  });

  const marker = new RegExp(`${MARKER}="([^"]*)"`);
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      const found = marker.exec(out);
      if (found) {
        return found[1] ?? '';
      }
      if (child.exitCode !== null) {
        break;
      }
      await delay(100);
    }
  } finally {
    child.kill('SIGKILL');
  }
  throw new Error(`no ${MARKER} marker in browser output.\nstderr tail: ${err.slice(-2000)}`);
}

test('the built page renders vertically in a headless Chromium', {
  skip: browser === undefined && !browserRequired
    ? 'no Chromium-family browser on this machine (CI requires one via JPNOV_E2E_REQUIRE_BROWSER=1)'
    : false,
}, async () => {
  assert.ok(browser, 'JPNOV_E2E_REQUIRE_BROWSER=1 but no Chromium-family browser was found');
  assert.ok(builtHtml, 'the build leg must have produced an HTML artifact');
  assert.ok(builtHtml.includes('</body>'), 'built HTML must close <body> for script injection');

  const pageDir = await mkdtemp(join(tmpdir(), 'jpnov-e2e-page-'));
  cleanups.push(pageDir);
  const pagePath = join(pageDir, 'hon.html');
  await writeFile(pagePath, builtHtml.replace('</body>', `${MEASURE_SCRIPT}</body>`), 'utf8');
  const profileDir = await mkdtemp(join(pageDir, 'profile-'));

  const raw = await dumpMarker(browser, pathToFileURL(pagePath).href, profileDir);
  const metrics = JSON.parse(unescapeAttr(raw)) as VerifyMetrics;

  assert.equal(metrics.writingMode, 'vertical-rl', 'pages must flow vertical-rl');
  assert.ok(metrics.rootFontSize > 0);
  assert.ok(metrics.lineCount >= 2, `expected multiple line columns, saw ${String(metrics.lineCount)}`);
  assert.ok(
    metrics.paintedExtent >= metrics.rootFontSize,
    `a line must paint at least one character tall (painted ${String(metrics.paintedExtent)}px)`,
  );
  assert.ok(metrics.rubyCount >= 1, 'the ruby annotation must reach the DOM');
  assert.ok(metrics.tcyCount >= 2, 'both 縦中横 units must reach the DOM');
});
