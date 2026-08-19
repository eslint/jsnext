import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import { eslintParser } from "./packages/jskit/dist/jskit.js";

export default defineConfig([
	/*
	 * `test262` is where AGENTS.md says to clone the suite, and it is 52,000
	 * files of deliberately invalid JavaScript. Linting it is neither wanted nor
	 * survivable.
	 */
	globalIgnores(["**/dist/", "test262/**"]),
	{
		files: ["**/*.js", "**/*.mjs", "**/*.ts"],
		plugins: { js },
		extends: ["js/recommended"],
		languageOptions: {
			parser: eslintParser,
			globals: globals.node,
		},
	},
	{
		files: ["**/*.ts"],

		/*
		 * These two core rules only understand values, so in TypeScript they
		 * report every type name as an undefined variable and every
		 * type-only import as unused. `typescript-eslint` turns them off for
		 * the same reason and supplies type-aware replacements.
		 */
		rules: {
			"no-undef": "off",
			"no-unused-vars": "off",
		},
	},
]);
