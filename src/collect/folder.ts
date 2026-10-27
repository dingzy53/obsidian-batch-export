/**
 * Obsidian-facing collection: which notes live in a folder, which one is the
 * index, and what each note links to. The ordering and classification logic
 * itself lives in the pure `order.ts` / `graph.ts`.
 */

import { parseLinktext, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { buildGraph, type Graph, type RawEdge } from "./graph";
import { orderNotes } from "./order";

export interface NoteInfo {
	path: string;
	title: string;
	/** False for notes the index does not list. */
	inIndex: boolean;
}

export interface ExportModel {
	folderPath: string;
	folderName: string;
	indexPath: string | null;
	/** Candidate index notes for the modal's dropdown (top-level first). */
	indexCandidates: string[];
	/** Folder notes in export order, index excluded. */
	notes: NoteInfo[];
	graph: Graph;
	/** Titles of folder notes and of every external note referenced. */
	titles: Map<string, string>;
}

export function listFolderNotes(folder: TFolder): TFile[] {
	const out: TFile[] = [];
	const walk = (dir: TFolder): void => {
		for (const child of dir.children) {
			if (child instanceof TFolder) walk(child);
			else if (child instanceof TFile && child.extension === "md") out.push(child);
		}
	};
	walk(folder);
	return out;
}

/** The note title: frontmatter `title`, else the file name. */
export function noteTitle(app: App, file: TFile): string {
	const title: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.title;
	return typeof title === "string" && title.trim() !== "" ? title.trim() : file.basename;
}

/** First top-level note with `type: index`, else one whose name contains "index". */
export function findIndex(app: App, files: TFile[], folder: TFolder): TFile | null {
	const top = files.filter((f) => f.parent === folder);
	const byType = top.find((f) => app.metadataCache.getFileCache(f)?.frontmatter?.type === "index");
	if (byType) return byType;
	return top.find((f) => /index/i.test(f.basename)) ?? null;
}

function rawEdgesOf(app: App, file: TFile): RawEdge[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];
	const edges: RawEdge[] = [];
	const add = (kind: RawEdge["kind"], link: string): void => {
		const { path, subpath } = parseLinktext(link);
		const target = path === "" ? file : app.metadataCache.getFirstLinkpathDest(path, file.path);
		if (target === file) return;
		// Images, PDFs and other attachments are not notes.
		if (target && target.extension !== "md") return;
		edges.push({ kind, raw: link, targetPath: target ? target.path : null, subpath });
	};
	for (const ref of cache.links ?? []) add("link", ref.link);
	for (const ref of cache.embeds ?? []) add("embed", ref.link);
	for (const ref of cache.frontmatterLinks ?? []) add("frontmatter", ref.link);
	return edges;
}

/** Everything the modal and the exporter need to know about a folder. */
export function collectModel(app: App, folder: TFolder, indexOverride: string | null | undefined): ExportModel {
	const files = listFolderNotes(folder);
	let index: TFile | null;
	if (indexOverride === null) index = null;
	else if (indexOverride !== undefined) index = files.find((f) => f.path === indexOverride) ?? findIndex(app, files, folder);
	else index = findIndex(app, files, folder);

	let indexLinkTargets: string[] = [];
	if (index) {
		const links = [...(app.metadataCache.getFileCache(index)?.links ?? [])].sort(
			(a, b) => a.position.start.offset - b.position.start.offset,
		);
		for (const ref of links) {
			const { path } = parseLinktext(ref.link);
			if (path === "") continue;
			const target = app.metadataCache.getFirstLinkpathDest(path, index.path);
			if (target) indexLinkTargets.push(target.path);
		}
	}
	indexLinkTargets = indexLinkTargets.filter((p, i, all) => all.indexOf(p) === i);

	const byPath = new Map(files.map((f) => [f.path, f]));
	const ordered = orderNotes({
		folderFiles: files.map((f) => f.path),
		indexPath: index?.path ?? null,
		indexLinkTargets,
	});
	const notes: NoteInfo[] = ordered.map((entry) => {
		const file = byPath.get(entry.path) as TFile;
		return { path: entry.path, title: noteTitle(app, file), inIndex: entry.inIndex };
	});

	// The index is deliberately not part of the folder set: links to it from
	// a note surface as an optional appendix candidate instead of vanishing.
	const folderPaths = new Set(notes.map((n) => n.path));
	const graph = buildGraph(
		notes.map((n) => ({ path: n.path, edges: rawEdgesOf(app, byPath.get(n.path) as TFile) })),
		folderPaths,
	);

	const titles = new Map<string, string>(notes.map((n) => [n.path, n.title]));
	for (const list of graph.edges.values()) {
		for (const edge of list) {
			if (edge.targetPath === null || titles.has(edge.targetPath)) continue;
			const file = app.vault.getAbstractFileByPath(edge.targetPath);
			if (file instanceof TFile) titles.set(edge.targetPath, noteTitle(app, file));
		}
	}

	const top = files.filter((f) => f.parent === folder).map((f) => f.path);
	const rest = files.filter((f) => f.parent !== folder).map((f) => f.path);
	return {
		folderPath: folder.path,
		folderName: folder.name,
		indexPath: index?.path ?? null,
		indexCandidates: [...top, ...rest],
		notes,
		graph,
		titles,
	};
}

/** Notes ticked by default: everything the index lists (or all, with no index). */
export function defaultTicks(model: ExportModel): string[] {
	return model.notes.filter((n) => n.inIndex).map((n) => n.path);
}
