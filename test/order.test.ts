import { describe, expect, it } from "vitest";
import { orderNotes } from "../src/collect/order";

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
