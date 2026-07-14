/**
 * Unit tests for the pure Build-to-PDF browser resolver. `browser.ts` imports nothing, so this
 * runs directly under `node --test` with no vscode mock and no resolution shim:
 *   node --test "test/client/browser.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { printToPdfArgs, resolveBrowserExecutable } from '../../src/client/browser.ts';

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** An `exists` predicate that accepts exactly the given paths. */
const only =
  (...present: string[]) =>
  (path: string): boolean =>
    present.includes(path);

test('configured path wins when it exists', () => {
  const got = resolveBrowserExecutable({
    configuredPath: '/custom/chrome',
    env: { CHROME_PATH: '/env/chrome' },
    platform: 'darwin',
    exists: only('/custom/chrome', '/env/chrome', CHROME_MAC),
  });
  assert.equal(got, '/custom/chrome');
});

test('a configured-but-missing path falls through to auto-detect', () => {
  const got = resolveBrowserExecutable({
    configuredPath: '/gone/chrome',
    env: {},
    platform: 'darwin',
    exists: only(CHROME_MAC),
  });
  assert.equal(got, CHROME_MAC);
});

test('CHROME_PATH is honored before the platform defaults', () => {
  const got = resolveBrowserExecutable({
    configuredPath: '',
    env: { CHROME_PATH: '/env/chrome' },
    platform: 'linux',
    exists: only('/env/chrome', '/usr/bin/google-chrome'),
  });
  assert.equal(got, '/env/chrome');
});

test('PUPPETEER_EXECUTABLE_PATH is honored too', () => {
  const got = resolveBrowserExecutable({
    env: { PUPPETEER_EXECUTABLE_PATH: '/env/pptr' },
    platform: 'win32',
    exists: only('/env/pptr'),
  });
  assert.equal(got, '/env/pptr');
});

test('macOS falls back to the Chrome app bundle', () => {
  const got = resolveBrowserExecutable({ env: {}, platform: 'darwin', exists: only(CHROME_MAC) });
  assert.equal(got, CHROME_MAC);
});

test('macOS prefers Chrome over Edge when both are present', () => {
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const got = resolveBrowserExecutable({
    env: {},
    platform: 'darwin',
    exists: only(CHROME_MAC, edge),
  });
  assert.equal(got, CHROME_MAC);
});

test('Windows joins a Program Files root with the Chrome relative path', () => {
  const got = resolveBrowserExecutable({
    env: { ProgramFiles: 'C\\PF' },
    platform: 'win32',
    exists: only('C\\PF\\Google\\Chrome\\Application\\chrome.exe'),
  });
  assert.equal(got, 'C\\PF\\Google\\Chrome\\Application\\chrome.exe');
});

test('Windows finds per-user Edge under LOCALAPPDATA', () => {
  const edge = 'L\\AD\\Microsoft\\Edge\\Application\\msedge.exe';
  const got = resolveBrowserExecutable({
    env: { LOCALAPPDATA: 'L\\AD' },
    platform: 'win32',
    exists: only(edge),
  });
  assert.equal(got, edge);
});

test('Linux resolves a bare chromium on $PATH', () => {
  const got = resolveBrowserExecutable({
    env: { PATH: '/opt/bin:/usr/local/bin' },
    platform: 'linux',
    exists: only('/usr/local/bin/chromium'),
  });
  assert.equal(got, '/usr/local/bin/chromium');
});

test('returns undefined when nothing is found', () => {
  const got = resolveBrowserExecutable({ env: {}, platform: 'linux', exists: () => false });
  assert.equal(got, undefined);
});

test('printToPdfArgs ends with the file URL and carries the print flag', () => {
  const args = printToPdfArgs('file:///out/book.html', '/out/book.pdf', '/tmp/profile');
  assert.deepEqual(args, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/profile',
    '--no-pdf-header-footer',
    '--print-to-pdf=/out/book.pdf',
    'file:///out/book.html',
  ]);
});
