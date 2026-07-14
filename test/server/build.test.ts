/**
 * Integration tests for the `jpnov/build` + `jpnov/listBooks` handlers against real `file:`
 * fixtures. NOT wired into `npm test` (the default glob is `test/shared/**` +
 * `test/server/highlight/**`): these import a server module whose `#/*` VALUE imports Node's ESM
 * loader rejects, so run them by bundling through esbuild first (which resolves `#/*`):
 *   npx esbuild test/server/build.test.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.jpnov-test-tmp.mjs && node --test .jpnov-test-tmp.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleBuild, handleListBooks } from '../../src/server/build.ts';
import {
  makeContext,
  makeFakeConnection,
  makeTmpWorkspace,
  writeUnder,
  type FakeConnection,
} from './helpers.ts';
import type { ServerContext } from '../../src/server/roots.ts';
import { BUILD_CHROME_DEFAULT } from '../../src/shared/config/settings.ts';
import { LAYOUT_DEFAULT } from '../../src/shared/config/types.ts';
import type {
  BuildResult,
  HtmlSettings,
  ListBooksResult,
  ProjectDirs,
  ProjectDirsMap,
} from '../../src/shared/protocol.ts';

/** The product-default settings snapshot every build request carries (settings is required). */
const SETTINGS: HtmlSettings = { ...LAYOUT_DEFAULT, ...BUILD_CHROME_DEFAULT };

/** The per-root `jpnov.project.*` map a request carries; defaults unless overridden. */
function projectsFor(uri: string, dirs: Partial<ProjectDirs> = {}): ProjectDirsMap {
  return { [uri]: { outDir: dirs.outDir ?? 'dist' } };
}

/** A fresh server context + recording connection (builds read only the request's projectDirs). */
function boot(): { ctx: ServerContext; conn: FakeConnection } {
  const conn = makeFakeConnection();
  return { ctx: makeContext(conn), conn };
}

test('build emits a .txt and an .html artifact per filelist containing both files', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    // index.filelist in vol1/ -> dist/vol1.{txt,html}; entries resolve in vol1/.
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov\nb.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あいう');
    writeUnder(ws.dir, 'vol1/b.jpnov', 'かきく');

    const result: BuildResult = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.ok(result.errors);
    assert.equal(result.errors.length, 0);
    assert.equal(result.artifacts.length, 2);

    const html = result.artifacts.find((a) => a.path.endsWith('.html'));
    assert.ok(html);
    assert.equal(html.path, `${ws.uri}/dist/vol1.html`);
    assert.match(html.content, /<!DOCTYPE html>/i);
    assert.ok(html.content.includes('あいう'), 'first file content present');
    assert.ok(html.content.includes('かきく'), 'second file content present');

    const txt = result.artifacts.find((a) => a.path.endsWith('.txt'));
    assert.ok(txt);
    assert.equal(txt.path, `${ws.uri}/dist/vol1.txt`);
    // The .txt is the concatenated source: one \n between files, no trailing newline.
    assert.equal(txt.content, 'あいう\nかきく');
  } finally {
    ws.cleanup();
  }
});

test('build stays lenient on an unclosed ［＃: ok, artifacts emitted, tail visible as literal text', async () => {
  // Preview/build cohesion: a syntax error is an EDITOR diagnostic, never a build gate. The
  // swallowed tail must appear verbatim in the HTML (same shared buildRows arm the preview uses).
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', '本文［＃閉じない注記\n次の行');

    const result: BuildResult = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.ok(result.errors);
    assert.equal(result.errors.length, 0);
    assert.equal(result.artifacts.length, 2);
    const html = result.artifacts.find((a) => a.path.endsWith('.html'));
    assert.ok(html);
    assert.ok(html.content.includes('本文［＃閉じない注記'), 'swallowed tail visible in HTML');
    assert.ok(html.content.includes('次の行'), 'the next line is untouched');
    const txt = result.artifacts.find((a) => a.path.endsWith('.txt'));
    assert.ok(txt);
    assert.equal(txt.content, '本文［＃閉じない注記\n次の行'); // .txt is byte-faithful anyway
  } finally {
    ws.cleanup();
  }
});

test('nested filelist mirrors the folder tree in the output path', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'part1/vol2/index.filelist', 'c.jpnov');
    writeUnder(ws.dir, 'part1/vol2/c.jpnov', 'テスト');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    const html = result.artifacts.find((a) => a.path.endsWith('.html'));
    const txt = result.artifacts.find((a) => a.path.endsWith('.txt'));
    assert.ok(html);
    assert.ok(txt);
    assert.equal(html.path, `${ws.uri}/dist/part1/vol2.html`);
    assert.equal(txt.path, `${ws.uri}/dist/part1/vol2.txt`);
    assert.equal(txt.content, 'テスト');
  } finally {
    ws.cleanup();
  }
});

test('deeply nested filelist writes a mirrored nested output path', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'a/b/c/index.filelist', 'd.jpnov');
    writeUnder(ws.dir, 'a/b/c/d.jpnov', 'ふかい');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    const html = result.artifacts.find((a) => a.path.endsWith('.html'));
    const txt = result.artifacts.find((a) => a.path.endsWith('.txt'));
    assert.ok(html);
    assert.ok(txt);
    assert.equal(html.path, `${ws.uri}/dist/a/b/c.html`);
    assert.equal(txt.path, `${ws.uri}/dist/a/b/c.txt`);
    assert.equal(txt.content, 'ふかい');
  } finally {
    ws.cleanup();
  }
});

test('flat name.filelist resolves entries relative to its OWN dir, not a stem dir', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    // volume01.filelist lives at the root, so its entries resolve there — here volume01/ch1.jpnov.
    writeUnder(ws.dir, 'volume01.filelist', 'volume01/ch1.jpnov');
    writeUnder(ws.dir, 'volume01/ch1.jpnov', 'ほん');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    const html = result.artifacts.find((a) => a.path.endsWith('.html'));
    assert.ok(html);
    assert.equal(html.path, `${ws.uri}/dist/volume01.html`);
    assert.ok(html.content.includes('ほん'));
    const txt = result.artifacts.find((a) => a.path.endsWith('.txt'));
    assert.ok(txt);
    assert.equal(txt.path, `${ws.uri}/dist/volume01.txt`);
    assert.equal(txt.content, 'ほん');
  } finally {
    ws.cleanup();
  }
});

test('projectDirs overrides outDir per root', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'ほんぶん');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri, { outDir: 'out' }),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/out/vol1.html`));
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/out/vol1.txt`));
  } finally {
    ws.cleanup();
  }
});

test('an invalid outDir silently falls back to dist — and the FALLBACK dir is what discovery skips', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');
    // Lives inside the FALLBACK output dir: it must be excluded even though the
    // configured outDir string ('/abs') never resolved.
    writeUnder(ws.dir, 'dist/hidden.filelist', 'a.jpnov');

    // An absolute outDir is rejected by containment and silently replaced by the
    // default — the build proceeds as if unset.
    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri, { outDir: '/abs' }),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2, 'only vol1 built — dist/hidden.filelist skipped');
    assert.ok(result.artifacts.every((a) => a.path.startsWith(`${ws.uri}/dist/vol1.`)));
  } finally {
    ws.cleanup();
  }
});

test('a missing referenced .jpnov is a per-book error + diagnostic; other books still build', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx, conn } = boot();
    writeUnder(ws.dir, 'bad/index.filelist', 'present.jpnov\ngone.jpnov');
    writeUnder(ws.dir, 'bad/present.jpnov', 'ある');
    writeUnder(ws.dir, 'good/index.filelist', 'y.jpnov');
    writeUnder(ws.dir, 'good/y.jpnov', 'よい');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors);
    assert.ok(result.artifacts);
    assert.equal(result.errors.length, 1);
    const err = result.errors[0];
    assert.ok(err);
    assert.equal(err.book, 'bad/index.filelist');
    assert.equal(err.code, 'book.entryFileNotFound');
    assert.ok(String(err.args?.[0]).includes('gone.jpnov'));
    // The good book still produced its two artifacts (.txt + .html).
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.every((a) => a.path.startsWith(`${ws.uri}/dist/good.`)));
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/dist/good.html`));
    // A diagnostic was published on the offending .filelist (line-level).
    const badUri = `${ws.uri}/bad/index.filelist`;
    assert.ok(conn.diagnostics.some((d) => d.uri === badUri && d.count > 0));
  } finally {
    ws.cleanup();
  }
});

test('two filelists colliding on the output path error BOTH and emit neither', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx, conn } = boot();
    // volume01/index.filelist and volume01.filelist both derive base "volume01".
    writeUnder(ws.dir, 'volume01/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'volume01/a.jpnov', 'A');
    writeUnder(ws.dir, 'volume01.filelist', 'volume01/a.jpnov');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors);
    assert.ok(result.artifacts);
    assert.ok(result.errors.length >= 2, 'both colliding filelists error');
    assert.ok(
      result.errors.every((e) => e.code === 'build.outPathCollision'),
      'collision code present on both',
    );
    assert.equal(result.artifacts.length, 0, 'neither colliding book is emitted');
    for (const rel of ['volume01/index.filelist', 'volume01.filelist']) {
      assert.ok(
        conn.diagnostics.some((d) => d.uri === `${ws.uri}/${rel}` && d.count > 0),
        `diagnostic on ${rel}`,
      );
    }
  } finally {
    ws.cleanup();
  }
});

test('build honors the kinsoku mode from the settings snapshot (禁則)', async () => {
  const ws = makeTmpWorkspace();
  try {
    // 禁則 rides the request's settings snapshot (same source as the preview). At width 16 a
    // naive wrap ends column 1 on the opening 「 (cell 16); 追い出し pushes it down →
    // 15×あ | 「い」. Proves settings.kinsoku reaches renderBook alongside charsPerLine.
    const { ctx } = boot();
    const head = 'あ'.repeat(15);
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', `${head}「い」`);

    const result = await handleBuild(ctx, {
      settings: { ...SETTINGS, charsPerLine: 16, kinsoku: 'normal', pageNumberPosition: 'none' },
      projectDirs: projectsFor(ws.uri),
    });
    const html = result.artifacts?.find((a) => a.path.endsWith('.html'))?.content ?? '';
    assert.ok(
      html.includes(
        `<div class="line" data-line="0">${head}</div>` +
          `<div class="line" data-line="0">「い」</div>`,
      ),
      '追い出し keeps the opening bracket with its content',
    );
  } finally {
    ws.cleanup();
  }
});

test('build with an empty projectDirs map returns ok with no artifacts', async () => {
  const { ctx } = boot();
  const result = await handleBuild(ctx, { settings: SETTINGS, projectDirs: {} });
  assert.deepEqual(result, { ok: true, artifacts: [], errors: [] });
});

test('build targeting a specific root only builds that root', async () => {
  const wsA = makeTmpWorkspace();
  const wsB = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(wsA.dir, 'va/index.filelist', 'x.jpnov');
    writeUnder(wsA.dir, 'va/x.jpnov', 'A');
    writeUnder(wsB.dir, 'vb/index.filelist', 'y.jpnov');
    writeUnder(wsB.dir, 'vb/y.jpnov', 'B');

    const result = await handleBuild(ctx, {
      root: wsA.uri,
      settings: SETTINGS,
      projectDirs: { ...projectsFor(wsA.uri), ...projectsFor(wsB.uri) },
    });

    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.every((a) => a.path.startsWith(`${wsA.uri}/dist/va.`)));
    assert.ok(result.artifacts.some((a) => a.path === `${wsA.uri}/dist/va.html`));
  } finally {
    wsA.cleanup();
    wsB.cleanup();
  }
});

test('listBooks enumerates every filelist with no reads (pure discovery)', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');
    writeUnder(ws.dir, 'part1/vol2/index.filelist', 'c.jpnov');
    writeUnder(ws.dir, 'part1/vol2/c.jpnov', 'て');

    // Pure enumeration by construction: handleListBooks has no connection to publish with.
    const result: ListBooksResult = await handleListBooks({ projectDirs: projectsFor(ws.uri) });

    assert.equal(result.books.length, 2);
    const byOut = new Map(result.books.map((b) => [b.outRel, b]));
    const vol1 = byOut.get('vol1');
    const vol2 = byOut.get('part1/vol2');
    assert.ok(vol1);
    assert.ok(vol2);
    assert.equal(vol1.uri, `${ws.uri}/vol1/index.filelist`);
    assert.equal(vol1.fileRel, 'vol1/index.filelist');
    assert.equal(vol1.rootUri, ws.uri);
    assert.equal(vol2.fileRel, 'part1/vol2/index.filelist');
  } finally {
    ws.cleanup();
  }
});

test('build format "html" emits only the .html artifact', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');

    const result = await handleBuild(ctx, {
      format: 'html',
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.path, `${ws.uri}/dist/vol1.html`);
  } finally {
    ws.cleanup();
  }
});

test('build format "txt" emits only the .txt artifact', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');

    const result = await handleBuild(ctx, {
      format: 'txt',
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 1);
    const only = result.artifacts[0];
    assert.ok(only);
    assert.equal(only.path, `${ws.uri}/dist/vol1.txt`);
    assert.equal(only.content, 'あ');
  } finally {
    ws.cleanup();
  }
});

test('build restricts to the selected books (by filelist uri)', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'a/index.filelist', 'x.jpnov');
    writeUnder(ws.dir, 'a/x.jpnov', 'A');
    writeUnder(ws.dir, 'b/index.filelist', 'y.jpnov');
    writeUnder(ws.dir, 'b/y.jpnov', 'B');

    const onlyA = `${ws.uri}/a/index.filelist`;
    const result = await handleBuild(ctx, {
      books: [onlyA],
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2); // a.txt + a.html, and nothing from book b
    assert.ok(result.artifacts.every((art) => art.path.startsWith(`${ws.uri}/dist/a.`)));
  } finally {
    ws.cleanup();
  }
});

test('build with an empty books selection builds nothing (distinct from omitting it)', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'a/index.filelist', 'x.jpnov');
    writeUnder(ws.dir, 'a/x.jpnov', 'A');

    const result = await handleBuild(ctx, {
      books: [],
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.artifacts, []);
    assert.deepEqual(result.errors, []);
  } finally {
    ws.cleanup();
  }
});

test('a selected book still errors when it collides with an UNSELECTED one', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    // Both derive base "volume01"; select only the flat one.
    writeUnder(ws.dir, 'volume01/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'volume01/a.jpnov', 'A');
    writeUnder(ws.dir, 'volume01.filelist', 'volume01/a.jpnov');

    const selected = `${ws.uri}/volume01.filelist`;
    const result = await handleBuild(ctx, {
      books: [selected],
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.code, 'build.outPathCollision');
    assert.deepEqual(result.artifacts, []);
  } finally {
    ws.cleanup();
  }
});

test('a txt-only build still reports a missing .jpnov as a per-book error + diagnostic', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx, conn } = boot();
    writeUnder(ws.dir, 'bad/index.filelist', 'present.jpnov\ngone.jpnov');
    writeUnder(ws.dir, 'bad/present.jpnov', 'ある');

    const result = await handleBuild(ctx, {
      format: 'txt',
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors);
    assert.equal(result.errors.length, 1);
    const err = result.errors[0];
    assert.ok(err);
    assert.equal(err.code, 'book.entryFileNotFound');
    assert.ok(String(err.args?.[0]).includes('gone.jpnov'));
    // Format gating only skips artifact emission — diagnosis still runs.
    const badUri = `${ws.uri}/bad/index.filelist`;
    assert.ok(conn.diagnostics.some((d) => d.uri === badUri && d.count > 0));
  } finally {
    ws.cleanup();
  }
});

test('a root-level filelist is discovered (discovery is anchored at the folder root)', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'volume1.filelist', 'ch1.jpnov');
    writeUnder(ws.dir, 'ch1.jpnov', 'ねこ');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/dist/volume1.html`));
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/dist/volume1.txt`));
  } finally {
    ws.cleanup();
  }
});

test('a src/ layout mirrors the src layer into the output path', async () => {
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'src/volume1.filelist', 'ch1.jpnov');
    writeUnder(ws.dir, 'src/ch1.jpnov', 'いぬ');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/dist/src/volume1.html`));
    assert.ok(result.artifacts.some((a) => a.path === `${ws.uri}/dist/src/volume1.txt`));
  } finally {
    ws.cleanup();
  }
});

test('discovery skips dot-folders, node_modules, and the resolved outDir', async () => {
  const ws = makeTmpWorkspace();
  try {
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');
    writeUnder(ws.dir, '.hidden/x.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'node_modules/pkg/y.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'deep/node_modules/z.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'dist/w.filelist', 'a.jpnov');

    const result: ListBooksResult = await handleListBooks({ projectDirs: projectsFor(ws.uri) });

    assert.equal(result.books.length, 1, 'only the real book is discovered');
    assert.equal(result.books[0]?.fileRel, 'vol1/index.filelist');
  } finally {
    ws.cleanup();
  }
});

test('a non-ASCII outDir (出力) is still excluded from discovery', async () => {
  // The regression pin for the percent-encoding trap: resolveContained returns a
  // re-encoded URL href, while the walk compares in decoded fs-path space — a URI-string
  // comparison would NEVER match 出力 and books inside the output dir would build again.
  const ws = makeTmpWorkspace();
  try {
    const { ctx } = boot();
    writeUnder(ws.dir, 'vol1/index.filelist', 'a.jpnov');
    writeUnder(ws.dir, 'vol1/a.jpnov', 'あ');
    writeUnder(ws.dir, '出力/old.filelist', 'a.jpnov');

    const result = await handleBuild(ctx, {
      settings: SETTINGS,
      projectDirs: projectsFor(ws.uri, { outDir: '出力' }),
    });

    assert.equal(result.ok, true);
    assert.ok(result.artifacts);
    assert.equal(result.artifacts.length, 2, '出力/old.filelist is not a book');
    assert.ok(result.artifacts.every((a) => a.path.startsWith(`${ws.uri}/`)));
    assert.ok(result.artifacts.some((a) => a.path.endsWith('/vol1.html')));
  } finally {
    ws.cleanup();
  }
});
