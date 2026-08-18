/** Repo-root anchor + raw-file reader shared by the packaging/manifest guard tests. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Repository root as a URL base: resolve with `new URL(rel, REPO_ROOT)`. */
export const REPO_ROOT = new URL('../../', import.meta.url);

export function readRepoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, REPO_ROOT)), 'utf8');
}
