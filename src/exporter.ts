/**
 * The export pipeline: render -> settle -> post-process -> print twice (so the
 * TOC can show page numbers) -> report. Never writes into the vault; scratch
 * files live in the OS temp directory.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Component } from "obsidian";
import type { App, TFile } from "obsidian";
import { createPrintContainer } from "./render/container";
import { postprocess } from "./render/postprocess";
import { renderNotes, type NoteToRender } from "./render/renderNotes";
import { settle } from "./render/settle";
import { buildToc, currentNumbers, fillPageNumbers } from "./render/toc";
import { fixNamedDests, type DestGeometry } from "./pdf/fixDests";
import { readPdfPages } from "./pdf/pages";
import { printToPdf } from "./pdf/print";
import { resolveScale, type BatchExportSettings } from "./settingsModel";

export interface ExportRequest {
	title: string;
	/** Main notes first, in order. */
	notes: { file: TFile; title: string }[];
	/** External notes for the appendix, in order. */
	appendix: { file: TFile; title: string }[];
	outPath: string;
	/** 0 = no TOC, 1 = note titles, N = titles + headings down to level N. */
	tocDepth: number;
}

export interface ExportResult {
	outPath: string;
	notes: number;
	appendix: number;
	pages: number;
	tikzErrors: { title: string; count: number }[];
	embedsPending: number;
	tikzPending: number;
	timedOut: boolean;
	tikzApiMissing: boolean;
	deadLinks: number;
	unalignedHeadings: number;
	unresolvedBlocks: number;
	/** The named destinations could not be corrected (see `pdf/fixDests.ts`). */
	destsUnfixed: boolean;
	tocUnstable: boolean;
}

export interface Reporter {
	cancelled: boolean;
	set(text: string): void;
}

export class CancelledError extends Error {
	constructor() {
		super("Export cancelled");
	}
}

const MAX_PRINT_PASSES = 3;
const PT_PER_MM = 72 / 25.4;

/** Corrects the named destinations in place. False when the file could not be patched. */
async function correctDestinations(file: string, geometry: DestGeometry): Promise<boolean> {
	try {
		const result = fixNamedDests(await fsp.readFile(file), geometry);
		if (result.pdf) await fsp.writeFile(file, result.pdf);
		return result.pdf !== null || result.reason === "no-dests";
	} catch (error) {
		console.error("[batch-export] Could not correct link targets.", error);
		return false;
	}
}

export async function runExport(
	app: App,
	settings: BatchExportSettings,
	request: ExportRequest,
	reporter: Reporter,
): Promise<ExportResult> {
	const component = new Component();
	component.load();
	const obsidianPdf = (app.vault as unknown as { getConfig(key: string): unknown }).getConfig("pdfExportSettings") as
		| { downscalePercent?: unknown }
		| undefined;
	const scale = resolveScale(settings.scalePercent, obsidianPdf?.downscalePercent);
	const container = createPrintContainer(settings, scale);
	const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "batch-export-"));
	await fsp.mkdir(path.dirname(request.outPath), { recursive: true });
	const previousTitle = document.title;
	document.body.addClass("batch-export-printing");
	const check = (): void => {
		if (reporter.cancelled) throw new CancelledError();
	};

	try {
		const toRender: NoteToRender[] = [
			...request.notes.map((n) => ({ ...n, appendix: false })),
			...request.appendix.map((n) => ({ ...n, appendix: true })),
		];

		reporter.set("Rendering notes…");
		const rendered = await renderNotes(
			app,
			container.root,
			component,
			toRender,
			(done, total, title) => reporter.set(`Rendering ${done + 1}/${total}: ${title}`),
			() => reporter.cancelled,
		);
		check();

		reporter.set("Waiting for math, diagrams and embeds…");
		const settled = await settle(app, container.root, settings.renderTimeoutSec * 1000, () => reporter.cancelled);
		check();

		reporter.set("Preparing outline and links…");
		const stats = postprocess(app, rendered, settings.outlineDepth);
		const toc = buildToc(container.root, rendered, stats.structure, request.tocDepth);

		const tikzErrors = rendered
			.map((n) => ({ title: n.title, count: n.section.querySelectorAll(".tikz-error").length }))
			.filter((e) => e.count > 0);

		// Chromium takes the PDF /Title from the page title.
		document.title = request.title;

		const printBase = {
			pageSize: settings.pageSize,
			marginsMm: settings.marginsMm,
			pageNumbers: settings.pageNumbers,
			scale,
			timeoutMs: settings.renderTimeoutSec * 1000,
		};
		let pages = 0;
		let stable = true;
		const tmpPdf = path.join(scratch, "pass.pdf");
		const finalTmp = `${request.outPath}.part`;

		if (toc) {
			stable = false;
			for (let pass = 1; pass <= MAX_PRINT_PASSES; pass++) {
				check();
				reporter.set(`Printing (pass ${pass}/${MAX_PRINT_PASSES})…`);
				await printToPdf({
					filepath: tmpPdf,
					...printBase,
				});
				const found = await readPdfPages(tmpPdf);
				pages = found.pageCount;
				const before = currentNumbers(toc);
				fillPageNumbers(toc, found.pageOf);
				const after = currentNumbers(toc);
				stable = [...after].every(([id, text]) => before.get(id) === text);
				if (stable) {
					// The numbers printed in this pass already match reality.
					await fsp.copyFile(tmpPdf, finalTmp);
					break;
				}
			}
			if (!stable) {
				// Best effort: ship the last pass with the freshest numbers.
				reporter.set("Printing final copy…");
				await printToPdf({
					filepath: finalTmp,
					...printBase,
				});
			}
		} else {
			reporter.set("Printing…");
			await printToPdf({
				filepath: finalTmp,
				...printBase,
			});
			pages = (await readPdfPages(finalTmp)).pageCount;
		}

		reporter.set("Correcting link targets…");
		const destsFixed = await correctDestinations(finalTmp, {
			scale,
			marginTopPt: settings.marginsMm.top * PT_PER_MM,
			marginLeftPt: settings.marginsMm.left * PT_PER_MM,
		});
		await fsp.rename(finalTmp, request.outPath);

		return {
			outPath: request.outPath,
			notes: request.notes.length,
			appendix: request.appendix.length,
			pages,
			tikzErrors,
			embedsPending: settled.embedsPending,
			tikzPending: settled.tikzPending,
			timedOut: settled.timedOut,
			tikzApiMissing: settled.tikzApiMissing,
			deadLinks: stats.deadLinks,
			unalignedHeadings: stats.unalignedHeadings,
			unresolvedBlocks: stats.unresolvedBlocks,
			destsUnfixed: !destsFixed,
			tocUnstable: toc !== null && !stable,
		};
	} finally {
		document.title = previousTitle;
		document.body.removeClass("batch-export-printing");
		container.dispose();
		component.unload();
		await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		await fsp.rm(`${request.outPath}.part`, { force: true }).catch(() => undefined);
	}
}
