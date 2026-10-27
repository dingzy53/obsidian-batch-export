/**
 * Reads page numbers back out of a printed PDF with Obsidian's bundled pdf.js.
 * Chromium writes one named destination per element `id`, so the TOC can look
 * up the page of any anchor it links to.
 */

import * as fsp from "node:fs/promises";
import { loadPdfJs } from "obsidian";

export interface PdfPages {
	pageCount: number;
	/** Anchor id -> 1-based page number. */
	pageOf: Map<string, number>;
}

interface PdfDoc {
	numPages: number;
	getDestinations(): Promise<Record<string, unknown[]>>;
	getPageIndex(ref: unknown): Promise<number>;
	destroy(): Promise<void>;
}

interface PdfJs {
	getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> };
}

export async function readPdfPages(pdfPath: string): Promise<PdfPages> {
	const pdfjs = (await loadPdfJs()) as PdfJs;
	const data = new Uint8Array(await fsp.readFile(pdfPath));
	const doc = await pdfjs.getDocument({ data }).promise;
	try {
		const pageOf = new Map<string, number>();
		const dests = await doc.getDestinations();
		for (const [name, dest] of Object.entries(dests)) {
			if (!Array.isArray(dest) || dest.length === 0) continue;
			try {
				pageOf.set(name, (await doc.getPageIndex(dest[0])) + 1);
			} catch {
				// A destination that does not resolve to a page is simply skipped.
			}
		}
		return { pageCount: doc.numPages, pageOf };
	} finally {
		await doc.destroy().catch(() => undefined);
	}
}
