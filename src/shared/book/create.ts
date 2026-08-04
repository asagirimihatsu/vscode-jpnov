/**
 * Pure composition for the guided new-book wizard (`jpbook.createBook`): the file-name
 * stem derived from a title, and the initial `.jpbook` text. vscode-free.
 */
import { sanitizeValue } from './edits.ts';

/**
 * The title reduced to a usable file-name stem: path-hostile characters (the Windows
 * forbidden set) and control characters are dropped, then leading/trailing dots and
 * whitespace (incl. U+3000) are trimmed. '' = the title cannot name a file.
 */
export function sanitizeBookStem(title: string): string {
  return title
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '')
    .replace(/^[\s.]+/u, '')
    .replace(/[\s.]+$/u, '');
}

/**
 * The initial `.jpbook` text: a title-only front-matter block, then one root-relative
 * chapter path per line. LF with a trailing newline; round-trips through `parseJpbook`.
 */
export function newBookText(title: string, chapterRels: readonly string[]): string {
  const clean = sanitizeValue(title);
  const entry = clean === '' ? 'title:' : `title: ${clean}`;
  return ['---', entry, '---', ...chapterRels, ''].join('\n');
}
