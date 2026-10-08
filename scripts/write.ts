import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Writes `path` iff its content changed (parent folders created); returns whether a write happened. */
export async function writeIfChanged(path: string, next: string): Promise<boolean> {
  let prev: string | undefined;
  try {
    prev = await readFile(path, 'utf8');
  } catch {
    prev = undefined;
  }
  if (prev === next) {
    return false;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  return true;
}

/** The CLI of a codegen: runs `write` when the module at `moduleUrl` is the script node started. */
export function runCli(moduleUrl: string, label: string, write: () => Promise<boolean>): void {
  if (process.argv[1] === undefined || moduleUrl !== pathToFileURL(process.argv[1]).href) {
    return;
  }
  write().then((changed) => {
    console.log(changed ? `regenerated ${label}` : `up to date: ${label}`);
  }).catch((err: unknown) => {
    console.error(`error generating ${label}:`, err);
    process.exit(1);
  });
}
