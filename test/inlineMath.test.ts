import { describe, expect, it } from "vitest";
import { hasInlineMath, splitInlineMath } from "../src/render/inlineMath";

const t = (text: string) => ({ math: false, text });
const m = (tex: string) => ({ math: true, tex });

describe("splitInlineMath", () => {
	it("finds math in link text", () => {
		expect(splitInlineMath("$\\chi^{2}$")).toEqual([m("\\chi^{2}")]);
		expect(splitInlineMath("why $n-1$")).toEqual([t("why "), m("n-1")]);
		expect(splitInlineMath("$t$ interval")).toEqual([m("t"), t(" interval")]);
		expect(splitInlineMath("a $x$ and $y$")).toEqual([t("a "), m("x"), t(" and "), m("y")]);
	});

	it("leaves dollar amounts and spaced dollars as text", () => {
		expect(splitInlineMath("costs $5 and $6")).toEqual([t("costs $5 and $6")]);
		expect(splitInlineMath("$ x$")).toEqual([t("$ x$")]);
		expect(splitInlineMath("$x $")).toEqual([t("$x $")]);
		expect(splitInlineMath("only $one")).toEqual([t("only $one")]);
	});

	it("treats \\$ as a literal dollar", () => {
		expect(splitInlineMath("\\$x\\$")).toEqual([t("$x$")]);
		expect(splitInlineMath("$a\\$b$")).toEqual([m("a\\$b")]);
	});

	it("leaves display math alone", () => {
		expect(splitInlineMath("$$x$$")).toEqual([t("$$x$$")]);
		expect(splitInlineMath("$x$$")).toEqual([t("$x$$")]);
	});

	it("returns nothing for empty text", () => {
		expect(splitInlineMath("")).toEqual([]);
	});
});

describe("hasInlineMath", () => {
	it("is a cheap yes/no", () => {
		expect(hasInlineMath("plain")).toBe(false);
		expect(hasInlineMath("costs $5")).toBe(false);
		expect(hasInlineMath("why $n-1$")).toBe(true);
	});
});
