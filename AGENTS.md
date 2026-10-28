# AGENTS.md

Instructions for any coding agent (or human) working in this repository.

## What this repo is

A **desktop-only** Obsidian plugin (`batch-export`)
that exports a vault folder to one PDF. Notes are rendered by Obsidian's own Markdown renderer
into an off-screen `div.print` container and printed through the same
`print-to-pdf` IPC that Obsidian's built-in export uses.

## Commands

- `npm install`
- `npm run dev` / `npm run build`: esbuild bundle to `main.js`
- `npm run lint`: `eslint-plugin-obsidianmd` recommended, the same source rules
  the community automated review runs. Keep it at 0 errors.
- `npm test` (vitest, pure modules only)

Dev install: symlink this repo's `main.js`, `manifest.json` and `styles.css`
into `<vault>/.obsidian/plugins/batch-export/`. After a
build run `obsidian plugin:reload id=batch-export`.

## Hard constraints

1. **Never write into the vault.** Scratch files go to `os.tmpdir()`; the PDF
   goes where the user chose. All transforms run on in-memory strings and
   detached DOM. Notes are only ever *read* (`vault.cachedRead`).
2. **Never hang.** Every wait (render, settle, print) has a timeout and the
   user can cancel. On timeout, export anyway and report what was not ready.
3. **Light output always.** The container carries `theme-light` and
   `data-tikz-theme="light"` so callouts and TikZ ignore Obsidian's dark mode
   (needs obsidian-tikz >= 1.2.0, which provides `api.whenSettled` and the
   scoped theme).
4. Keep `settingsModel.ts`, `collect/order.ts`, `collect/graph.ts`,
   `render/preprocess.ts`, `render/anchors.ts` and `pdf/fixDests.ts` free of
   `import "obsidian"` so they stay unit-testable.

## Facts learned the hard way (Obsidian 1.14.4 / Electron 43)

- `printToPDF` only emits `/Outlines` with **`generateTaggedPDF: true`** plus
  `generateDocumentOutline: true`. Headings turned into
  `div role="presentation"` stay out of the outline.
- Element ids become PDF named destinations only when something links to
  them. pdf.js (`loadPdfJs()`) reads them back for the TOC page numbers.
- The TOC depth is chosen per export (modal, remembered per folder) and is
  independent of `outlineDepth`. Headings demoted to `div.be-heading` still get
  a named destination once the TOC links to their id, so the TOC can list
  headings that are not bookmarked.
- Obsidian's print CSS hides every `body > :not(.print)` and opens callouts
  under `.print .markdown-preview-view`.
- The `print-to-pdf` reply is sent even when printing failed; check the file.
- `obsidian eval` cannot `require("obsidian")`; test pdf.js code in the plugin.
- Block ids leave no trace in rendered HTML. `preprocess.markBlockIds`
  replaces the cache's `^id` token (it ends at `blocks[id].position.end.offset`)
  with a plain-text marker before rendering; post-processing puts the anchor
  on the enclosing callout, else the paragraph or list item. The cache can
  label a lazily continued callout as a list item (seen with a multi-paragraph callout in a list), so the DOM
  decides the target, not the cache.
- `printToPDF` writes named destinations (`/Dests`, used by every link) in
  unscaled content-box coordinates: it ignores `scale` and the margins, so at
  scale 0.8 a link near the bottom of a page landed ~140 pt too low.
  `/Outlines` entries are correct. `pdf/fixDests.ts` rewrites `/Dests` as an
  incremental update on the final file (classic xref only; otherwise the
  summary reports it).
- Obsidian's own export prints a hidden *light* popup window with
  `scale = downscalePercent / 100` (vault config `pdfExportSettings`) and
  Electron's default 1 cm margins. We match that: same scale and margins, no
  font-size override, no background fill.
- A `.theme-light` class below a dark `<body>` is NOT enough: most variables
  are declared on `body` as `var()` references and arrive already resolved
  with dark values (`--background-primary` was `#1C1C1C`). `lightScope.ts`
  swaps the body class inside one synchronous task, reads the computed light
  values and sets the ones that differ inline on the wrapper `div.print`
  (`setCssProps`). The root inherits them, and rules on the root or below
  still win.
- A dark `<body>` background is printed as a full-page fill. `exporter.ts`
  adds `batch-export-printing` to both `<html>` and `<body>` (no `:has`, which
  the Obsidian community CSS lint flags) so `styles.css` can make them
  transparent in print, for our export only.
- Community-plugin automated review (community.obsidian.md dashboard):
  - Creating a `<style>` element is an *error* and blocks install. Use
    `styles.css` plus CSS variables set with `setCssProps`, never inline
    `el.style.*`.
  - The CSS lint (doiuse) reports `break-before/after/inside` as
    "multicolumn". Use the CSS 2.1 `page-break-*` aliases, which Chromium maps
    onto `break-*`.
  - No `!important`: win on specificity (`.batch-export-print >
    .batch-export-root`) or with a later rule.
  - The `fs` and Electron IPC warnings are inherent (PDF write,
    `print-to-pdf`). The README explains them.

## Layout

```
src/main.ts           plugin, commands, folder menu, public api
src/exporter.ts       pipeline: render, settle, post-process, print x N
src/collect/          folder listing + index order (pure) + link graph (pure)
src/render/           preprocess (pure), anchors (pure), container, renderNotes,
                      settle, postprocess, toc
src/pdf/              print (IPC), pages (pdf.js destinations), fixDests (pure)
src/ui/               SelectModal, SummaryModal, progress
test/                 vitest for the pure modules
```

## Verification used during development

Headless export through `app.plugins.plugins['batch-export'].api.exportFolder`
via `obsidian eval`, then `qpdf --json` / `pypdf` checks of outline, link
annotations and TOC numbers, and a `sha256sum` of the test folder before and
after to prove no note changed.
