/**
 * Markdown text transforms applied to an in-memory copy of a note.
 * Pure: no `import "obsidian"`. The vault file is never touched.
 */

import { blockMarker } from "./anchors";

const FENCE = /^(`{3,}|~{3,})/;
const CALLOUT_FOLD = /^((?:\s*>)+\s*\[![^\]]+\])[+-](?=\s|$)/;

/** Drop the leading `>` quote markers so a fence inside a callout is recognised. */
function stripQuote(line: string): string {
	return line.replace(/^(?:\s*>)*\s*/, "");
}

/**
 * Rewrite `[!type]-` / `[!type]+` to `[!type]` so every callout renders open.
 * Callout headers inside fenced code blocks are left alone.
 */
export function unfoldCallouts(markdown: string): string {
	const lines = markdown.split("\n");
	let fence: { char: string; length: number } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const body = stripQuote(lines[i].replace(/\r$/, ""));
		const match = FENCE.exec(body);
		if (fence) {
			if (match && match[1][0] === fence.char && match[1].length >= fence.length && body.slice(match[1].length).trim() === "") {
				fence = null;
			}
			continue;
		}
		if (match) {
			fence = { char: match[1][0], length: match[1].length };
			continue;
		}
		lines[i] = lines[i].replace(CALLOUT_FOLD, "$1");
	}
	return lines.join("\n");
}

/** Body of a note without its frontmatter, given Obsidian's `contentStart`. */
export function stripFrontmatter(markdown: string, contentStart: number): string {
	return markdown.slice(contentStart);
}

/** A `^blockid` from the metadata cache: its id and the offset just past the token. */
export interface BlockRef {
	id: string;
	endOffset: number;
}

/**
 * Replace each cached `^blockid` token with a text marker so the rendered
 * block can be found in the DOM. Obsidian already decided which tokens are
 * block ids when it built the cache, so only those exact offsets are touched.
 * A token that is not where the cache says (stale cache) is skipped.
 */
export function markBlockIds(markdown: string, blocks: BlockRef[]): { text: string; marked: string[] } {
	let text = markdown;
	const marked: string[] = [];
	const sorted = [...blocks].sort((a, b) => b.endOffset - a.endOffset);
	for (const { id, endOffset } of sorted) {
		const start = endOffset - 1 - id.length;
		if (start < 0 || text.slice(start, endOffset) !== `^${id}`) continue;
		text = text.slice(0, start) + blockMarker(id) + text.slice(endOffset);
		marked.push(id);
	}
	return { text, marked };
}
