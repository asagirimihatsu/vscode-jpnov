/**
 * Pure input normalization for the panel's create-file command (`jpbook.createFile`):
 * one typed path becomes a root-relative `.jpnov` / `.jpbook` entry. vscode-free.
 */
import { isAbsoluteLocation } from '../config/validate.ts';

/** Why a typed path is unusable; the command maps each code to a localized message. */
export type FileInputError = 'empty' | 'absolute' | 'escapes' | 'badName';

/**
 * A typed path (`src/my-chapter`, either separator) normalized into a root-relative file
 * path: segments collapsed, `suffix` appended when missing, NFC. Rejects what the `.jpbook`
 * grammar or a filesystem would: absolute/home/scheme locations, `..` segments, and
 * per-segment the Windows-forbidden character set or leading/trailing dots and
 * whitespace (dotfiles would be invisible to the chapter picker).
 */
export function normalizeFileInput(
  raw: string,
  suffix: string,
): { ok: true; rel: string } | { ok: false; error: FileInputError } {
  const trimmed = raw.trim().normalize('NFC');
  if (trimmed === '') {
    return { ok: false, error: 'empty' };
  }
  if (trimmed.startsWith('~') || isAbsoluteLocation(trimmed)) {
    return { ok: false, error: 'absolute' };
  }
  const segments = trimmed.split(/[\\/]/u).filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    return { ok: false, error: 'escapes' };
  }
  const last = segments.pop();
  if (last === undefined) {
    return { ok: false, error: 'empty' };
  }
  const stem = last.endsWith(suffix) ? last.slice(0, -suffix.length) : last;
  if (stem === '') {
    return { ok: false, error: 'empty' };
  }
  for (const part of [...segments, stem]) {
    if (/[\p{Cc}:*?"<>|]/u.test(part) || /^[\s.]|[\s.]$/u.test(part)) {
      return { ok: false, error: 'badName' };
    }
  }
  return { ok: true, rel: [...segments, `${stem}${suffix}`].join('/') };
}
