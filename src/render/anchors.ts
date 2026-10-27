/**
 * Id scheme for exported anchors and heading alignment.
 * Pure: no `import "obsidian"`.
 */

export function noteAnchor(noteIndex: number): string {
	return `n${noteIndex}`;
}

export function headingAnchor(noteIndex: number, domIndex: number): string {
	return `n${noteIndex}-h${domIndex}`;
}

/** Block ids are case-insensitive in Obsidian, so the anchor is lowercased. */
export function blockAnchor(noteIndex: number, blockId: string): string {
	return `n${noteIndex}-b-${blockId.toLowerCase()}`;
}

/**
 * Plain-text stand-in for a `^blockid` token. Nothing in it is markdown, math
 * or HTML syntax, so it reaches the DOM as literal text and can be found there.
 */
export function blockMarker(blockId: string): string {
	return `BEBLOCK-${blockId}-END`;
}

export const BLOCK_MARKER_RE = /BEBLOCK-([A-Za-z0-9-]+?)-END/g;

/** Heading elements deeper than the outline depth are demoted to styled divs. */
export function isOutlineLevel(level: number, outlineDepth: number): boolean {
	return level <= outlineDepth;
}

/** Whether a heading of this level is listed on a TOC of the given depth (0 = no TOC, 1 = notes only). */
export function inToc(level: number, tocDepth: number): boolean {
	return tocDepth >= 2 && level <= tocDepth;
}

/** Indent level (`be-toc-l{n}`) of a heading line; note titles are l1 (l2 in the appendix). */
export function tocLineLevel(level: number, appendix: boolean): number {
	return Math.min(6, Math.max(2, level)) + (appendix ? 1 : 0);
}

/**
 * Map each metadata-cache heading to a rendered heading.
 *
 * Both lists are in document order. When the counts agree the mapping is the
 * identity (the usual case). When they differ (for example headings inside a
 * callout that the cache does not list), fall back to matching, in order, the
 * next unused rendered heading of the same level. Unmatched cache headings
 * map to null.
 */
export function alignHeadings(cacheLevels: number[], domLevels: number[]): (number | null)[] {
	if (cacheLevels.length === domLevels.length) {
		let same = true;
		for (let i = 0; i < cacheLevels.length; i++) {
			if (cacheLevels[i] !== domLevels[i]) {
				same = false;
				break;
			}
		}
		if (same) return cacheLevels.map((_, i) => i);
	}
	const result: (number | null)[] = [];
	let cursor = 0;
	for (const level of cacheLevels) {
		let found: number | null = null;
		for (let j = cursor; j < domLevels.length; j++) {
			if (domLevels[j] === level) {
				found = j;
				cursor = j + 1;
				break;
			}
		}
		result.push(found);
	}
	return result;
}
