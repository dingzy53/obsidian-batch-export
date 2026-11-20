/**
 * Splits plain text into text and inline `$…$` math, with the rules Obsidian
 * uses for inline math. Pure: no `import "obsidian"`.
 */

export type Segment = { math: false; text: string } | { math: true; tex: string };

function isSpace(ch: string | undefined): boolean {
	return ch !== undefined && /\s/.test(ch);
}

/**
 * - An opening `$` must not be followed by whitespace, and a closing `$`
 *   must not be preceded by whitespace.
 * - `\$` is a literal dollar sign.
 * - `$$` is left as text (no display math here).
 * - An unclosed `$` stays text.
 * Adjacent text is merged; empty input gives `[]`.
 */
export function splitInlineMath(text: string): Segment[] {
	const out: Segment[] = [];
	let buf = "";
	const pushText = (s: string): void => {
		buf += s;
	};
	const flush = (): void => {
		if (buf) out.push({ math: false, text: buf });
		buf = "";
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "\\" && text[i + 1] === "$") {
			pushText("$");
			i += 2;
			continue;
		}
		if (ch !== "$") {
			pushText(ch);
			i++;
			continue;
		}
		if (text[i + 1] === "$") {
			// `$$…`: keep every dollar of the run as text.
			let j = i;
			while (text[j] === "$") j++;
			pushText(text.slice(i, j));
			i = j;
			continue;
		}
		const close = findClose(text, i + 1);
		if (close === -1) {
			pushText("$");
			i++;
			continue;
		}
		flush();
		out.push({ math: true, tex: text.slice(i + 1, close) });
		i = close + 1;
	}
	flush();
	return out;
}

/** Index of the `$` that closes math opened just before `start`, or -1. */
function findClose(text: string, start: number): number {
	if (start >= text.length || isSpace(text[start])) return -1;
	for (let j = start; j < text.length; j++) {
		if (text[j] === "\\") {
			j++;
			continue;
		}
		if (text[j] !== "$") continue;
		if (j === start || isSpace(text[j - 1]) || text[j + 1] === "$") return -1;
		return j;
	}
	return -1;
}

/** True when `splitInlineMath(text)` would find any math. */
export function hasInlineMath(text: string): boolean {
	return text.includes("$") && splitInlineMath(text).some((s) => s.math);
}
