/**
 * Export order: the index note's links first, then everything else.
 * Pure: no `import "obsidian"`.
 */

export interface OrderInput {
	/** Vault paths of every `.md` file under the folder (index included). */
	folderFiles: string[];
	/** The index note's path, or null when the folder has none. */
	indexPath: string | null;
	/** Resolved body-link targets of the index note, in document order. */
	indexLinkTargets: string[];
}

export interface OrderedEntry {
	path: string;
	/** False for notes appended after the index-listed ones. */
	inIndex: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural, case-insensitive path comparison ("Exercise 2" before "Exercise 10"). */
export function comparePaths(a: string, b: string): number {
	return collator.compare(a, b);
}

/**
 * A copy of `items` with the element at `fromIndex` moved to `toIndex`.
 * Indices are clamped to the array bounds; an out-of-range move or a move to
 * the same place returns an equivalent copy unchanged.
 */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
	const next = [...items];
	if (next.length === 0) return next;
	const from = Math.min(Math.max(fromIndex, 0), next.length - 1);
	const to = Math.min(Math.max(toIndex, 0), next.length - 1);
	if (from === to) return next;
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

/** True when two path lists have the same length and the same order. */
export function isSameOrder(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
}

/**
 * Reorder `notes` according to `savedOrder`. Paths not in `notes` and
 * duplicate entries in `savedOrder` are ignored; any remaining notes follow in
 * their existing order.
 */
export function applySavedOrder<T extends { path: string }>(
	notes: readonly T[],
	savedOrder: readonly string[] | undefined,
): T[] {
	if (!savedOrder || savedOrder.length === 0) return [...notes];
	const byPath = new Map(notes.map((n) => [n.path, n]));
	const seen = new Set<string>();
	const result: T[] = [];
	for (const path of savedOrder) {
		if (seen.has(path)) continue;
		const item = byPath.get(path);
		if (!item) continue;
		seen.add(path);
		result.push(item);
	}
	for (const note of notes) {
		if (!seen.has(note.path)) result.push(note);
	}
	return result;
}

export function orderNotes(input: OrderInput): OrderedEntry[] {
	const inFolder = new Set(input.folderFiles);
	const result: OrderedEntry[] = [];
	const seen = new Set<string>();
	if (input.indexPath) seen.add(input.indexPath);

	for (const target of input.indexLinkTargets) {
		if (!inFolder.has(target) || seen.has(target)) continue;
		seen.add(target);
		result.push({ path: target, inIndex: true });
	}

	const rest = input.folderFiles.filter((p) => !seen.has(p)).sort(comparePaths);
	// With no index at all there is no "not in index" notion: everything is
	// alphabetical and nothing deserves the badge.
	const hasIndex = input.indexPath !== null;
	for (const path of rest) result.push({ path, inIndex: !hasIndex });
	return result;
}
