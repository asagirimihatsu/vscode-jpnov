import { randomBytes } from 'node:crypto';

/** A cryptographically-random nonce for a webview's CSP (base64url, no padding). */
export function makeNonce(): string {
  return randomBytes(24).toString('base64url');
}
