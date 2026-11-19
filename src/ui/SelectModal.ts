/**
 * The checklist shown before exporting: which notes to include, with link
 * dependencies colour-coded, plus the notes outside the folder that the
 * selection links to.
 */

import { Modal, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { ExportModel, NoteInfo } from "../collect/folder";
import { applySavedOrder, isSameOrder, moveItem } from "../collect/order";
import { tocDepthLabel } from "../settingsModel";
import { danglingTargets, externalRefs, incomingLinks, unresolvedRefs, type ExternalRef } from "../collect/graph";

export interface Selection {
	indexPath: string | null;
	notes: string[];
	order: string[];
	appendix: string[];
	outPath: string;
	openAfter: boolean;
	tocDepth: number;
}

export interface SelectModalInit {
	model: ExportModel;
	ticked: Set<string>;
	/** Previously saved custom note order for this folder. */
	savedOrder?: string[];
	appendix: Set<string>;
	outPath: string;
	openAfter: boolean;
	tocDepth: number;
	/** Re-collect after the index note was changed in the dropdown. */
	recollect(indexPath: string | null): ExportModel;
	/** Ticks for a freshly collected model. */
	defaultTicks(model: ExportModel): Set<string>;
	browse(current: string): Promise<string | null>;
	onSubmit(selection: Selection): void;
	onCancel(): void;
}

const MAX_CHIPS = 60;

export class SelectModal extends Modal {
	private model: ExportModel;
	/** The export order, independent of `model.notes` once the user reorders. */
	private noteOrder: NoteInfo[];
	private ticked: Set<string>;
	private appendix: Set<string>;
	private outPath: string;
	private openAfter: boolean;
	private tocDepth: number;
	private readonly expanded = new Set<string>();
	private submitted = false;

	private listEl!: HTMLElement;
	private externalEl!: HTMLElement;
	private unresolvedEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private resetBtn!: HTMLButtonElement;
	private dragFrom: number | null = null;
	/** The row whose grip handle received the active pointer press. */
	private dragArmedRow: HTMLElement | null = null;
	private readonly disarmDrag = (): void => {
		this.dragArmedRow = null;
	};

	constructor(
		app: App,
		private readonly init: SelectModalInit,
	) {
		super(app);
		this.model = init.model;
		this.noteOrder = applySavedOrder(init.model.notes, init.savedOrder);
		this.ticked = init.ticked;
		this.appendix = init.appendix;
		this.outPath = init.outPath;
		this.openAfter = init.openAfter;
		this.tocDepth = init.tocDepth;
	}

	private title(path: string): string {
		return this.model.titles.get(path) ?? path.replace(/^.*\//, "").replace(/\.md$/, "");
	}

	onOpen(): void {
		this.modalEl.addClass("be-modal");
		this.setTitle(`Export “${this.model.folderName}” to PDF`);
		window.addEventListener("pointerup", this.disarmDrag);
		window.addEventListener("blur", this.disarmDrag);
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createDiv({ cls: "be-sub", text: this.model.folderPath });
		// Everything except the footer scrolls, so Export is always reachable.
		const scroll = contentEl.createDiv({ cls: "be-scroll" });

		new Setting(scroll)
			.setName("Index note")
			.setDesc("The links in this note decide the order of the PDF.")
			.addDropdown((dd) => {
				dd.addOption("", "(None: alphabetical)");
				for (const path of this.model.indexCandidates) dd.addOption(path, this.relative(path));
				dd.setValue(this.model.indexPath ?? "");
				dd.onChange((value) => {
					this.model = this.init.recollect(value === "" ? null : value);
					this.noteOrder = [...this.model.notes];
					this.ticked = this.init.defaultTicks(this.model);
					this.appendix = new Set();
					this.expanded.clear();
					this.renderAll();
				});
			});

		const bar = scroll.createDiv({ cls: "be-bar" });
		bar.createEl("button", { text: "Select all" }).onclick = () => {
			this.ticked = new Set(this.model.notes.map((n) => n.path));
			this.renderAll();
		};
		bar.createEl("button", { text: "Select none" }).onclick = () => {
			this.ticked = new Set();
			this.renderAll();
		};
		bar.createEl("button", { text: "Tick linked dependencies" }).onclick = () => {
			// Ticking can expose new dependencies, so repeat until stable.
			for (;;) {
				const missing = danglingTargets(this.model.graph, this.ticked);
				if (missing.size === 0) break;
				for (const path of missing.keys()) this.ticked.add(path);
			}
			this.renderAll();
		};
		this.resetBtn = bar.createEl("button", { text: "Reset order" });
		this.resetBtn.setAttr("title", "Put the notes back into index order");
		this.resetBtn.onclick = () => {
			this.noteOrder = [...this.model.notes];
			this.renderNotes();
		};
		const legend = bar.createDiv({ cls: "be-legend" });
		legend.createSpan({ cls: "be-swatch be-amber", text: "unticked but linked from a ticked note" });
		legend.createSpan({ cls: "be-swatch be-grey", text: "unticked" });

		scroll.createEl("h4", { text: "Notes in this folder" });
		this.listEl = scroll.createDiv({ cls: "be-list" });
		scroll.createEl("h4", { text: "Linked notes outside this folder" });
		this.externalEl = scroll.createDiv({ cls: "be-external" });
		this.unresolvedEl = scroll.createDiv({ cls: "be-unresolved" });

		const footer = contentEl.createDiv({ cls: "be-footer" });
		this.summaryEl = footer.createDiv({ cls: "be-summary" });

		const out = footer.createDiv({ cls: "be-out" });
		const input = out.createEl("input", { type: "text", cls: "be-out-input", value: this.outPath });
		input.oninput = () => {
			this.outPath = input.value;
		};
		out.createEl("button", { text: "Browse…" }).onclick = () => {
			void this.init.browse(this.outPath).then((chosen) => {
				if (chosen) {
					this.outPath = chosen;
					input.value = chosen;
				}
			});
		};

		new Setting(footer).setName("Table of contents").addDropdown((dd) => {
			for (let depth = 0; depth <= 6; depth++) dd.addOption(String(depth), tocDepthLabel(depth));
			dd.setValue(String(this.tocDepth));
			dd.onChange((value) => {
				this.tocDepth = Number(value);
			});
		});

		const row = footer.createDiv({ cls: "be-footer-row" });
		const label = row.createEl("label", { cls: "be-check" });
		const open = label.createEl("input", { type: "checkbox" });
		open.checked = this.openAfter;
		open.onchange = () => {
			this.openAfter = open.checked;
		};
		label.createSpan({ text: "Open PDF after export" });

		const buttons = row.createDiv({ cls: "be-buttons" });
		buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		const exportBtn = buttons.createEl("button", { text: "Export", cls: "mod-cta" });
		exportBtn.onclick = () => this.submit();

		this.renderAll();
	}

	private relative(path: string): string {
		const prefix = `${this.model.folderPath}/`;
		return path.startsWith(prefix) ? path.slice(prefix.length) : path;
	}

	private submit(): void {
		const notes = this.noteOrder.filter((n) => this.ticked.has(n.path)).map((n) => n.path);
		if (notes.length === 0) {
			this.summaryEl.setText("Tick at least one note.");
			return;
		}
		if (!this.outPath.trim().toLowerCase().endsWith(".pdf")) {
			this.summaryEl.setText("The output path must have a PDF extension.");
			return;
		}
		const referenced = externalRefs(this.model.graph, this.ticked);
		const appendix = [...this.appendix].filter((p) => referenced.has(p));
		this.submitted = true;
		this.close();
		this.init.onSubmit({
			indexPath: this.model.indexPath,
			notes,
			order: this.noteOrder.map((n) => n.path),
			appendix,
			outPath: this.outPath.trim(),
			openAfter: this.openAfter,
			tocDepth: this.tocDepth,
		});
	}

	onClose(): void {
		window.removeEventListener("pointerup", this.disarmDrag);
		window.removeEventListener("blur", this.disarmDrag);
		this.dragArmedRow = null;
		this.dragFrom = null;
		this.contentEl.empty();
		if (!this.submitted) this.init.onCancel();
	}

	private renderAll(): void {
		this.renderNotes();
		this.renderExternal();
		this.renderSummary();
	}

	private renderNotes(): void {
		const el = this.listEl;
		const scrollTop = el.scrollTop;
		el.empty();
		const graph = this.model.graph;
		const dangling = danglingTargets(graph, this.ticked);
		const incoming = incomingLinks(graph, this.ticked);

		this.noteOrder.forEach((note, index) => {
			const isTicked = this.ticked.has(note.path);
			const missingFrom = dangling.get(note.path);
			const state = isTicked ? "be-ticked" : missingFrom ? "be-amber" : "be-grey";
			const row = el.createDiv({ cls: `be-row ${state}` });

			const head = row.createDiv({ cls: "be-row-head" });
			const drag = head.createSpan({ cls: "be-drag-handle", attr: { "aria-label": "Drag to reorder", title: "Drag to reorder" } });
			setIcon(drag, "grip-vertical");
			const cb = head.createEl("input", { type: "checkbox" });
			cb.checked = isTicked;
			cb.onchange = () => {
				if (cb.checked) this.ticked.add(note.path);
				else this.ticked.delete(note.path);
				this.renderAll();
			};
			head.createSpan({ cls: "be-title", text: note.title });
			if (!note.inIndex) head.createSpan({ cls: "be-badge", text: "not in index" });

			const outgoing = (graph.edges.get(note.path) ?? []).filter((e) => e.kind !== "frontmatter");
			if (outgoing.length > 0) head.createSpan({ cls: "be-badge", text: `↗ ${outgoing.length}` });
			const from = incoming.get(note.path);
			if (from) {
				const badge = head.createSpan({ cls: "be-badge", text: `← ${from.length}` });
				badge.setAttr("title", `Linked from ticked: ${from.map((p) => this.title(p)).join(", ")}`);
			}
			if (missingFrom) {
				head.setAttr("title", `Linked from ticked notes (${missingFrom.map((p) => this.title(p)).join(", ")}): its cross-references would be dead text.`);
			}

			const up = head.createEl("button", {
				cls: "be-move-btn clickable-icon",
				attr: { "aria-label": "Move up", title: "Move up", "data-move": "up" },
			});
			setIcon(up, "arrow-up");
			up.disabled = index === 0;
			up.onclick = () => this.moveNote(index, index - 1, "up");

			const down = head.createEl("button", {
				cls: "be-move-btn clickable-icon",
				attr: { "aria-label": "Move down", title: "Move down", "data-move": "down" },
			});
			setIcon(down, "arrow-down");
			down.disabled = index === this.noteOrder.length - 1;
			down.onclick = () => this.moveNote(index, index + 1, "down");

			const open = this.expanded.has(note.path);
			const chevron = head.createEl("button", { cls: "be-chevron", text: open ? "▾" : "▸" });
			chevron.onclick = () => {
				if (this.expanded.has(note.path)) this.expanded.delete(note.path);
				else this.expanded.add(note.path);
				this.renderNotes();
			};
			if (open) this.renderChips(row, note.path);

			this.wireRowDrag(row, index);
		});

		this.updateOrderControls();
		el.scrollTop = scrollTop;
	}

	/** Reorder one step, redraw the list, and keep keyboard focus on the moved row. */
	private moveNote(from: number, to: number, focusDir?: "up" | "down"): void {
		const next = moveItem(this.noteOrder, from, to);
		if (isSameOrder(next.map((n) => n.path), this.noteOrder.map((n) => n.path))) return;
		this.noteOrder = next;
		this.renderNotes();
		if (focusDir) {
			const targetRow = this.listEl.querySelectorAll<HTMLElement>(".be-row")[to];
			const preferred = targetRow?.querySelector<HTMLButtonElement>(`button[data-move="${focusDir}"]`);
			const fallbackDir = focusDir === "up" ? "down" : "up";
			const targetBtn =
				preferred && !preferred.disabled
					? preferred
					: targetRow?.querySelector<HTMLButtonElement>(`button[data-move="${fallbackDir}"]`);
			if (targetBtn && !targetBtn.disabled) targetBtn.focus();
		}
	}

	/** Enable "Reset order" only when the list differs from index order. */
	private updateOrderControls(): void {
		if (!this.resetBtn) return;
		this.resetBtn.disabled = isSameOrder(
			this.noteOrder.map((n) => n.path),
			this.model.notes.map((n) => n.path),
		);
	}

	/** Drag-and-drop reordering, armed only by dragging the grip handle. */
	private wireRowDrag(row: HTMLElement, index: number): void {
		// The row is always draggable so the native drag starts reliably; the
		// grip merely arms it, and a drag from anywhere else is cancelled.
		row.draggable = true;
		row.addEventListener("pointerdown", (event) => {
			this.dragArmedRow =
				event.target instanceof Element && event.target.closest(".be-drag-handle") !== null ? row : null;
		});

		row.addEventListener("dragstart", (event) => {
			if (this.dragArmedRow !== row) {
				event.preventDefault();
				return;
			}
			this.dragArmedRow = null;
			this.dragFrom = index;
			row.addClass("be-dragging");
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = "move";
				// Some Chromium builds refuse to start a drag without data.
				event.dataTransfer.setData("text/plain", String(index));
			}
		});

		row.addEventListener("dragover", (event) => {
			if (this.dragFrom === null || this.dragFrom === index) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			this.clearDropMarks();
			const above = this.isDropAbove(row, event);
			row.toggleClass("be-drop-above", above);
			row.toggleClass("be-drop-below", !above);
		});

		row.addEventListener("dragleave", (event) => {
			if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
			row.removeClass("be-drop-above");
			row.removeClass("be-drop-below");
		});

		row.addEventListener("drop", (event) => {
			event.preventDefault();
			const from = this.dragFrom;
			this.dragFrom = null;
			this.clearDropMarks();
			if (from === null) return;
			const above = this.isDropAbove(row, event);
			let to = above ? index : index + 1;
			// An insertion point after the item being moved shifts left by one.
			if (from < to) to -= 1;
			this.noteOrder = moveItem(this.noteOrder, from, to);
			this.renderNotes();
		});

		row.addEventListener("dragend", () => {
			this.dragFrom = null;
			this.dragArmedRow = null;
			row.removeClass("be-dragging");
			this.clearDropMarks();
		});
	}

	private isDropAbove(row: HTMLElement, event: DragEvent): boolean {
		const rect = row.getBoundingClientRect();
		return event.clientY < rect.top + rect.height / 2;
	}

	private clearDropMarks(): void {
		this.listEl.querySelectorAll(".be-drop-above, .be-drop-below").forEach((el) => {
			el.removeClass("be-drop-above");
			el.removeClass("be-drop-below");
		});
	}

	private renderChips(row: HTMLElement, path: string): void {
		const chips = row.createDiv({ cls: "be-chips" });
		const edges = this.model.graph.edges.get(path) ?? [];
		const seen = new Set<string>();
		let shown = 0;
		for (const edge of edges) {
			const key = `${edge.kind}|${edge.targetPath ?? edge.raw}|${edge.subpath}`;
			if (seen.has(key)) continue;
			seen.add(key);
			if (shown++ >= MAX_CHIPS) {
				chips.createSpan({ cls: "be-chip be-chip-info", text: "…" });
				break;
			}
			let cls = "be-chip-blue";
			if (edge.category === "unresolved") cls = "be-chip-red";
			else if (edge.kind === "frontmatter") cls = "be-chip-info";
			else if (edge.category === "in-folder") cls = this.ticked.has(edge.targetPath as string) ? "be-chip-green" : "be-chip-amber";
			const label = edge.targetPath ? `${this.title(edge.targetPath)}${edge.subpath}` : edge.raw;
			chips.createSpan({ cls: `be-chip ${cls}`, text: `${edge.kind === "embed" ? "📎 " : ""}${label}` });
		}
		if (shown === 0) chips.createSpan({ cls: "be-chip be-chip-info", text: "no links" });
	}

	private renderExternal(): void {
		const el = this.externalEl;
		el.empty();
		const refs = externalRefs(this.model.graph, this.ticked);
		const info: [string, ExternalRef][] = [];
		let any = false;

		for (const [path, ref] of refs) {
			if (ref.frontmatterOnly) {
				info.push([path, ref]);
				continue;
			}
			any = true;
			const row = el.createDiv({ cls: "be-row be-ext" });
			const head = row.createDiv({ cls: "be-row-head" });
			const cb = head.createEl("input", { type: "checkbox" });
			cb.checked = this.appendix.has(path);
			cb.onchange = () => {
				if (cb.checked) this.appendix.add(path);
				else this.appendix.delete(path);
				this.renderSummary();
			};
			head.createSpan({ cls: "be-title", text: this.title(path) });
			head.createSpan({ cls: "be-path", text: path });
			if (ref.embeddedOnly) head.createSpan({ cls: "be-badge", text: "embedded (renders inline anyway)" });
			row.createDiv({ cls: "be-from", text: `linked from: ${ref.sources.map((p) => this.title(p)).join(", ")}` });
		}
		if (!any) el.createDiv({ cls: "be-empty", text: "No ticked note links outside this folder." });

		if (info.length > 0) {
			const details = el.createEl("details", { cls: "be-info" });
			details.createEl("summary", { text: `Prerequisites (info only, ${info.length})` });
			for (const [path, ref] of info) {
				details.createDiv({ cls: "be-from", text: `${this.title(path)} ← ${ref.sources.map((p) => this.title(p)).join(", ")}` });
			}
		}

		const unresolved = unresolvedRefs(this.model.graph, this.ticked);
		this.unresolvedEl.empty();
		if (unresolved.size > 0) {
			const details = this.unresolvedEl.createEl("details", { cls: "be-info" });
			details.createEl("summary", { text: `Unresolved links (${unresolved.size}): plain text in the PDF` });
			for (const [raw, sources] of unresolved) {
				details.createDiv({ cls: "be-from", text: `[[${raw}]] ← ${sources.map((p) => this.title(p)).join(", ")}` });
			}
		}
	}

	private renderSummary(): void {
		const refs = externalRefs(this.model.graph, this.ticked);
		const appendix = [...this.appendix].filter((p) => refs.has(p)).length;
		const notes = this.model.notes.filter((n) => this.ticked.has(n.path)).length;
		this.summaryEl.setText(`${notes} note${notes === 1 ? "" : "s"}${appendix ? ` + ${appendix} appendix` : ""} selected`);
	}
}
