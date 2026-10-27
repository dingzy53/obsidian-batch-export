import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, resolveScale, tocDepthLabel } from "../src/settingsModel";

describe("mergeSettings", () => {
	it("returns defaults for junk", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings("x")).toEqual(DEFAULT_SETTINGS);
	});

	it("clamps and validates", () => {
		const s = mergeSettings({ outlineDepth: 99, fontSizePt: 1, pageSize: "B7", tocDepth: 9, marginsMm: { top: -4 } });
		expect(s.outlineDepth).toBe(6);
		expect(s.fontSizePt).toBe(6);
		expect(s.pageSize).toBe("A4");
		expect(s.tocDepth).toBe(3);
		expect(s.marginsMm.top).toBe(0);
	});

	it("validates the TOC depth", () => {
		expect(DEFAULT_SETTINGS.tocDepth).toBe(3);
		expect(mergeSettings({ settingsVersion: 3, tocDepth: 5 }).tocDepth).toBe(5);
		expect(mergeSettings({ settingsVersion: 3, tocDepth: 0 }).tocDepth).toBe(0);
		for (const bad of [9, -1, 2.5, "3", null]) expect(mergeSettings({ settingsVersion: 3, tocDepth: bad }).tocDepth).toBe(3);
	});

	it("moves an untouched version-2 TOC depth to the new default, keeps deliberate ones", () => {
		expect(mergeSettings({ settingsVersion: 2, tocDepth: 1 }).tocDepth).toBe(3);
		expect(mergeSettings({ settingsVersion: 2, tocDepth: 2 }).tocDepth).toBe(2);
		expect(mergeSettings({ settingsVersion: 2, tocDepth: 0 }).tocDepth).toBe(0);
		expect(mergeSettings({ settingsVersion: 3, tocDepth: 1 }).tocDepth).toBe(1);
	});

	it("does not re-run the version-1 drops on newer data", () => {
		const v2 = mergeSettings({ settingsVersion: 2, fontSizePt: 11, marginsMm: { top: 15, right: 15, bottom: 18, left: 15 } });
		expect(v2.fontSizePt).toBe(11);
		expect(v2.marginsMm.bottom).toBe(18);
	});

	it("validates the remembered TOC depth per folder", () => {
		const s = mergeSettings({ folderState: { a: { tocDepth: 4 }, b: { tocDepth: 12 }, c: {} } });
		expect(s.folderState.a?.tocDepth).toBe(4);
		expect(s.folderState.b?.tocDepth).toBeUndefined();
		expect(s.folderState.c?.tocDepth).toBeUndefined();
	});

	it("labels TOC depths", () => {
		expect(tocDepthLabel(0)).toBe("None");
		expect(tocDepthLabel(1)).toBe("Notes only");
		expect(tocDepthLabel(3)).toBe("Notes and headings to ###");
	});

	it("allows 0 (follow Obsidian) for font size and scale", () => {
		const s = mergeSettings({ settingsVersion: 2, fontSizePt: 0, scalePercent: 0 });
		expect(s.fontSizePt).toBe(0);
		expect(s.scalePercent).toBe(0);
		expect(mergeSettings({ scalePercent: 500 }).scalePercent).toBe(200);
	});

	it("drops untouched version-1 page defaults, keeps changed ones", () => {
		const v1 = mergeSettings({ marginsMm: { top: 15, right: 15, bottom: 18, left: 15 }, fontSizePt: 11 });
		expect(v1.marginsMm).toEqual(DEFAULT_SETTINGS.marginsMm);
		expect(v1.fontSizePt).toBe(0);
		const changed = mergeSettings({ marginsMm: { top: 20, right: 15, bottom: 18, left: 15 }, fontSizePt: 12 });
		expect(changed.marginsMm.top).toBe(20);
		expect(changed.fontSizePt).toBe(12);
		// already migrated data is taken as-is
		expect(mergeSettings({ settingsVersion: 2, fontSizePt: 11 }).fontSizePt).toBe(11);
	});

	it("resolves the print scale", () => {
		expect(resolveScale(0, 80)).toBe(0.8);
		expect(resolveScale(0, undefined)).toBe(1);
		expect(resolveScale(90, 80)).toBe(0.9);
	});

	it("keeps valid folder state and drops garbage", () => {
		const s = mergeSettings({ folderState: { a: { ticked: ["x", 1], known: ["x"], appendix: [], indexPath: 4 }, b: 3 } });
		expect(s.folderState).toEqual({ a: { ticked: ["x"], known: ["x"], appendix: [], indexPath: null } });
	});
});
