/**
 * Turns the rendered notes into something that prints well: open callouts,
 * stable anchor ids (headings and `^blockid` blocks), an outline-friendly heading structure, and links that
 * point at pages of this PDF instead of at Obsidian.
 */

import { parseLinktext, resolveSubpath } from "obsidian";
import type { App, HeadingCache } from "obsidian";
import { alignHeadings, BLOCK_MARKER_RE, blockAnchor, headingAnchor, isOutlineLevel, noteAnchor, outlineTagLevel, repeatsTitle } from "./anchors";
import type { RenderedNote } from "./renderNotes";

export interface TocHeading {
	id: string;
	text: string;
	/** Inline DOM cloned from the heading (math, emphasis) for the TOC. */
	content?: DocumentFragment;
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
	/**
	 * Rendered heading index of a leading `#` that repeated the note title and
	 * was removed; links to it land on the note title. Null when none was.
	 */
	titleHeading: number | null;
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

/**
 * Keeps MathJax and SVG subtrees out of Chromium's accessibility tree.
 * Without this, a tagged PDF gets one `/NonStruct` object per glyph and one
 * marked-content wrapper per math character (a 57-page export reached ~89k
 * objects). Math inside headings that stay in the outline is left alone:
 * Chromium takes bookmark titles from the heading's accessible text, and
 * MathJax's assistive MathML is what supplies that text.
 */
function pruneAccessibilityTree(section: HTMLElement): void {
	section.querySelectorAll("mjx-container, svg").forEach((el) => {
		if (el.closest(HEADING_SELECTOR)) return;
		el.setAttribute("aria-hidden", "true");
	});
}

/**
 * A copy of a heading's inline content that is safe inside the TOC's `<a>`:
 * no duplicate element ids, no nested links, and hidden math/diagram subtrees.
 */
function cloneHeadingContent(heading: HTMLElement): DocumentFragment {
	const fragment = createFragment();
	for (const node of Array.from(heading.childNodes)) fragment.appendChild(node.cloneNode(true));

	// A TOC line is not a heading, so footnote markers and block-anchor spans are noise there.
	fragment.querySelectorAll("sup.footnote-ref, .be-block-anchor").forEach((el) => el.remove());
	for (const el of Array.from(fragment.querySelectorAll("[id]"))) el.removeAttribute("id");
	// Internal links, external links and tags become plain text: no accent
	// colour, no underline and no tag pill in the contents page.
	for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
		const span = createSpan();
		while (anchor.firstChild) span.appendChild(anchor.firstChild);
		anchor.replaceWith(span);
	}
	fragment.querySelectorAll("mjx-container, svg").forEach((el) => el.setAttribute("aria-hidden", "true"));
	return fragment;
}

/** False when cloning and cleanup left nothing to show (a lone footnote, say). */
function hasContent(fragment: DocumentFragment): boolean {
	return (fragment.textContent ?? "").trim() !== "" || fragment.querySelector("mjx-container, svg, img") !== null;
}

interface StructuredHeading {
	el: HTMLElement;
	level: number;
}

/** True when nothing visible comes before `heading` inside `body`. */
function isFirstContent(heading: HTMLElement, body: Element): boolean {
	const range = document.createRange();
	range.setStart(body, 0);
	range.setEndBefore(heading);
	const before = range.cloneContents();
	return (
		(before.textContent ?? "").trim() === "" &&
		before.querySelector("img, svg, mjx-container, .math, .internal-embed, iframe, video, audio, table, hr") === null
	);
}

/**
 * A leading body `#` that repeats the note title would print the title twice
 * and add a second bookmark and TOC line for it.
 */
function isDuplicateTitle(note: RenderedNote, heading: HTMLElement, body: Element): boolean {
	return (
		heading.tagName === "H1" &&
		isFirstContent(heading, body) &&
		repeatsTitle(heading.textContent ?? "", [note.title, note.file.basename])
	);
}

/**
 * Removes the duplicate heading. Its block markers become anchors on the note
 * title here, because `placeBlockAnchors` only looks inside the body.
 */
function mergeIntoTitle(note: RenderedNote, heading: HTMLElement, blocks: Set<string>): void {
	const title = note.section.querySelector<HTMLElement>(".be-note-title");
	const text = heading.textContent ?? "";
	for (const m of text.matchAll(BLOCK_MARKER_RE)) {
		const id = m[1].toLowerCase();
		if (title && !blocks.has(id)) {
			title.prepend(createSpan({ cls: "be-block-anchor", attr: { id: blockAnchor(note.index, id) } }));
			blocks.add(id);
		}
	}
	heading.remove();
}

function structureHeadings(
	app: App,
	note: RenderedNote,
	outlineDepth: number,
): { cacheToDom: (number | null)[]; headingEls: StructuredHeading[]; titleHeading: number | null; titleBlocks: Set<string> } {
	const section = note.section;
	// The note title is already a heading of its own; everything else in the
	// body is content.
	const body = section.querySelector(".be-note-body") ?? section;

	const all = Array.from(body.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
	const own: HTMLElement[] = [];
	for (const heading of all) {
		if (inEmbed(heading, body)) retag(heading, null, levelOf(heading));
		else own.push(heading);
	}

	const cacheLevels = (app.metadataCache.getFileCache(note.file)?.headings ?? []).map((h: HeadingCache) => h.level);
	// Aligned before the duplicate title is removed, so rendered indices stay
	// those of the cache and a link to the removed heading can be redirected.
	const cacheToDom = alignHeadings(cacheLevels, own.map(levelOf));

	const titleBlocks = new Set<string>();
	let titleHeading: number | null = null;
	if (own.length > 0 && isDuplicateTitle(note, own[0], body)) {
		mergeIntoTitle(note, own[0], titleBlocks);
		titleHeading = 0;
	}

	const headingEls: StructuredHeading[] = [];
	own.forEach((heading, j) => {
		if (j === titleHeading) return;
		const level = levelOf(heading);
		const keep = isOutlineLevel(level, outlineDepth);
		const tag = keep ? (`h${outlineTagLevel(level, note.appendix)}` as HeadingTag) : null;
		const next = retag(heading, tag, level);
		next.id = headingAnchor(note.index, j);
		headingEls.push({ el: next, level });
	});

	return { cacheToDom, headingEls, titleHeading, titleBlocks };
}

function collectTocHeadings(headingEls: StructuredHeading[]): TocHeading[] {
	const headings: TocHeading[] = [];
	for (const { el, level } of headingEls) {
		if (!el.isConnected) continue;
		const text = (el.textContent ?? "").trim();
		if (!text) continue;
		const content = cloneHeadingContent(el);
		headings.push({ id: el.id, text, level, content: hasContent(content) ? content : undefined });
	}
	return headings;
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

/**
 * Removes `#tag` links. A paragraph or list item left empty goes too, so a
 * `#TODO` line leaves no gap. Runs before the TOC is collected, so headings
 * lose their tags in the TOC as well.
 */
function removeTags(section: HTMLElement): void {
	section.querySelectorAll<HTMLElement>("a.tag").forEach((tag) => {
		const block = tag.parentElement?.closest<HTMLElement>("p, li");
		tag.remove();
		if (block && section.contains(block) && isEmptyBlock(block)) block.remove();
	});
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
			const target = structure.get(j);
			const dom = k >= 0 ? target?.cacheToDom[k] : null;
			if (dom !== null && dom !== undefined) {
				return dom === target?.titleHeading ? `#${noteAnchor(j)}` : `#${headingAnchor(j, dom)}`;
			}
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

export interface PostOptions {
	outlineDepth: number;
	hideTags: boolean;
}

export function postprocess(app: App, notes: RenderedNote[], options: PostOptions): PostStats {
	const { outlineDepth } = options;
	const stats: PostStats = { deadLinks: 0, rewrittenLinks: 0, unalignedHeadings: 0, unresolvedBlocks: 0, structure: new Map() };
	const pathToIndex = new Map(notes.map((n) => [n.file.path, n.index]));

	for (const note of notes) {
		openCallouts(note.section);
		if (options.hideTags) removeTags(note.section);
		const { cacheToDom, headingEls, titleHeading, titleBlocks } = structureHeadings(app, note, outlineDepth);
		// After the headings, so retagging cannot drop a block id.
		const blocks = placeBlockAnchors(note);
		for (const id of titleBlocks) blocks.add(id);
		// After block anchors, so block markers are removed before TOC cloning.
		const headings = collectTocHeadings(headingEls);
		// After retagging, so only headings that really are bookmarks keep
		// their math visible to Chromium's outline builder.
		pruneAccessibilityTree(note.section);
		stats.structure.set(note.index, { cacheToDom, headings, blocks, titleHeading });
		stats.unalignedHeadings += cacheToDom.filter((d) => d === null).length;
	}
	// Links need every note's heading map, so they are a second pass.
	for (const note of notes) rewriteLinks(app, note, pathToIndex, stats.structure, stats);
	return stats;
}
