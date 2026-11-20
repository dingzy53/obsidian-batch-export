/**
 * Keeps short callouts on one page. `styles.css` already keeps a callout's
 * title with its content, but Chromium can still break a short callout just
 * below the title (seen with a one-line example callout), leaving an empty
 * coloured box at the bottom of the page.
 */

import { keepCalloutWhole } from "../settingsModel";

/**
 * Marks every callout no taller than a share of the page with `be-keep`.
 * Call after settle and post-processing, when heights are final. Returns how
 * many callouts were marked.
 */
export function keepShortCallouts(root: HTMLElement, pageHeightPx: number): number {
	let kept = 0;
	root.querySelectorAll<HTMLElement>(".callout").forEach((callout) => {
		if (!keepCalloutWhole(callout.getBoundingClientRect().height, pageHeightPx)) return;
		callout.addClass("be-keep");
		kept++;
	});
	return kept;
}
