# README screenshots

`docs/images/` holds two kinds of images: **generated renders** produced straight
from the compiler (section A) and **manual VS Code UI captures** (section B).
Nothing under `docs/` ships in the VSIX — the Marketplace loads these images from
the GitHub repository via the manifest's `repository` field, so the repo must be
public by publish time.

## A. Generated renders

`hero-page.png`, `genkoyoshi.png`, `notation.png`, `kinsoku-off.png`,
`kinsoku-on.png` — regenerate whenever the renderer's visual output changes.

Two pipelines, both driving the product's own code:

- **Page shots** (`hero-page`, `genkoyoshi`) go through the real PDF print
  pipeline: `renderBook()` HTML → headless Chrome `--print-to-pdf` with the
  exact flags of `src/client/browser.ts` `printToPdfArgs()` → page 1
  rasterized by `qlmanage` (macOS built-in). The white margin around the text
  grid is the product's own `PRINT_MARGIN` (2.5em, `@media print`), not
  post-processing — the PNGs are unretouched "Build to PDF" output apart from
  the grey mat ffmpeg pads around the sheet.
- **Specimen shots** (`notation`, `kinsoku-*`) use `renderPreview()` +
  `--screenshot`. The real preview is horizontally flush against the pane
  edge, so the injected `PAPER` style adds paper colour + a 24px side mat.

Requirements: macOS with Google Chrome at the standard path, `ffmpeg`
(`brew install ffmpeg`), Node ≥ 24 (runs TypeScript directly).

1. Save the script below as `.scratch/shots.ts` (`.scratch/` is gitignored).
2. `node .scratch/shots.ts`
3. `cp .scratch/shots/{hero-page,genkoyoshi,notation,kinsoku-off,kinsoku-on}.png docs/images/`

Hard-won facts baked into the script — keep them if you rewrite it:

- **Chrome's minimum window width is 500 CSS px** (screenshot mode). Below that
  the layout viewport stays 500 wide while the capture canvas matches
  `--window-size`, so the right edge — exactly where vertical-rl content
  sits — gets cropped. Never pass a width under 500; trim whitespace with
  ffmpeg afterwards instead.
- **Delete the previous output file before launching Chrome.** The file-size
  poll otherwise sees the stale file settle and kills Chrome before the new
  capture is written.
- **Every run needs a fresh `--user-data-dir`** — a reused profile dies on its
  leftover SingletonLock. Headless Chrome also lingers after writing the file,
  hence poll-then-kill rather than waiting for exit.
- The preview renderer emits a transparent background with `--vscode-*`
  variables; the injected `PAPER` style pins white paper + dark ink (plus the
  side mat) so the PNGs stay readable on GitHub's dark theme.
- `*{font-family:…!important}` pins Hiragino Mincho ProN: the shipped CSS says
  bare `serif`, and the shots should not depend on the machine's serif mapping.
  This is the only injection the page shots get.
- The Sōseki text is public domain (Aozora Bunko). Keep the credit captions in
  the READMEs if you swap the sample.

```ts
// README 用スクリーンショット生成器。
// ページ物 (hero/genkoyoshi) は本物の PDF 印刷パイプライン（フラグは
// src/client/browser.ts printToPdfArgs と同一）で出力し、1 ページ目を qlmanage で
// ラスタライズする — PRINT_MARGIN (2.5em) 含め「PDF に出力」の結果そのまま。
// 見本 (notation/kinsoku) はプレビューレンダラー + headless --screenshot。
// 使い方: node shots.ts   （出力: <このファイルの隣>/shots/*.png）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBook } from '../src/shared/compiler/document.ts';
import { renderPreview } from '../src/shared/compiler/preview.ts';

const OUT = join(import.meta.dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

// ---- サンプルテキスト ----------------------------------------------------

// 夏目漱石『吾輩は猫である』冒頭（青空文庫、パブリックドメイン）
const NEKO = `　吾輩《わがはい》は猫である。名前はまだ無い。
　どこで生れたかとんと見当《けんとう》がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番｜獰悪《どうあく》な種族であったそうだ。この書生というのは時々我々を捕《つかま》えて煮《に》て食うという話である。しかしその当時は何という考もなかったから別段恐しいとも思わなかった。ただ彼の掌《てのひら》に載せられてスーと持ち上げられた時何だかフワフワした感じがあったばかりである。掌の上で少し落ちついて書生の顔を見たのがいわゆる人間というものの見始《みはじめ》であろう。この時妙なものだと思った感じが今でも残っている。第一毛をもって装飾されべきはずの顔がつるつるしてまるで薬缶《やかん》だ。その後《ご》猫にもだいぶ逢《あ》ったがこんな片輪《かたわ》には一度も出会《でく》わした事がない。のみならず顔の真中があまりに突起している。そうしてその穴の中から時々ぷうぷうと煙《けむり》を吹く。どうも咽《む》せぽくて実に弱った。これが人間の飲む煙草《たばこ》というものである事はようやくこの頃知った。
　この書生の掌の裏《うち》でしばらくはよい心持に坐っておったが、しばらくすると非常な速力で運転し始めた。書生が動くのか自分だけが動くのか分らないが無暗《むやみ》に眼が廻る。胸が悪くなる。到底《とうてい》助からないと思っていると、どさりと音がして眼から火が出た。それまでは記憶しているがあとは何の事やらいくら考え出そうとしても分らない。
　ふと気が付いて見ると書生はいない。たくさんおった兄弟が一｜疋《ぴき》も見えぬ。肝心《かんじん》の母親さえ姿を隠してしまった。その上｜今《いま》までの所とは違って無暗《むやみ》に明るい。眼を明いていられぬくらいだ。はてな何でも容子《ようす》がおかしいと、のそのそ這《は》い出して見ると非常に痛い。吾輩は藁《わら》の上から急に笹原の中へ棄てられたのである。
　ようやくの思いで笹原を這い出すと向うに大きな池がある。吾輩は池の前に坐ってどうしたらよかろうと考えて見た。別にこれという分別《ふんべつ》も出ない。しばらくして泣いたら書生がまた迎に来てくれるかと考え付いた。ニャー、ニャーと試みにやって見たが誰も来ない。そのうち池の上をさらさらと風が渡って日が暮れかかる。腹が非常に減って来た。泣きたくても声が出ない。仕方がない、何でもよいから食物《くいもの》のある所まであるこうと決心をしてそろりそろりと池を左《ひだ》りに廻り始めた。どうも非常に苦しい。そこを我慢して無理やりに這《は》って行くとようやくの事で何となく人間臭い所へ出た。ここへ這入《はい》ったら、どうにかなると思って竹垣の崩《くず》れた穴から、とある邸内にもぐり込んだ。縁は不思議なもので、もしこの竹垣が破れていなかったなら、吾輩はついに路傍《ろぼう》に餓死《がし》したかも知れんのである。一樹の蔭とはよく云《い》ったものだ。この垣根の穴は今日《こんにち》に至るまで吾輩が隣家《となり》の三毛を訪問する時の通路になっている。さて邸《やしき》へは忍び込んだもののこれから先どうして善《い》いか分らない。そのうちに暗くなる、腹は減る、寒さは寒し、雨が降って来るという始末でもう一刻の猶予《ゆうよ》が出来なくなった。
`;

// 記法見本（自作・各行 1 記法、表示幅 ≤ 9 字）
const NOTATION = `　物語《ものがたり》が始まる。
　｜お茶の間《おちゃのま》へ届け。
　覚悟［＃「覚悟」に傍点］を決めた。
　運命［＃「運命」に波線］が動く。
　英雄《えいゆう》［＃「英雄」の左に「ヒーロー」のルビ］の登場。
　第42［＃「42」は縦中横］話、太字［＃「太字」は太字］で。
「何だと!?」
`;

// 禁則見本（自作）: charsPerLine=20 で
//   kinsoku none   → 2 行目が「。」で始まり「「」で終わる
//   kinsoku normal → 「。」は 1 行目末尾にぶら下げ、「「」は行中に収まる
const KINSOKU = `　長い夜がようやく終わりを告げていくのだ。そのときに、彼はしずかにこう呟いた。「まだ続きがある」と彼は思った。
`;

// ---- ショット定義 --------------------------------------------------------

// フォントだけは全ショットで固定する（製品 CSS は素の serif — マシン依存を断つ）
const FONT = '*{font-family:"Hiragino Mincho ProN","YuMincho",serif !important}';
// プレビューは透明背景 + --vscode-* 変数なので、紙色を与える。
// padding-block は vertical-rl では左右の余白（プレビュー自身は横方向フラッシュ）。
const PAPER = 'html{background:#fff;color:#1a1a1a}body{padding-block:24px}';

const bookOpts = {
  charsPerLine: 40,
  linesPerPage: 34,
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
} as const;
const folio = {
  pageNumber: 'right',
  pageNumberFormat: '{page} / {totalPage}',
  header: '吾輩は猫である',
} as const;

interface PdfShot {
  name: string;
  html: string;
  mode: 'pdf';
  /** qlmanage -s（長辺の物理 px。ページ 1304 css px の 2 倍 = 2608 で 2x 相当） */
  rasterSize: number;
  /** ffmpeg pad の台紙幅（物理 px）— 白い紙が GitHub のライトテーマに溶けないように */
  mat: number;
}
interface ScreenShot {
  name: string;
  html: string;
  mode: 'screenshot';
  style: string;
  w: number;
  h: number;
  /** 論理 px。fromRight: 内容が右寄せなので右端から w px を残す */
  crop?: { w: number; fromRight: boolean };
}
type Shot = PdfShot | ScreenShot;

const shots: Shot[] = [
  {
    name: 'hero-page',
    mode: 'pdf',
    html: renderBook({
      books: [{ files: [{ name: 'wagahai.jpnov', src: NEKO }] }],
      ...bookOpts,
      chrome: { lineNumbers: false, edgeLine: 'none', ...folio },
    }),
    rasterSize: 2608,
    mat: 40,
  },
  {
    name: 'genkoyoshi',
    mode: 'pdf',
    html: renderBook({
      books: [{ files: [{ name: 'wagahai.jpnov', src: NEKO }] }],
      ...bookOpts,
      chrome: { lineNumbers: true, edgeLine: 'red', ...folio },
    }),
    rasterSize: 2608,
    mat: 40,
  },
  {
    name: 'notation',
    mode: 'screenshot',
    html: renderPreview(NOTATION, {
      charsPerLine: 9,
      kinsoku: 'normal',
      autoTcy: 'punctuationPairs',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 1080, // Chrome の最小ウィンドウ幅は 500 — それ未満だと右端が切れる
    h: 620,
    crop: { w: 1006, fromRight: true },
  },
  {
    name: 'kinsoku-off',
    mode: 'screenshot',
    html: renderPreview(KINSOKU, {
      charsPerLine: 20,
      kinsoku: 'none',
      autoTcy: 'punctuationPairs',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 500, // 最小幅ちょうど。撮影後に左余白を crop
    h: 640,
    crop: { w: 250, fromRight: true },
  },
  {
    name: 'kinsoku-on',
    mode: 'screenshot',
    html: renderPreview(KINSOKU, {
      charsPerLine: 20,
      kinsoku: 'normal',
      autoTcy: 'punctuationPairs',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 500,
    h: 640,
    crop: { w: 250, fromRight: true },
  },
];

// ---- 撮影 ----------------------------------------------------------------

/** 出力ファイルの生成をサイズ安定で検知し、Chrome を止める（headless は自然終了しない） */
async function runChromeUntilSettled(args: string[], outFile: string): Promise<void> {
  rmSync(outFile, { force: true }); // 前回の出力が残っているとポーリングが即座に誤終了する
  const profile = mkdtempSync(join(tmpdir(), 'jpnov-shot-')); // プロファイル再利用は SingletonLock で死ぬ
  const proc = spawn(CHROME, [`--user-data-dir=${profile}`, ...args], { stdio: 'ignore' });
  const deadline = Date.now() + 30_000;
  let last = -1;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    let size = 0;
    try {
      size = statSync(outFile).size;
    } catch {
      /* not yet */
    }
    if (size > 0 && size === last) break;
    last = size > 0 ? size : -1;
  }
  proc.kill('SIGKILL');
}

function screenshotArgs(png: string, w: number, h: number, url: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    `--window-size=${w},${h}`,
    '--force-device-scale-factor=2',
    '--hide-scrollbars',
    '--timeout=3000',
    `--screenshot=${png}`,
    url,
  ];
}

// src/client/browser.ts printToPdfArgs と同じフラグ（--user-data-dir は共通処理側）
function printToPdfArgs(pdf: string, url: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdf}`,
    url,
  ];
}

for (const shot of shots) {
  const htmlPath = join(OUT, `${shot.name}.html`);
  const inject = shot.mode === 'pdf' ? FONT : FONT + shot.style;
  writeFileSync(htmlPath, shot.html.replace('</head>', `<style>${inject}</style></head>`));
  const url = `file://${htmlPath}`;
  const png = join(OUT, `${shot.name}.png`);

  if (shot.mode === 'pdf') {
    const pdf = join(OUT, `${shot.name}.pdf`);
    await runChromeUntilSettled(printToPdfArgs(pdf, url), pdf);
    // 1 ページ目をラスタライズ（qlmanage は <name>.pdf.png を書く）
    rmSync(png, { force: true });
    rmSync(`${pdf}.png`, { force: true });
    spawnSync('/usr/bin/qlmanage', ['-t', '-s', String(shot.rasterSize), '-o', OUT, pdf], {
      stdio: 'ignore',
    });
    renameSync(`${pdf}.png`, png);
    // 台紙を付ける（紙が白背景に溶けないように）
    const m = shot.mat;
    const tmp = join(OUT, `${shot.name}.mat.png`);
    spawnSync(FFMPEG, [
      '-y', '-loglevel', 'error', '-i', png,
      '-vf', `pad=iw+${m * 2}:ih+${m * 2}:${m}:${m}:color=0xe8e6e1`, tmp,
    ]);
    renameSync(tmp, png);
  } else {
    await runChromeUntilSettled(screenshotArgs(png, shot.w, shot.h, url), png);
    if (shot.crop) {
      // scale factor 2 なので物理 px は 2 倍
      const w = shot.crop.w * 2;
      const x = shot.crop.fromRight ? shot.w * 2 - w : 0;
      const tmp = join(OUT, `${shot.name}.crop.png`);
      spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-vf', `crop=${w}:ih:${x}:0`, tmp]);
      renameSync(tmp, png);
    }
  }
  console.log(`${shot.name}: ${statSync(png).size} bytes`);
}
```

## B. Manual VS Code captures

Five shots need a real VS Code window. Retake one by overwriting its PNG in
`docs/images/` under the same filename (both READMEs reference the same
files).

Common setup:

- macOS retina display (2× pixel density), whole-window capture
  (<kbd>⇧⌘4</kbd> then <kbd>Space</kbd>; hold <kbd>⌥</kbd> while clicking to
  drop the drop shadow if you prefer).
- VS Code in **Japanese display language**, **Dark Modern** theme.
- Pin the window, then:

  ```sh
  osascript -e 'tell application "System Events" to tell process "Code"
    set position of front window to {80, 40}
    set size of front window to {1600, 1000}
  end tell'
  ```

  On "not allowed assistive access": システム設定 → プライバシーとセキュリティ →
  アクセシビリティ → allow your terminal. The Extension Development Host is the
  same `Code` process; Insiders is `"Code - Insiders"`.

  Windows equivalent (PowerShell; capture with <kbd>Alt</kbd>+<kbd>PrtScn</kbd>):

  ```powershell
  Add-Type -Namespace Native -Name Win -MemberDefinition @'
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool Repaint);
  '@
  [Native.Win]::SetProcessDPIAware() | Out-Null
  $hwnd = (Get-Process Code | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).MainWindowHandle
  [Native.Win]::MoveWindow($hwnd, 80, 40, 1600, 1000, $true) | Out-Null
  ```

  Sizes are physical pixels — use 3200 × 2000 on a HiDPI monitor. With several
  VS Code windows open, close the extras or pick one by title:
  `Where-Object MainWindowTitle -like '*拡張機能開発ホスト*'`.
- Bump the editor font one step (<kbd>⌘+</kbd>) so text survives README
  downscaling.

Sample project to open (any temp folder):

```
novel-sample/
├── 第一章.jpnov        ← paste the source below
├── 第二章.jpnov        ← a few plain lines are enough
├── 作品集.jpbook       ← the front-mattered sample below
└── .vscode/settings.json
```

```json
{
  "jpnov.editor.highlight.characters": ["神木 林", "Arill Stains"],
  "jpnov.editor.highlight.keywords": ["境無"]
}
```

`作品集.jpbook` source:

```
---
title: My 作品集
header: 作品集　その一
divider: ＊　＊　＊
---
第一章.jpnov
第二章.jpnov
```

`第一章.jpnov` source (same spirit as the walkthrough sample):

```
　ようこそ、物語《ものがたり》の世界へ。
ここぞという言葉には傍点［＃「傍点」に傍点］を打てます。
　太字［＃「太字」は太字］や字下げも青空文庫の注記のままに。
　その日、林は境無をもらった。
「!?」
［＃改ページ］
　まさか――これが、［＃太字］事実――［＃太字終わり］ということか。
「なすべきことを、なすだけ」
「29［＃「29」は縦中横］番隊隊長、参ります」
　英雄《えいゆう》［＃「英雄」の左に「Hero」のルビ］になるには、代償が必要。
「進め!!」
　天地［＃「天地」に傍点］は、裂けた［＃「裂けた」に傍線］。
　境界線から｜詠唱の声《キャスターサウンド》が聞こえた。
　作者の魔術だ。
「えっ、作者の魔術って？」
「［＃丸傍点］あれ［＃丸傍点終わり］を勝てる術あるのかよ」
「あるさ」
　神木林は片方の口角だけを引き上げた。
「編集部からご指示により、全文を書き直せ！」
「何だと!?」
　次のシーン「焼肉、やっぱうまくね？」
```

### `vscode-side-by-side.png` — editor + vertical preview

Open `第一章.jpnov`, click the editor-title 「プレビューを横に開く」 icon.
Must show: annotated source with syntax highlighting on the left, the vertical
preview on the right, cursor somewhere mid-text.

### `vscode-books-panel.png` — Books panel, expanded

Open the activity-bar 「小説」 icon and expand My 作品集 and its 「本の情報」
group. One shot serves both stories (finding the view + building, and editing
a book in place), so keep the activity bar in frame — a full window with the
editor and preview behind is fine. Must show: My 作品集 checked (labelled by
its front-matter title), the view title-bar build buttons with the
「PDF に出力」 tooltip under the pointer, the two chapter rows, and all five
本の情報 rows with their values (題名・ヘッダー・章区切り set, the ページ番号
rows at their defaults).

### `vscode-highlight.png` — cast & keyword highlighting

Frame a narration paragraph containing 「林は境無を構えた。」. Must show:
`林は` / `神木林は` coloured as a subject, `境無` bold, dialogue lines left in body colour.

### `vscode-lint-quickfix.png` — lint quick fix

Enable `jpnov.lint.narration.generalNovelStyle`, write a narration line without
the leading full-width indent, open the lightbulb menu on the squiggle. Must
show: the squiggle and the open quick-fix menu.

### `vscode-settings.png` — settings UI

Settings (<kbd>⌘,</kbd>) → search `jpnov` (settings search matches the key
prefix; it does not index the localized group titles, so 「小説」 finds
nothing). Must show: the 「小説 — 組版と出力」 group with the 40 × 34 defaults
visible.
