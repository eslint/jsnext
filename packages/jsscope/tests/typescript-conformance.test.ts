/**
 * @fileoverview Compares the scope graph against
 * `@typescript-eslint/scope-manager`.
 *
 * The reference analyzer runs with `lib: []` and no JSX pragma, for the reason
 * the conformance script explains: those are the two places where its defaults
 * add names that have nothing to do with the program being analyzed.
 */

import { readFileSync } from "node:fs";
import { analyze as analyzeReference } from "@typescript-eslint/scope-manager";
import { parse as parseReference } from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import { parse } from "@eslint/jsparse";
import { analyze, analyzeTree, toScopeManager } from "../src/index.js";
import {
	serializeBinary,
	serializeReference,
} from "../scripts/serialize.mjs";

/** The fields both implementations fill in. */
const FLAGS = {
	index: false,
	partial: false,
	typeRefs: true,
	dropLibVariables: true,
};

/**
 * The same fields, plus the adjustment the binary path needs: the buffer holds
 * `espree`'s notion of how far a `Program` reaches, and the decoder derives
 * `@typescript-eslint/parser`'s from it.
 */
const BINARY_FLAGS = { ...FLAGS, tsProgramExtent: true };

/**
 * Reads a fixture file of source snippets.
 * @param name The fixture's file name.
 * @returns The snippets it holds.
 */
function fixture(name: string): string[] {
	return JSON.parse(
		readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
	);
}

/**
 * Checks one snippet against the reference implementation.
 * @param code The source text to analyze.
 * @param jsx Whether the snippet is TSX.
 * @returns Nothing.
 */
function compare(code: string, jsx: boolean): void {
	const tree = parseReference(code, {
		sourceType: "module",
		range: true,
		loc: false,
		jsx,
	});
	/*
	 * `const` is the one name the reference analyzer injects even with
	 * `lib: []`, so that `x as const` resolves.
	 */
	const options = {
		sourceType: "module" as const,
		dialect: "ts" as const,
		jsx,
		globals: ["const"],
	};
	const expected = serializeReference(
		analyzeReference(tree, {
			sourceType: "module",
			lib: [],
			jsxPragma: null,
		}),
		FLAGS,
	);

	const parsed = parse(code);

	expect(
		serializeBinary(
			toScopeManager(analyze(parsed, options), parsed),
			BINARY_FLAGS,
		),
	).toEqual(expected);
	expect(
		serializeReference(
			toScopeManager(analyzeTree(tree, options), tree),
			FLAGS,
		),
	).toEqual(expected);
}

describe("typescript-eslint scope-manager conformance", () => {
	for (const code of fixture("typescript.json")) {
		it(`matches the reference for ${JSON.stringify(code)}`, () => {
			compare(code, false);
		});
	}
});

describe("typescript-eslint scope-manager conformance for TSX", () => {
	for (const code of fixture("tsx.json")) {
		it(`matches the reference for ${JSON.stringify(code)}`, () => {
			compare(code, true);
		});
	}
});
