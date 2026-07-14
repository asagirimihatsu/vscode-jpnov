/**
 * Zero-dependency resolution of a Chromium-family browser for the Build-to-PDF step, plus the
 * headless print-to-PDF argument list. Pure and vscode-free — the filesystem check and the
 * environment are injected — so the whole resolver is unit-testable off any real machine. Chrome,
 * Edge, Chromium and Brave are all Chromium-based and accept the same flags; the candidate paths
 * mirror chrome-launcher / puppeteer's install-location lists.
 */

export interface BrowserResolveOptions {
  /** The user's `jpnov.build.browserPath`; used verbatim when it points at an existing file. */
  readonly configuredPath?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** Existence predicate (real caller: `fs.existsSync`); injected so the resolver stays pure. */
  readonly exists: (path: string) => boolean;
}

/**
 * The browser executable to drive, or `undefined` when none is found. Priority: the configured
 * path, then the `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` env vars, then per-platform defaults.
 * A configured-but-missing path falls through to auto-detect rather than hard-failing.
 */
export function resolveBrowserExecutable(opts: BrowserResolveOptions): string | undefined {
  const configured = opts.configuredPath?.trim();
  if (configured && opts.exists(configured)) {
    return configured;
  }
  for (const key of ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH'] as const) {
    const value = opts.env[key]?.trim();
    if (value && opts.exists(value)) {
      return value;
    }
  }
  for (const candidate of platformCandidates(opts.platform, opts.env)) {
    if (opts.exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Well-known install locations per platform, in preference order (Chrome → Edge → Chromium → Brave). */
function platformCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  if (platform === 'win32') {
    // %ProgramFiles% is the 64-bit install root, the (x86) variant 32-bit, %LOCALAPPDATA% per-user.
    const roots = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
      .map((key) => env[key])
      .filter((root): root is string => typeof root === 'string' && root.length > 0);
    const relatives = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ];
    return relatives.flatMap((rel) => roots.map((root) => `${root}\\${rel}`));
  }
  // Linux / other: fixed absolute paths, then the same binaries resolved against $PATH.
  const absolute = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/brave-browser',
  ];
  const names = [
    'google-chrome-stable',
    'google-chrome',
    'microsoft-edge-stable',
    'microsoft-edge',
    'chromium',
    'chromium-browser',
    'brave-browser',
  ];
  return [...absolute, ...resolveOnPath(names, env)];
}

/** Each name joined onto every `$PATH` directory (POSIX), name-major so preference order holds. */
function resolveOnPath(names: string[], env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.PATH ?? '').split(':').filter((dir) => dir.length > 0);
  return names.flatMap((name) => dirs.map((dir) => `${dir}/${name}`));
}

/**
 * The headless print-to-PDF invocation for any Chromium-family browser. A fresh `--user-data-dir`
 * is mandatory: it forces a standalone instance (never joining the user's running Chrome) and
 * sidesteps the SingletonLock a shared profile leaves behind. The built HTML already keeps the
 * browser's own header/footer off the paper via `@page{margin:0}`; `--no-pdf-header-footer` is
 * belt-and-braces.
 */
export function printToPdfArgs(htmlFileUrl: string, outPdfPath: string, userDataDir: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--no-pdf-header-footer',
    `--print-to-pdf=${outPdfPath}`,
    htmlFileUrl,
  ];
}
