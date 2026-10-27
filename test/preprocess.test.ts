import { describe, expect, it } from "vitest";
import { markBlockIds, stripFrontmatter, unfoldCallouts } from "../src/render/preprocess";

describe("unfoldCallouts", () => {
	it("removes fold markers, keeps titles", () => {
		expect(unfoldCallouts("> [!example]- Domain and Range\n> body")).toBe("> [!example] Domain and Range\n> body");
		expect(unfoldCallouts("> [!note]+\n> x")).toBe("> [!note]\n> x");
	});

	it("handles nested callouts", () => {
		expect(unfoldCallouts("> [!theorem]-\n> > [!proof]- P\n> > x")).toBe("> [!theorem]\n> > [!proof] P\n> > x");
	});

	it("leaves open callouts and plain text alone", () => {
		const s = "> [!tip] T\n> x\n\nA - [!x]- not a callout";
		expect(unfoldCallouts(s)).toBe(s);
	});

	it("does not touch callout syntax inside fenced code", () => {
		const s = "```md\n> [!example]- keep me\n```\n> [!example]- change me";
		expect(unfoldCallouts(s)).toBe("```md\n> [!example]- keep me\n```\n> [!example] change me");
	});

	it("does not mistake a tikz fence inside a callout for the end of callout handling", () => {
		const s = "> [!example]- A\n> ```tikz\n> \\draw;\n> ```\n> [!note]- B\n> y";
		expect(unfoldCallouts(s)).toBe("> [!example] A\n> ```tikz\n> \\draw;\n> ```\n> [!note] B\n> y");
	});

	it("respects longer fences and tildes", () => {
		const s = "````\n```\n> [!a]- x\n````\n~~~\n> [!b]- y\n~~~\n> [!c]- z";
		expect(unfoldCallouts(s)).toBe("````\n```\n> [!a]- x\n````\n~~~\n> [!b]- y\n~~~\n> [!c] z");
	});

	it("keeps CRLF line endings", () => {
		expect(unfoldCallouts("> [!a]- t\r\n> x\r\n")).toBe("> [!a] t\r\n> x\r\n");
	});
});

describe("stripFrontmatter", () => {
	it("slices at contentStart", () => {
		expect(stripFrontmatter("---\na: 1\n---\nbody", 13)).toBe("body");
	});
});

describe("markBlockIds", () => {
	const ref = (text: string, id: string) => ({ id, endOffset: text.indexOf(`^${id}`) + id.length + 1 });

	it("replaces the token at the cached offset, after frontmatter", () => {
		const raw = "---\na: 1\n---\n> [!example] E\n> body\n> ^Ex1\n";
		const { text, marked } = markBlockIds(raw, [ref(raw, "Ex1")]);
		expect(text).toBe("---\na: 1\n---\n> [!example] E\n> body\n> BEBLOCK-Ex1-END\n");
		expect(marked).toEqual(["Ex1"]);
		expect(stripFrontmatter(text, 13)).toBe("> [!example] E\n> body\n> BEBLOCK-Ex1-END\n");
	});

	it("replaces several ids regardless of input order", () => {
		const raw = "para ^a\n\n- item ^b-2\n\n>^c\n";
		const { text, marked } = markBlockIds(raw, [ref(raw, "a"), ref(raw, "c"), ref(raw, "b-2")]);
		expect(text).toBe("para BEBLOCK-a-END\n\n- item BEBLOCK-b-2-END\n\n>BEBLOCK-c-END\n");
		expect(marked.sort()).toEqual(["a", "b-2", "c"]);
	});

	it("skips a token that is not where the cache says", () => {
		const raw = "para ^a\n";
		const { text, marked } = markBlockIds(raw, [{ id: "a", endOffset: 3 }, { id: "zz", endOffset: 99 }]);
		expect(text).toBe(raw);
		expect(marked).toEqual([]);
	});

	it("handles nested callouts and CRLF", () => {
		const raw = "> [!theorem]\r\n> > [!proof]\r\n> > text ^p1\r\n";
		expect(markBlockIds(raw, [ref(raw, "p1")]).text).toBe("> [!theorem]\r\n> > [!proof]\r\n> > text BEBLOCK-p1-END\r\n");
	});

	it("leaves the marker intact through unfoldCallouts", () => {
		const raw = "> [!example]- E\n> x\n> ^Ex2\n";
		const { text } = markBlockIds(raw, [ref(raw, "Ex2")]);
		expect(unfoldCallouts(text)).toBe("> [!example] E\n> x\n> BEBLOCK-Ex2-END\n");
	});
});
