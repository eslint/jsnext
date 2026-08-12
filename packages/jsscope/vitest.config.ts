import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		/*
		 * Unit tests sit next to the module they exercise and end in
		 * `.spec.ts`; integration tests live in `tests/` and end in `.test.ts`.
		 */
		include: ["src/**/*.spec.ts", "tests/**/*.test.ts"],
	},
});
