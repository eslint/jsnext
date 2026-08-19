/**
 * @fileoverview Compares the scope graph against `eslint-scope`.
 *
 * Both entry points are checked against the same `eslint-scope` result: the
 * binary one over buffers the parser produced from the same source, and
 * the tree one over the very `espree` tree `eslint-scope` was handed.
 *
 * `node_modules` holds no `.jsx` files, so the JSX fixtures here are the only
 * coverage JSX gets outside of a real React codebase. Everything else in this
 * file is a second, faster check on ground the differential corpus already
 * walks.
 */

import { readFileSync } from "node:fs";
import { analyze as analyzeReference } from "eslint-scope";
import { KEYS } from "eslint-visitor-keys";
import * as espree from "espree";
import { describe, expect, it } from "vitest";
import {
	analyze,
	analyzeTree,
	parse,
	toScopeManager,
} from "../../src/index.js";
import {
	serializeBinary,
	serializeReference,
} from "../../scripts/scope/serialize.mjs";

/** The fields both implementations fill in. */
const FLAGS = { index: true, partial: true, typeRefs: false };

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
 *
 * A snippet that `espree` rejects under one source type — `with` in a module,
 * say — has nothing to compare against there, so it is reported as skipped
 * rather than compared. The caller insists that at least one source type
 * worked, so a fixture cannot quietly stop being checked.
 * @param code The source text to analyze.
 * @param sourceType How the program should be interpreted.
 * @param jsx Whether JSX identifiers count as references.
 * @returns `true` when the two implementations were actually compared.
 */
function compare(
	code: string,
	sourceType: "script" | "module",
	jsx: boolean,
): boolean {
	let tree;

	try {
		tree = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType,
			range: true,
			ecmaFeatures: { jsx },
		});
	} catch {
		return false;
	}

	const options = { sourceType, dialect: "js" as const, jsx };
	const expected = serializeReference(
		/*
		 * `childVisitorKeys` is what ESLint's own `Linter` passes, and it
		 * matters: without it `esrecurse` falls back to `estraverse`'s table,
		 * where `ImportExpression` still names only `source`, so nothing in
		 * `import(specifier, options)` is ever visited. Comparing against that
		 * would be comparing against an `eslint-scope` nobody runs.
		 */
		analyzeReference(tree, {
			ecmaVersion: 2025,
			sourceType,
			jsx,
			childVisitorKeys: KEYS,
		}),
		FLAGS,
	);

	const parsed = parse(code);

	expect(
		serializeBinary(toScopeManager(analyze(parsed, options), parsed), FLAGS),
	).toEqual(expected);
	expect(
		serializeReference(
			toScopeManager(analyzeTree(tree, options), tree),
			FLAGS,
		),
	).toEqual(expected);

	return true;
}

describe("eslint-scope conformance", () => {
	for (const code of fixture("javascript.json")) {
		it(`matches eslint-scope for ${JSON.stringify(code)}`, () => {
			/*
			 * Both source types are checked, because the choice decides
			 * whether the top level is strict, whether a module scope exists,
			 * and where an undeclared assignment lands.
			 */
			const asModule = compare(code, "module", false);
			const asScript = compare(code, "script", false);

			expect(asModule || asScript).toBe(true);
		});
	}
});

describe("eslint-scope conformance for JSX", () => {
	for (const code of fixture("jsx.json")) {
		it(`matches eslint-scope for ${JSON.stringify(code)}`, () => {
			expect(compare(code, "module", true)).toBe(true);
		});
	}

	it("creates no reference when JSX support is off", () => {
		const parsed = parse("const a = <Component />;");
		const scopeManager = toScopeManager(
			analyze(parsed, {
				sourceType: "module",
				dialect: "js",
				jsx: false,
			}),
			parsed,
		);
		const moduleScope = scopeManager.scopes[1];

		expect(moduleScope.through).toHaveLength(0);
	});
});
