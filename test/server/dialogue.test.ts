/**
 * The dialogue stack on its own: the segments one prose node splits into, the depth each one
 * carries, lenient recovery, and the state that carries across nodes and lines. What the lint
 * and the highlighter make of the segments is walker.test.ts's and highlight/dialogue.test.ts's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DialogueStack, type DialogueSegment } from '../../src/server/dialogue.ts';

type Row = [DialogueSegment['kind'], string, number];

/** The segments of `text` fed to `stack`, as [kind, the text covered, depth]. */
function rows(text: string, stack = new DialogueStack()): Row[] {
  return stack.feed(text).map((seg) => [seg.kind, text.slice(seg.from, seg.to), seg.depth]);
}

test('prose without a corner is one segment at depth 0', () => {
  assert.deepEqual(rows('山田　太郎は歩いた。'), [['prose', '山田　太郎は歩いた。', 0]]);
  assert.deepEqual(rows(''), []);
});

test('a top-level utterance: its corners are 地の文 (depth 0), its interior depth 1', () => {
  assert.deepEqual(rows('地「台詞」文'), [
    ['prose', '地', 0],
    ['open', '「', 0],
    ['prose', '台詞', 1],
    ['close', '」', 0],
    ['prose', '文', 0],
  ]);
});

test('nesting: an inner corner belongs to the outer utterance (depth 1), its interior depth 2', () => {
  assert.deepEqual(rows('「外『内』外」'), [
    ['open', '「', 0],
    ['prose', '外', 1],
    ['open', '『', 1],
    ['prose', '内', 2],
    ['close', '』', 1],
    ['prose', '外', 1],
    ['close', '」', 0],
  ]);
});

test('a closer that does not match the top is prose and pops nothing', () => {
  assert.deepEqual(rows('「あ』い」'), [
    ['open', '「', 0],
    ['prose', 'あ』い', 1],
    ['close', '」', 0],
  ]);
});

test('a closer with nothing open is prose', () => {
  assert.deepEqual(rows('あ」い』う'), [['prose', 'あ」い』う', 0]]);
});

test('the stack carries across nodes and lines; depth reports what is open', () => {
  const stack = new DialogueStack();
  assert.deepEqual(rows('「一行目', stack), [['open', '「', 0], ['prose', '一行目', 1]]);
  assert.equal(stack.depth, 1);
  assert.deepEqual(rows('二行目」続き', stack), [['prose', '二行目', 1], ['close', '」', 0], ['prose', '続き', 0]]);
  assert.equal(stack.depth, 0);
});

test('an opener is counted again inside an utterance; depth tracks every push', () => {
  const stack = new DialogueStack();
  rows('「「「', stack);
  assert.equal(stack.depth, 3);
  assert.deepEqual(rows('」」」', stack), [['close', '」', 2], ['close', '」', 1], ['close', '」', 0]]);
});

test('offsets are UTF-16 units: an astral character before a corner counts two', () => {
  const [, open] = new DialogueStack().feed('𠮷「あ」');
  assert.deepEqual(open, { kind: 'open', from: 2, to: 3, depth: 0 });
});
