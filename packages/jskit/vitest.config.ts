import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		/*
		 * Unit tests sit next to the module they exercise and end in
		 * `.spec.ts`; integration tests live in `tests/` and end in `.test.ts`.
		 * Both are split into `parse/`, `scope/`, and `flow/` the same way the
		 * source is.
		 */
		include: ["src/**/*.spec.ts", "tests/**/*.test.ts"],

		coverage: {
			provider: "v8",

			/*
			 * Only `src/` is measured, and only what actually runs. The
			 * `include` is what puts a source file with no test at all into
			 * the report — without it, v8 reports on loaded modules only, and
			 * an unreached file would be invisible rather than a 0%.
			 */
			include: ["src/**/*.ts"],
			exclude: [
				// The tests themselves, and what they share.
				"src/**/*.spec.ts",
				"src/**/*.spec-helpers.ts",

				/*
				 * Declaration-only modules. These compile to nothing, so v8
				 * has no statements to attribute and reports them as 0%
				 * forever. Anything added here has to be types all the way
				 * down; a single `const` makes it real code again.
				 */
				"src/parse/ast-types.ts",
			],
			reporter: ["text", "html", "json-summary"],

			/*
			 * The whole project is held to one bar rather than each file to
			 * its own, so that a module that is genuinely hard to reach can be
			 * carried by the rest. Raise these when the real number moves up;
			 * never lower them to make a run pass.
			 */
			thresholds: {
				statements: 95,
				branches: 95,
				functions: 95,
				lines: 95,
			},
		},
	},
});
