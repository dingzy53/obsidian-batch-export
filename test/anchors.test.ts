import { describe, expect, it } from "vitest";
import { alignHeadings, BLOCK_MARKER_RE, blockAnchor, blockMarker, headingAnchor, inToc, isOutlineLevel, noteAnchor, tocLineLevel } from "../src/render/anchors";

describe("anchors", () => {
	it("builds ids", () => {
		expect(noteAnchor(3)).toBe("n3");
		expect(headingAnchor(3, 7)).toBe("n3-h7");
		expect(blockAnchor(2, "Example1")).toBe("n2-b-example1");
	});

	it("finds block markers, including ids with hyphens", () => {
		const s = `a ${blockMarker("Ex-1")} b ${blockMarker("x2")}`;
		expect(Array.from(s.matchAll(BLOCK_MARKER_RE), (m) => m[1])).toEqual(["Ex-1", "x2"]);
	});

	it("lists headings on the TOC down to its depth", () => {
		expect([0, 1].map((d) => inToc(2, d))).toEqual([false, false]);
		expect(inToc(1, 2)).toBe(true);
		expect(inToc(3, 3)).toBe(true);
		expect(inToc(4, 3)).toBe(false);
	});

	it("indents TOC lines by heading level", () => {
		expect([1, 2, 4, 6].map((l) => tocLineLevel(l, false))).toEqual([2, 2, 4, 6]);
		expect([1, 2, 4, 6].map((l) => tocLineLevel(l, true))).toEqual([3, 3, 5, 7]);
	});

	it("outline levels", () => {
		expect(isOutlineLevel(3, 3)).toBe(true);
		expect(isOutlineLevel(4, 3)).toBe(false);
	});

	it("aligns identically when levels agree", () => {
		expect(alignHeadings([2, 3, 4], [2, 3, 4])).toEqual([0, 1, 2]);
	});

	it("skips extra rendered headings (e.g. inside callouts) by level", () => {
		// the DOM has an extra h3 (index 1) that the cache does not list
		expect(alignHeadings([2, 4], [2, 3, 4])).toEqual([0, 2]);
	});

	it("maps to null when a cache heading has no rendered counterpart", () => {
		expect(alignHeadings([2, 3, 3], [2, 3])).toEqual([0, 1, null]);
	});

	it("handles empty input", () => {
		expect(alignHeadings([], [])).toEqual([]);
	});
});
