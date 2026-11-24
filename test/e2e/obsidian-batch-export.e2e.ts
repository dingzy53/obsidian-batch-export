import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';

describe('Folder to PDF E2E', function () {
	it('loads the batch-export plugin and exposes inspect API', async function () {
		const inspection = await browser.executeObsidian(({ app }) => {
			const plugins = (app as unknown as {
				plugins: {
					enabledPlugins: Set<string>;
					plugins: Record<string, { api?: { inspect: (folder: string) => { notes: { path: string }[] } } }>;
				};
			}).plugins;
			return {
				enabled: plugins.enabledPlugins.has('batch-export'),
				notes: plugins.plugins['batch-export']?.api?.inspect('Chapter1').notes.map((n) => n.path) ?? [],
			};
		});
		expect(inspection.enabled).toBe(true);
		expect(inspection.notes.sort()).toEqual(['Chapter1/Intro.md', 'Chapter1/Math.md']);
	});

	it('opens the export checklist modal for an active folder note', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Chapter1/Intro.md');
			if (!file) throw new Error('Missing Chapter1/Intro.md');
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(file);
			app.workspace.setActiveLeaf(leaf, { focus: true });
		});

		await browser.executeObsidianCommand('batch-export:export-folder-of-active-note');

		await browser.waitUntil(
			async () => browser.execute(() => Boolean(document.querySelector('.modal-container .modal'))),
			{ timeout: 10000, timeoutMsg: 'Expected batch-export checklist modal to open' },
		);

		const modalText = await browser.execute(() => document.querySelector('.modal-container .modal')?.textContent ?? '');
		expect(modalText).toContain('Intro');

		await browser.execute(() => {
			const closeBtn = document.querySelector<HTMLElement>('.modal-container .modal-close-button');
			closeBtn?.click();
		});
	});
});
