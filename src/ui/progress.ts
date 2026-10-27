import { Notice } from "obsidian";

/** A sticky Notice with a status line and a Cancel button. */
export class Progress {
	private readonly notice: Notice;
	private readonly label: HTMLElement;
	cancelled = false;

	constructor(title: string) {
		this.notice = new Notice("", 0);
		const el = this.notice.messageEl;
		el.createDiv({ cls: "be-progress-title", text: title });
		this.label = el.createDiv({ cls: "be-progress-label" });
		const cancel = el.createEl("button", { text: "Cancel", cls: "be-progress-cancel" });
		cancel.onclick = () => {
			this.cancelled = true;
			this.set("Cancelling…");
		};
	}

	set(text: string): void {
		this.label.setText(text);
	}

	close(): void {
		this.notice.hide();
	}
}
