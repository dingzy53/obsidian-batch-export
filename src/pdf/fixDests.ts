/**
 * Corrects the positions of Chromium's named destinations.
 *
 * `printToPDF` writes each `/XYZ` destination in unscaled content-box
 * coordinates: it ignores the print `scale` and the page margins (the
 * `/Outlines` entries are right). With scale 0.8 a link to the bottom of a
 * page lands about a fifth of a page too low. This module maps every entry back
 * to page coordinates and appends the corrected `/Dests` dictionary as an
 * incremental update, so nothing else in the file moves.
 *
 * Pure: no `import "obsidian"`. All string work is latin1, so offsets are bytes.
 */

import { Buffer } from "node:buffer";

export interface DestGeometry {
	/** The `scale` passed to `printToPDF`. */
	scale: number;
	marginTopPt: number;
	marginLeftPt: number;
}

export type FixDestsResult = { pdf: Buffer; fixed: number } | { pdf: null; reason: "no-dests" | "unsupported" };

const ENTRY = /(\/[^\s[\]<>()/%]+)\s*\[\s*(\d+) (\d+) R\s*\/XYZ\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+|null)\s*\]/g;

function num(n: number): string {
	return String(Math.round(n * 100) / 100);
}

/** Byte offsets of in-use objects from a single classic xref table. */
function readXref(text: string, at: number): Map<number, number> | null {
	if (!text.startsWith("xref", at)) return null;
	const offsets = new Map<number, number>();
	const sub = /(\d+) (\d+)\s*\n/y;
	const entry = /(\d{10}) (\d{5}) ([nf])\s*\r?\n/y;
	let pos = text.indexOf("\n", at) + 1;
	for (;;) {
		sub.lastIndex = pos;
		const head = sub.exec(text);
		if (!head) break;
		let id = Number(head[1]);
		const count = Number(head[2]);
		pos = sub.lastIndex;
		for (let k = 0; k < count; k++, id++) {
			entry.lastIndex = pos;
			const e = entry.exec(text);
			if (!e) return null;
			if (e[3] === "n") offsets.set(id, Number(e[1]));
			pos = entry.lastIndex;
		}
	}
	return text.startsWith("trailer", pos) ? offsets : null;
}

function objectBody(text: string, offsets: Map<number, number>, id: number): string | null {
	const at = offsets.get(id);
	if (at === undefined || !text.startsWith(`${id} 0 obj`, at)) return null;
	const end = text.indexOf("endobj", at);
	return end < 0 ? null : text.slice(at + `${id} 0 obj`.length, end);
}

export function fixNamedDests(input: Buffer, geometry: DestGeometry): FixDestsResult {
	const text = input.toString("latin1");
	const unsupported = { pdf: null, reason: "unsupported" } as const;

	const tail = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
	if (!tail || text.includes("/ObjStm") || text.includes("/Type /XRef")) return unsupported;
	const xrefAt = Number(tail[1]);
	const offsets = readXref(text, xrefAt);
	if (!offsets) return unsupported;

	const trailerAt = text.indexOf("trailer", xrefAt);
	const trailerEnd = text.indexOf("startxref", trailerAt);
	const trailer = text.slice(trailerAt + "trailer".length, trailerEnd).trim();
	// An already-updated file is left alone, which also makes this idempotent.
	if (!trailer.startsWith("<<") || !trailer.endsWith(">>") || trailer.includes("/Prev")) return unsupported;

	const root = /\/Root (\d+) 0 R/.exec(trailer);
	const catalog = root ? objectBody(text, offsets, Number(root[1])) : null;
	if (!catalog) return unsupported;
	const destsRef = /\/Dests (\d+) 0 R/.exec(catalog);
	if (!destsRef) return { pdf: null, reason: "no-dests" };
	const destsId = Number(destsRef[1]);
	const dests = objectBody(text, offsets, destsId);
	if (!dests) return unsupported;

	const heights = new Map<number, number>();
	const entries: string[] = [];
	for (const m of dests.matchAll(ENTRY)) {
		const [, name, page, gen, left, top, zoom] = m;
		const pageId = Number(page);
		let height = heights.get(pageId);
		if (height === undefined) {
			const box = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(objectBody(text, offsets, pageId) ?? "");
			if (!box) return unsupported;
			height = Number(box[4]) - Number(box[2]);
			heights.set(pageId, height);
		}
		const { scale: s, marginTopPt, marginLeftPt } = geometry;
		const newLeft = marginLeftPt + s * Number(left);
		const newTop = (1 - s) * height - marginTopPt + s * Number(top);
		entries.push(`${name} [${page} ${gen} R /XYZ ${num(newLeft)} ${num(newTop)} ${zoom}]`);
	}
	// Every array in the dictionary must be one we understood.
	if (entries.length === 0 || entries.length !== (dests.match(/\[/g) ?? []).length) return unsupported;

	let out = text.endsWith("\n") ? text : `${text}\n`;
	const objAt = out.length;
	out += `${destsId} 0 obj\n<<${entries.join("\n")}>>\nendobj\n`;
	const newXrefAt = out.length;
	out += `xref\n${destsId} 1\n${String(objAt).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n${trailer.slice(0, -2)}\n/Prev ${xrefAt}>>\nstartxref\n${newXrefAt}\n%%EOF\n`;
	return { pdf: Buffer.from(out, "latin1"), fixed: entries.length };
}
