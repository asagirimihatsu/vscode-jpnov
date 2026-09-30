/**
 * What holds for the rows of EVERY manuscript, checked over the generated ones of the AST's
 * property tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../../../src/shared/ast/parse.ts';
import { buildRows, paginate, type DisplayLine } from '../../../src/shared/compiler/layout.ts';
import { manuscripts, withEol } from '../ast/_fuzz.ts';

const CORPUS = manuscripts();
/** The same manuscripts with a lone CR for every terminator — the third line ending. */
const ALL = [...CORPUS, ...CORPUS.slice(0, 60).map((src) => withEol(src, '\r'))];

test('a row shows the state of its line', () => {
  for (const src of ALL) {
    const ast = parse(src);
    for (const row of buildRows(ast)) {
      if (row.kind === 'line') {
        const line = ast.lines[row.srcLine];
        assert.ok(line);
        assert.equal(row.indent, line.indent);
        assert.equal(row.heading, line.heading);
        assert.ok(row.units.length > 0 || row.srcLine < ast.lines.length - 1);
      }
    }
  }
});

test('the three line endings lay out alike', () => {
  for (const src of CORPUS.slice(0, 150)) {
    const lf = buildRows(parse(withEol(src, '\n')), { dash: 'horizontalBar' });
    assert.deepEqual(buildRows(parse(withEol(src, '\r\n')), { dash: 'horizontalBar' }), lf, JSON.stringify(src));
    assert.deepEqual(buildRows(parse(withEol(src, '\r')), { dash: 'horizontalBar' }), lf, JSON.stringify(src));
  }
});

test('the real units of a row run in source order, each inside its line', () => {
  for (const src of ALL) {
    const ast = parse(src);
    for (const row of buildRows(ast)) {
      if (row.kind !== 'line') {
        continue;
      }
      const line = ast.lines[row.srcLine];
      assert.ok(line);
      let last = 0;
      for (const u of row.units) {
        assert.ok(u.at >= 0 && u.at <= line.span.end - line.span.start, JSON.stringify(src));
        if (u.cells > 0) {
          assert.ok(u.at >= last, JSON.stringify(src));
          last = u.at;
        }
      }
    }
  }
});

test('a line\'s columns start at its head, then in source order', () => {
  for (const src of ALL) {
    for (const kinsoku of ['none', 'strict'] as const) {
      let prev: DisplayLine | undefined;
      for (const column of paginate(buildRows(parse(src)), 3, 1000, kinsoku).flat()) {
        if (column.srcLine === prev?.srcLine) {
          assert.ok(column.at >= prev.at, JSON.stringify(src));
        } else {
          assert.equal(column.at, 0, JSON.stringify(src));
        }
        prev = column;
      }
    }
  }
});
