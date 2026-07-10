# Japanese Novel

A Visual Studio Code extension for formatting, previewing, and generating vertical writing books of Japanese novels annotated with [Aozora Bunko annotations](https://www.aozora.gr.jp/annotation/index.html).

## Novel Publishment

Publishing a novel is a serious matter. Many editors explicitly forbid the use of **any AI**. This tool will **NOT** introduce any AI tools **for writing**, and will disable the Copilot extension by default for `*.jpnov` / `*.filelist`.

All `*.filelist` completion relies entirely on non-AI programs.

**Writing must be done entirely by human author from beginning to end.**

Some authors might think this is "making a mountain out of a molehill". But, commercial publishing is indeed a complex issue. Determining copyright boundaries and resolving infringement disputes incurs high costs in terms of human and material resources.

## Status

Early scaffolding. Novel sources are written in `.jpnov` files (the editor binds them
to the **Japanese Novel** language for highlighting and live preview); a `.filelist`
manifest lists, in reading order, the `.jpnov` chapters that make up one book.

The extension activates when you open a `.jpnov` or `.filelist` file, or when a
workspace folder root holds a `novel.jp.*` config or a `*.filelist`. **Preview** of a
`.jpnov` and **`.filelist` editing** (completion, diagnostics, links) work with no
configuration at all. A **Get started with Japanese Novel** walkthrough (Help →
Get Started) covers the same steps as the quick start below.

## Quick start

1. **Write a chapter.** Create a file ending in `.jpnov` (e.g. `src/chapter1.jpnov`) and start
   writing. [Aozora Bunko annotations](https://www.aozora.gr.jp/annotation/index.html) are
   highlighted as you type; click the preview icon in the editor title bar (or run **Japanese
   Novel: Open Preview to the Side**) to see it in vertical, right-to-left 原稿用紙 layout.
2. **Make a book.** Create a `.filelist` (e.g. `src/volume1.filelist`) and list your chapter
   files, one per line, in reading order. One `.filelist` is one book.
3. **Build it.** Open the **Japanese Novel** view in the Activity Bar (the book icon appears
   once a `.filelist` exists), tick the books you want, and use **Build to HTML** (paginated
   vertical `.html`) or **Build to Text** (concatenated Aozora-format `.txt`) from the panel's
   title bar. Use **Select All** / **Deselect All** to bulk-toggle the selection.

Chapters and filelists live under `jpnov.project.sourceDir` (default `./src`); build output
lands in `jpnov.project.outDir` (default `dist`). Both are plain VS Code settings
(**Japanese Novel — Project**) and can be overridden per workspace folder. Layout, preview,
HTML-output, and lint behavior are settings too, under the other **Japanese Novel** sections.

A `novel.jp.*` config file is only used for cast/keyword highlighting (see
[below](#character--keyword-highlighting)). Supported forms, in precedence order:

| Form | Loaded by | Notes |
| --- | --- | --- |
| `novel.jp.json` | `JSON.parse` | virtual/remote-fs safe, preferred |
| `novel.jp.js` / `.mjs` / `.cjs` | `await import()`<br />(default export) | local + trusted workspace only |
| `novel.jp.ts` | `await import()` via<br />Node native type-stripping | extra dependency may not work.<br />local + trusted workspace only |

## Annotations

Novel sources use [Aozora Bunko annotations](https://www.aozora.gr.jp/annotation/index.html).
Recognised forms are highlighted and rendered; anything else passes through as an HTML
comment (never an error), so unusual markup degrades quietly.

| Effect | Inline / postfix | Block (each on its own line) |
| --- | --- | --- |
| Ruby | `漢字《かんじ》`, `｜親文字《ルビ》` | — |
| Emphasis dots 傍点 | `［＃「対象」に傍点］`, `［＃傍点］…［＃傍点終わり］` | — |
| Side line 傍線 (5 styles) | `［＃「対象」に傍線］` (傍線/二重傍線/鎖線/破線/波線) | — |
| Bold 太字 | `［＃「対象」は太字］`, `［＃太字］…［＃太字終わり］` | `［＃ここから太字］…［＃ここで太字終わり］` |
| Italic 斜体 | `［＃「対象」は斜体］`, `［＃斜体］…［＃斜体終わり］` | `［＃ここから斜体］…［＃ここで斜体終わり］` |
| Indent 字下げ | `［＃○字下げ］` (line head) | `［＃ここから○字下げ］…［＃ここで字下げ終わり］` |
| Page break | — | `［＃改ページ］` |

Notes: 傍点/傍線 take a left-side variant with `の左に` / `左に` (e.g. `［＃「対象」の左に傍点］`);
bold/italic use the connector **は**, not に. Indent counts (`○`) are **full-width digits**
(２, １０); the block indent also indents wrapped continuation lines. The hanging-indent form
(`折り返して`) is not supported and degrades to a comment. An unclosed block (`ここから` with no
`ここで…終わり`) still renders to the end of the file but raises an editor **Warning**; italic
relies on the browser synthesising an oblique for Japanese fonts.

## Character & keyword highlighting

A `novel.jp.*` config may declare your **cast** and a few **coined keywords**, so they stand out
while you write — handy where Japanese drops the subject:

```json
{
  "characters": ["朝霧　巳一", "Arill Stains"],
  "keywords": ["黒剣", "境無"]
}
```

- **`characters`** — each name is split on the half-/full-width space into surname + given, so the
  full name, the surname alone, and the given name alone are all recognised. A character is
  highlighted only where it reads as a **subject**: a name (optionally with an honorific such as
  `さん` / `先生` / `ちゃん`) immediately followed by `は` or `が` — e.g. `巳一は`, `朝霧ちゃんが`. The
  common pronouns `僕` / `私` / `彼` / `彼女` are recognised the same way. Dialogue inside
  `「」` / `『』` is left in the body colour; only narration is scanned.
- **`keywords`** — coined terms (a fantasy noun, a place, …) are **bolded** wherever they appear in
  narration, without changing colour. Where a surface is in both lists the subject form wins, so
  `境無は` reads as a character while a bare `境無` is a keyword.

Colouring is delivered as LSP semantic tokens with per-language default colours; override them in
your settings under `editor.semanticTokenColorCustomizations` if you like.

## Development

```sh
npm install
```

Press <kbd>F5</kbd> to launch an Extension Development Host. Open a `.jpnov` file
(or a folder containing a `novel.jp.*` config) to trigger activation.

Other commands:

```sh
npm run lint        # typescript-eslint (type-aware)
npm run type-check  # tsc --noEmit
npm test            # node --test — shared + highlight unit tests
npm run build:dev   # bundle to dist/extension.js (ESM)
```

## License

Licensed under the MIT License. See the [`LICENSE`](./LICENSE) file for the full text.
