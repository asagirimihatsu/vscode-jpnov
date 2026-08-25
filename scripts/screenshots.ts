// README 用スクリーンショット生成器（npm run screenshots）。
// ページ物 (hero/genkoyoshi) は出力 HTML を Chromium で印刷（test/e2e/_browser.ts
// printToPdfArgs と同じフラグ）して PDF にし、1 ページ目を qlmanage で
// ラスタライズする — 用紙余白含め「印刷」の結果そのまま（A4 横）。
// 見本 (notation/kinsoku) はプレビューレンダラー + headless --screenshot。
// 最終 PNG は docs/images/ を直接上書きし、中間産物は .scratch/shots/ に残す。
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBook } from '../src/shared/compiler/document.ts';
import { renderPreview } from '../src/shared/compiler/preview.ts';

const OUT = fileURLToPath(new URL('../.scratch/shots/', import.meta.url));
const IMAGES = fileURLToPath(new URL('../docs/images/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

// ---- サンプルテキスト ----------------------------------------------------

// 夏目漱石『吾輩は猫である』冒頭（青空文庫、パブリックドメイン）。
// 差し替えるときは README 両方のクレジット表記も合わせて更新する。
const NEKO = `　吾輩《わがはい》は猫である。名前はまだ無い。
　どこで生れたかとんと見当《けんとう》がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番｜獰悪《どうあく》な種族であったそうだ。この書生というのは時々我々を捕《つかま》えて煮《に》て食うという話である。しかしその当時は何という考もなかったから別段恐しいとも思わなかった。ただ彼の掌《てのひら》に載せられてスーと持ち上げられた時何だかフワフワした感じがあったばかりである。掌の上で少し落ちついて書生の顔を見たのがいわゆる人間というものの見始《みはじめ》であろう。この時妙なものだと思った感じが今でも残っている。第一毛をもって装飾されべきはずの顔がつるつるしてまるで薬缶《やかん》だ。その後《ご》猫にもだいぶ逢《あ》ったがこんな片輪《かたわ》には一度も出会《でく》わした事がない。のみならず顔の真中があまりに突起している。そうしてその穴の中から時々ぷうぷうと煙《けむり》を吹く。どうも咽《む》せぽくて実に弱った。これが人間の飲む煙草《たばこ》というものである事はようやくこの頃知った。
　この書生の掌の裏《うち》でしばらくはよい心持に坐っておったが、しばらくすると非常な速力で運転し始めた。書生が動くのか自分だけが動くのか分らないが無暗《むやみ》に眼が廻る。胸が悪くなる。到底《とうてい》助からないと思っていると、どさりと音がして眼から火が出た。それまでは記憶しているがあとは何の事やらいくら考え出そうとしても分らない。
　ふと気が付いて見ると書生はいない。たくさんおった兄弟が一｜疋《ぴき》も見えぬ。肝心《かんじん》の母親さえ姿を隠してしまった。その上｜今《いま》までの所とは違って無暗《むやみ》に明るい。眼を明いていられぬくらいだ。はてな何でも容子《ようす》がおかしいと、のそのそ這《は》い出して見ると非常に痛い。吾輩は藁《わら》の上から急に笹原の中へ棄てられたのである。
　ようやくの思いで笹原を這い出すと向うに大きな池がある。吾輩は池の前に坐ってどうしたらよかろうと考えて見た。別にこれという分別《ふんべつ》も出ない。しばらくして泣いたら書生がまた迎に来てくれるかと考え付いた。ニャー、ニャーと試みにやって見たが誰も来ない。そのうち池の上をさらさらと風が渡って日が暮れかかる。腹が非常に減って来た。泣きたくても声が出ない。仕方がない、何でもよいから食物《くいもの》のある所まであるこうと決心をしてそろりそろりと池を左《ひだ》りに廻り始めた。どうも非常に苦しい。そこを我慢して無理やりに這《は》って行くとようやくの事で何となく人間臭い所へ出た。ここへ這入《はい》ったら、どうにかなると思って竹垣の崩《くず》れた穴から、とある邸内にもぐり込んだ。縁は不思議なもので、もしこの竹垣が破れていなかったなら、吾輩はついに路傍《ろぼう》に餓死《がし》したかも知れんのである。一樹の蔭とはよく云《い》ったものだ。この垣根の穴は今日《こんにち》に至るまで吾輩が隣家《となり》の三毛を訪問する時の通路になっている。さて邸《やしき》へは忍び込んだもののこれから先どうして善《い》いか分らない。そのうちに暗くなる、腹は減る、寒さは寒し、雨が降って来るという始末でもう一刻の猶予《ゆうよ》が出来なくなった。仕方がないからとにかく明るくて暖かそうな方へ方へとあるいて行く。今から考えるとその時はすでに家の内に這入っておったのだ。
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

// フォントは製品既定（css.ts DEFAULT_FONT_STACK — Hiragino 先頭）をそのまま使う。
// プレビューは透明背景 + --vscode-* 変数なので、紙色を与える。
// padding-block は vertical-rl では左右の余白（プレビュー自身は横方向フラッシュ）。
const PAPER = 'html{background:#fff;color:#1a1a1a}body{padding-block:24px}';

const bookOpts = {
  charsPerLine: 40,
  linesPerPage: 34,
  linePitch: 1.5, // 既定値のまま撮る
  fontFamily: '',
  kinsoku: 'normal',
  autoTcy: 'punctuationPairs',
  dash: 'horizontalBar',
  paperSize: 'a4',
  paperOrientation: 'auto',
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
  /** qlmanage -s（長辺の物理 px。A4 横のページ長辺 297mm ≈ 1122.5 css px の 2 倍 ≈ 2245 で 2x 相当） */
  rasterSize: number;
  /** ffmpeg pad の台紙幅（物理 px）— 白い紙が GitHub のライトテーマに溶けないように */
  mat: number;
}
interface ScreenShot {
  name: string;
  html: string;
  mode: 'screenshot';
  style: string;
  /**
   * ウィンドウ幅（論理 px）は 500 未満にしないこと — screenshot モードの layout viewport は
   * 最小 500 のまま、キャンバスだけが --window-size に従うため、右端（vertical-rl の内容側）から
   * 欠ける。細くしたい絵は幅そのままで撮り、ffmpeg の crop で切る。
   */
  w: number;
  h: number;
  /**
   * 論理 px。fromRight: 内容が右寄せなので右端から w px を残す。
   * w はインク幅 + 左右対称の余白の実測値 — ショットの行送りを変えたら測り直す。
   */
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
    rasterSize: 2245,
    mat: 40,
  },
  {
    name: 'genkoyoshi',
    mode: 'pdf',
    html: renderBook({
      books: [{ files: [{ name: 'wagahai.jpnov', src: NEKO }] }],
      ...bookOpts,
      linePitch: 2, // 罫線あり — 既定 1.5 では罫線がルビを横切る
      chrome: { lineNumbers: true, edgeLine: 'red', ...folio },
    }),
    rasterSize: 2245,
    mat: 40,
  },
  {
    name: 'notation',
    mode: 'screenshot',
    html: renderPreview(NOTATION, {
      charsPerLine: 9,
      linesPerPage: 34,
      linePitch: 2, // 見本に左ルビがある — 既定 1.5 では隣の行に重なる
      fontFamily: '',
      kinsoku: 'normal',
      autoTcy: 'punctuationPairs',
      dash: 'horizontalBar',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 1080,
    h: 620,
    crop: { w: 865, fromRight: true },
  },
  {
    name: 'kinsoku-off',
    mode: 'screenshot',
    html: renderPreview(KINSOKU, {
      charsPerLine: 20,
      linesPerPage: 34,
      linePitch: 1.5,
      fontFamily: '',
      kinsoku: 'none',
      autoTcy: 'punctuationPairs',
      dash: 'horizontalBar',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 500, // 最小幅ちょうど。撮影後に左余白を crop
    h: 640,
    crop: { w: 180, fromRight: true },
  },
  {
    name: 'kinsoku-on',
    mode: 'screenshot',
    html: renderPreview(KINSOKU, {
      charsPerLine: 20,
      linesPerPage: 34,
      linePitch: 1.5,
      fontFamily: '',
      kinsoku: 'normal',
      autoTcy: 'punctuationPairs',
      dash: 'horizontalBar',
      chrome: { lineNumbers: false, edgeLine: 'none' },
    }),
    style: PAPER,
    w: 500,
    h: 640,
    crop: { w: 180, fromRight: true },
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
    `--window-size=${String(w)},${String(h)}`,
    '--force-device-scale-factor=2',
    '--hide-scrollbars',
    '--timeout=3000',
    `--screenshot=${png}`,
    url,
  ];
}

// test/e2e/_browser.ts printToPdfArgs と同じフラグ（--user-data-dir は共通処理側）
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
  writeFileSync(
    htmlPath,
    shot.mode === 'pdf' ? shot.html : shot.html.replace('</head>', `<style>${shot.style}</style></head>`),
  );
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
      '-vf', `pad=iw+${String(m * 2)}:ih+${String(m * 2)}:${String(m)}:${String(m)}:color=0xe8e6e1`, tmp,
    ]);
    renameSync(tmp, png);
  } else {
    await runChromeUntilSettled(screenshotArgs(png, shot.w, shot.h, url), png);
    if (shot.crop) {
      // scale factor 2 なので物理 px は 2 倍
      const w = shot.crop.w * 2;
      const x = shot.crop.fromRight ? shot.w * 2 - w : 0;
      const tmp = join(OUT, `${shot.name}.crop.png`);
      spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-vf', `crop=${String(w)}:ih:${String(x)}:0`, tmp]);
      renameSync(tmp, png);
    }
  }
  copyFileSync(png, join(IMAGES, `${shot.name}.png`));
  console.log(`${shot.name}: ${String(statSync(png).size)} bytes`);
}
