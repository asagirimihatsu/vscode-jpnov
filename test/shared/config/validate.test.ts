import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContained } from '../../../src/shared/config/validate.ts';

const ROOT = 'file:///Users/x/proj';

test('resolveContained accepts contained relative subpaths', () => {
  const cases: [string, string][] = [
    ['./src', 'file:///Users/x/proj/src'],
    ['src', 'file:///Users/x/proj/src'],
    ['dist', 'file:///Users/x/proj/dist'],
    ['./a/b/c', 'file:///Users/x/proj/a/b/c'],
    ['a/../b', 'file:///Users/x/proj/b'],
    ['./deep/../src', 'file:///Users/x/proj/src'],
  ];
  for (const [rel, expected] of cases) {
    const got = resolveContained(ROOT, rel, 'sourceDir');
    assert.deepEqual(got, { ok: true, abs: expected }, `for rel=${rel}`);
  }
});

test('resolveContained accepts when the root already has a trailing slash', () => {
  assert.deepEqual(resolveContained('file:///Users/x/proj/', './src', 'sourceDir'), {
    ok: true,
    abs: 'file:///Users/x/proj/src',
  });
});

test('resolveContained rejects empty / root-only paths', () => {
  for (const rel of ['', '   ', '.', './', 'foo/..']) {
    const got = resolveContained(ROOT, rel, 'sourceDir');
    assert.equal(got.ok, false, `should reject rel=${JSON.stringify(rel)}`);
  }
});

test('resolveContained rejects paths that escape above the root', () => {
  for (const rel of ['..', '../sibling', './a/../../escape', '../../etc']) {
    const got = resolveContained(ROOT, rel, 'sourceDir');
    assert.equal(got.ok, false, `should reject rel=${rel}`);
  }
});

test('resolveContained rejects absolute paths and URIs', () => {
  for (const rel of ['/etc/passwd', 'C:\\Windows', '\\\\server\\share', 'file:///etc', 'http://evil']) {
    const got = resolveContained(ROOT, rel, 'outDir');
    assert.equal(got.ok, false, `should reject rel=${rel}`);
  }
});

test('resolveContained rejects leading "~" (home-relative)', () => {
  for (const rel of ['~', '~/secrets', '~root/x']) {
    const got = resolveContained(ROOT, rel, 'outDir');
    assert.equal(got.ok, false, `should reject rel=${rel}`);
  }
});

test('resolveContained carries the label in the rejection args', () => {
  const got = resolveContained(ROOT, '', 'sourceDir');
  assert.ok(!got.ok);
  assert.equal(got.code, 'path.empty');
  assert.deepEqual(got.args, ['sourceDir']);
});

test('resolveContained maps each rejection family to its code (C18 merged into path.rootDot)', () => {
  const code = (rel: string): string => {
    const got = resolveContained(ROOT, rel, 'sourceDir');
    assert.ok(!got.ok, `should reject ${JSON.stringify(rel)}`);
    return got.code;
  };
  assert.equal(code(''), 'path.empty');
  assert.equal(code('.'), 'path.rootDot');
  assert.equal(code('foo/..'), 'path.rootDot');
  assert.equal(code('~'), 'path.homeRelative');
  assert.equal(code('/etc/passwd'), 'path.absolute');
  assert.equal(code('..'), 'path.escapesRoot');
});
