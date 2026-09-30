/**
 * TEST-ONLY setup the E2E suites share: the browser this machine resolves to, the options that
 * skip a browser leg without one (unless CI requires one via `JPNOV_E2E_REQUIRE_BROWSER=1`), and
 * the scratch directories a suite removes once its tests are done (`after(removeCleanups)`).
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { resolveBrowserExecutable } from './_browser.ts';

export const browser = resolveBrowserExecutable({
  env: process.env,
  platform: process.platform,
  exists: existsSync,
});

/** The options of every browser leg. */
export const BROWSER_SKIP = {
  skip: browser === undefined && process.env.JPNOV_E2E_REQUIRE_BROWSER !== '1'
    ? 'no Chromium-family browser on this machine (CI requires one via JPNOV_E2E_REQUIRE_BROWSER=1)'
    : false,
};

/** The scratch directories {@link removeCleanups} removes. */
export const cleanups: string[] = [];

export async function removeCleanups(): Promise<void> {
  await Promise.all(
    cleanups.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
}
