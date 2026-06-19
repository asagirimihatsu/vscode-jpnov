import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emphasisClass,
  emphasisClassRule,
} from '../../../src/shared/compiler/emphasis.ts';

test('emphasisClass maps all nine dot variants directly to their class', () => {
  const table: [string, string][] = [
    ['傍点', 'emph-fs'],
    ['白ゴマ傍点', 'emph-os'],
    ['丸傍点', 'emph-fc'],
    ['白丸傍点', 'emph-oc'],
    ['二重丸傍点', 'emph-fd'],
    ['蛇の目傍点', 'emph-od'],
    ['黒三角傍点', 'emph-ft'],
    ['白三角傍点', 'emph-ot'],
    ['ばつ傍点', 'emph-x'],
  ];
  for (const [variant, cls] of table) {
    assert.equal(emphasisClass(variant), cls, `variant ${variant}`);
  }
});

test('emphasisClass collapses ×傍点 and ばつ傍点 to the same emph-x class', () => {
  assert.equal(emphasisClass('×傍点'), 'emph-x');
  assert.equal(emphasisClass('ばつ傍点'), 'emph-x');
});

test('emphasisClass adds the -l suffix for 左に / の左に prefixes (valid on all nine)', () => {
  assert.equal(emphasisClass('左に傍点'), 'emph-fs-l');
  assert.equal(emphasisClass('の左に傍点'), 'emph-fs-l');
  assert.equal(emphasisClass('左に二重丸傍点'), 'emph-fd-l');
  assert.equal(emphasisClass('の左にばつ傍点'), 'emph-x-l');
});

test('emphasisClass returns null for the 傍線 line family (=> comment)', () => {
  for (const v of ['傍線', '二重傍線', '鎖線', '破線', '波線', '左に傍線', '波線終わり']) {
    assert.equal(emphasisClass(v), null, `line family ${v} must be null`);
  }
});

test('emphasisClass returns null for unknown / empty variants', () => {
  for (const v of ['', 'なぞ傍点', '傍', 'ページ', '左に']) {
    assert.equal(emphasisClass(v), null, `unknown ${v} must be null`);
  }
});

test('emphasisClassRule yields the full CSS rule; emph-x uses the real × glyph, not ASCII', () => {
  assert.equal(emphasisClassRule('emph-fs'), '.emph-fs{text-emphasis-style:filled sesame}');
  assert.equal(
    emphasisClassRule('emph-fs-l'),
    '.emph-fs-l{text-emphasis-style:filled sesame;text-emphasis-position:left}',
  );
  // The slug is 'x' but the emitted CSS value is the full-width × glyph.
  assert.equal(emphasisClassRule('emph-x'), `.emph-x{text-emphasis-style:'×'}`);
  // Unknown class names yield ''.
  assert.equal(emphasisClassRule('emph-nope'), '');
});
