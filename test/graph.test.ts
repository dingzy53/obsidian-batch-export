import { describe, expect, it } from "vitest";
import { buildGraph, danglingTargets, externalRefs, incomingLinks, unresolvedRefs, type RawEdge } from "../src/collect/graph";

const e = (kind: RawEdge["kind"], raw: string, targetPath: string | null, subpath = ""): RawEdge => ({
	kind,
	raw,
	targetPath,
	subpath,
});

const folder = new Set(["f/A.md", "f/B.md", "f/C.md"]);
const graph = buildGraph(
	[
		{ path: "f/A.md", edges: [e("link", "B", "f/B.md"), e("link", "Vec", "x/Vec.md"), e("link", "rot", null), e("frontmatter", "C", "f/C.md")] },
		{ path: "f/B.md", edges: [e("embed", "Ex#Answer", "x/Ex.md", "#Answer"), e("link", "Vec", "x/Vec.md")] },
		{ path: "f/C.md", edges: [e("link", "A", "f/A.md")] },
	],
	folder,
);

describe("graph", () => {
	it("classifies edges", () => {
		expect(graph.edges.get("f/A.md")?.map((x) => x.category)).toEqual(["in-folder", "external", "unresolved", "in-folder"]);
	});

	it("flags unticked targets of ticked notes, ignoring frontmatter", () => {
		const d = danglingTargets(graph, new Set(["f/A.md"]));
		expect([...d.keys()]).toEqual(["f/B.md"]);
		expect(d.get("f/B.md")).toEqual(["f/A.md"]);
	});

	it("is empty when every linked note is ticked", () => {
		expect(danglingTargets(graph, new Set(["f/A.md", "f/B.md"])).size).toBe(0);
	});

	it("collects external refs only from ticked notes", () => {
		const refs = externalRefs(graph, new Set(["f/A.md", "f/B.md"]));
		expect(refs.get("x/Vec.md")?.sources).toEqual(["f/A.md", "f/B.md"]);
		expect(refs.get("x/Ex.md")?.embeddedOnly).toBe(true);
		expect(refs.get("x/Vec.md")?.embeddedOnly).toBe(false);
		expect(externalRefs(graph, new Set(["f/C.md"])).size).toBe(0);
	});

	it("lists unresolved links", () => {
		expect([...unresolvedRefs(graph, new Set(["f/A.md"])).keys()]).toEqual(["rot"]);
	});

	it("counts incoming links from ticked notes, including to ticked targets", () => {
		const inc = incomingLinks(graph, new Set(["f/A.md", "f/B.md", "f/C.md"]));
		expect(inc.get("f/B.md")).toEqual(["f/A.md"]);
		expect(inc.get("f/A.md")).toEqual(["f/C.md"]);
		// frontmatter-only reference A -> C does not count
		expect(inc.get("f/C.md")).toBeUndefined();
	});
});
