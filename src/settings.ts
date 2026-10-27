import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type BatchExportPlugin from "./main";
import { tocDepthLabel, type PageSize } from "./settingsModel";

export class BatchExportSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchExportPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = (): void => void this.plugin.saveSettings();

		new Setting(containerEl).setName("Page").setHeading();

		new Setting(containerEl).setName("Page size").addDropdown((dd) =>
			dd
				.addOptions({ A4: "A4", Letter: "Letter", A5: "A5" })
				.setValue(s.pageSize)
				.onChange((v) => {
					s.pageSize = v as PageSize;
					save();
				}),
		);

		for (const side of ["top", "right", "bottom", "left"] as const) {
			new Setting(containerEl).setName(`Margin ${side} (mm)`).addText((t) =>
				t.setValue(String(s.marginsMm[side])).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0 && n <= 60) {
						s.marginsMm[side] = n;
						save();
					}
				}),
			);
		}

		new Setting(containerEl)
			.setName("Scale (%)")
			.setDesc("0 uses the downscale percentage of Obsidian's own Export to PDF dialog.")
			.addText((t) =>
				t.setValue(String(s.scalePercent)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && (n === 0 || (n >= 10 && n <= 200))) {
						s.scalePercent = Math.round(n);
						save();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Base font size (pt)")
			.setDesc("0 keeps Obsidian's font size, like the built-in export.")
			.addText((t) =>
				t.setValue(String(s.fontSizePt)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && (n === 0 || (n >= 6 && n <= 24))) {
						s.fontSizePt = n;
						save();
					}
				}),
			);

		new Setting(containerEl).setName("Start each note on a new page").addToggle((t) =>
			t.setValue(s.pageBreakPerNote).onChange((v) => {
				s.pageBreakPerNote = v;
				save();
			}),
		);

		new Setting(containerEl).setName("Page numbers in footer").addToggle((t) =>
			t.setValue(s.pageNumbers).onChange((v) => {
				s.pageNumbers = v;
				save();
			}),
		);

		new Setting(containerEl).setName("Structure").setHeading();

		new Setting(containerEl)
			.setName("Outline depth")
			.setDesc("Deepest heading level in the PDF outline. 1 is the note title, 2 is ##, 3 is ###. Deeper headings still print, they are just not bookmarked.")
			.addSlider((sl) =>
				sl
					.setLimits(1, 6, 1)
					.setValue(s.outlineDepth)
					.setDynamicTooltip()
					.onChange((v) => {
						s.outlineDepth = v;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Default table of contents")
			.setDesc("How deep the contents page goes. The export dialog can change it for one export, and remembers the choice per folder.")
			.addDropdown((dd) => {
				for (let depth = 0; depth <= 6; depth++) dd.addOption(String(depth), tocDepthLabel(depth));
				dd.setValue(String(s.tocDepth)).onChange((v) => {
					s.tocDepth = Number(v);
					save();
				});
			});

		new Setting(containerEl).setName("Behaviour").setHeading();

		new Setting(containerEl)
			.setName("Render timeout (seconds)")
			.setDesc("Longest wait for math, diagrams and embeds before printing anyway.")
			.addText((t) =>
				t.setValue(String(s.renderTimeoutSec)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 10 && n <= 1800) {
						s.renderTimeoutSec = Math.round(n);
						save();
					}
				}),
			);

		new Setting(containerEl).setName("Open PDF after export").addToggle((t) =>
			t.setValue(s.openAfterExport).onChange((v) => {
				s.openAfterExport = v;
				save();
			}),
		);

		new Setting(containerEl)
			.setName("Remember ticks per folder")
			.addToggle((t) =>
				t.setValue(s.rememberTicks).onChange((v) => {
					s.rememberTicks = v;
					save();
				}),
			);
	}
}
