# Japanese Novel

[日本語](./README.md) | English

Write, proofread, and typeset Japanese novels in Visual Studio Code — vertical
layout, [Aozora Bunko](https://www.aozora.gr.jp/annotation/index.html) markup,
one-command HTML / PDF / text builds. No AI anywhere in the writing path
(see [No-AI policy](#no-ai-policy)).

![A vertically typeset novel page with ruby glosses, a running head, and a folio](docs/images/hero-page.png)

*Unretouched "Build to PDF" output: the opening of Natsume Sōseki's* I Am a Cat *(Aozora Bunko).*

## Features

- **Vertical preview** — live, cursor-following 縦書き rendering beside the editor,
  using the same layout engine as the builds.
- **Aozora Bunko annotations** — ruby (incl. both-side), emphasis dots, side
  lines, bold/italic, tate-chū-yoko, indents, page breaks.
- **Book builds** — collect chapters into a paginated vertical HTML file, a
  print-ready PDF, or a concatenated Aozora-format text.
- **Proofreading** — hygiene checks on by default, opt-in manuscript-convention
  lints, quick fixes and a fix-all action.
- **Cast & keyword highlighting** — semantic colouring of character names and
  coined terms in narration.

![VS Code with an annotated chapter on the left and the vertical preview on the right](docs/images/vscode-side-by-side.png)

## Design stance

- **No AI.** Nothing in the writing path involves AI; Copilot is disabled by
  default for `.jpnov` / `.jpbook` (see [No-AI policy](#no-ai-policy)).
- **Dictionary-free.** No morphological analysis, no bundled word lists — so no
  false positives on ordinary words and no coined term left behind. What
  deserves highlighting is declared by the author; the lint rules reason about
  structure, not vocabulary.
- **Zero runtime dependencies.** Everything ships bundled: no package manager,
  no post-install downloads, no network traffic — fully offline, with an
  instant preview. Even PDF export just drives a browser already on the
  machine, offline like everything else.
- **Non-invasive.** Sources are plain text in Aozora notation under dedicated
  extensions (`.jpnov` / `.jpbook`), so no `.txt` / `.md` project is ever
  touched, and the manuscript outlives the tool.

## Quick start

1. **Write a chapter.** Create a file ending in `.jpnov` (e.g. `chapter1.jpnov`)
   and start writing. Aozora Bunko annotations are highlighted as you type;
   click the preview icon in the editor title bar (**Japanese Novel: Open
   Preview to the Side**) to see the vertical layout.
2. **Make a book.** Create a `.jpbook` (e.g. `volume1.jpbook`) and list your
   chapter files, one per line, in reading order — paths count from the
   workspace folder, so moving the `.jpbook` never breaks them. One `.jpbook`
   is one book.
   An optional `---`-fenced front-matter block at the top carries the book's
   own metadata (title, running head, page-number style — see
   [Per-book metadata](#per-book-metadata-front-matter)).
3. **Build it.** Save everything (builds read from disk), open the **Japanese
   Novel** view in the Activity Bar (the book icon), tick the books you want,
   and use **Build to HTML**, **Build to PDF**, or **Build to Text** from the
   view's title bar.

Chapters and book files can live anywhere in the workspace folder; subfolders are
mirrored into the output (`src/volume1.jpbook` builds to
`dist/src/volume1.html`). The output folder (`jpnov.project.outDir`, default
`dist`), dot-folders, and `node_modules` are never scanned. The extension
activates when you open a `.jpnov`/`.jpbook`, when a workspace folder
contains a `*.jpbook`, or when any `jpnov.*` setting is saved at workspace
or folder level — preview and book editing need no configuration at all. A
**Get started with Japanese Novel** walkthrough covers the same steps.

## A 60-second Japanese typography primer

The terms this document (and the settings UI) uses, for readers who know code
but not Japanese typesetting:

- **Vertical writing（縦書き）** — text runs top-to-bottom, lines advance
  right-to-left, books open "backwards". The preview, HTML, and PDF are all
  vertical; the source you edit stays ordinary horizontal text.
- **Ruby（ルビ）** — small reading glosses beside the base characters (furigana).
  In vertical text they sit to the right; a second gloss can sit on the left
  (両側ルビ, "both-side ruby") — often a translation or nuance note.
- **Emphasis dots（傍点）** — the Japanese counterpart of italics: a small mark
  beside every emphasised character. Nine dot shapes plus five side-line styles
  (傍線) are part of the Aozora vocabulary, and all are supported.
- **Tate-chū-yoko（縦中横）** — a short horizontal run ("42", "!?") stood upright
  in a single character cell within vertical text. Half-width pairs `!!` `!?`
  `?!` `??` are combined automatically by default
  (`jpnov.layout.autoTateChuYoko`); anything else takes an explicit annotation.
- **Kinsoku（禁則処理）** — Japanese line-breaking prohibitions, applied at every
  wrap in preview and builds alike (`jpnov.layout.kinsoku`, default `normal`):
  opening brackets never end a line; closing punctuation, small kana, `ー` and
  `々` never start one; `――` and `……` pairs never split; and a trailing `、`/`。`
  hangs into the margin (ぶら下げ) instead of pushing text down. `strict` adds
  the middle-dot and repetition-mark classes and keeps symbol runs unbroken;
  `none` restores the bare wrap.

  | kinsoku `none` | kinsoku `normal` (default) |
  | :---: | :---: |
  | <img src="docs/images/kinsoku-off.png" width="250" alt="Without kinsoku: a full stop opens a line and an opening bracket ends one"> | <img src="docs/images/kinsoku-on.png" width="250" alt="With kinsoku: the full stop hangs at the end of the previous line and the bracket moves inline"> |

- **Genkō yōshi（原稿用紙）** — the manuscript grid Japanese prose is drafted
  on. The default page of **40 characters × 34 lines** mirrors common
  submission requirements; turn on line numbers and edge rules for the classic
  manuscript-paper look:

  ![A page with red column rules and line numbers, resembling manuscript paper](docs/images/genkoyoshi.png)

- **Aozora Bunko notation** — the de-facto plain-text markup for all of the
  above, used by Japan's public-domain digital library. Sources stay portable:
  a `.jpnov` file is meaningful with or without this extension.

## Annotations

Novel sources use [Aozora Bunko annotations](https://www.aozora.gr.jp/annotation/index.html).
Recognised forms are highlighted and rendered; anything else passes through as
an HTML comment (never an error), so unusual markup degrades quietly.

Most annotations take a **forward-ref** form that points back at the target text. Where the range is easier to bracket, a **start / end** pair wraps it inline; for multi-line ranges a **block** form puts the start and end annotations on their own lines. All spellings render the same.

| Effect | Forward-ref form | Start / end form | Block form |
| --- | --- | --- | --- |
| Ruby | `漢字《かんじ》` | `｜親文字《ルビ》` | — |
| Left ruby 左ルビ | `［＃「対象」の左に「よみ」のルビ］` | — | — |
| Tate-chu-yoko 縦中横 | `対象［＃「対象」は縦中横］` | `［＃縦中横］…［＃縦中横終わり］` | — |
| Emphasis dots 傍点 | `［＃「対象」に傍点］` | `［＃傍点］…［＃傍点終わり］` | — |
| Side line 傍線 (5 styles) | `［＃「対象」に傍線］` (傍線/二重傍線/鎖線/破線/波線) | `［＃傍線］…［＃傍線終わり］` | — |
| Bold 太字 | `［＃「対象」は太字］` | `［＃太字］…［＃太字終わり］` | `［＃ここから太字］…［＃ここで太字終わり］` |
| Italic 斜体 | `［＃「対象」は斜体］` | `［＃斜体］…［＃斜体終わり］` | `［＃ここから斜体］…［＃ここで斜体終わり］` |
| Heading 見出し | `第一章［＃「第一章」は大見出し］` (大見出し / 中見出し / 小見出し) | `［＃大見出し］…［＃大見出し終わり］` | `［＃ここから大見出し］…［＃ここで大見出し終わり］` |
| Indent 字下げ | `［＃○字下げ］` (line head) | — | `［＃ここから○字下げ］…［＃ここで字下げ終わり］` |
| Page break | `［＃改ページ］` (on its own line) | — | — |

<img src="docs/images/notation.png" width="800" alt="A rendered specimen showing ruby, both-side ruby, emphasis dots, a wavy side line, bold, and tate-chu-yoko">

The specimen's source — paste it into a `.jpnov` to try:

```text
　物語《ものがたり》が始まる。
　｜お茶の間《おちゃのま》へ届け。
　覚悟［＃「覚悟」に傍点］を決めた。
　運命［＃「運命」に波線］が動く。
　英雄《えいゆう》［＃「英雄」の左に「ヒーロー」のルビ］の登場。
　第42［＃「42」は縦中横］話、太字［＃「太字」は太字］で。
「何だと!?」
```

Notes: 傍点/傍線 take a left-side variant, fixed by form — the **forward-ref**
form uses `の左に` (`［＃「対象」の左に傍点］`), the **start / end** form uses bare
`左に` (`［＃左に傍点］…［＃左に傍点終わり］`); bold/italic use the connector **は**,
not に. Indent counts (`○`) are **full-width digits** (２, １０); the block indent
also indents wrapped continuation lines. An unclosed block (`ここから` with no
`ここで…終わり`) still renders to the end of the file but raises an editor
**Warning**; an unclosed `［＃` is an **Error**. Italic relies on the browser
synthesising an oblique for Japanese fonts.

**Left ruby** puts a reading on the LEFT of the preceding text; pair it with an
ordinary right ruby for 両側ルビ (`青空文庫《あおぞらぶんこ》［＃「青空文庫」の左に
「aozora bunko」のルビ］` — the annotation names the base only, never the `《》`
part). Left readings are exempt from the ruby-kana lint, since they are often
Latin. **縦中横** stands a short run upright in one square — keep it to 3
characters or fewer (longer squishes and raises a Warning). **自動縦中横**
(`jpnov.layout.autoTateChuYoko`, default `punctuationPairs`) auto-combines the
half-width pairs `!!` `!?` `?!` `??` with no markup — runs of three or more are
never touched — and the text build writes the explicit markers out, so the
`.txt` round-trips; set it to `none` to turn it off.

## Preview

Open it from the editor title bar (**Open Preview to the Side**) on any
`.jpnov`. The preview is a continuous vertical flow re-rendered as you type;
it follows the editor cursor, wraps and breaks lines with the exact engine the
builds use, and shows `［＃改ページ］` as a labelled dashed marker. Line numbers
(on by default, restarting at every page break) and manuscript-paper edge rules
are toggled under **Japanese Novel — Preview**.

## Building books

The **Japanese Novel** Activity Bar view lists every discovered `.jpbook` as
a book with a checkbox (labelled by its front-matter `title` when it declares
one). The view's title bar builds the checked books:

- **Build to HTML** — one standalone, paginated vertical `.html` per book
  (inline CSS, no external assets).
- **Build to PDF** — builds the HTML, then drives a locally installed
  Chromium-family browser headlessly to print a sibling `.pdf`. Detection
  order: `jpnov.build.browserPath` → `CHROME_PATH` /
  `PUPPETEER_EXECUTABLE_PATH` → Chrome → Edge → Chromium → Brave. If none is
  found the HTML is kept and a warning offers to configure the path.
- **Build to Text** — the chapters concatenated as Aozora-format `.txt`
  (auto-tate-chū-yoko is materialised as explicit annotations, so the text
  round-trips).

Outputs land in `<outDir>/<book path>.{html,pdf,txt}` with `outDir`
defaulting to `dist`. Two book files that resolve to the same output path fail
the build with a diagnostic instead of overwriting each other.

A `.jpbook` is a reading-order table of contents — file names and folder
layout never decide what a book contains or in what order. That scales to long
works: keep one `.jpbook` per volume and hand your editor only the newest
volume's PDF; keep alternate drafts of a chapter side by side and swap a
single line to retarget a submission; name and move chapter files freely
without reshuffling the book.

On `.jpbook` files the editor offers completion (chapter paths, metadata keys
and enum values), diagnostics (missing files, duplicates, escaping the
workspace, unknown metadata keys…), and document links — Cmd/Ctrl-click an
entry to open the chapter.

The panel manages books, too: expand one for its Book Info rows and chapter
list — [+] adds chapters, drag (or the context menu) reorders them, and
clicking an Info row edits the title, header, or page number in place. Every
action rewrites the `.jpbook` text itself, so the panel and code mode always
agree.

![The Books view: expanded to its chapter list and Book Info rows, with the build buttons in the view title bar](docs/images/vscode-books-panel.png)

Renaming or moving a chapter (or a folder of chapters) inside VS Code offers
to update every `.jpbook` that references it —
`jpnov.book.updateReferencesOnFileMove` picks `prompt` (default), `always`, or
`never`, the `updateImportsOnFileMove` triad. Renames made outside VS Code
can't be tracked; the missing path is flagged in the editor instead.

### Per-book metadata (front matter)

Page furniture is a property of the book, not of the workspace — two volumes
in one workspace can carry different running heads; the chapter divider is
book identity for the same reason. A `.jpbook` therefore starts with an
optional `---`-fenced block of `key: value` lines:

```text
---
title: 夜霧の姫　第一巻
header: 夜霧の姫　一
pageNumber: right
pageNumberFormat: {page} / {totalPage}
divider: ＊　＊　＊
---
01_prologue.jpnov
02_chapter1.jpnov
```

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | — | Display name in the Books view (the output path still derives from the file name) |
| `header` | `""` | Running head centered at the top of every page; omit for none |
| `pageNumber` | `right` | Folio placement: pinned (`right`, `left`) or alternating per page (`rightLeft`, `leftRight`), or `none` |
| `pageNumberFormat` | `{page} / {totalPage}` | Folio text; blank suppresses it |
| `divider` | — | Chapter divider inserted between chapters that do not open with a heading (e.g. `＊　＊　＊`); a bare mark is centred along the line at build time, a `［＃３字下げ］` prefix indents it instead; omit for a single blank line |

Every key is optional; unknown keys warn and are ignored, so future keys stay
forward-compatible. The same five keys are also editable from the Books
panel's Book Info rows.

## Character & keyword highlighting

Declare your **cast** and a few **coined keywords** in settings (**Japanese
Novel — Highlighting**, per workspace folder), so they stand out while you
write — handy where Japanese drops the subject:

```json
// .vscode/settings.json
{
  "jpnov.highlight.characters": ["神木　林", "Arill Stains"],
  "jpnov.highlight.keywords": ["境無"]
}
```

- **`jpnov.highlight.characters`** — each name is split on the half-/full-width
  space into surname + given, so the full name, the surname alone, and the
  given name alone are all recognised. A character is highlighted only where it
  reads as a **subject**: a name (optionally with one honorific such as `さん` /
  `先生` / `ちゃん`) immediately followed by `は` or `が` — e.g. `林は`,
  `神木ちゃんが`. Common pronouns (`僕` / `私` / `俺` / `彼` / `彼女` …) are
  recognised the same way. Dialogue inside `「」` / `『』` is left in the body
  colour; only narration is scanned.
- **`jpnov.highlight.keywords`** — coined terms (a fantasy noun, a place, …)
  are **bolded** wherever they appear in narration, without changing colour.
  If a surface is in both lists, the subject form wins.

Matching is exact — no dictionary, no guessing — so ordinary words are never
miscoloured and invented names are always caught. Both lists apply per
workspace folder and take effect immediately in open
editors — no reload, no rebuild. Colouring is delivered as LSP semantic tokens;
override the colours under `editor.semanticTokenColorCustomizations` if you
like.

![Narration with a coloured character subject and a bolded keyword](docs/images/vscode-highlight.png)

## Proofreading (lint)

Japanese Novel runs prose checks as you write, surfaced as editor diagnostics
with quick fixes (and a **Fix all auto-fixable problems** source action).
Everything is a plain `jpnov.lint.*` setting under **Japanese Novel — Lint**.

Checks run per stream: narration, dialogue (`「…」`), and ruby readings are
linted separately, so narration-only style rules never fire inside a line of
dialogue. Being dictionary-free, the rules never guess at vocabulary — a
coined proper noun is never "corrected".

- **Hygiene checks are on by default** — half-width kana, decomposed (NFD)
  characters, zero-width / invisible characters, and invalid control
  characters — so a stray malformed or invisible character never slips into a
  manuscript.
- **Publication-style checks are opt-in.** `narration.generalNovelStyle`
  (a bundle of general conventions: paragraph indent, punctuation spacing,
  numeral style, and more) and `narration.jaNoMixedPeriod` (narration
  sentences end with `。`) catch manuscript-convention slips many editors
  expect fixed before submission; both are auto-fixable. Length/run limits
  (`sentenceLength`, `maxTen`, `maxKanjiRun`) and the ruby-kana rule are
  opt-in too.

Turn the publication-style checks on when you prepare a submission; leave them
off while drafting. Syntax problems (an unclosed `［＃` annotation, a dangling
block end) are always reported, independent of lint settings.

![A lint squiggle with its quick-fix menu open](docs/images/vscode-lint-quickfix.png)

## Settings reference

Layout, HTML output, preview, and lint settings are window-level; the output
folder and the highlighting lists are per workspace folder; the browser path is
per machine.

### Japanese Novel — Layout

| Setting | Default | Meaning |
| --- | --- | --- |
| `jpnov.layout.charsPerLine` | `40` | Characters per line (16–64), preview and builds |
| `jpnov.layout.linesPerPage` | `34` | Lines per page in builds (16–64) |
| `jpnov.layout.kinsoku` | `normal` | Line-breaking rules: `none` / `normal` / `strict` |
| `jpnov.layout.autoTateChuYoko` | `punctuationPairs` | Auto-combine `!!` `!?` `?!` `??`; `none` to disable |

### Japanese Novel — HTML Output

| Setting | Default | Meaning |
| --- | --- | --- |
| `jpnov.html.lineNumbers` | `false` | Line numbers in built pages, restarting per page |
| `jpnov.html.edgeLine` | `none` | Column rules + page frame: `none` / `text` / `red` |

The running head and page number are **per-book** properties and live in each
`.jpbook`'s front matter, not in settings — see
[Per-book metadata](#per-book-metadata-front-matter).

### Japanese Novel — Preview

| Setting | Default | Meaning |
| --- | --- | --- |
| `jpnov.preview.lineNumbers` | `true` | Line numbers in the preview, restarting per page break |
| `jpnov.preview.edgeLine` | `none` | Column rules: `none` / `text` / `red` |

### Japanese Novel — Lint

Threshold rules take an integer or `null` (off). All rules run on narration;
`common.*` rules also run inside dialogue.

| Setting | Default | Checks |
| --- | --- | --- |
| `jpnov.lint.common.noHankakuKana` | `true` | Half-width kana |
| `jpnov.lint.common.noNfd` | `true` | Decomposed (NFD) characters |
| `jpnov.lint.common.noZeroWidth` | `true` | Zero-width / invisible characters |
| `jpnov.lint.common.noControlChar` | `true` | Invalid control characters |
| `jpnov.lint.common.sentenceLength` | `null` | Sentence length limit (suggested 100) |
| `jpnov.lint.common.maxTen` | `null` | Commas (、) per sentence (suggested 3) |
| `jpnov.lint.common.maxKanjiRun` | `null` | Consecutive kanji (suggested 6) |
| `jpnov.lint.common.noEmDash` | `false` | Single `—` instead of a double dash `――` |
| `jpnov.lint.common.noUnmatchedPair` | `false` | Unmatched brackets / quotes |
| `jpnov.lint.common.jaNoSpaceBetweenFullWidth` | `false` | Space between full-width characters (auto-fix) |
| `jpnov.lint.common.jaUnnaturalAlphabet` | `false` | Unnatural alphabet usage |
| `jpnov.lint.common.minusPosition` | `false` | Minus sign not before a number |
| `jpnov.lint.narration.generalNovelStyle` | `false` | General novel conventions bundle (auto-fix) |
| `jpnov.lint.narration.jaNoMixedPeriod` | `false` | Narration sentences end with `。` (auto-fix) |
| `jpnov.lint.ruby.kana` | `off` | Ruby readings all-hiragana / all-katakana |

### Japanese Novel — Project / PDF Output / Highlighting / Book Files

| Setting | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `jpnov.project.outDir` | `dist` | folder | Output folder, never scanned for books |
| `jpnov.build.browserPath` | `""` | machine | Chromium-family executable for PDF export |
| `jpnov.highlight.characters` | `[]` | folder | Cast names (see highlighting) |
| `jpnov.highlight.keywords` | `[]` | folder | Coined terms (see highlighting) |
| `jpnov.book.updateReferencesOnFileMove` | `prompt` | user | Update `.jpbook` paths on rename/move (`always`, `never`) |

## Commands

All under the **Japanese Novel** category.

| Command | Where |
| --- | --- |
| Open Preview to the Side | Editor title bar on `.jpnov`, Command Palette |
| Open Preview | Command Palette |
| Build to HTML / Build to PDF / Build to Text | Books view title bar |
| Select All Books / Deselect All Books / Refresh Books | Books view title bar |

There are no default keybindings.

## No-AI policy

Publishing a novel is a serious matter, and many editors explicitly forbid the
use of **any AI**. This extension introduces **no AI tools for writing**, and
disables the Copilot extension by default for `*.jpnov` / `*.jpbook`. All
completion (chapter paths, metadata keys, etc.) relies entirely on non-AI programs.

**Writing must be done entirely by the human author, from beginning to end.**

If you do want Copilot back, override `github.copilot.enable` in your
settings.

## Development

```sh
npm install
```

Press <kbd>F5</kbd> to launch an Extension Development Host. Open a `.jpnov`
file (or a folder containing a `*.jpbook`) to trigger activation.

Other commands:

```sh
npm run lint        # typescript-eslint (type-aware)
npm run type-check  # tsc --noEmit
npm test            # node --test — shared + highlight unit tests
npm run build:dev   # bundle to dist/ (ESM)
```

The rendered images in this README are generated straight from the compiler —
see [docs/SCREENSHOTS.md](./docs/SCREENSHOTS.md) to regenerate them or to
capture the pending UI shots.

## License

Under the MIT License. See the [`LICENSE`](./LICENSE) file for the
full text.
