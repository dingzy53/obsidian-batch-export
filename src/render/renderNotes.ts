/**
 * Renders the selected notes into the print container with Obsidian's own
 * Markdown renderer. The note files are only read, never written.
 */

import { getFrontMatterInfo, MarkdownRenderer } from "obsidian";
import type { App, Component, TFile } from "obsidian";
import { noteAnchor } from "./anchors";
import { markBlockIds, stripFrontmatter, unfoldCallouts, type BlockRef } from "./preprocess";

export interface NoteToRender {
	file: TFile;
	title: string;
	appendix: boolean;
}

export interface RenderedNote extends NoteToRender {
	/** Position in the export; the id prefix of everything inside it. */
	index: number;
	section: HTMLElement;
	/** Block ids whose `^id` token was replaced by a marker before rendering. */
	markedBlocks: string[];
}

export const APPENDIX_ANCHOR = "appendix";

export interface RenderProgress {
	(done: number, total: number, title: string): void;
}

export async function renderNotes(
	app: App,
	root: HTMLElement,
	component: Component,
	notes: NoteToRender[],
	progress: RenderProgress,
	isCancelled: () => boolean,
): Promise<RenderedNote[]> {
	const rendered: RenderedNote[] = [];
	let appendixHeaderDone = false;

	for (let i = 0; i < notes.length; i++) {
		if (isCancelled()) break;
		const note = notes[i];
		progress(i, notes.length, note.title);

		if (note.appendix && !appendixHeaderDone) {
			appendixHeaderDone = true;
			const header = root.createEl("section", { cls: "be-appendix-header" });
			header.createEl("h1", { cls: "be-note-title", text: "Appendix", attr: { id: APPENDIX_ANCHOR } });
		}

		const raw = await app.vault.cachedRead(note.file);
		const { contentStart } = getFrontMatterInfo(raw);
		// Markers go in first: the cache offsets refer to the raw file, and
		// unfolding callouts shifts them.
		const refs: BlockRef[] = Object.values(app.metadataCache.getFileCache(note.file)?.blocks ?? {})
			.map((b) => ({ id: b.id, endOffset: b.position.end.offset }))
			.filter((b) => b.endOffset > contentStart);
		const { text, marked } = markBlockIds(raw, refs);
		const markdown = unfoldCallouts(stripFrontmatter(text, contentStart));

		const section = root.createEl("section", { cls: "be-note" });
		// Appendix notes sit one outline level below the "Appendix" heading.
		section.createEl(note.appendix ? "h2" : "h1", {
			cls: "be-note-title",
			text: note.title,
			attr: { id: noteAnchor(i) },
		});
		const body = section.createDiv({ cls: "be-note-body" });
		await MarkdownRenderer.render(app, markdown, body, note.file.path, component);

		rendered.push({ ...note, index: i, section, markedBlocks: marked });
	}
	progress(notes.length, notes.length, "");
	return rendered;
}
