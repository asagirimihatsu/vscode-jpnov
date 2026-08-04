import assert from 'node:assert/strict';

/** The only self-closed voids the reflow/EPUB XHTML output may contain. */
const VOIDS = new Set(['br', 'link']);

/**
 * Strict-enough XML well-formedness walk for the emitted XHTML: balanced tags, double-quoted
 * attributes, legal comment bodies, only the declared voids self-closed, no unescaped
 * text-level `<`/`>`/`&`. Not a full parser — no CDATA/PI/DTD, which the emitters never
 * produce (the leading XML declaration and doctype are stripped before the walk).
 */
export function assertWellFormedXml(doc: string): void {
  const s = doc
    .replace(/^<\?xml[^?]*\?>\s*/, '')
    .replace(/^<!DOCTYPE html>\s*/i, '');
  const stack: string[] = [];
  let at = 0;
  while (at < s.length) {
    const lt = s.indexOf('<', at);
    const text = s.slice(at, lt === -1 ? s.length : lt);
    assert.doesNotMatch(text, /[<>]/, 'stray angle bracket in text');
    assert.doesNotMatch(
      text,
      /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/,
      `unescaped & in: ${text}`,
    );
    if (lt === -1) {
      break;
    }
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      assert.notEqual(end, -1, 'unterminated comment');
      const inner = s.slice(lt + 4, end);
      assert.ok(!inner.includes('--'), `comment contains --: ${inner}`);
      assert.ok(!inner.endsWith('-'), `comment ends with -: ${inner}`);
      at = end + 3;
      continue;
    }
    const close = s.indexOf('>', lt);
    assert.notEqual(close, -1, 'unterminated tag');
    const tag = s.slice(lt + 1, close);
    if (tag.startsWith('/')) {
      assert.equal(stack.pop(), tag.slice(1).trim(), `mismatched </${tag.slice(1)}>`);
    } else {
      const selfClosed = tag.endsWith('/');
      const m = /^([a-z][a-z0-9]*)((?:\s+[a-z:-]+="[^"<>]*")*)\s*$/.exec(
        selfClosed ? tag.slice(0, -1) : tag,
      );
      assert.ok(m, `malformed tag <${tag}>`);
      const name = m[1] ?? '';
      if (selfClosed) {
        assert.ok(VOIDS.has(name), `unexpected self-closed <${name}/>`);
      } else {
        assert.ok(!VOIDS.has(name), `void <${name}> must self-close`);
        stack.push(name);
      }
    }
    at = close + 1;
  }
  assert.equal(stack.length, 0, `unclosed: ${stack.join(',')}`);
}
