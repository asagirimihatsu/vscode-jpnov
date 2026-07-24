/**
 * Ambient globals available ONLY inside the webview (browser) bundles: the VS Code webview API
 * and the `window.__INIT` bootstrap the host injects as a nonce'd inline script before the bundle
 * runs. Included solely by src/client/webview/tsconfig.json — never the host program — so a host file that
 * reaches for `acquireVsCodeApi` fails to compile instead of failing at runtime.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface Window {
  /** Set by the host's bootstrap `<script>`; each bundle narrows it to its own Init shape. */
  __INIT?: unknown;
}
