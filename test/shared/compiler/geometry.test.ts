/**
 * fitPaper: the paper-fit math behind the build's `@page`/font-size/border emission. The
 * pinned cases carry the same numbers css.test.ts locks as emitted strings; the sweep locks
 * the two fit invariants (inset never below PRINT_MARGIN − 0.02em; per-axis slack inside the
 * 0.02–0.04em emission guard band) over the whole settings domain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PaperFit, PaperOrientation, PaperSize } from '../../../src/shared/compiler/geometry.ts';
import {
  FOLIO_BAND,
  PAPER_ORIENTATIONS,
  PAPER_SIZES,
  PRINT_MARGIN,
  SIDE_PAD,
  fitPaper,
} from '../../../src/shared/compiler/geometry.ts';
import { LINE_PITCHES } from '../../../src/shared/config/types.ts';

interface Grid {
  readonly charsPerLine: number;
  readonly linesPerPage: number;
  readonly linePitch: number;
  readonly hTop: number;
}

const DEFAULT_GRID: Grid = { charsPerLine: 40, linesPerPage: 34, linePitch: 2, hTop: 3 };

test('auto orientation follows linesPerPage > charsPerLine / 2, strictly', () => {
  const at = (charsPerLine: number, linesPerPage: number): PaperFit =>
    fitPaper({ charsPerLine, linesPerPage, linePitch: 2, hTop: 3, size: 'a4', orientation: 'auto' });
  assert.deepEqual([at(40, 21).widthMm, at(40, 21).heightMm], [297, 210], '21 > 20 → landscape');
  assert.deepEqual([at(40, 20).widthMm, at(40, 20).heightMm], [210, 297], '20 > 20 is false → portrait');
  assert.deepEqual([at(33, 17).widthMm, at(33, 17).heightMm], [297, 210], '17 > 16.5 → landscape');
});

test('exact fits for the pinned cases', () => {
  const cases: readonly (readonly [Grid, PaperSize, PaperOrientation, PaperFit])[] = [
    // A: the 投稿書式 default on A4, auto → landscape.
    [DEFAULT_GRID, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 3.907, insetBlockEm: 2.49, insetInlineEm: 3.86 }],
    // B: same with the line-number band; the block axis stays the binding one.
    [{ ...DEFAULT_GRID, hTop: 4 }, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 3.907, insetBlockEm: 2.49, insetInlineEm: 3.36 }],
    // C: a smaller grid scales up.
    [{ ...DEFAULT_GRID, charsPerLine: 30, linesPerPage: 25 }, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 5.12, insetBlockEm: 2.49, insetInlineEm: 2.49 }],
    // D: the default grid on A6 (文庫判).
    [DEFAULT_GRID, 'a6', 'auto', { widthMm: 148, heightMm: 105, fontMm: 1.947, insetBlockEm: 2.49, insetInlineEm: 3.95 }],
    // E: forced portrait turns the paper, not the grid — the inline axis gets the surplus.
    [DEFAULT_GRID, 'a4', 'portrait', { widthMm: 210, heightMm: 297, fontMm: 2.763, insetBlockEm: 2.49, insetInlineEm: 30.73 }],
    // F: a tall grid picks portrait on its own (18 > 20 is false).
    [{ ...DEFAULT_GRID, linesPerPage: 18 }, 'a4', 'auto', { widthMm: 210, heightMm: 297, fontMm: 4.772, insetBlockEm: 2.49, insetInlineEm: 8.1 }],
    // G: A6 forced portrait — the e2e PDF leg's configuration.
    [DEFAULT_GRID, 'a6', 'portrait', { widthMm: 105, heightMm: 148, fontMm: 1.381, insetBlockEm: 2.5, insetInlineEm: 30.57 }],
    // Tight pitches flip the binding axis to inline (the block axis gets the surplus).
    [{ ...DEFAULT_GRID, linePitch: 1.5 }, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 4.117, insetBlockEm: 9.05, insetInlineEm: 2.49 }],
    [{ ...DEFAULT_GRID, linePitch: 1.75 }, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 4.117, insetBlockEm: 4.8, insetInlineEm: 2.49 }],
    // The 2.25 tier keeps the pre-setting output byte-identical (the "old look" escape hatch).
    [{ ...DEFAULT_GRID, linePitch: 2.25 }, 'a4', 'auto', { widthMm: 297, heightMm: 210, fontMm: 3.514, insetBlockEm: 2.49, insetInlineEm: 6.87 }],
    [{ ...DEFAULT_GRID, linePitch: 2.25 }, 'a6', 'portrait', { widthMm: 105, heightMm: 148, fontMm: 1.242, insetBlockEm: 2.51, insetInlineEm: 36.57 }],
  ];
  for (const [grid, size, orientation, expected] of cases) {
    assert.deepEqual(
      fitPaper({ ...grid, size, orientation }),
      expected,
      `${String(grid.charsPerLine)}x${String(grid.linesPerPage)}@${String(grid.linePitch)}/hTop${String(grid.hTop)} on ${size}/${orientation}`,
    );
  }
});

test('fit invariants hold over the whole settings domain', () => {
  const EPS = 1e-9;
  for (const linePitch of LINE_PITCHES) {
    for (let charsPerLine = 16; charsPerLine <= 64; charsPerLine++) {
      for (let linesPerPage = 16; linesPerPage <= 64; linesPerPage++) {
        for (const size of PAPER_SIZES) {
          for (const orientation of PAPER_ORIENTATIONS) {
            for (const hTop of [3, 4]) {
              const fit = fitPaper({ charsPerLine, linesPerPage, linePitch, hTop, size, orientation });
              const label = `${String(charsPerLine)}x${String(linesPerPage)}@${String(linePitch)}/hTop${String(hTop)} on ${size}/${orientation}`;
              assert.ok(fit.fontMm > 0, `${label}: fontMm must be positive`);
              const sheetBlockEm = linesPerPage * linePitch + 2 * SIDE_PAD;
              const sheetInlineEm = charsPerLine + hTop + FOLIO_BAND;
              for (const [paperMm, insetEm, sheetEm] of [
                [fit.widthMm, fit.insetBlockEm, sheetBlockEm],
                [fit.heightMm, fit.insetInlineEm, sheetInlineEm],
              ] as const) {
                assert.ok(
                  insetEm >= PRINT_MARGIN - 0.02 - EPS,
                  `${label}: inset ${String(insetEm)}em under the PRINT_MARGIN floor`,
                );
                // Slack = paper minus the emitted border box, in em: within the emission guard
                // band [0.02, 0.04) — never overflowing, never wasting more than the guard.
                const slackEm = paperMm / fit.fontMm - (sheetEm + 2 * insetEm);
                assert.ok(
                  slackEm >= 0.02 - EPS && slackEm < 0.04 + EPS,
                  `${label}: slack ${String(slackEm)}em outside the guard band`,
                );
              }
            }
          }
        }
      }
    }
  }
});
