/**
 * Link graph classification for the checklist modal.
 * Pure: the Obsidian-facing code resolves links and hands us `RawEdge`s.
 */

export type EdgeKind = "link" | "embed" | "frontmatter";

export interface RawEdge {
	kind: EdgeKind;
	/** The link text as written, for display (`Continuity#Limit Criterion`). */
	raw: string;
	/** Resolved vault path, or null when the link does not resolve. */
	targetPath: string | null;
	subpath: string;
}

export type Category = "in-folder" | "external" | "unresolved";

export interface Edge extends RawEdge {
	category: Category;
}

export interface Graph {
	/** Outgoing edges per note path (only for notes inside the folder). */
	edges: Map<string, Edge[]>;
}

export function buildGraph(
	notes: { path: string; edges: RawEdge[] }[],
	folderPaths: ReadonlySet<string>,
): Graph {
	const edges = new Map<string, Edge[]>();
	for (const note of notes) {
		const list: Edge[] = [];
		for (const raw of note.edges) {
			let category: Category;
			if (raw.targetPath === null) category = "unresolved";
			else if (folderPaths.has(raw.targetPath)) category = "in-folder";
			else category = "external";
			list.push({ ...raw, category });
		}
		edges.set(note.path, list);
	}
	return { edges };
}

/**
 * Unticked in-folder notes that a *ticked* note links to or embeds: their
 * cross-references would dangle. Maps the unticked note to its ticked sources.
 * Frontmatter-only references never count: they are not printed.
 */
export function danglingTargets(graph: Graph, ticked: ReadonlySet<string>): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [source, list] of graph.edges) {
		if (!ticked.has(source)) continue;
		for (const edge of list) {
			if (edge.category !== "in-folder" || edge.kind === "frontmatter") continue;
			const target = edge.targetPath;
			if (target === null || ticked.has(target) || target === source) continue;
			const sources = out.get(target) ?? [];
			if (!sources.includes(source)) sources.push(source);
			out.set(target, sources);
		}
	}
	return out;
}

export interface ExternalRef {
	sources: string[];
	/** Only ever transcluded (`![[...]]`), never linked: it renders inline anyway. */
	embeddedOnly: boolean;
	/** Only referenced from frontmatter (informational). */
	frontmatterOnly: boolean;
}

/** External notes referenced from ticked notes. */
export function externalRefs(graph: Graph, ticked: ReadonlySet<string>): Map<string, ExternalRef> {
	const out = new Map<string, ExternalRef>();
	for (const [source, list] of graph.edges) {
		if (!ticked.has(source)) continue;
		for (const edge of list) {
			if (edge.category !== "external" || edge.targetPath === null) continue;
			const ref = out.get(edge.targetPath) ?? { sources: [], embeddedOnly: true, frontmatterOnly: true };
			if (!ref.sources.includes(source)) ref.sources.push(source);
			if (edge.kind !== "embed") ref.embeddedOnly = false;
			if (edge.kind !== "frontmatter") ref.frontmatterOnly = false;
			out.set(edge.targetPath, ref);
		}
	}
	return out;
}

/** Unresolved link texts referenced from ticked notes, with their sources. */
export function unresolvedRefs(graph: Graph, ticked: ReadonlySet<string>): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [source, list] of graph.edges) {
		if (!ticked.has(source)) continue;
		for (const edge of list) {
			if (edge.category !== "unresolved" || edge.kind === "frontmatter") continue;
			const sources = out.get(edge.raw) ?? [];
			if (!sources.includes(source)) sources.push(source);
			out.set(edge.raw, sources);
		}
	}
	return out;
}

/**
 * In-folder notes with the ticked notes that link to or embed them, whether or
 * not the target itself is ticked. Frontmatter-only references are excluded.
 */
export function incomingLinks(graph: Graph, ticked: ReadonlySet<string>): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [source, list] of graph.edges) {
		if (!ticked.has(source)) continue;
		for (const edge of list) {
			if (edge.category !== "in-folder" || edge.kind === "frontmatter") continue;
			const target = edge.targetPath;
			if (target === null || target === source) continue;
			const sources = out.get(target) ?? [];
			if (!sources.includes(source)) sources.push(source);
			out.set(target, sources);
		}
	}
	return out;
}
