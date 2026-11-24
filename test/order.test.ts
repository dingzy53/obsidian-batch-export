import { describe, expect, it } from "vitest";
import { applySavedOrder, isSameOrder, moveItem, orderNotes, pickDefaultIndexPath } from "../src/collect/order";

describe("orderNotes", () => {
	const files = ["C/Index.md", "C/B.md", "C/A.md", "C/Exercise/Ex 10.md", "C/Exercise/Ex 2.md", "C/Z.md"];

	it("follows index order, drops the index, appends the rest naturally sorted", () => {
		const out = orderNotes({
			folderFiles: files,
			indexPath: "C/Index.md",
			indexLinkTargets: ["C/Z.md", "C/Exercise/Ex 2.md", "Other/Outside.md", "C/Z.md"],
		});
		expect(out.map((e) => e.path)).toEqual([
			"C/Z.md",
			"C/Exercise/Ex 2.md",
			"C/A.md",
			"C/B.md",
			"C/Exercise/Ex 10.md",
		]);
		expect(out.map((e) => e.inIndex)).toEqual([true, true, false, false, false]);
	});

	it("does not flag notes when there is no index", () => {
		const out = orderNotes({ folderFiles: ["x/b.md", "x/a.md"], indexPath: null, indexLinkTargets: [] });
		expect(out).toEqual([
			{ path: "x/a.md", inIndex: true },
			{ path: "x/b.md", inIndex: true },
		]);
	});

	it("ignores a link from the index to itself", () => {
		const out = orderNotes({ folderFiles: ["i.md", "a.md"], indexPath: "i.md", indexLinkTargets: ["i.md", "a.md"] });
		expect(out.map((e) => e.path)).toEqual(["a.md"]);
	});
});

describe("moveItem", () => {
	const items = ["a", "b", "c", "d"] as const;

	it("moves an item down and up", () => {
		expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
		expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
	});

	it("leaves the input untouched", () => {
		const input = [...items];
		moveItem(input, 0, 3);
		expect(input).toEqual(["a", "b", "c", "d"]);
	});

	it("clamps out-of-range indices", () => {
		expect(moveItem(items, -5, 1)).toEqual(["b", "a", "c", "d"]);
		expect(moveItem(items, 1, 99)).toEqual(["a", "c", "d", "b"]);
	});

	it("is a no-op for the same or an empty index", () => {
		expect(moveItem(items, 2, 2)).toEqual([...items]);
		expect(moveItem([], 0, 1)).toEqual([]);
	});
});

describe("isSameOrder", () => {
	it("compares length and element order", () => {
		expect(isSameOrder(["a", "b"], ["a", "b"])).toBe(true);
		expect(isSameOrder(["a", "b"], ["b", "a"])).toBe(false);
		expect(isSameOrder(["a"], ["a", "b"])).toBe(false);
		expect(isSameOrder([], [])).toBe(true);
	});
});

describe("applySavedOrder", () => {
	const notes = [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }];

	it("preserves saved order when paths match", () => {
		expect(applySavedOrder(notes, ["c.md", "a.md", "b.md"]).map((n) => n.path)).toEqual(["c.md", "a.md", "b.md"]);
	});

	it("drops missing paths and appends new notes in existing order", () => {
		expect(applySavedOrder(notes, ["c.md", "gone.md"]).map((n) => n.path)).toEqual(["c.md", "a.md", "b.md"]);
	});

	it("deduplicates repeated paths in savedOrder", () => {
		expect(applySavedOrder(notes, ["b.md", "b.md", "a.md"]).map((n) => n.path)).toEqual(["b.md", "a.md", "c.md"]);
	});

	it("returns a fresh copy unchanged when savedOrder is undefined or empty", () => {
		const fromUndefined = applySavedOrder(notes, undefined);
		const fromEmpty = applySavedOrder(notes, []);
		expect(fromUndefined).toEqual(notes);
		expect(fromEmpty).toEqual(notes);
		expect(fromUndefined).not.toBe(notes);
	});
});

describe("pickDefaultIndexPath", () => {
	it("prefers type: index and index-named notes over folder-named notes", () => {
		expect(
			pickDefaultIndexPath("Book", [
				{ path: "Book/Book.md", basename: "Book", isIndexType: false, linksToSibling: true },
				{ path: "Book/Outline.md", basename: "Outline", isIndexType: true, linksToSibling: false },
			]),
		).toBe("Book/Outline.md");
		expect(
			pickDefaultIndexPath("Book", [
				{ path: "Book/Book.md", basename: "Book", isIndexType: false, linksToSibling: true },
				{ path: "Book/00 Index.md", basename: "00 Index", isIndexType: false, linksToSibling: false },
			]),
		).toBe("Book/00 Index.md");
	});

	it("auto-picks a same-named folder note only when it links to a sibling", () => {
		expect(
			pickDefaultIndexPath("Book", [
				{ path: "Book/Book.md", basename: "Book", isIndexType: false, linksToSibling: true },
				{ path: "Book/Ch1.md", basename: "Ch1", isIndexType: false, linksToSibling: false },
			]),
		).toBe("Book/Book.md");
		expect(
			pickDefaultIndexPath("Math", [
				{ path: "Math/Math.md", basename: "Math", isIndexType: false, linksToSibling: false },
				{ path: "Math/Algebra.md", basename: "Algebra", isIndexType: false, linksToSibling: false },
			]),
		).toBeNull();
	});
});
