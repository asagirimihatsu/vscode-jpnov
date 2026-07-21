/**
 * Drives a resolved Chromium-family browser to convert one built `.html` into a sibling `.pdf`,
 * on the extension host's Node runtime. Each conversion gets a throwaway `--user-data-dir` under
 * the OS temp dir (removed afterwards).
 *
 * Headless Chrome writes the PDF and then often LINGERS — helper/updater processes keep the main
 * process alive well past the write — so success is detected by the output file appearing and its
 * size settling, NOT by the process exiting; the browser is killed once the PDF is ready. A
 * missing/empty file by the deadline (or the browser dying first) is a failure.
 *
 * Browser lifetime: the spawn is `detached` (own process group) so the kill can take the whole
 * tree — killing only the main pid leaves helpers behind. A `process.on('exit')` hook kills any
 * in-flight browser when the extension host shuts down normally; an orphan survives ONLY a hard
 * kill of the host, and a lingering `--print-to-pdf` Chrome then hijacks LaunchServices .html
 * opens on macOS (no window appears; the opened page is silently printed to PDF).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { printToPdfArgs } from './browser.ts';

const POLL_MS = 200;

/**
 * Kills the browser's whole process GROUP (the spawn is detached, so the child is its group
 * leader and `-pid` reaches every helper); falls back to the main pid when the group is gone.
 */
function killBrowser(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return; // never spawned
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL'); // group already gone; false on an already-dead child, never throws
  }
}

// In-flight conversions, killed from a single process-exit hook so a normal extension-host
// shutdown mid-conversion cannot orphan a print-to-pdf browser (conversions are serial, so
// this holds at most one child in practice).
const inFlight = new Set<ChildProcess>();
let exitHookInstalled = false;

function trackInFlight(child: ChildProcess): void {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const c of inFlight) {
        killBrowser(c);
      }
    });
  }
  inFlight.add(child);
}

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
    detached: true,
  });
  trackInFlight(child);
  try {
    await waitForOutput(pdfPath, child, timeoutMs, signal);
  } finally {
    killBrowser(child);
    inFlight.delete(child);
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
