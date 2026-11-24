import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		exclude: ["test/e2e/**", ".obsidian-cache/**", "node_modules/**"],
		pool: "forks",
		testTimeout: 30_000,
	},
});
