import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_CHROME_DEFAULT,
  PREVIEW_CHROME_DEFAULT,
  resolveHtmlSettings,
  resolvePreviewSettings,
} from '../../../src/shared/config/settings.ts';
import { LAYOUT_DEFAULT } from '../../../src/shared/config/types.ts';
import type { HtmlSettings, PreviewSettings } from '../../../src/shared/protocol.ts';

/** A fully-valid baseline built from the single-source constants. */
const HTML_BASE: HtmlSettings = { ...LAYOUT_DEFAULT, ...BUILD_CHROME_DEFAULT };
const PREVIEW_BASE: PreviewSettings = {
  charsPerLine: LAYOUT_DEFAULT.charsPerLine,
  avoidLineBreaks: LAYOUT_DEFAULT.avoidLineBreaks,
  autoTcy: LAYOUT_DEFAULT.autoTcy,
  ...PREVIEW_CHROME_DEFAULT,
};

/**
 * An intentionally-invalid wire payload: the spread keeps the declared field types, so
 * this models the untrusted IPC value without any cast noise.
 */
function badHtml(patch: Record<string, unknown>): HtmlSettings {
  return { ...HTML_BASE, ...patch };
}

test('valid settings pass through unchanged', () => {
  assert.deepEqual(resolveHtmlSettings(HTML_BASE), HTML_BASE);
  assert.deepEqual(resolvePreviewSettings(PREVIEW_BASE), PREVIEW_BASE);
});

test('product defaults differ per target: preview line numbers on, html off', () => {
  assert.equal(PREVIEW_CHROME_DEFAULT.lineNumbers, true);
  assert.equal(BUILD_CHROME_DEFAULT.lineNumbers, false);
});

test('grid geometry clamps to [16..64] and falls back on non-integers', () => {
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, charsPerLine: 3 }).charsPerLine, 16);
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, charsPerLine: 99 }).charsPerLine, 64);
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, linesPerPage: 1 }).linesPerPage, 16);
  assert.equal(
    resolveHtmlSettings(badHtml({ charsPerLine: 'wide' })).charsPerLine,
    LAYOUT_DEFAULT.charsPerLine,
  );
  assert.equal(
    resolveHtmlSettings(badHtml({ linesPerPage: Number.NaN })).linesPerPage,
    LAYOUT_DEFAULT.linesPerPage,
  );
  assert.equal(resolvePreviewSettings({ ...PREVIEW_BASE, charsPerLine: 64 }).charsPerLine, 64);
});

test('avoidLineBreaks rides both snapshots: kept when boolean, defaulted otherwise', () => {
  assert.equal(
    resolveHtmlSettings({ ...HTML_BASE, avoidLineBreaks: true }).avoidLineBreaks,
    true,
  );
  assert.equal(
    resolvePreviewSettings({ ...PREVIEW_BASE, avoidLineBreaks: true }).avoidLineBreaks,
    true,
  );
  assert.equal(
    resolveHtmlSettings(badHtml({ avoidLineBreaks: 'on' })).avoidLineBreaks,
    LAYOUT_DEFAULT.avoidLineBreaks,
  );
});

test('autoTcy rides both snapshots: kept when a known member, defaulted otherwise', () => {
  assert.equal(
    resolveHtmlSettings({ ...HTML_BASE, autoTcy: 'punctuationPairs' }).autoTcy,
    'punctuationPairs',
  );
  assert.equal(
    resolvePreviewSettings({ ...PREVIEW_BASE, autoTcy: 'punctuationPairs' }).autoTcy,
    'punctuationPairs',
  );
  assert.equal(resolveHtmlSettings(badHtml({ autoTcy: 'always' })).autoTcy, LAYOUT_DEFAULT.autoTcy);
  assert.equal(resolveHtmlSettings(badHtml({ autoTcy: true })).autoTcy, LAYOUT_DEFAULT.autoTcy);
  assert.equal(LAYOUT_DEFAULT.autoTcy, 'none'); // 自動縦中横 ships off (Aozora-manual by default)
});

test('bogus enum and boolean values coerce to their defaults', () => {
  assert.equal(resolveHtmlSettings(badHtml({ edgeLine: 'blue' })).edgeLine, 'none');
  assert.equal(
    resolveHtmlSettings(badHtml({ pageNumberPosition: 'sideways' })).pageNumberPosition,
    BUILD_CHROME_DEFAULT.pageNumberPosition,
  );
  assert.equal(
    resolveHtmlSettings(badHtml({ lineNumbers: 'yes' })).lineNumbers,
    BUILD_CHROME_DEFAULT.lineNumbers,
  );
  assert.equal(
    resolvePreviewSettings({ ...PREVIEW_BASE, edgeLine: 'red' }).edgeLine,
    'red',
  );
});

test('template keeps an explicit empty string; a non-string falls back', () => {
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, pageNumberTemplate: '' }).pageNumberTemplate, '');
  assert.equal(
    resolveHtmlSettings(badHtml({ pageNumberTemplate: 7 })).pageNumberTemplate,
    BUILD_CHROME_DEFAULT.pageNumberTemplate,
  );
});

test('header folds newlines to single spaces but keeps literal spaces', () => {
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, header: 'a\nb' }).header, 'a b');
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, header: 'a\r\n\r\nb' }).header, 'a b');
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, header: ' 章 ' }).header, ' 章 ');
  assert.equal(resolveHtmlSettings({ ...HTML_BASE, header: '' }).header, '');
});
