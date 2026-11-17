# PLAN.md: open items

The fixes for manual ordering, PDF size, math rendering and dark-mode export
are implemented (`71566f9`, `31a2694`). The previous version of this file
(`4535371`) holds the full plan and the reasons behind it. The items below
were **not** verified when the branch was merged.

## 1. Live export verification

Unit tests, lint and build pass. No real export has been run against the
final code. Use the `01 - Courses/Inferential Stats` folder (57 pages,
11.89 MB before these fixes). Write all output outside the vault. The full
commands are in section 7 of `git show 4535371:PLAN.md`.

- [ ] **Vault integrity:** `sha256sum` of the folder is the same before and
      after every export.
- [ ] **Size:** the PDF is 2 MB or less, and the PDF has fewer than 3,000
      `/StructElem` objects. The page count, outline entries and number of
      named destinations match the export from before these fixes.
- [ ] **Bookmark titles keep math:** the outline entry for `Deviations from
      $\bar{X}$ Are Too Small` has an X between "from" and "Are".
- [ ] **TOC:** `\bar{X}` in a TOC line has its bar over the X. Headings that
      contain links or tags look like the other entries (same colour, no
      pill, no underline). Dot leaders and page numbers still line up, and
      three TOC links land on the right pages.
- [ ] **Math in the body:** check radical bars at 100, 150 and 400 DPI
      (`pdftoppm`, `mutool draw`). Each bar touches the root sign and does
      not disappear. `\bar{X}` bars are complete, fraction bars are visible,
      and `\binom` has no bar.
- [ ] **Dark mode:** `qpdf --qdf` output has no `.1098 .1098 .1098 rg`.
      Pages are white to the edges. The window background is
      `#1C1C1C` again after the export, and nothing flickers on screen.
      If possible, repeat with translucent window on and check that the
      colour goes back to `#00000000`.
- [ ] **Manual ordering:** in the modal, test drag, ↑/↓ buttons, Reset
      order, and changing the index note. A drag that starts outside the
      grip must not start a drag. The order in the PDF outline must match
      the modal, and `api.exportFolder(..., { ticked })` must keep the array
      order.

## 2. Footnote selectors in TOC entries

`cloneHeadingContent` (`src/render/postprocess.ts`) removes
`sup.footnote-ref, .footnote-link, sup[data-footnote-id]`. Nobody has
checked these selectors against what Obsidian 1.15 actually renders for
`## Heading[^1]`. Render such a heading (in a scratch vault, never the real
one), look at the DOM, and keep only the selectors that match. If they are
wrong, the only effect is a stray footnote number in that TOC line.

## 3. Bold or other non-size surd

The radical padding override deliberately skips the 0.958em surd variant,
which has a `TEX-` class (for example `$\boldsymbol{\sqrt{x}}$`). Check in a
throwaway vault that this variant still renders correctly, because writing
into the real vault is not allowed.

When all items are ticked, delete this file.
