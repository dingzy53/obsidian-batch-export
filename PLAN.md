# PLAN: QA audit fixes (batch-export)

> Branch: `fix/qa-audit-fixes` (from `feat/e2e-testing`) · Date: 2026-11-24 · Status: Implemented and verified.

## Scope from `OBSIDIAN_PLUGINS_QA_REPORT.md`

- **P3 / Cancellation reliability & feedback**:
  - Check `reporter.cancelled` right after every `await` in `runExport` (`src/exporter.ts`) including immediately before `fsp.rename(finalTmp, request.outPath)`, and in `settle` (`src/render/settle.ts`) so cancellation prevents final `.pdf` creation while letting in-flight `print-to-pdf` IPC finish and restore window background.
  - Disable the Cancel button immediately after click in `src/ui/progress.ts`.
- **P3 / Modal & collection UX**:
  - Stop mutating `this.settings.openAfterExport` from the modal checkbox in `src/main.ts`.
  - Auto-select a same-named folder note (`Book/Book.md`) as the default index note only when it links to at least one sibling note in the folder (`src/collect/order.ts`, `src/collect/folder.ts`, `test/order.test.ts`).
- **Settings UI & US English polish**:
  - Omit `min`/`max` on numeric settings so unified period-ended `range()` validation messages always appear, and combine the 4 margin inputs into a single compact `"Margins (mm)"` row (`src/settings.ts`, `styles.css`).
  - Normalize UK -> US spelling across user-facing strings (`Behavior`, `colors`, `Canceling…`, `canceled`) in `src/settings.ts`, `src/ui/SummaryModal.ts`, `src/ui/progress.ts`, `src/exporter.ts`, `src/main.ts`, and `README.md`.

## Order of Work

1. `[x]` Add comprehensive cancellation checks (`src/exporter.ts`, `src/render/settle.ts`, `src/ui/progress.ts`).
2. `[x]` Stop overwriting global `openAfterExport` (`src/main.ts`) and add `pickDefaultIndexPath` (`src/collect/order.ts`, `src/collect/folder.ts`, `test/order.test.ts`).
3. `[x]` Compact `"Margins (mm)"` row, omit `min`/`max` for consistent validation messages, and normalize US English (`src/settings.ts`, `src/ui/SummaryModal.ts`, `styles.css`, `README.md`).
4. `[x]` Run `npm run build && npm run check:mobile && npm run lint && npm test`, mark plan verified, and push `fix/qa-audit-fixes`.
