import { PluginSettingTab } from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
import type BatchExportPlugin from "./main";
import { tocDepthLabel } from "./settingsModel";

/** Range check for a number control. The returned message is shown below the setting. */
function range(min: number, max: number, allowZero = false): (v: number) => string | void {
	return (v) => {
		if (!Number.isFinite(v) || ((v < min || v > max) && !(allowZero && v === 0))) {
			return allowZero ? `Use 0 or a value from ${min} to ${max}.` : `Use a value from ${min} to ${max}.`;
		}
	};
}

const INTEGER_KEYS = new Set(["scalePercent", "renderTimeoutSec"]);

export class BatchExportSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchExportPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const tocOptions: Record<string, string> = {};
		for (let depth = 0; depth <= 6; depth++) tocOptions[String(depth)] = tocDepthLabel(depth);

		return [
			{
				type: "group",
				heading: "Page",
				items: [
					{
						name: "Page size",
						control: { type: "dropdown", key: "pageSize", options: { A4: "A4", Letter: "Letter", A5: "A5" } },
					},
					...(["top", "right", "bottom", "left"] as const).map((side) => ({
						name: `Margin ${side} (mm)`,
						control: { type: "number" as const, key: `marginsMm.${side}`, min: 0, max: 60, validate: range(0, 60) },
					})),
					{
						name: "Scale (%)",
						desc: "0 uses the downscale percentage of Obsidian's own Export to PDF dialog.",
						control: { type: "number", key: "scalePercent", min: 0, max: 200, step: 1, validate: range(10, 200, true) },
					},
					{
						name: "Base font size (pt)",
						desc: "0 keeps Obsidian's font size, like the built-in export.",
						control: { type: "number", key: "fontSizePt", min: 0, max: 24, validate: range(6, 24, true) },
					},
					{ name: "Start each note on a new page", control: { type: "toggle", key: "pageBreakPerNote" } },
					{ name: "Page numbers in footer", control: { type: "toggle", key: "pageNumbers" } },
				],
			},
			{
				type: "group",
				heading: "Structure",
				items: [
					{
						name: "Outline depth",
						desc: "Deepest heading level in the PDF outline. 1 is the note title, 2 is ##, 3 is ###. Deeper headings still print, they are just not bookmarked.",
						control: { type: "slider", key: "outlineDepth", min: 1, max: 6, step: 1 },
					},
					{
						name: "Default table of contents",
						desc: "How deep the contents page goes. The export dialog can change it for one export, and remembers the choice per folder.",
						control: { type: "dropdown", key: "tocDepth", options: tocOptions },
					},
				],
			},
			{
				type: "group",
				heading: "Behaviour",
				items: [
					{
						name: "Render timeout (seconds)",
						desc: "Longest wait for math, diagrams and embeds before printing anyway.",
						control: { type: "number", key: "renderTimeoutSec", min: 10, max: 1800, step: 1, validate: range(10, 1800) },
					},
					{ name: "Open PDF after export", control: { type: "toggle", key: "openAfterExport" } },
					{ name: "Remember ticks per folder", control: { type: "toggle", key: "rememberTicks" } },
				],
			},
		];
	}

	// Keys are dot paths into the settings (`marginsMm.left`). The TOC
	// dropdown works on strings while the setting is a number.
	getControlValue(key: string): unknown {
		const [head, tail] = key.split(".");
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		const value = tail === undefined ? s[head] : (s[head] as Record<string, unknown>)[tail];
		return key === "tocDepth" ? String(value) : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = value;
		if (key === "tocDepth") v = Number(value);
		else if (INTEGER_KEYS.has(key) && typeof value === "number") v = Math.round(value);
		const [head, tail] = key.split(".");
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		if (tail === undefined) s[head] = v;
		else (s[head] as Record<string, unknown>)[tail] = v;
		await this.plugin.saveSettings();
	}
}
