import * as os from "node:os";
import * as path from "node:path";
import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { collectModel, defaultTicks, type ExportModel } from "./collect/folder";
import { CancelledError, runExport, type ExportRequest, type ExportResult } from "./exporter";
import { BatchExportSettingTab } from "./settings";
import { DEFAULT_SETTINGS, mergeSettings, type BatchExportSettings } from "./settingsModel";
import { Progress } from "./ui/progress";
import { SelectModal, type Selection } from "./ui/SelectModal";
import { SummaryModal } from "./ui/SummaryModal";

export interface ExportFolderOptions {
	/** Absolute output path (must end in .pdf). */
	out: string;
	/** Vault paths to export, in order. `"default"` = every note the index lists. */
	ticked?: string[] | "default";
	/** Vault paths of external notes for the appendix. */
	appendix?: string[];
	/** Index note override; `null` for none. */
	index?: string | null;
	/** TOC depth: 0 = none, 1 = notes, N = notes + headings to level N. Default: the setting. */
	tocDepth?: number;
}

/** Public surface, used by `obsidian eval` for headless testing. */
export interface BatchExportApi {
	exportFolder(folderPath: string, options: ExportFolderOptions): Promise<ExportResult>;
	/** Plain-data view of what the modal would show. */
	inspect(folderPath: string): {
		index: string | null;
		notes: { path: string; title: string; inIndex: boolean }[];
	};
}

interface RemoteDialog {
	showSaveDialog(options: {
		defaultPath?: string;
		filters?: { name: string; extensions: string[] }[];
	}): Promise<{ canceled: boolean; filePath?: string }>;
}

interface ElectronShell {
	openPath(target: string): Promise<string>;
}

export default class BatchExportPlugin extends Plugin {
	settings: BatchExportSettings = { ...DEFAULT_SETTINGS };
	api!: BatchExportApi;
	private busy = false;

	async onload(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
		this.addSettingTab(new BatchExportSettingTab(this.app, this));

		this.api = {
			exportFolder: (folderPath, options) => this.exportFolderHeadless(folderPath, options),
			inspect: (folderPath) => {
				const model = collectModel(this.app, this.requireFolder(folderPath), undefined);
				return { index: model.indexPath, notes: model.notes };
			},
		};

		this.addCommand({
			id: "export-folder-of-active-note",
			name: "Export folder of the active note to PDF",
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				const folder = file?.parent;
				if (!folder || folder.isRoot()) {
					new Notice("Open a note that lives in a folder first.");
					return;
				}
				this.openChecklist(folder);
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder) || file.isRoot()) return;
				menu.addItem((item) =>
					item
						.setTitle("Export folder to PDF…")
						.setIcon("file-output")
						.onClick(() => this.openChecklist(file)),
				);
			}),
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private requireFolder(folderPath: string): TFolder {
		const folder = this.app.vault.getFolderByPath(folderPath);
		if (!folder) throw new Error(`No such folder in the vault: ${folderPath}`);
		return folder;
	}

	// ---- interactive flow ------------------------------------------------

	private openChecklist(folder: TFolder): void {
		if (this.busy) {
			new Notice("An export is already running.");
			return;
		}
		const saved = this.settings.rememberTicks ? this.settings.folderState[folder.path] : undefined;
		const model = collectModel(this.app, folder, saved?.indexPath);
		const modal = new SelectModal(this.app, {
			model,
			ticked: this.initialTicks(model, saved),
			appendix: new Set(saved?.appendix ?? []),
			outPath: this.defaultOutPath(model),
			openAfter: this.settings.openAfterExport,
			tocDepth: saved?.tocDepth ?? this.settings.tocDepth,
			recollect: (indexPath) => collectModel(this.app, folder, indexPath),
			defaultTicks: (m) => new Set(defaultTicks(m)),
			browse: (current) => this.browse(current),
			onSubmit: (selection) => void this.runFromSelection(folder, selection),
			onCancel: () => undefined,
		});
		modal.open();
	}

	private initialTicks(model: ExportModel, saved: { ticked: string[]; known: string[] } | undefined): Set<string> {
		if (!saved) return new Set(defaultTicks(model));
		const ticked = new Set(saved.ticked);
		const known = new Set(saved.known);
		const out = new Set<string>();
		for (const note of model.notes) {
			// A note the modal has never shown gets the default; anything seen
			// before keeps the user's choice.
			if (known.has(note.path) ? ticked.has(note.path) : note.inIndex) out.add(note.path);
		}
		return out;
	}

	private defaultOutPath(model: ExportModel): string {
		const dir = this.settings.lastSaveDir || os.homedir();
		return path.join(dir, `${model.folderName}.pdf`);
	}

	private async browse(current: string): Promise<string | null> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled with Obsidian, not resolvable at build time
			const remote = require("@electron/remote") as { dialog: RemoteDialog };
			const result = await remote.dialog.showSaveDialog({
				defaultPath: current,
				filters: [{ name: "PDF", extensions: ["pdf"] }],
			});
			return result.canceled || !result.filePath ? null : result.filePath;
		} catch (error) {
			console.error("[batch-export] Save dialog unavailable.", error);
			new Notice("Could not open the save dialog. Type the output path instead.");
			return null;
		}
	}

	private async runFromSelection(folder: TFolder, selection: Selection): Promise<void> {
		const model = collectModel(this.app, folder, selection.indexPath);
		this.settings.folderState[folder.path] = {
			ticked: selection.notes,
			known: model.notes.map((n) => n.path),
			appendix: selection.appendix,
			indexPath: selection.indexPath,
			tocDepth: selection.tocDepth,
		};
		this.settings.lastSaveDir = path.dirname(selection.outPath);
		this.settings.openAfterExport = selection.openAfter;
		await this.saveSettings();

		const progress = new Progress(`Exporting ${folder.name}`);
		this.busy = true;
		try {
			const result = await runExport(
				this.app,
				this.settings,
				this.buildRequest(model, selection.notes, selection.appendix, selection.outPath, selection.tocDepth),
				progress,
			);
			progress.close();
			new SummaryModal(this.app, result, (p) => this.openFile(p)).open();
			if (selection.openAfter) this.openFile(result.outPath);
		} catch (error) {
			progress.close();
			if (error instanceof CancelledError) {
				new Notice("Export cancelled.");
			} else {
				console.error("[batch-export] Export failed.", error);
				new Notice(`Export failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
			}
		} finally {
			this.busy = false;
		}
	}

	// ---- headless flow ---------------------------------------------------

	private async exportFolderHeadless(folderPath: string, options: ExportFolderOptions): Promise<ExportResult> {
		if (this.busy) throw new Error("An export is already running.");
		const folder = this.requireFolder(folderPath);
		const model = collectModel(this.app, folder, options.index);
		const notes = options.ticked === undefined || options.ticked === "default" ? defaultTicks(model) : options.ticked;
		this.busy = true;
		try {
			return await runExport(
				this.app,
				this.settings,
				this.buildRequest(model, notes, options.appendix ?? [], options.out, options.tocDepth ?? this.settings.tocDepth),
				{ cancelled: false, set: () => undefined },
			);
		} finally {
			this.busy = false;
		}
	}

	// ---- shared ----------------------------------------------------------

	private buildRequest(model: ExportModel, notes: string[], appendix: string[], outPath: string, tocDepth: number): ExportRequest {
		const resolve = (paths: string[]): { file: TFile; title: string }[] =>
			paths.map((p) => {
				const file = this.app.vault.getFileByPath(p);
				if (!file) throw new Error(`Note not found: ${p}`);
				return { file, title: model.titles.get(p) ?? file.basename };
			});
		// Keep the export order, whatever order the caller listed notes in.
		const order = new Map(model.notes.map((n, i) => [n.path, i]));
		const sorted = [...notes].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
		return {
			title: model.folderName,
			notes: resolve(sorted),
			appendix: resolve(appendix),
			outPath,
			tocDepth,
		};
	}

	private openFile(target: string): void {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- `electron` resolves only inside Obsidian's desktop host
			const electron = require("electron") as { shell?: ElectronShell };
			void electron.shell?.openPath(target);
		} catch (error) {
			console.error("[batch-export] Could not open the PDF.", error);
			new Notice(`PDF saved to ${target}`);
		}
	}
}
