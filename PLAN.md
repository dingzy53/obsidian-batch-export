# Implementation Plan (`PLAN.md`)

This document details the root-cause analysis (verified against **Obsidian 1.15.1 / installer 1.14.4 / Electron 43 / Chromium m150 / MathJax 4.1.3** and the actual 57-page `Inferential Stats.pdf` export) and the step-by-step implementation plan for the four issues reported.

No source code has been modified yet; all changes below respect the repository constraints in `AGENTS.md` (never write into the vault, never hang, light output always, keep pure modules free of `import "obsidian"`, and pass `eslint-plugin-obsidianmd` / community CSS review rules with 0 errors and no `<style>` injection or `!important`).

---

## 1. Manual Note Sorting Before Export (Defaulting to Index Order)

### Root Cause
1. **[src/ui/SelectModal.ts](src/ui/SelectModal.ts)** renders `this.model.notes` as a static list and offers no UI to reorder rows. On submit (`SelectModal.submit()`, line 179), it filters `this.model.notes` in fixed collection order:
   ```ts
   const notes = this.model.notes.filter((n) => this.ticked.has(n.path)).map((n) => n.path);
   ```
2. **[src/main.ts](src/main.ts)** (`buildRequest()`, lines 227–228) explicitly re-sorts the passed `notes` array back to `model.notes` order, discarding any custom order passed by the modal or by `api.exportFolder(folderPath, { ticked })`:
   ```ts
   const order = new Map(model.notes.map((n, i) => [n.path, i]));
   const sorted = [...notes].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
   ```

### Proposed Design & Changes

#### A. Pure Ordering Helpers (`src/collect/order.ts` & `test/order.test.ts`)
Keep `src/collect/order.ts` free of `import "obsidian"` and add two pure functions:
- `moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[]`
  Returns a new array with the item at `fromIndex` moved to `toIndex` (clamped to `[0, items.length - 1]`; no-op when out of range or `fromIndex === toIndex`).
- `isSameOrder(a: readonly string[], b: readonly string[]): boolean`
  Returns `true` when two path lists have identical length and element order (used to enable/disable the "Reset to index order" button).

#### B. Interactive Reordering in `SelectModal` (`src/ui/SelectModal.ts` & `styles.css`)
- **Default to index order**:
  - Initialize `private noteOrder: NoteInfo[] = [...init.model.notes]` in `SelectModal`.
  - When opening the modal, `noteOrder` always starts in the index note's link order (followed by non-index folder notes in natural path order via `orderNotes()`).
  - When the user changes the **Index note** dropdown (`onChange`), `this.model = this.init.recollect(...)` resets `this.noteOrder = [...this.model.notes]`.
- **Row reorder controls (both drag-and-drop and click/keyboard)**:
  - **Drag handle**: Add a leading `<span class="be-drag-handle" aria-label="Drag to reorder">` (using Obsidian's `setIcon(handle, "grip-vertical")`) inside `.be-row-head`.
    - Make `.be-row` `draggable = true` when pointer interaction starts on `.be-drag-handle` (so clicking checkboxes, text, or chevrons never triggers accidental drags).
    - Handle `dragstart`, `dragover`, `dragleave`, `drop`, and `dragend` on `.be-row`, toggling `.be-dragging`, `.be-drop-above`, and `.be-drop-below` CSS classes to show a clear insertion line and calling `this.noteOrder = moveItem(this.noteOrder, fromIndex, targetIndex)`.
  - **Up / Down buttons**: Add compact `↑` / `↓` buttons (`setIcon(upBtn, "arrow-up")`, `setIcon(downBtn, "arrow-down")`, class `be-move-btn clickable-icon`) on `.be-row-head` (disabled at `index === 0` and `index === this.noteOrder.length - 1` respectively) for single-step keyboard/mouse nudging.
- **Reset to index order button**:
  - In `.be-bar` (alongside *Select all*, *Select none*, *Tick linked dependencies*), add a **Reset order** button that sets `this.noteOrder = [...this.model.notes]` and is `disabled` whenever `isSameOrder(this.noteOrder.map((n) => n.path), this.model.notes.map((n) => n.path))` is `true`.
- **Submit order**:
  - In `SelectModal.submit()`, build `notes` from `this.noteOrder`:
    ```ts
    const notes = this.noteOrder.filter((n) => this.ticked.has(n.path)).map((n) => n.path);
    ```

#### C. Respect Caller Order in `BatchExportPlugin.buildRequest` (`src/main.ts`)
- Remove the forced re-sort in `buildRequest()` (lines 227–228) so `resolve(notes)` preserves the exact order chosen in `SelectModal` (and the exact array order passed to `api.exportFolder(folderPath, { ticked: [...] })`, matching the existing `ExportFolderOptions.ticked` docstring).

---

## 2. PDF File Size Bloating (57 Pages = 11.89 MB -> ~1.3 MB)

### Root Cause (Measured on `Inferential Stats.pdf`)
Inspection of the 57-page `Inferential Stats.pdf` (`11,886,178 bytes` = `11.89 MB`, `91,700` indirect PDF objects) revealed where the size comes from:

| Component in `Inferential Stats.pdf` | Object Count | Byte Size | Share of 11.89 MB |
| :--- | ---: | ---: | ---: |
| `/Type /StructElem` dictionaries (`88,481` of which are `/S /NonStruct`) | 89,712 | 8,525,602 B | 71.7% |
| Classic `xref` table entries for `/StructElem` (`20 bytes × 89,712`) | — | 1,794,240 B | 15.1% |
| `/K` structure child arrays | 177 | 255,156 B | 2.1% |
| Page `/Form` XObjects (57 pages + TikZ SVGs + callouts) | 197 | 857,019 B | 7.2% |
| Page streams, 29 embedded fonts, `/Outlines`, `/Dests`, `/Annots` | 1,614 | 454,161 B | 3.8% |
| **Total** | **91,700** | **11,886,178 B** | **100.0%** |

**Why Chromium emits 88,481 `/NonStruct` objects:**
1. As documented in `AGENTS.md`, Electron's `webContents.printToPDF` only emits PDF bookmarks (`/Outlines`) when **both** `generateTaggedPDF: true` and `generateDocumentOutline: true` are enabled ([src/pdf/print.ts](src/pdf/print.ts#L58-L59)).
2. With `generateTaggedPDF: true`, Blink serializes its accessibility tree (`AXObject`) into the PDF `/StructTreeRoot`.
3. In Obsidian 1.14 / 1.15, **MathJax 4.1.3 CHTML** represents every single character, digit, operator, surd, box, spacer, and stretchy assembly as deeply nested custom HTML elements (`<mjx-container>` → `<mjx-math>` → `<mjx-msqrt>` → `<mjx-sqrt>` → `<mjx-surd>` → `<mjx-mo>` → `<mjx-c>`). Similarly, **TikZ diagrams** are inline `<svg>` trees with hundreds of `<g>`, `<path>`, and `<text>` nodes.
4. Because `<mjx-*>` custom elements and `<svg>` internal nodes have no semantic PDF tag, Chromium emits a `/Type /StructElem /S /NonStruct` dictionary object for **every single DOM node** inside every formula and diagram, plus `/NonStruct <</MCID N>> BDC ... EMC` marked-content wrappers around every glyph in the page streams.
5. In addition, MathJax 4 CHTML sets `clip-path: padding-box polygon(...)` on every `mjx-mo > mjx-c, mjx-mi > mjx-c, mjx-mn > mjx-c`, causing Skia/PDF to emit a `q ... re W* n ... Q` clip rectangle around every single math character in the content stream.

### Verified Fix & Benchmark
We tested adding `aria-hidden="true"` to `<mjx-container>` and `<svg>` elements inside `.batch-export-root` during post-processing in Obsidian 1.15.1 (`printToPDF` with `generateTaggedPDF: true, generateDocumentOutline: true`):
- **Without `aria-hidden="true"`** (80 formulas): `821,947 bytes`, `7,286` `/StructElem` objects, `/Outlines: true`, `/Dests: true`.
- **With `aria-hidden="true"`** (same 80 formulas): `59,598 bytes` (**92.7% smaller / 13.8× reduction**), `6` `/StructElem` objects, `/Outlines: true`, `/Dests: true`.
- All visual rendering, selectable text, vector glyphs, `/Outlines` bookmarks, and `/Dests` internal links remain **100% identical**, because `aria-hidden="true"` only tells Blink's `AXObjectCache` not to walk inside `<mjx-container>` and `<svg>` subtrees when building `/StructTreeRoot`.

### Proposed Changes (`src/render/postprocess.ts` & `src/render/toc.ts`)
1. In `postprocess()` ([src/render/postprocess.ts](src/render/postprocess.ts)):
   - Add a `pruneAccessibilityTree(section: HTMLElement)` step that sets `aria-hidden="true"` on:
     - `mjx-container` (MathJax equations)
     - `.tikz-container svg` and any standalone `svg` diagrams/icons (callout icons `.callout-icon`, etc.)
   - Keep headings (`h1`–`h6`) and links (`<a href="#...">`) untouched in the accessibility tree so Chromium still generates `/Outlines` and `/Dests`.
2. In `buildToc()` ([src/render/toc.ts](src/render/toc.ts)):
   - Mark `.be-toc-dots` with `aria-hidden="true"` and any cloned `<mjx-container>` in TOC entries with `aria-hidden="true"`.

---

## 3. Math Equation Rendering Problems (Square Root Top Bar, Mean `\bar` / `\overline`, and TOC Math)

### Root Causes (Verified Against MathJax 4.1.3 in `obsidian-1.15.1.asar` and `Inferential Stats.pdf`)

There are **four distinct mechanisms** causing top bars (`\sqrt{...}`, `\bar{X}`, `\overline{x}`) to break, detach, or disappear in exported PDFs:

#### Cause 3A: Table of Contents flattens math in headings to `.textContent` (`Deviations from ¯X`)
- In [src/render/postprocess.ts](src/render/postprocess.ts#L93):
  ```ts
  const text = (heading.textContent ?? "").trim();
  ```
- When a heading contains inline math such as `### Deviations from $\bar{X}$ Are Too Small` (`Sample Variance.md`), MathJax renders `<mjx-mover><mjx-over>¯</mjx-over><mjx-base>𝑋</mjx-base></mjx-mover>`.
- Reading `heading.textContent` serializes `<mjx-mover>` into the two characters `"¯𝑋"` (`U+00AF` + `U+1D44B`).
- [src/render/toc.ts](src/render/toc.ts#L14) inserts `text` as plain text (`row.createEl("a", { cls: "be-toc-text", text })`), so the TOC page literally prints **`Deviations from ¯X Are Too Small`** with the bar `¯` sitting to the left of `X` instead of on top of `X` (verified on page 2 of `Inferential Stats.pdf`).

#### Cause 3B: MathJax 4 CHTML sets `clip-path: padding-box polygon(...)` on every `mjx-c`, clipping overbars (`\bar{X}`)
- In Obsidian 1.14+, MathJax was upgraded to **MathJax 4.1.3** (`lib/mathjax/obsidian-mathjax.js`).
- In `obsidian-mathjax.js` (`Yd.commonStyles`), MathJax 4 adds:
  ```css
  mjx-mo > mjx-c, mjx-mi > mjx-c, mjx-mn > mjx-c, mjx-ms > mjx-c, mjx-mtext > mjx-c {
    clip-path: padding-box polygon(-1em -2px, calc(100% + 1em) -2px, calc(100% + 1em) calc(100% + 2px), -1em calc(100% + 2px));
  }
  ```
- For `\bar{X}`, MathJax 4 uses glyph `U+00AF` (`175`, `mjx-cAF`) with metrics `[h = 0.59, d = -0.544, w = 0.5]`. Because CSS `padding-bottom` cannot be negative (`em0(-0.544) = 0`), the glyph's horizontal bar sits at `0.544em..0.590em`—inside the **top `0.046em` (`~0.58px`)** of `<mjx-c class="mjx-cAF">`'s padding box, followed by `margin-bottom: -0.544em` on `<mjx-over>`.
- During `printToPDF` at `scale: 0.8`, Skia/PDF converts each `clip-path` into a PDF clipping rectangle (`re W* n`). Sub-pixel rounding of that clip box slices into the top `0.046em` of `mjx-cAF`, making `\bar{X}` appear thinned or missing at normal zoom levels.
- Notably, Obsidian's own `app.css` includes a workaround for `.pele-math`:
  ```css
  .pele-math mjx-container * { clip-path: none !important; overflow: visible !important; position: static !important; }
  .pele-math mjx-stretchy-h > mjx-ext { overflow-x: clip !important; }
  ```
  because `clip-path` on `mjx-c` is unnecessary outside WebKit selection painting, whereas `mjx-stretchy-h > mjx-ext` and `mjx-stretchy-v > mjx-ext` *do* need `clip-path` / `overflow` to clip repeated extender glyphs (`–––` in `\overline{x}`).

#### Cause 3C: Square root (`\sqrt{...}`) horizontal vinculum is a CSS `border-top` that detaches horizontally from `<mjx-surd>` due to italic correction + integer pixel-snapping
- In MathJax 4.1.3 (`obsidian-mathjax.js`), `\sqrt{n}` is rendered as:
  ```html
  <mjx-msqrt>
    <mjx-sqrt>
      <mjx-surd><mjx-mo><mjx-c class="mjx-c221A">√</mjx-c></mjx-mo></mjx-surd>
      <mjx-box style="padding-top: 0.281em;">...</mjx-box>
    </mjx-sqrt>
  </mjx-msqrt>
  ```
  with CSS:
  ```css
  mjx-surd { display: inline-block; vertical-align: top; }
  mjx-sqrt { display: inline-block; padding-top: 0.075em; }
  mjx-sqrt > mjx-box { border-top: 0.075em solid; padding-left: 0.03em; margin-left: -0.03em; }
  mjx-sqrt.mjx-tall > mjx-box { padding-left: 0.3em; margin-left: -0.3em; }
  ```
- In MathJax 4's font tables (`obsidian-mathjax.js` offsets `908595`, `955184`, `964956`), the surd character `8730` (`\u221A`, `mjx-c221A` across sizes 0–4) and tall surd top `57345` (`U+E001`) have italic correction `{ic: 0.02}`. Because `mjx-c221A` is the last child of `mjx-mo`, `noic` is **not** set, so `charStyles` sets `padding-right = width + ic` (`0.833em + 0.02em = 0.853em` for normal size, `1.02em` for sizes 1–4).
- That `+0.02em` right padding consumes two-thirds of `mjx-box`'s `margin-left: -0.03em`, leaving only `0.01em` (`~0.12px` at scale `0.8`) of overlap.
- In Chromium's PDF print pipeline (`BoxBorderPainter`), CSS borders (`border-top` on `mjx-box`) are snapped via `PixelSnappedIntRect` to **integer layout pixels** (`403 337 10 1 re` and `363 361 76 1 re` in page 42's `/X397` stream), while the surd font glyph `<mjx-c class="mjx-c221A">` is placed at floating-point text coordinates (`1 0 0 -1 347.5 388 Tm`). Whenever `mjx-box`'s left edge rounds up, a visible horizontal gap opens between `√` and the top bar, and whenever `padding-top` / `border-top-width` rounds to an integer pixel, a vertical step appears between the tip of `√` and the bar.

#### Cause 3D: Sub-pixel `border-top` (`0.075em`) on `<mjx-box>` and `<mjx-line>` rounds down to `1` device unit (`0.6pt`) at `scale: 0.8` and drops out in PDF rasterizers
- At `scale: 0.8` (Obsidian's default `downscalePercent: 80`), `1em` in body text is `12.8px` (`9.6pt`), and in fractions/tables/scripts it is `9.05px` (`6.8pt`).
- `0.075em` is `0.68px–0.96px`, which Chromium snaps to a `1`-unit (`0.6pt`) filled rectangle (`re f`) with no PDF stroke adjustment. In Poppler/Cairo (`pdftoppm` / Evince at 100–150 DPI) and MuPDF at 100 DPI, a `0.6pt` filled rectangle frequently falls between pixel centers and **disappears completely** (as seen on page 42 of `Inferential Stats.pdf`, where the entire top bar of `\sqrt{\frac{(n-1)S^2}{\sigma^2(n-1)}}` vanishes at 150 DPI).

### Proposed Changes

#### A. Preserve Rendered Math in TOC Entries (`src/render/postprocess.ts` & `src/render/toc.ts`)
1. In `src/render/postprocess.ts`:
   - Add a helper `cloneHeadingContent(heading: HTMLElement): DocumentFragment` that clones `heading.childNodes` into a `DocumentFragment` and sanitizes it for placement inside `<a class="be-toc-text">`:
     - Remove any `[id]` attributes inside the clone so duplicate anchor IDs are never created in the document.
     - Unwrap any nested `<a>` elements into `<span>` elements (since HTML forbids `<a>` inside `<a>`).
     - Set `aria-hidden="true"` on any `<mjx-container>` or `<svg>` inside the clone.
   - Extend `TocHeading` with `content?: DocumentFragment` (keeping `text: string` for pure tests and fallback).
2. In `src/render/toc.ts`:
   - Update `line()` to accept `content?: DocumentFragment`: if `content` is present, append `content.cloneNode(true)` into `<a class="be-toc-text">`; otherwise fall back to `text`.

#### B. Scoped MathJax 4 Print Fixes in `styles.css` (No `!important`, Community-Lint Safe)
Because MathJax's `#MJX-CHTML-styles` rules have low specificity (`(0, 0, 1)` to `(0, 1, 2)`), rules scoped under `.batch-export-print > .batch-export-root` (specificity `(0, 2, 1)+`) win naturally without `!important`:
1. **Remove per-glyph `clip-path` on `mjx-c` while keeping stretchy extender clips**:
   ```css
   .batch-export-print > .batch-export-root mjx-mo > mjx-c,
   .batch-export-print > .batch-export-root mjx-mi > mjx-c,
   .batch-export-print > .batch-export-root mjx-mn > mjx-c,
   .batch-export-print > .batch-export-root mjx-ms > mjx-c,
   .batch-export-print > .batch-export-root mjx-mtext > mjx-c {
   	clip-path: none;
   }
   ```
   This eliminates the thousands of per-character `re W* n` clip rectangles in the PDF and prevents `\bar{X}`, `\hat{X}`, and `\tilde{X}` top bars from being clipped at their padding-box edge.
2. **Close the horizontal gap and align the square root vinculum (`mjx-sqrt > mjx-box`)**:
   - In `src/render/postprocess.ts`, set `noic="true"` on `mjx-surd mjx-c` elements (`section.querySelectorAll("mjx-surd mjx-c").forEach((el) => el.setAttribute("noic", "true"))`) or compensate via CSS on `.batch-export-print > .batch-export-root mjx-surd mjx-c.mjx-c221A` so the `+0.02em` italic-correction padding on `√` does not push `mjx-box` away from the surd tip.
   - In `styles.css`, overlap `mjx-sqrt > mjx-box` slightly further into `mjx-surd` and ensure a minimum vinculum thickness that survives `0.8` downscaling and PDF rasterization:
     ```css
     .batch-export-print > .batch-export-root mjx-sqrt > mjx-box {
     	border-top-width: max(0.078em, 1.25px);
     	padding-left: 0.06em;
     	margin-left: -0.06em;
     }
     .batch-export-print > .batch-export-root mjx-sqrt.mjx-tall > mjx-box {
     	padding-left: 0.33em;
     	margin-left: -0.33em;
     }
     ```
   - Also reinforce horizontal stretchy overbars/underbars (`\overline`, `\underline`) and fraction lines (`mjx-line`) so they do not drop out at `scale: 0.8`:
     ```css
     .batch-export-print > .batch-export-root mjx-line {
     	border-top-width: max(0.067em, 1.15px);
     }
     ```

---

## 4. Dark Background with Black Font When Exporting from Dark Mode

### Root Cause (Verified in `obsidian-1.15.1.asar` and `be-dark.pdf`)
We reproduced the exact bug by exporting `Sample Variance.md` while Obsidian was in Dark Mode (`theme-dark`) and inspecting the resulting PDF content stream (`be-dark.pdf`):
```pdf
.23999999 0 0 -.23999999 0 842.88 cm
q
3.125 0 0 3.125 0 0 cm
.1098 .1098 .1098 RG .1098 .1098 .1098 rg
/G3 gs
/Document <</MCID 0 >>BDC
0 0 900 1311 re
f
Q
```
Here is the exact chain of events that produces `0.1098 0.1098 0.1098 rg` (`rgb(28, 28, 28)` = `#1C1C1C`) across the entire page while the text is black (`0 0 0 rg`):

1. **Obsidian sets Electron's native `BrowserWindow` background color to `#1c1c1c` in Dark Mode**:
   - In `obsidian-1.15.1.asar` (`app.js`), function `NW(app)` reads `getComputedStyle(document.body).backgroundColor` and sends an IPC message:
     ```js
     window.electron.ipcRenderer.send("startup-appearance", {
       theme: t.hasClass("theme-light") ? "theme-light" : "theme-dark",
       ...
       background: r?.a === 1 ? ka(r) : null
     });
     ```
   - In `obsidian-1.15.1.asar`'s main process, the `"startup-appearance"` handler calls:
     ```js
     browserWindow.setBackgroundColor(/^#[0-9a-f]{6}$/i.test(He) ? He : "#00000000");
     ```
     In Dark Mode, `getComputedStyle(document.body).backgroundColor` is `#1c1c1c`, so `browserWindow.getBackgroundColor()` is `"#1C1C1C"`.
2. **Chromium's `printToPDF` paints `BrowserWindow`'s `base_background_color_` over the entire unscaled MediaBox**:
   - Obsidian's built-in "Export to PDF" (`printToPdfDesktop` in `app.js`) opens a separate hidden popup `BrowserWindow` (`window.open("about:blank", "_blank", "token=...,hide=true")`) without `background=`, so that popup window's `BrowserWindow` background color is white and its `body` has `theme-light`.
   - By contrast, `batch-export` prints the **main `BrowserWindow`**. When `printToPDF({ printBackground: true, scale: 0.8, ... })` runs on the main `BrowserWindow`, Blink paints the `WebView`'s `base_background_color_` (`#1C1C1C` from `browserWindow.setBackgroundColor("#1c1c1c")`) across the **entire unscaled page MediaBox** (`0 0 900 1311 re f`) *before* applying margins or `scale`.
3. **`styles.css` set `background: transparent` on `html` and `body`, and even `background: #fff` in CSS only covers the scaled margin box**:
   - In [styles.css](styles.css#L283-L287):
     ```css
     @media print {
       html.batch-export-printing,
       body.batch-export-printing {
         background: transparent;
         color-scheme: light;
       }
     }
     ```
   - Because `html`, `body`, and `.batch-export-root` all had transparent backgrounds, the `#1C1C1C` `BrowserWindow` base background filled 100% of every page, while `lightScope.ts` resolved `--text-normal` inside `.batch-export-root` to light-theme black (`#222222` / `#000000`) and callout fills to `10%` alpha over `#1C1C1C`—resulting in black text on a `#1C1C1C` dark background.
   - Furthermore, we verified via `obsidian eval` that setting `background-color: #ffffff` in CSS alone is **not sufficient** when `scale < 1` or `margins > 0`: CSS `html`/`body` backgrounds are clipped to the margin box (`115.625 115.625 2250 3279.1992 re`) and scaled by `scale` (`0.8`), leaving `#1C1C1C` around the margins and bottom/right of the page unless the `BrowserWindow` background color itself is white (`#ffffff`) during `printToPDF`.
4. **Plugins that check `document.body.classList.contains("theme-dark")` (e.g., `obsidian-tikz` 1.1.2)**:
   - While `obsidian-tikz >= 1.2.0` honors `data-tikz-theme="light"` on `.batch-export-root`, `obsidian-tikz 1.1.2` (currently installed in the vault) checks `el.doc.body.classList.contains("theme-dark")` in `isDarkTheme(el)`. If a diagram is injected while `document.body` has `theme-dark`, `tikz 1.1.2` applies dark-mode color adaptation or `.tikz-light-canvas` borders.

### Verified Fix
We tested calling `win.setBackgroundColor("#ffffff")` on the current `BrowserWindow` before `printToPDF` and restoring the previous `win.getBackgroundColor()` (`#1C1C1C`) in `finally`:
- The `.1098 .1098 .1098 rg` (`0 0 900 1311 re f`) dark page rectangle **completely disappears** from the PDF content stream, matching a native Light Mode export byte-for-byte.
- Because `document.body` covers 100% of the on-screen viewport during the export, changing `BrowserWindow`'s underlying native background color during `printToPdf` produces **zero visual flicker** in the user's dark-mode workspace.

### Proposed Changes (`src/pdf/print.ts`, `src/render/lightScope.ts`, & `styles.css`)

1. **Reset `BrowserWindow` native background color during `printToPdf` (`src/pdf/print.ts`)**:
   - Add a helper `withLightWindowBackground<T>(fn: () => Promise<T>): Promise<T>` in `src/pdf/print.ts`:
     - Obtain the current `BrowserWindow` via `require("@electron/remote")?.getCurrentWindow?.()` (or `(window as { electronWindow?: BrowserWindowLike }).electronWindow`, which Obsidian's `app.js` sets on `window`).
     - Read `const prevBg = win?.getBackgroundColor?.()` and call `win?.setBackgroundColor?.("#ffffff")` (and also send `ipcRenderer.send("startup-appearance", ...)` only if `remote` is unavailable).
     - In `try / finally`, restore `if (prevBg) win.setBackgroundColor(prevBg)` after `printToPDF` completes.
2. **Set explicit white background in `@media print` (`styles.css`)**:
   - In [styles.css](styles.css#L283-L293), change `background: transparent` to `#ffffff` so that both the root canvas and `.batch-export-print` explicitly paint white in print media:
     ```css
     @media print {
     	html.batch-export-printing,
     	body.batch-export-printing,
     	.batch-export-print,
     	.batch-export-print > .batch-export-root {
     		background: #ffffff;
     		background-color: #ffffff;
     		color-scheme: light;
     	}
     ```
   - Also explicitly set `color: var(--text-normal)` on `.batch-export-print > .batch-export-root` so text color never falls back to an inherited dark-theme rule.
3. **Ensure `lightScope.ts` overrides cover all computed theme properties**:
   - In [src/render/lightScope.ts](src/render/lightScope.ts), ensure `--background-primary: #ffffff` and `--text-normal` are always included in `lightScopeProps()` even if a custom theme defines them on `.theme-dark` / `.theme-light` rather than `body`.

---

## 5. Summary of Files to Touch When Implementing

| File | Planned Changes |
| :--- | :--- |
| [src/collect/order.ts](src/collect/order.ts) | Add pure `moveItem()` and `isSameOrder()` helpers (no `import "obsidian"`). |
| [test/order.test.ts](test/order.test.ts) | Add unit tests for `moveItem()` and `isSameOrder()` alongside existing `orderNotes()` tests. |
| [src/ui/SelectModal.ts](src/ui/SelectModal.ts) | Maintain `noteOrder: NoteInfo[]` (defaulting to `model.notes` index order); add drag handle (`grip-vertical`), row drag-and-drop events, `↑`/`↓` move buttons, and a *Reset order* button in `.be-bar`; emit `notes` in `this.noteOrder` order on submit. |
| [src/main.ts](src/main.ts) | In `buildRequest()`, preserve the caller's `notes` array order instead of re-sorting by `model.notes`. |
| [src/render/postprocess.ts](src/render/postprocess.ts) | 1) Set `aria-hidden="true"` on `mjx-container` and `svg` elements (`pruneAccessibilityTree`) to eliminate the ~89k `/NonStruct` tagged-PDF objects.<br>2) Set `noic="true"` on `mjx-surd mjx-c` so surd italic correction does not push the vinculum away.<br>3) Clone and sanitize heading inline DOM (`cloneHeadingContent`) for `TocHeading.content` so math in headings renders properly in the TOC. |
| [src/render/toc.ts](src/render/toc.ts) | Render `TocHeading.content` (cloned inline nodes including math) inside `<a class="be-toc-text">`, and mark `.be-toc-dots` with `aria-hidden="true"`. |
| [src/pdf/print.ts](src/pdf/print.ts) | Wrap the `print-to-pdf` IPC call in `withLightWindowBackground()` so Electron's `BrowserWindow` background color is temporarily `#ffffff` during PDF generation and restored in `finally`. |
| [src/render/lightScope.ts](src/render/lightScope.ts) | Guarantee `--background-primary` and `--text-normal` light values in `lightScopeProps()`. |
| [styles.css](styles.css) | 1) Add styles for `.be-drag-handle`, `.be-move-btn`, `.be-dragging`, `.be-drop-above`, `.be-drop-below`.<br>2) Under `.batch-export-print > .batch-export-root`, remove `clip-path` on `mjx-c` (`\bar{X}` fix) and adjust `mjx-sqrt > mjx-box` overlap (`margin-left: -0.06em`) and `border-top-width` (`\sqrt{...}` fix).<br>3) Under `@media print`, set `background: #ffffff; background-color: #ffffff; color-scheme: light;` on `html.batch-export-printing`, `body.batch-export-printing`, and `.batch-export-print`. |

---

## 6. Verification Plan (When Approved for Implementation)

1. `npm test` — verify all Vitest suites pass (including new `order.test.ts` tests for manual sorting).
2. `npm run lint` & `npm run build` — verify 0 warnings/errors from `eslint-plugin-obsidianmd` and clean TypeScript/esbuild bundle.
3. Headless export verification in Obsidian (`01 - Courses/Inferential Stats`):
   - **Dark Mode Export**: Run export while Obsidian is in Dark Mode (`theme-dark`); verify via `qpdf` / `pdftoppm` that no `.1098 .1098 .1098 rg` background rectangle is emitted and pages have pure white (`#ffffff`) backgrounds with black text.
   - **File Size**: Verify the 57-page `Inferential Stats.pdf` drops from `~11.9 MB` (`89,712` `/StructElem` objects) to `~1.2–1.5 MB` (`< 1,500` `/StructElem` objects) while retaining all `/Outlines` bookmarks and `/Dests` internal links.
   - **Math Rendering**: Render pages 2 (TOC), 8, 40, 41, 42, 54 at 150 DPI and 400 DPI with `pdftoppm` and `mutool draw`; verify `Deviations from \bar{X}` in the TOC, `\bar{X}` in tables/callouts, and `\sqrt{n}` / `\sqrt{\frac{(n-1)S^2}{\sigma^2(n-1)}}` top bars are continuous and unclipped.
   - **Vault Integrity**: Verify `sha256sum` of all markdown files in the exported folder before and after export.
