import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import { eslintParser } from "./packages/jsparse/dist/jsparse.js";

export default defineConfig([
	globalIgnores(["**/dist/"]),
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
