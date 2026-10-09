/**
 * `.jpbook` text for tests: the version line and the seven required keys at the book template's
 * values, any of them overridden or left out, then the closing `---`, so a fixture reads as
 * `meta() + 'a.jpnov\n'` and the keys stay out of its way. The template itself is pinned by
 * create.test.ts.
 */
import { bookTemplate } from '../../../src/shared/book/create.ts';
import { metaLine, REQUIRED_KEYS, type RequiredKey } from '../../../src/shared/book/jpbook.ts';

/** The eight metadata lines (`version` first), `overrides` applied and `omit` dropped, then `---` and a newline. */
export function meta(overrides: Partial<Record<RequiredKey, string>> = {}, omit: readonly RequiredKey[] = []): string {
  const base = bookTemplate('作品名').split('\n');
  const lines = REQUIRED_KEYS.flatMap((key, i) => {
    if (omit.includes(key)) {
      return [];
    }
    const value = overrides[key];
    return [value === undefined ? base[i] ?? '' : metaLine(key, value)];
  });
  return `${[...lines, '---'].join('\n')}\n`;
}

/** {@link meta} with `lines` written last in the metadata, right above the fence. */
export function metaWith(
  lines: string,
  overrides: Partial<Record<RequiredKey, string>> = {},
  omit: readonly RequiredKey[] = [],
): string {
  return meta(overrides, omit).replace(/---\n$/, `${lines}\n---\n`);
}
