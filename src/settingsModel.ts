/**
 * Settings schema, defaults and validation. Pure: no `import "obsidian"`.
 */

export type PageSize = "A4" | "Letter" | "A5";

export interface MarginsMm {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Remembered checklist state for one exported folder. */
export interface FolderState {
	/** Notes that were ticked last time. */
	ticked: string[];
	/** Every note the modal showed last time; anything else is "new". */
	known: string[];
	/** External notes that were ticked for the appendix. */
	appendix: string[];
	/** Index note override chosen in the modal. */
	indexPath: string | null;
	/** TOC depth chosen in the modal last time (see `tocDepth` below). */
	tocDepth?: number;
}

export interface BatchExportSettings {
	/** Schema version, for one-off migrations of stored data. */
	settingsVersion: number;
	pageSize: PageSize;
	marginsMm: MarginsMm;
	/** 0 = keep Obsidian's own font size (what the built-in export does). */
	fontSizePt: number;
	/** 0 = use Obsidian's "Export to PDF" downscale percentage. */
	scalePercent: number;
	/** Deepest heading level (h1 = note title) that appears in the PDF outline. */
	outlineDepth: number;
	/**
	 * Default TOC depth, which the export dialog can override per export:
	 * 0 = no TOC page, 1 = note titles, N = titles + headings down to level N.
	 */
	tocDepth: number;
	pageBreakPerNote: boolean;
	pageNumbers: boolean;
	renderTimeoutSec: number;
	openAfterExport: boolean;
	rememberTicks: boolean;
	lastSaveDir: string;
	folderState: Record<string, FolderState>;
}

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: BatchExportSettings = {
	settingsVersion: SETTINGS_VERSION,
	pageSize: "A4",
	// Electron's printToPDF default (1 cm), which Obsidian's own export uses.
	marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
	fontSizePt: 0,
	scalePercent: 0,
	outlineDepth: 3,
	tocDepth: 3,
	pageBreakPerNote: true,
	pageNumbers: true,
	renderTimeoutSec: 120,
	openAfterExport: true,
	rememberTicks: true,
	lastSaveDir: "",
	folderState: {},
};

const PAGE_SIZES: readonly PageSize[] = ["A4", "Letter", "A5"];

function num(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** A whole number from 0 to 6, else `fallback`. */
function tocDepthOr<T extends number | undefined>(value: unknown, fallback: T): number | T {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6 ? value : fallback;
}

/** Label for a TOC depth, shared by the settings tab and the export dialog. */
export function tocDepthLabel(depth: number): string {
	if (depth <= 0) return "None";
	if (depth === 1) return "Notes only";
	return `Notes and headings to ${"#".repeat(depth)}`;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function mergeFolderState(raw: unknown): Record<string, FolderState> {
	const out: Record<string, FolderState> = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const v = value as Record<string, unknown>;
		out[key] = {
			ticked: strings(v.ticked),
			known: strings(v.known),
			appendix: strings(v.appendix),
			indexPath: typeof v.indexPath === "string" ? v.indexPath : null,
			tocDepth: tocDepthOr(v.tocDepth, undefined),
		};
	}
	return out;
}

/** Version-1 defaults, written to data.json by the first build. */
const V1_MARGINS = { top: 15, right: 15, bottom: 18, left: 15 };
const V1_FONT_PT = 11;

/**
 * Stepwise migration of stored data, oldest step first.
 *
 * Version 1 stored its page defaults even when the user never touched them.
 * Those untouched values are dropped so the new, built-in-export-like
 * defaults apply; anything the user actually changed is kept.
 *
 * Version 2 stored `tocDepth: 1`, then the default. The default is now 3, so
 * an untouched 1 is dropped; a deliberate 0 or 2 is kept.
 */
function migrate(r: Record<string, unknown>): Record<string, unknown> {
	const version = typeof r.settingsVersion === "number" ? r.settingsVersion : 1;
	const out = { ...r };
	if (version < 2) {
		const m = r.marginsMm as Record<string, unknown> | undefined;
		if (m && m.top === V1_MARGINS.top && m.right === V1_MARGINS.right && m.bottom === V1_MARGINS.bottom && m.left === V1_MARGINS.left) {
			delete out.marginsMm;
		}
		if (r.fontSizePt === V1_FONT_PT) delete out.fontSizePt;
	}
	if (version < 3 && r.tocDepth === 1) delete out.tocDepth;
	return out;
}

/** Font size: 0 (inherit) or a clamped point size. */
function fontSize(value: unknown, fallback: number): number {
	if (value === 0) return 0;
	return num(value, fallback, 6, 24);
}

/** Scale: 0 (follow Obsidian) or a clamped percentage. */
function scale(value: unknown, fallback: number): number {
	if (value === 0) return 0;
	return Math.round(num(value, fallback, 10, 200));
}

/** Fold untrusted persisted data over the defaults, clamping every field. */
export function mergeSettings(raw: unknown): BatchExportSettings {
	const r = migrate((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>);
	const m = (r.marginsMm && typeof r.marginsMm === "object" ? r.marginsMm : {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;
	return {
		settingsVersion: SETTINGS_VERSION,
		pageSize: PAGE_SIZES.includes(r.pageSize as PageSize) ? (r.pageSize as PageSize) : d.pageSize,
		marginsMm: {
			top: num(m.top, d.marginsMm.top, 0, 60),
			right: num(m.right, d.marginsMm.right, 0, 60),
			bottom: num(m.bottom, d.marginsMm.bottom, 0, 60),
			left: num(m.left, d.marginsMm.left, 0, 60),
		},
		fontSizePt: fontSize(r.fontSizePt, d.fontSizePt),
		scalePercent: scale(r.scalePercent, d.scalePercent),
		outlineDepth: Math.round(num(r.outlineDepth, d.outlineDepth, 1, 6)),
		tocDepth: tocDepthOr(r.tocDepth, d.tocDepth),
		pageBreakPerNote: bool(r.pageBreakPerNote, d.pageBreakPerNote),
		pageNumbers: bool(r.pageNumbers, d.pageNumbers),
		renderTimeoutSec: Math.round(num(r.renderTimeoutSec, d.renderTimeoutSec, 10, 1800)),
		openAfterExport: bool(r.openAfterExport, d.openAfterExport),
		rememberTicks: bool(r.rememberTicks, d.rememberTicks),
		lastSaveDir: typeof r.lastSaveDir === "string" ? r.lastSaveDir : d.lastSaveDir,
		folderState: mergeFolderState(r.folderState),
	};
}

/**
 * Print scale as a factor. `obsidianPercent` is Obsidian's own "Export to
 * PDF" downscale setting, used when ours is 0 (follow Obsidian).
 */
export function resolveScale(scalePercent: number, obsidianPercent: unknown): number {
	const percent = scalePercent > 0 ? scalePercent : typeof obsidianPercent === "number" && Number.isFinite(obsidianPercent) ? obsidianPercent : 100;
	return Math.min(2, Math.max(0.1, percent / 100));
}
