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

interface BrowserWindowLike {
	getBackgroundColor?(): string;
	setBackgroundColor?(color: string): void;
}

/** The Electron window that hosts this renderer, on desktop. */
function currentWindow(): BrowserWindowLike | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled with Obsidian, not resolvable at build time
		const remote = require("@electron/remote") as { getCurrentWindow?: () => BrowserWindowLike };
		const win = remote.getCurrentWindow?.();
		if (win) return win;
	} catch (error) {
		console.error("[batch-export] Could not reach the Electron window.", error);
	}
	// Obsidian's own code uses this window handle for the frame appearance.
	return (window as unknown as { electronWindow?: BrowserWindowLike }).electronWindow ?? null;
}

/**
 * Runs `fn` while the native window background is white.
 *
 * Chromium's `printToPDF` paints the window's base background over the whole
 * page, before margins and `scale` apply. In dark mode that background is
 * `#1C1C1C`, so a transparent `html`/`body` still prints a dark page with
 * black text. CSS cannot reach this color; only the window can. The export
 * container covers the viewport, so the change is invisible on screen.
 */
export async function withLightWindowBackground<T>(fn: () => Promise<T>): Promise<T> {
	const win = currentWindow();
	let previous: string | null = null;
	try {
		previous = win?.getBackgroundColor?.() ?? null;
	} catch (error) {
		console.error("[batch-export] Could not read the window background.", error);
	}
	if (!win || previous === null) return fn();
	try {
		win.setBackgroundColor?.("#ffffff");
	} catch (error) {
		console.error("[batch-export] Could not change the window background.", error);
		return fn();
	}
	try {
		return await fn();
	} finally {
		try {
			win.setBackgroundColor?.(previous);
		} catch (error) {
			console.error("[batch-export] Could not restore the window background.", error);
		}
	}
}

export async function printToPdf(options: PrintOptions): Promise<void> {
	const ipc = getIpc();
	await fsp.rm(options.filepath, { force: true });

	await withLightWindowBackground(
		() =>
			new Promise<void>((resolve, reject) => {
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
			}),
	);

	// The main process answers even when printToPDF threw, so a missing or
	// empty file is the real failure signal.
	const stat = await fsp.stat(options.filepath).catch(() => null);
	if (!stat || stat.size === 0) throw new Error("Obsidian did not produce a PDF (printToPDF failed)");
}
