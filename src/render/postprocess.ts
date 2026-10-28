/**
 * Turns the rendered notes into something that prints well: open callouts,
 * stable anchor ids (headings and `^blockid` blocks), an outline-friendly heading structure, and links that
 * point at pages of this PDF instead of at Obsidian.
 */

import { parseLinktext, resolveSubpath } from "obsidian";
import type { App, HeadingCache } from "obsidian";
import { alignHeadings, BLOCK_MARKER_RE, blockAnchor, headingAnchor, isOutlineLevel, noteAnchor } from "./anchors";
import type { RenderedNote } from "./renderNotes";

export interface TocHeading {
	id: string;
	text: string;
	/** Source level, 1-6 (a body `#` is 1). */
	level: number;
}

export interface NoteStructure {
	/** Cache heading index -> rendered heading index (null when unmatched). */
	cacheToDom: (number | null)[];
	/** The note's own headings in document order, in the outline or not, for the TOC. */
	headings: TocHeading[];
	/** Lowercased block ids that got an anchor in this note. */
	blocks: Set<string>;
}

export interface PostStats {
	deadLinks: number;
	rewrittenLinks: number;
	/** Cache headings with no rendered counterpart (links fall back to the note). */
	unalignedHeadings: number;
	/** Block links whose block got no anchor (they fall back to the note). */
	unresolvedBlocks: number;
	/** Per note index. */
	structure: Map<number, NoteStructure>;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

function levelOf(el: Element): number {
	return Number(el.tagName.charAt(1));
}

function inEmbed(el: Element, boundary: Element): boolean {
	const embed = el.closest(".internal-embed, .markdown-embed");
	return embed !== null && boundary.contains(embed);
}

function openCallouts(section: HTMLElement): void {
	section.querySelectorAll(".callout.is-collapsed").forEach((el) => el.classList.remove("is-collapsed"));
	section.querySelectorAll(".callout-fold").forEach((el) => el.remove());
	section.querySelectorAll(".heading-collapse-indicator").forEach((el) => el.remove());
}

type HeadingTag = `h${1 | 2 | 3 | 4 | 5 | 6}`;

/**
 * Replace `el` with a different tag, keeping attributes and children.
 * `null` produces a presentational div that stays out of the PDF outline.
 */
function retag(el: HTMLElement, tag: HeadingTag | null, level: number): HTMLElement {
	const next = createEl(tag ?? "div");
	for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value);
	while (el.firstChild) next.appendChild(el.firstChild);
	if (tag === null) {
		next.classList.add("be-heading", `be-h${level}`);
		next.setAttribute("role", "presentation");
	}
	el.replaceWith(next);
	return next;
}

function structureHeadings(app: App, note: RenderedNote, outlineDepth: number): NoteStructure {
	const section = note.section;
	// The note title is already a heading of its own; everything else in the
	// body is content.
	const body = section.querySelector(".be-note-body") ?? section;
	const shift = note.appendix ? 1 : 0;

	const all = Array.from(body.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
	const own: HTMLElement[] = [];
	for (const heading of all) {
		if (inEmbed(heading, body)) retag(heading, null, levelOf(heading));
		else own.push(heading);
	}

	const cacheLevels = (app.metadataCache.getFileCache(note.file)?.headings ?? []).map((h: HeadingCache) => h.level);
	const cacheToDom = alignHeadings(cacheLevels, own.map(levelOf));

	const headings: TocHeading[] = [];
	own.forEach((heading, j) => {
		const level = levelOf(heading);
		const text = (heading.textContent ?? "").trim();
		const keep = isOutlineLevel(level, outlineDepth);
		const tag = keep ? (`h${Math.min(6, level + shift)}` as HeadingTag) : null;
		const next = retag(heading, tag, level);
		next.id = headingAnchor(note.index, j);
		if (text) headings.push({ id: next.id, text, level });
	});

	return { cacheToDom, headings, blocks: new Set() };
}

const BLOCK_TARGET = "li, p, blockquote, table, .math-block";
const MARKER_WITH_SPACE = new RegExp(`\\s*${BLOCK_MARKER_RE.source}`, "g");

/** The child of `body` that holds `el`. */
function topLevel(el: HTMLElement, body: HTMLElement): HTMLElement {
	let cur = el;
	while (cur.parentElement && cur.parentElement !== body) cur = cur.parentElement;
	return cur;
}

/**
 * The element a `^blockid` labels, seen from where its marker landed. The
 * enclosing callout wins: an id line at the end of a callout is usually a lazy
 * continuation, so the marker sits inside the callout's last paragraph or list
 * item, while the id names the whole callout.
 */
function blockTarget(el: HTMLElement, body: HTMLElement): HTMLElement {
	const callout = el.closest<HTMLElement>(".callout");
	if (callout && body.contains(callout)) return callout;
	const block = el.closest<HTMLElement>(BLOCK_TARGET);
	if (block && body.contains(block)) return block;
	return topLevel(el, body);
}

function isEmptyBlock(el: HTMLElement): boolean {
	return (el.textContent ?? "").trim() === "" && el.querySelector("img, svg, mjx-container, .math") === null;
}

/** Turn the markers left by `markBlockIds` into anchor ids. */
function placeBlockAnchors(note: RenderedNote): Set<string> {
	const placed = new Set<string>();
	if (note.markedBlocks.length === 0) return placed;
	const body = note.section.querySelector<HTMLElement>(".be-note-body") ?? note.section;

	const hits: Text[] = [];
	const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		const parent = text.parentElement;
		if (parent && text.data.includes("BEBLOCK-") && !inEmbed(parent, body)) hits.push(text);
	}

	for (const text of hits) {
		const parent = text.parentElement;
		if (!parent) continue;
		const ids = Array.from(text.data.matchAll(BLOCK_MARKER_RE), (m) => m[1].toLowerCase());
		text.data = text.data.replace(MARKER_WITH_SPACE, "");

		let target = blockTarget(parent, body);
		if (isEmptyBlock(target)) {
			// A `^id` on its own line after a blank line names the block before it.
			const holder = topLevel(target, body);
			const previous = holder.previousElementSibling;
			if (previous instanceof HTMLElement) {
				holder.remove();
				target = previous;
			}
		} else if (parent !== target && parent.matches("p") && isEmptyBlock(parent)) {
			// `> ^id` after a blank line inside a callout leaves an empty paragraph.
			parent.remove();
		}

		for (const id of ids) {
			const anchor = blockAnchor(note.index, id);
			if (!target.id) target.id = anchor;
			else target.prepend(createSpan({ cls: "be-block-anchor", attr: { id: anchor } }));
			placed.add(id);
		}
	}
	return placed;
}

function headingIndexIn(headings: HeadingCache[], current: HeadingCache): number {
	const byRef = headings.indexOf(current);
	if (byRef >= 0) return byRef;
	return headings.findIndex(
		(h) => h.position.start.offset === current.position.start.offset && h.heading === current.heading,
	);
}

/** `#anchor` for a link target inside the export, or null when it is not in it. */
function resolveAnchor(
	app: App,
	href: string,
	sourcePath: string,
	pathToIndex: Map<string, number>,
	structure: Map<number, NoteStructure>,
	stats: PostStats,
): string | null {
	const { path, subpath } = parseLinktext(href);
	const target = path === "" ? app.vault.getFileByPath(sourcePath) : app.metadataCache.getFirstLinkpathDest(path, sourcePath);
	if (!target) return null;
	const j = pathToIndex.get(target.path);
	if (j === undefined) return null;

	if (subpath) {
		const cache = app.metadataCache.getFileCache(target);
		const resolved = cache ? resolveSubpath(cache, subpath) : null;
		if (cache && resolved && resolved.type === "heading") {
			const k = headingIndexIn(cache.headings ?? [], resolved.current);
			const dom = k >= 0 ? structure.get(j)?.cacheToDom[k] : null;
			if (dom !== null && dom !== undefined) return `#${headingAnchor(j, dom)}`;
		}
		if (resolved && resolved.type === "block") {
			const id = resolved.block.id.toLowerCase();
			if (structure.get(j)?.blocks.has(id)) return `#${blockAnchor(j, id)}`;
			stats.unresolvedBlocks++;
		}
		// Unmatched headings and blocks land on the note itself.
	}
	return `#${noteAnchor(j)}`;
}

function rewriteLinks(
	app: App,
	note: RenderedNote,
	pathToIndex: Map<string, number>,
	structure: Map<number, NoteStructure>,
	stats: PostStats,
): void {
	note.section.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
		const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
		const anchor = resolveAnchor(app, href, note.file.path, pathToIndex, structure, stats);
		if (anchor === null) {
			const span = createSpan({ cls: "be-dead-link" });
			while (a.firstChild) span.appendChild(a.firstChild);
			a.replaceWith(span);
			stats.deadLinks++;
			return;
		}
		a.setAttribute("href", anchor);
		a.removeAttribute("target");
		a.removeAttribute("rel");
		a.removeAttribute("data-href");
		stats.rewrittenLinks++;
	});

	// `#TODO` renders as a link to a tag search, which is a dead URL on paper.
	note.section.querySelectorAll<HTMLAnchorElement>("a.tag").forEach((a) => {
		const span = createSpan({ cls: "tag" });
		while (a.firstChild) span.appendChild(a.firstChild);
		a.replaceWith(span);
	});
}

export function postprocess(app: App, notes: RenderedNote[], outlineDepth: number): PostStats {
	const stats: PostStats = { deadLinks: 0, rewrittenLinks: 0, unalignedHeadings: 0, unresolvedBlocks: 0, structure: new Map() };
	const pathToIndex = new Map(notes.map((n) => [n.file.path, n.index]));

	for (const note of notes) {
		openCallouts(note.section);
		const structure = structureHeadings(app, note, outlineDepth);
		// After the headings, so retagging cannot drop a block id.
		structure.blocks = placeBlockAnchors(note);
		stats.structure.set(note.index, structure);
		stats.unalignedHeadings += structure.cacheToDom.filter((d) => d === null).length;
	}
	// Links need every note's heading map, so they are a second pass.
	for (const note of notes) rewriteLinks(app, note, pathToIndex, stats.structure, stats);
	return stats;
}
