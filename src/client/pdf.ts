/**
 * Drives a resolved Chromium-family browser to convert one built `.html` into a sibling `.pdf`,
 * on the extension host's Node runtime. Each conversion gets a throwaway `--user-data-dir` under
 * the OS temp dir (removed afterwards).
 *
 * Headless Chrome writes the PDF and then often LINGERS — helper/updater processes keep the main
 * process alive well past the write — so success is detected by the output file appearing and its
 * size settling, NOT by the process exiting; the browser is killed once the PDF is ready. A
 * missing/empty file by the deadline (or the browser dying first) is a failure.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { printToPdfArgs } from './browser.ts';

const POLL_MS = 200;

export async function convertHtmlToPdf(
  browserExe: string,
  htmlPath: string,
  pdfPath: string,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<void> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'jpnov-pdf-'));
  // Drop any stale output so a settled non-empty file unambiguously means "freshly written".
  await rm(pdfPath, { force: true }).catch(() => undefined);
  const child = spawn(browserExe, printToPdfArgs(pathToFileURL(htmlPath).href, pdfPath, userDataDir), {
    stdio: 'ignore',
  });
  try {
    await waitForOutput(pdfPath, child, timeoutMs, signal);
  } finally {
    child.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Resolves once `pdfPath` is non-empty and its size is stable between two polls (Chrome writes the
 * file in one pass, so a settled size means the write finished). Rejects on abort, on the browser
 * failing to spawn or exiting before any output, or when the deadline passes with no settled file.
 */
function waitForOutput(
  pdfPath: string,
  child: ChildProcess,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let exited = false;
    let settled = false;

    const done = (err?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(timer);
      signal?.removeEventListener('abort', onAbort);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };
    const onAbort = (): void => {
      done(new Error('cancelled'));
    };
    const onExit = (): void => {
      exited = true;
    };
    const onError = (err: Error): void => {
      done(err);
    };

    if (signal?.aborted) {
      done(new Error('cancelled'));
      return;
    }
    signal?.addEventListener('abort', onAbort);
    child.on('exit', onExit);
    child.on('error', onError);

    const timer = setInterval(() => {
      void (async (): Promise<void> => {
        const size = await stat(pdfPath).then(
          (s) => s.size,
          () => -1,
        );
        if (size > 0 && size === lastSize) {
          done(); // non-empty and unchanged since the last poll -> write finished
          return;
        }
        lastSize = size;
        if (Date.now() > deadline) {
          done(new Error('the browser produced no PDF output'));
        } else if (exited && size <= 0) {
          done(new Error('the browser exited before writing a PDF'));
        }
      })();
    }, POLL_MS);
  });
}
