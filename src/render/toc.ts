/**
 * The table-of-contents page. Page numbers start as same-width placeholders so
 * filling in the real numbers after the first print cannot shift pagination.
 */

import { APPENDIX_ANCHOR, type RenderedNote } from "./renderNotes";
import type { NoteStructure } from "./postprocess";
import { inToc, noteAnchor, tocLineLevel } from "./anchors";

const PLACEHOLDER = "000";

function line(parent: HTMLElement, level: number, id: string, text: string): void {
	const row = parent.createDiv({ cls: `be-toc-line be-toc-l${level}` });
	row.createEl("a", { cls: "be-toc-text", text, attr: { href: `#${id}` } });
	row.createSpan({ cls: "be-toc-dots" });
	row.createSpan({ cls: "be-pg", text: PLACEHOLDER, attr: { "data-target": id } });
}

export function buildToc(
	root: HTMLElement,
	notes: RenderedNote[],
	structure: Map<number, NoteStructure>,
	tocDepth: number,
): HTMLElement | null {
	if (tocDepth === 0) return null;
	const toc = createEl("section", { cls: "be-toc" });
	toc.createDiv({ cls: "be-toc-title", text: "Contents" });

	let appendixLineDone = false;
	for (const note of notes) {
		if (note.appendix && !appendixLineDone) {
			appendixLineDone = true;
			line(toc, 1, APPENDIX_ANCHOR, "Appendix");
		}
		line(toc, note.appendix ? 2 : 1, noteAnchor(note.index), note.title);
		for (const h of structure.get(note.index)?.headings ?? []) {
			if (inToc(h.level, tocDepth)) line(toc, tocLineLevel(h.level, note.appendix), h.id, h.text);
		}
	}
	root.prepend(toc);
	return toc;
}

/** Writes real page numbers into the placeholders. Returns how many changed. */
export function fillPageNumbers(toc: HTMLElement, pageOf: Map<string, number>): number {
	let changed = 0;
	toc.querySelectorAll<HTMLElement>(".be-pg").forEach((el) => {
		const page = pageOf.get(el.dataset.target ?? "");
		const text = page === undefined ? "–" : String(page);
		if (el.textContent !== text) {
			el.textContent = text;
			changed++;
		}
	});
	return changed;
}

/** The numbers currently shown, for detecting a stable layout between passes. */
export function currentNumbers(toc: HTMLElement): Map<string, string> {
	const out = new Map<string, string>();
	toc.querySelectorAll<HTMLElement>(".be-pg").forEach((el) => out.set(el.dataset.target ?? "", el.textContent ?? ""));
	return out;
}
