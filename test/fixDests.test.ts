import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { fixNamedDests } from "../src/pdf/fixDests";

/** A minimal PDF with a classic xref table, laid out like Chromium's output. */
function buildPdf(dests: string | null): Buffer {
	const objects = [
		`<</Type /Catalog\n/Pages 2 0 R${dests === null ? "" : "\n/Dests 4 0 R"}>>`,
		"<</Type /Pages\n/Count 1\n/Kids [3 0 R]>>",
		"<</Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 600 800]>>",
		dests ?? "<<>>",
	];
	let text = "%PDF-1.7\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(text.length);
		text += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefAt = text.length;
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const at of offsets) text += `${String(at).padStart(10, "0")} 00000 n \n`;
	text += `trailer\n<</Size ${objects.length + 1}\n/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
	return Buffer.from(text, "latin1");
}

const geometry = { scale: 0.8, marginTopPt: 30, marginLeftPt: 20 };

describe("fixNamedDests", () => {
	it("maps unscaled content-box coordinates to page coordinates", () => {
		const input = buildPdf("<</n0 [3 0 R /XYZ 10 700 0]\n/n0-b-x [3 0 R /XYZ 0 800 0]>>");
		const result = fixNamedDests(input, geometry);
		expect(result.pdf).not.toBeNull();
		if (!result.pdf) return;
		expect(result.fixed).toBe(2);
		const text = result.pdf.toString("latin1");
		// The original bytes stay in place; the update is appended.
		expect(text.startsWith(input.toString("latin1"))).toBe(true);
		// top: (1 - 0.8) * 800 - 30 + 0.8 * 700 = 690; left: 20 + 0.8 * 10 = 28
		expect(text).toContain("/n0 [3 0 R /XYZ 28 690 0]");
		// Content-box top (800 = 0 from the top) lands on the top margin.
		expect(text).toContain("/n0-b-x [3 0 R /XYZ 20 770 0]");
		expect(text).toMatch(/trailer\n<<\/Size 5\n\/Root 1 0 R\n\/Prev \d+>>\nstartxref\n\d+\n%%EOF\n$/);
	});

	it("writes an xref entry that points at the new object", () => {
		const result = fixNamedDests(buildPdf("<</n0 [3 0 R /XYZ 10 700 0]>>"), geometry);
		if (!result.pdf) throw new Error("not patched");
		const text = result.pdf.toString("latin1");
		const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
		const entry = new RegExp(`^xref\\n4 1\\n(\\d{10}) 00000 n \\n`).exec(text.slice(startxref));
		expect(entry).not.toBeNull();
		expect(text.startsWith("4 0 obj\n<</n0 [3 0 R /XYZ 28 690 0]>>", Number(entry?.[1]))).toBe(true);
	});

	it("reports a PDF without named destinations", () => {
		expect(fixNamedDests(buildPdf(null), geometry)).toEqual({ pdf: null, reason: "no-dests" });
	});

	it("refuses entries it does not understand, and already-updated files", () => {
		expect(fixNamedDests(buildPdf("<</n0 [3 0 R /Fit]>>"), geometry).pdf).toBeNull();
		const once = fixNamedDests(buildPdf("<</n0 [3 0 R /XYZ 10 700 0]>>"), geometry);
		if (!once.pdf) throw new Error("not patched");
		expect(fixNamedDests(once.pdf, geometry)).toEqual({ pdf: null, reason: "unsupported" });
	});
});
