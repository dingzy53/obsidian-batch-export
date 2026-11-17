import { describe, expect, it } from "vitest";
import { isSameOrder, moveItem, orderNotes } from "../src/collect/order";

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
