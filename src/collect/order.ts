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
