/**
 * Renders `$…$` inside link text. Obsidian leaves math in a wikilink's
 * display text (`[[Note|$\chi^2$]]`) as plain text, in reading view too; on
 * paper the formula reads better than its source.
 */

import { renderMath } from "obsidian";
import { hasInlineMath, splitInlineMath } from "./inlineMath";

const LINK_SELECTOR = "a.internal-link, a.external-link";

/**
 * Replaces inline math in the text of every link under `root` with MathJax
 * output. Only whole text nodes are handled: a formula split by other markup
 * stays as written. Returns how many formulas were rendered; the caller must
 * then `await finishRenderMath()`.
 */
export function renderLinkMath(root: HTMLElement): number {
	let rendered = 0;
	root.querySelectorAll<HTMLElement>(LINK_SELECTOR).forEach((link) => {
		const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
		const hits: Text[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node as Text;
			if (text.parentElement?.closest("mjx-container")) continue;
			if (hasInlineMath(text.data)) hits.push(text);
		}
		for (const text of hits) {
			const fragment = createFragment();
			for (const segment of splitInlineMath(text.data)) {
				if (segment.math) {
					fragment.appendChild(renderMath(segment.tex, false));
					rendered++;
				} else {
					fragment.appendChild(document.createTextNode(segment.text));
				}
			}
			text.replaceWith(fragment);
		}
	});
	return rendered;
}
