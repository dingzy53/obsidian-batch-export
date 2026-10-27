/**
 * The off-screen container that Obsidian's `print` CSS prints.
 *
 * Obsidian's own export appends `div.print > div.markdown-preview-view` to the
 * body; its `@media print` rules hide every other body child
 * (`body > :not(.print) { display: none }`) and open callouts.
 */

import type { BatchExportSettings } from "../settingsModel";
import { createLightScopeStyle } from "./lightScope";

export interface PrintContainer {
	wrap: HTMLElement;
	root: HTMLElement;
	dispose(): void;
}

const PAGE_WIDTH_MM: Record<BatchExportSettings["pageSize"], number> = {
	A4: 210,
	Letter: 215.9,
	A5: 148,
};

const CSS_PX_PER_MM = 96 / 25.4;

export function createPrintContainer(settings: BatchExportSettings, scale: number): PrintContainer {
	const wrap = document.body.createDiv({ cls: ["print", "batch-export-print"] });
	const contentMm = PAGE_WIDTH_MM[settings.pageSize] - settings.marginsMm.left - settings.marginsMm.right;
	// Same CSS width on screen and on paper, so math, diagrams and wrapping lay
	// out identically in both. At scale 0.8 a page holds 1/0.8 more CSS pixels.
	wrap.style.width = `${Math.round((contentMm * CSS_PX_PER_MM) / scale)}px`;
	if (settings.fontSizePt > 0) {
		wrap.addClass("be-custom-font");
		wrap.style.setProperty("--be-font-size", `${settings.fontSizePt}pt`);
	}
	wrap.toggleClass("be-no-note-break", !settings.pageBreakPerNote);

	const root = wrap.createDiv({
		cls: ["markdown-preview-view", "markdown-rendered", "theme-light", "batch-export-root"],
	});
	// Light diagrams even while Obsidian is in dark mode (obsidian-tikz >= 1.2.0).
	root.setAttribute("data-tikz-theme", "light");
	// Light colours for everything else, even while Obsidian is in dark mode.
	wrap.prepend(createLightScopeStyle(".batch-export-root"));

	return {
		wrap,
		root,
		dispose: () => wrap.remove(),
	};
}
