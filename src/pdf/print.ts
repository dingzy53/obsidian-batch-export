/**
 * Prints the main Obsidian window through the same `print-to-pdf` IPC that
 * Obsidian's own "Export to PDF" uses. The main process forwards the options
 * object to Electron's `webContents.printToPDF` unchanged and writes the
 * result to `filepath`.
 */

import * as fsp from "node:fs/promises";
import type { MarginsMm, PageSize } from "../settingsModel";

export interface PrintOptions {
	/** Absolute path the main process writes the PDF to. */
	filepath: string;
	pageSize: PageSize;
	marginsMm: MarginsMm;
	pageNumbers: boolean;
	/** Content scale factor, as Obsidian's "Downscale percent" / 100. */
	scale: number;
	timeoutMs: number;
}

interface IpcRenderer {
	once(channel: string, listener: () => void): void;
	removeListener(channel: string, listener: () => void): void;
	send(channel: string, ...args: unknown[]): void;
}

const MM_PER_INCH = 25.4;

function getIpc(): IpcRenderer {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- `electron` resolves only inside Obsidian's desktop host
	const electron = require("electron") as { ipcRenderer?: IpcRenderer };
	if (!electron.ipcRenderer) throw new Error("Electron ipcRenderer is unavailable");
	return electron.ipcRenderer;
}

const FOOTER = `<div style="font-size:8px;width:100%;text-align:center;color:#555"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

export async function printToPdf(options: PrintOptions): Promise<void> {
	const ipc = getIpc();
	await fsp.rm(options.filepath, { force: true });

	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			ipc.removeListener("print-to-pdf", onDone);
			reject(new Error(`Printing timed out after ${Math.round(options.timeoutMs / 1000)} s`));
		}, options.timeoutMs);
		const onDone = (): void => {
			window.clearTimeout(timer);
			resolve();
		};
		ipc.once("print-to-pdf", onDone);
		ipc.send("print-to-pdf", {
			filepath: options.filepath,
			pageSize: options.pageSize,
			scale: options.scale,
			printBackground: true,
			// Chromium only emits /Outlines for a tagged PDF (found in the M0 spike).
			generateTaggedPDF: true,
			generateDocumentOutline: true,
			displayHeaderFooter: options.pageNumbers,
			headerTemplate: "<span></span>",
			footerTemplate: FOOTER,
			margins: {
				top: options.marginsMm.top / MM_PER_INCH,
				bottom: options.marginsMm.bottom / MM_PER_INCH,
				left: options.marginsMm.left / MM_PER_INCH,
				right: options.marginsMm.right / MM_PER_INCH,
			},
		});
	});

	// The main process answers even when printToPDF threw, so a missing or
	// empty file is the real failure signal.
	const stat = await fsp.stat(options.filepath).catch(() => null);
	if (!stat || stat.size === 0) throw new Error("Obsidian did not produce a PDF (printToPDF failed)");
}
