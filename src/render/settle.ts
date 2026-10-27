/**
 * Waits until everything that renders asynchronously inside the print
 * container has finished: MathJax, TikZ compiles, embeds, and whatever other
 * plugins (import-code, algo, mermaid) add late. Never waits forever.
 */

import { finishRenderMath } from "obsidian";
import type { App } from "obsidian";

interface TikzApi {
	whenSettled(root: HTMLElement): Promise<{ errors: number }>;
}

export interface SettleResult {
	timedOut: boolean;
	/** True when the tikz plugin's `api` was missing and polling was used. */
	tikzApiMissing: boolean;
	embedsPending: number;
	tikzPending: number;
}

const QUIET_MS = 500;
const POLL_MS = 100;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function tikzApi(app: App): TikzApi | null {
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { api?: TikzApi }> } }).plugins;
	return plugins?.plugins?.tikz?.api ?? null;
}

function pendingTikz(root: HTMLElement): number {
	return root.querySelectorAll(".tikz-loading").length;
}

/** Embeds Obsidian has not finished (it marks finished ones `is-loaded`). */
function pendingEmbeds(root: HTMLElement): number {
	return root.querySelectorAll(".internal-embed:not(.is-loaded)").length;
}

function waitQuiet(root: HTMLElement, deadline: number): Promise<void> {
	return new Promise((resolve) => {
		let quietTimer = 0;
		const finish = (): void => {
			observer.disconnect();
			window.clearTimeout(quietTimer);
			window.clearTimeout(limitTimer);
			resolve();
		};
		const arm = (): void => {
			window.clearTimeout(quietTimer);
			quietTimer = window.setTimeout(finish, QUIET_MS);
		};
		const observer = new MutationObserver(arm);
		const limitTimer = window.setTimeout(finish, Math.max(0, deadline - Date.now()));
		observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
		arm();
	});
}

export async function settle(
	app: App,
	root: HTMLElement,
	timeoutMs: number,
	isCancelled: () => boolean,
): Promise<SettleResult> {
	const deadline = Date.now() + timeoutMs;
	const api = tikzApi(app);
	const remaining = (): number => Math.max(0, deadline - Date.now());

	for (let pass = 0; pass < 6 && Date.now() < deadline && !isCancelled(); pass++) {
		await Promise.race([finishRenderMath(), sleep(remaining())]);

		if (api) {
			await Promise.race([api.whenSettled(root), sleep(remaining())]);
		}
		while ((pendingTikz(root) > 0 || pendingEmbeds(root) > 0) && Date.now() < deadline && !isCancelled()) {
			await sleep(POLL_MS);
		}

		await waitQuiet(root, deadline);

		if (pendingTikz(root) === 0 && pendingEmbeds(root) === 0) break;
	}
	await Promise.race([finishRenderMath(), sleep(remaining())]);

	const tikzPending = pendingTikz(root);
	const embedsPending = pendingEmbeds(root);
	return {
		timedOut: tikzPending > 0 || embedsPending > 0,
		tikzApiMissing: api === null,
		embedsPending,
		tikzPending,
	};
}
