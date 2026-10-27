import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { ExportResult } from "../exporter";

export class SummaryModal extends Modal {
	constructor(
		app: App,
		private readonly result: ExportResult,
		private readonly openFile: (path: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const r = this.result;
		this.setTitle("Export finished");
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: `${r.notes} notes${r.appendix ? ` + ${r.appendix} appendix` : ""}, ${r.pages} pages.`,
		});
		contentEl.createEl("p", { cls: "be-path", text: r.outPath });

		const issues: string[] = [];
		for (const e of r.tikzErrors) issues.push(`TikZ error in “${e.title}” (${e.count})`);
		if (r.embedsPending > 0) issues.push(`${r.embedsPending} embed(s) did not finish loading`);
		if (r.tikzPending > 0) issues.push(`${r.tikzPending} diagram(s) were still compiling at the timeout`);
		if (r.timedOut) issues.push("The render timeout was reached; some content may be missing");
		if (r.tikzApiMissing) issues.push("TikZ diagrams may use dark colours: update the tikz plugin to 1.2.0 or later");
		if (r.unalignedHeadings > 0) issues.push(`${r.unalignedHeadings} heading link(s) fall back to the start of their note`);
		if (r.unresolvedBlocks > 0) issues.push(`${r.unresolvedBlocks} block link(s) fall back to the start of their note`);
		if (r.destsUnfixed) issues.push("Link targets could not be corrected; links may land below their target");
		if (r.deadLinks > 0) issues.push(`${r.deadLinks} link(s) point outside the export and are plain text`);
		if (r.tocUnstable) issues.push("TOC page numbers did not settle after three passes");

		if (issues.length > 0) {
			const list = contentEl.createEl("ul");
			for (const issue of issues) list.createEl("li", { text: issue });
		}

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Open PDF", cls: "mod-cta" }).onclick = () => {
			this.openFile(r.outPath);
			this.close();
		};
		buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
