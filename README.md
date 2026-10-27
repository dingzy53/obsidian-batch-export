# Batch Export

An [Obsidian](https://obsidian.md) desktop plugin that exports a folder of notes to a single PDF, with an outline, a contents page with page numbers, clickable cross-references between the exported notes, and unfolded callouts.

## Requirements

- Obsidian 1.13.1 or newer, desktop only (the plugin uses Obsidian's own PDF printing).
- Optional: the [TikZ plugin](https://github.com/dingzy53/obsidian-tikz) 1.2.0 or newer, so TikZ diagrams print in the light theme.

## Installation

**From a release**

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/dingzy53/obsidian-batch-export/releases/latest).
2. Put them in `<vault>/.obsidian/plugins/batch-export/`.
3. Reload Obsidian and enable **Batch Export** under *Settings → Community plugins*.

**With BRAT:** add `dingzy53/obsidian-batch-export`.

## Usage

- Right-click a folder and choose **Export folder to PDF…**, or run the command for the folder of the active note.
- A checklist shows every note in index order. A note is **amber** when it is unticked but a ticked note links to it, so its cross-references would be dead text.
- Linked notes outside the folder are listed separately and can be added as an **Appendix**.
- The order comes from the links in the folder's index note.
- Choose the contents-page heading depth in the export dialog. It is remembered per folder.

The PDF has an outline (note, `##`, `###`), a contents page, and clickable cross-references. Output is always light, whatever your Obsidian theme. The plugin only reads your notes and never writes into the vault.

## Settings

Page size, margins, font size, outline depth, contents depth (default for new exports), render timeout.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check and bundle to main.js
npm run lint
npm test
```

To try a build, symlink `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/batch-export/`. See [AGENTS.md](AGENTS.md) for design notes.

## Releasing

```bash
npm version patch   # bumps package.json, manifest.json and versions.json, commits and tags
git push --follow-tags
```

The tag triggers the Release workflow, which lints, tests, builds and attaches `main.js`, `manifest.json` and `styles.css` to a GitHub release.

## License

[MIT](LICENSE)
