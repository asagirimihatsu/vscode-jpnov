# Japanese Novel

A Visual Studio Code extension for formatting, previewing, and generating vertical writing books of Japanese novels annotated with [Aozora Bunko annotations](https://www.aozora.gr.jp/annotation/index.html).

## Novel Publishment

Publishing a novel is a serious matter. Many editors explicitly forbid the use of **any AI**. This rule is very broad, so this tool will **NOT** introduce any AI tools **for writing**, and will disable the Copilot extension by default for `*.jpnov` / `*.filelist`.

All `*.filelist` completion relies entirely on non-AI programs.

**Writing must be done entirely by human author from beginning to end.**

Some authors might think this is "making a mountain out of a molehill". But, commercial publishing is indeed a complex issue. Determining copyright boundaries and resolving infringement disputes incurs high costs in terms of human and material resources.

## Status

Early scaffolding. Novel sources are written in `.jpnov` files (the editor binds them
to the **Japanese Novel** language for highlighting and live preview); a `.filelist`
manifest lists, in reading order, the `.jpnov` chapters that make up one book.

The extension activates when you open a `.jpnov` or `.filelist` file, or when a
`novel.jp.*` config exists at the workspace root. **Preview** of a `.jpnov` and
**`.filelist` editing** (completion, diagnostics, links) work with no config.

To scaffold a fresh project, run **Japanese Novel: Init Workspace** from the Command
Palette. It asks a few questions (disable AI in the workspace? characters-per-line and
lines-per-page? enable 禁則処理?), then writes `novel.jp.json`, a sample
`src/first-chapter.jpnov` + `src/volume1.filelist`, a `.vscode/launch.json` carrying the
build entries, a `.gitignore` that keeps the generated `dist/` out of version control,
and — if you opt in — a `.vscode/settings.json` that turns Copilot and inline suggestions
off for the workspace. It aborts rather than overwrite any file it would create (the
`.gitignore` is appended to, never overwritten), so it is safe to run in a folder that
already holds unrelated content.

**Build** lives in the **Books** panel of the **Run and Debug** view, which appears
once a `novel.jp.*` config is present (the config supplies the output directory and
the page layout). Each discovered `*.filelist` is one book with a checkbox; tick the
ones you want, then build them either from the panel's title-bar actions or — once a
`.vscode/launch.json` exists (run **Init Workspace** to get one) — from the **Run and
Debug** launch dropdown (the green ▶): **Build selected as HTML** renders the
checked books to paginated `.html`, **Build selected as Text** writes the concatenated
Aozora-format `.txt` — each into the output directory. Use **Select All** /
**Deselect All** to bulk-toggle the selection. (The ▶ entries run as a brief, empty
debug session — that dropdown only hosts debug configurations — purely to trigger the
build.)

Supported config forms, in precedence order:

| Form | Loaded by | Notes |
| --- | --- | --- |
| `novel.jp.json` | `JSON.parse` | virtual/remote-fs safe, preferred |
| `novel.jp.js` / `.mjs` / `.cjs` | `await import()`<br />(default export) | local + trusted workspace only |
| `novel.jp.ts` | `await import()` via<br />Node native type-stripping | extra dependency may not work.<br />local + trusted workspace only |

## Character & keyword highlighting

A `novel.jp.*` config may declare your **cast** and a few **coined keywords**, so they stand out
while you write — handy where Japanese drops the subject:

```json
{
  "sourceDir": "./src",
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
