/**
 * The hand-written .jpbook grammar against the parser: the cover-item markers come from
 * jpbook.ts COVER_ITEM_MARKS (on drift it prints the class to paste), and the front matter
 * opens the same way at the document start and after leading blank lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COVER_ITEM_MARKS } from '../../../src/shared/book/jpbook.ts';
import { readRepoFile } from '../repo.ts';

interface Rule {
  name?: string;
  match?: string;
  begin?: string;
  beginCaptures?: unknown;
  endCaptures?: unknown;
  patterns?: Rule[];
  include?: string;
}

const book = JSON.parse(readRepoFile('syntaxes/jpbook.tmLanguage.json')) as {
  patterns: Rule[];
  repository: Record<string, { patterns: Rule[] } | undefined>;
};

test('the .jpbook item rule accepts exactly the parser cover markers, before the key-value rule', () => {
  // A cover path may contain a colon, so the item rule has to win over the generic `key: value` rule.
  const frontMatter = book.repository['frontmatter-body']?.patterns ?? [];
  const item = frontMatter.findIndex((p) => p.match?.includes('.jpnov') === true);
  const keyValue = frontMatter.findIndex((p) => p.match?.includes(':：') === true);
  const needle = `[${COVER_ITEM_MARKS.join('')}]`;
  assert.ok(item >= 0, 'cover item rule not found in the front-matter block');
  assert.ok(keyValue >= 0, 'key-value rule not found in the front-matter block');
  assert.ok(item < keyValue, 'the item rule must precede the key-value rule (a path may contain a colon)');
  assert.ok(
    frontMatter[item]?.match?.includes(needle) === true,
    `stale cover-marker class in:\n${frontMatter[item]?.match ?? ''}\nPASTE:\n${needle}`,
  );
});

test('the .jpbook front matter opens at the document start and after leading blank lines alike', () => {
  const atStart = book.patterns.find((p) => p.name === 'meta.frontmatter.jpbook');
  const afterBlank = book.patterns
    .find((p) => p.name === undefined && p.begin?.startsWith('\\A') === true)
    ?.patterns?.find((p) => p.name === 'meta.frontmatter.jpbook');
  assert.ok(atStart, 'document-start front-matter rule not found');
  assert.ok(afterBlank, 'front-matter rule inside the leading-blank-lines rule not found');
  const painted = (rule: Rule): unknown => [rule.beginCaptures, rule.endCaptures, rule.patterns];
  assert.deepEqual(painted(afterBlank), painted(atStart));
  assert.deepEqual(atStart.patterns, [{ include: '#frontmatter-body' }]);
});
