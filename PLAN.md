# PLAN.md: follow-up fixes for `plan/export-fixes`

This plan is for whoever implements the next round of changes on the
`plan/export-fixes` branch (head `71566f9`, "Add manual sorting and fix PDF
size, math and dark-mode exports"). It comes from a review of that commit
against Obsidian 1.15.1's bundled `lib/mathjax/obsidian-mathjax.js` (MathJax
4, **TeX font**, `cssFontPrefix = "TEX"`) and `app.js` / `main.js`.

What already works and must not regress: manual ordering in `SelectModal`,
caller order kept in `main.ts#buildRequest`, `withLightWindowBackground` in
`src/pdf/print.ts`, the `clip-path: none` rule for `mjx-c`, the radical
overlap and thickness rules, and the white print background. Tests, lint and
build currently pass: `npm test` 51/51, `npm run lint` 0 errors and 2
warnings that are already on `main`.

All the rules in `AGENTS.md` still apply. In particular: no `import
"obsidian"` in the pure modules, no `<style>` elements, no `!important`, no
`el.style.*`, use the `page-break-*` aliases, and never write into the vault.

The decisions are made (by the repo owner):

| # | Topic | Decision |
|---|---|---|
| D1 | Math inside headings | **Leave it in the accessibility tree** so PDF bookmark titles keep the math |
| D2 | Links inside headings, as cloned into the TOC | **Plain TOC text**: drop link/tag classes and footnote refs |
| D3 | The always-on pin in `lightScopeProps` | **Remove it**; go back to the plain diff and remove the duplicated code |
| D4 | Verification | **Full headless checklist** (section 7) before merge |

---

## 1. Keep math in headings visible to Chromium (D1)

### Problem
`pruneAccessibilityTree` (`src/render/postprocess.ts`) sets
`aria-hidden="true"` on **every** `mjx-container` and `svg`. Chromium builds
`/Outlines` titles from a heading's accessible text, and MathJax's
`mjx-assistive-mml` is what gives math that text. Once the container is
hidden, a heading such as `### Deviations from $\bar{X}$ Are Too Small` is
expected to produce the bookmark **"Deviations from  Are Too Small"**. This
needs to be confirmed in 7.4 before and after the change.

### Change
1. In `pruneAccessibilityTree`, skip elements that sit inside a heading that
   stays in the outline:
   ```ts
   const OUTLINE_HEADING = "h1, h2, h3, h4, h5, h6";

   function pruneAccessibilityTree(section: HTMLElement): void {
   	section.querySelectorAll("mjx-container, svg").forEach((el) => {
   		// Bookmark titles come from the heading's accessible text; hiding
   		// its math would drop the formula from the outline entry.
   		if (el.closest(OUTLINE_HEADING)) return;
   		el.setAttribute("aria-hidden", "true");
   	});
   }
   ```
2. **Move the call** in `postprocess()` so it runs *after*
   `structureHeadings(...)` and `placeBlockAnchors(...)`, not before.
   `structureHeadings` retags headings beyond `outlineDepth` to
   `div.be-heading` (`role="presentation"`). Pruning afterwards means only
   headings that really are bookmarks keep their math unhidden, and the
   demoted ones get hidden like body text.
   ```ts
   for (const note of notes) {
   	openCallouts(note.section);
   	const structure = structureHeadings(app, note, outlineDepth);
   	structure.blocks = placeBlockAnchors(note);
   	pruneAccessibilityTree(note.section);   // moved here
   	...
   }
   ```
   Check that nothing between those calls depends on `aria-hidden`. At
   `71566f9` nothing does: `cloneHeadingContent` sets its own `aria-hidden`
   on the clone.
3. Update the JSDoc of `pruneAccessibilityTree`: it now says headings are
   left alone so `/Outlines` keeps math in titles.
4. Do **not** unhide math in TOC entries. The TOC lines are links, not
   headings, so their accessible text does not reach the outline, and
   unhiding them would only add objects.

### Expected cost
Only the math inside outline headings (`##`/`###` at the default depth) stays
tagged, a few hundred `/StructElem` at most. The size target in 7.3 already
allows for this.

---

## 2. Remove the dead `noic` code and fix the surd selector

### Facts (from `obsidian-mathjax.js`)
- `addCharStyles` sets `padding = this.padding(data, oc || ic)`. It writes a
  `[noic]` rule **only when the character has `oc`**:
  `n.oc && (t[a + "[noic]"] = { "padding-right": em(w) })`.
- The surd `U+221A` only has `ic`. The variants in the bundle are:

  | metrics `[h, d, w, {ic}]` | variant |
  |---|---|
  | `[.8, .2, .833, {ic:.02}]` | normal (no `TEX-` class) |
  | `[.85, .35, 1, {ic:.02}]` | `TEX-S1` |
  | `[1.15, .65, 1, {ic:.02}]` | `TEX-S2` |
  | `[1.45, .95, 1, {ic:.02}]` | `TEX-S3` |
  | `[1.75, 1.25, 1, {ic:.02}]` | `TEX-S4` |
  | `[.82, .18, .958, {ic:.03}]` | another variant (e.g. bold); it **has** a `TEX-*` class |

  So `setAttribute("noic", "true")` on `mjx-surd mjx-c` has no effect. The
  CSS `padding-right` override is what closes the gap.
- The current unscoped rule `… mjx-surd mjx-c.mjx-c221A { padding-right:
  0.833em }` also matches the 0.958em variant. That squeezes its box and
  makes the vinculum overlap the glyph.

### Change
1. `src/render/postprocess.ts`: delete
   ```ts
   section.querySelectorAll("mjx-surd mjx-c").forEach((el) => el.setAttribute("noic", "true"));
   ```
   and the two comment lines above it.
2. `styles.css`: limit the normal-size rule to the variant with no font class:
   ```css
   .batch-export-print > .batch-export-root mjx-surd mjx-c.mjx-c221A:not([class*="TEX-"]) {
   	padding-right: 0.833em;
   }
   ```
   Keep the `TEX-S1 … TEX-S4` rule at `1em`, and **remove** `TEX-SO` and
   `TEX-LO` from it: they are large-operator classes and never apply to a
   surd. Put a comment over the block that names the widths (normal 0.833em,
   S1–S4 1em) and says the 0.958em variant is left untouched on purpose.
3. Do not use `!important`. The specificity is (0,4,2) or more, against
   MathJax's (0,1,1), so these rules already win.

---

## 3. Fix the misleading `mjx-line` comment

`mjx-line` is created only in `makeFraction` (`this.html("mjx-line", n)`).
`\overline` and `\underline` are stretchy characters, not `mjx-line`.
Fractions with zero thickness go through `makeAtop` and have no line, and a
custom `linethickness` is set as an inline style, which beats our rule. So
the rule itself is safe; only the comment is wrong.

In `styles.css`, replace
```css
/* Fraction and stretchy over/underline bars get the same minimum thickness. */
```
with
```css
/* Fraction bars (mjx-line is only used by mjx-mfrac) get the same minimum
 * thickness. \atop / \binom have no line; custom linethickness is inline. */
```

---

## 4. TOC entries: plain text styling (D2)

### Problem
`cloneHeadingContent` replaces each `<a>` with a `<span>` but **copies its
`className`**. In the TOC this means:
- `a.internal-link` / `a.external-link` turn into `span.internal-link` and
  may pick up the accent colour or underline from Obsidian rules that match
  on the class;
- `a.tag` turns into `span.tag` and is drawn as a tag pill;
- footnote refs (`sup.footnote-ref > a`) leave a stray superscript number.

### Change in `src/render/postprocess.ts` → `cloneHeadingContent`
After the children are cloned and before links are unwrapped:
1. Remove footnote markers completely:
   ```ts
   fragment.querySelectorAll("sup.footnote-ref, .footnote-link, sup[data-footnote-id]")
   	.forEach((el) => el.remove());
   ```
   Check the selectors against what `MarkdownRenderer` actually produces for
   `## Heading[^1]` in the test vault, and keep only the ones that match.
2. Unwrap links into **plain** spans, without copying any class:
   ```ts
   for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
   	const span = createSpan();
   	while (anchor.firstChild) span.appendChild(anchor.firstChild);
   	anchor.replaceWith(span);
   }
   ```
3. Keep the existing steps: strip `[id]`, and set `aria-hidden` on
   `mjx-container`/`svg` in the clone (D1 does not change the TOC).
4. If removing footnotes leaves nothing behind (no text, no `mjx-container`),
   have `structureHeadings` pass `content: undefined` so `toc.ts` falls back
   to `text`. This needs one guard where `content` is set.
5. `styles.css`: add a guard for tags that still come through (for example
   `#tag` as plain text in a `span.tag` that is not inside an `<a>`):
   ```css
   .batch-export-root .be-toc-text .tag {
   	background: none;
   	padding: 0;
   	border: none;
   	color: inherit;
   }
   ```
   Add it only if 7.5 shows a pill. Do not add it on speculation.

---

## 5. `lightScope.ts`: back to the plain diff (D3)

The pin of `--background-primary`/`--text-normal` only matters when the
light read has no such variable at all. In every other case it either
duplicates the diff or writes back the value that is already there. Its
comment ("declared on `.theme-dark` only, so the diff would miss them") does
not describe what the code does. The white page is already guaranteed by the
`@media print` rules plus `withLightWindowBackground`. The refactor also
left `lightThemeOverrides` without any outside caller and copied its loop
into `lightScopeProps`.

### Change
Restore the file from `main`:
```sh
git checkout main -- src/render/lightScope.ts
```
After this, `lightScopeProps()` is again
`{ ...Object.fromEntries(lightThemeOverrides()), "color-scheme": "light" }`
and there is only one swap-and-read path. Run `grep -rn lightScope src` to
confirm that `src/render/container.ts` is still the only caller.

Leave the `@media print` block in `styles.css` as it is, including
`color: var(--text-normal)` on the root.

---

## 6. Small cleanups (same commit)

1. `src/pdf/print.ts`, `withLightWindowBackground`: the JSDoc says "the
   change is invisible on screen". Make it more precise: the change is
   invisible "because Obsidian's `body` paints an opaque background over the
   window; with *translucent window* on, the window colour is `#00000000`
   and is restored the same way". The code does not change.
2. `AGENTS.md` → "Facts learned the hard way": add these bullets.
   - In dark mode `printToPDF` on the main window paints the
     `BrowserWindow` background (`#1C1C1C`, set by Obsidian's
     `startup-appearance` handler) over the whole page, before margins and
     scale. CSS cannot cover it; `pdf/print.ts` sets the window to
     `#ffffff` while printing and restores it afterwards.
   - A tagged PDF gets one `/NonStruct` StructElem per DOM node inside
     MathJax and SVG. `aria-hidden` on `mjx-container`/`svg` prevents this,
     except inside outline headings, whose math gives the bookmark titles
     their text.
   - MathJax 4 (TeX font) only writes a `[noic]` rule for characters with
     `oc`. Characters that only have `ic`, such as the surd, need a CSS
     `padding-right` override instead.
3. README: no change needed. The ordering text from `71566f9` is correct.

---

## 7. Verification (required before merge, D4)

Run everything from the repo root. Use the vault that holds
`01 - Courses/Inferential Stats` (57 pages, 11.89 MB before this branch).
Write outputs only to a scratch dir outside the vault, for example
`OUT=$(mktemp -d)`.

### 7.1 Static
```sh
npm test          # all pass
npm run lint      # 0 errors (the 2 sentence-case warnings are pre-existing)
npm run build
obsidian plugin:reload id=batch-export
```

### 7.2 Vault integrity (before and after every export below)
```sh
find "<vault>/01 - Courses/Inferential Stats" -type f -print0 | sort -z | xargs -0 sha256sum > "$OUT/before.sha"
# ... exports ...
find "<vault>/01 - Courses/Inferential Stats" -type f -print0 | sort -z | xargs -0 sha256sum | diff - "$OUT/before.sha"
```
**Pass:** the diff is empty.

### 7.3 Size and structure (light mode)
```sh
obsidian eval "app.plugins.plugins['batch-export'].api.exportFolder('01 - Courses/Inferential Stats', { out: '$OUT/light.pdf' })"
```
Then:
```sh
ls -l "$OUT/light.pdf"
python3 -I - "$OUT/light.pdf" <<'PY'
import sys, pypdf
r = pypdf.PdfReader(sys.argv[1])
n = sum(1 for i in range(1, r.trailer["/Size"])
        if (o := r.get_object(i)) is not None and isinstance(o, dict) and o.get("/Type") == "/StructElem")
print("pages", len(r.pages), "structelem", n)
def walk(items, depth=0):
    for it in items:
        if isinstance(it, list): walk(it, depth + 1)
        else: print("  " * depth + it.title)
walk(r.outline)
print("dests", len(r.named_destinations))
PY
```
**Pass:**
- file size **≤ 2 MB** (the plan's estimate was about 1.3 MB);
- `/StructElem` **< 3,000**;
- the page count matches the pre-branch export, give or take 1;
- the outline exists and its note and `##`/`###` entries match the
  pre-branch export;
- the named destination count is at least the pre-branch count.

### 7.4 Bookmark titles keep math (D1)
In the outline printed by 7.3, find the entry for `Sample Variance.md`'s
heading `Deviations from $\bar{X}$ Are Too Small`.
**Pass:** the title contains a character for X (any form, e.g. `X̄`, `𝑋`, or
`X`) between "from" and "Are". **Fail:** the title is
`Deviations from  Are Too Small` (double space, nothing between).
To see the effect of section 1, also run the check once on the `71566f9`
build.

### 7.5 TOC rendering (D2, math)
```sh
pdftoppm -r 150 -f 1 -l 3 -png "$OUT/light.pdf" "$OUT/toc"
```
Look at the PNGs. **Pass:**
- `\bar{X}` in the TOC line has the bar **over** the X, not `¯X` to its left;
- TOC entries for headings that contain links or tags look like the other
  entries: same colour, no pill, no underline, no footnote number;
- dot leaders and page numbers still line up.
Also confirm that the TOC page numbers are right. Click three TOC entries in
a PDF viewer and check where they land, or compare `be-pg` numbers against
pypdf `get_destination_page_number` for three ids.

### 7.6 Math rendering in the body
Find the pages with the radicals. In the 57-page export these were pages 8,
40, 41, 42 and 54; find them again with `pdftotext` if the page numbers
moved. Render them:
```sh
pdftoppm -r 150 -f 40 -l 42 -png "$OUT/light.pdf" "$OUT/m150"
pdftoppm -r 400 -f 42 -l 42 -png "$OUT/light.pdf" "$OUT/m400"
mutool draw -r 100 -o "$OUT/mu%d.png" "$OUT/light.pdf" 40-42
```
**Pass**, at every resolution:
- the top bar of `\sqrt{n}` and of
  `\sqrt{\frac{(n-1)S^2}{\sigma^2(n-1)}}` touches the tip of the root sign,
  with no gap and no vertical step;
- the bar does not disappear at 100 or 150 DPI;
- `\bar{X}` bars are fully drawn in body text, tables and callouts;
- fraction bars are visible, and `\binom` shows no bar.
If the vault has no bold or other non-size surd, add a scratch note
**outside the vault** to test the 0.958em variant (`$\boldsymbol{\sqrt{x}}$`).
You can't write into the vault, so check this one case in a separate
throwaway vault, or skip it and say so in the PR.

### 7.7 Dark mode
Switch Obsidian to dark mode. Use `app.changeTheme('obsidian')` in
`obsidian eval`, or the Appearance setting. Then export to `$OUT/dark.pdf`.
```sh
qpdf --qdf --object-streams=disable "$OUT/dark.pdf" "$OUT/dark.qdf.pdf"
grep -c '\.1098 \.1098 \.1098 rg' "$OUT/dark.qdf.pdf"
pdftoppm -r 50 -f 1 -l 3 -png "$OUT/dark.pdf" "$OUT/dark"
```
**Pass:**
- the grep count is `0`;
- the pages are white, including the margins and the bottom and right
  edges, and the text is dark;
- after the export, `require('@electron/remote').getCurrentWindow().getBackgroundColor()`
  in `obsidian eval` gives back the pre-export value (`#1C1C1C` in dark mode);
- there is no visible flicker on screen during the export.
Repeat once with **translucent window** turned on, if the platform supports
it, and check that the colour comes back as `#00000000`.

### 7.8 Manual ordering (regression check)
In the modal:
1. Drag the 3rd note to the top. Press ↓ on the first note. Tick or untick
   a note: the order stays.
2. Export, then check that the top-level outline order matches the modal.
3. **Reset order** goes back to index order and is then disabled.
4. Changing the index note resets the order.
5. Dragging from a row's title (not the grip) does not start a drag, and
   clicking a checkbox still toggles it.

Through the API, check that the export order follows the `ticked` array:
```sh
obsidian eval "app.plugins.plugins['batch-export'].api.exportFolder('01 - Courses/Inferential Stats', { ticked: [<two paths in reverse index order>], out: '$OUT/order.pdf' })"
```

### 7.9 Report
In the PR description, give: the sizes and `/StructElem` counts before and
after, the bookmark title from 7.4, the PNGs from 7.5–7.7 (or a summary of
them), and anything skipped (for example 7.6's bold surd).

---

## 8. Files touched

| File | Change |
|---|---|
| `src/render/postprocess.ts` | §1 skip outline headings and move the prune call after `structureHeadings`/`placeBlockAnchors`; §2 delete the `noic` line; §4 drop footnote refs, unwrap links without classes, fall back when content is empty |
| `src/render/lightScope.ts` | §5 restore from `main` |
| `src/pdf/print.ts` | §6.1 JSDoc only |
| `styles.css` | §2 scope the normal surd rule with `:not([class*="TEX-"])` and drop `TEX-SO`/`TEX-LO`; §3 fix the comment; §4 `.tag` guard only if needed |
| `AGENTS.md` | §6.2 three new facts |
| `PLAN.md` | delete once the work is merged |

Use one commit, or one per section if that makes review easier. Do not
change `settingsModel.ts`, `collect/*`, `render/preprocess.ts`,
`render/anchors.ts` or `pdf/fixDests.ts`.
