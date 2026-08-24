/**
 * @fileoverview Compares the TypeScript AST against `@typescript-eslint/parser`.
 */

import { readFileSync } from "node:fs";
import { parse as tsParse } from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import { parse, toAST } from "../../src/index.js";
import { asReferenceProgramExtent, normalize } from "./helpers.js";

const samples: string[] = JSON.parse(
	readFileSync(
		new URL("./fixtures/typescript.json", import.meta.url),
		"utf8",
	),
);

describe("typescript-eslint conformance", () => {
	for (const code of samples) {
		it(`matches @typescript-eslint/parser for ${JSON.stringify(code).slice(0, 60)}`, () => {
			const expected = tsParse(code, {
				sourceType: "module",
				range: true,
				loc: false,
			});
			const actual = toAST(parse(code, { tokens: true }), {
				sourceType: "module",
				dialect: "ts",
			});

			expect(normalize(asReferenceProgramExtent(actual, code))).toEqual(
				normalize(expected),
			);
		});
	}
});

const jsxSamples: string[] = [
	...JSON.parse(
		readFileSync(new URL("./fixtures/jsx.json", import.meta.url), "utf8"),
	),
	...JSON.parse(
		readFileSync(new URL("./fixtures/tsx.json", import.meta.url), "utf8"),
	),
].filter(
	// TypeScript rejects a member access directly on a JSX element.
	(code: string) => !code.includes("<div/>.props"),
);

describe("typescript-eslint conformance for JSX", () => {
	for (const code of jsxSamples) {
		it(`matches @typescript-eslint/parser for ${JSON.stringify(code).slice(0, 60)}`, () => {
			const expected = tsParse(code, {
				sourceType: "module",
				range: true,
				loc: false,
				jsx: true,
			});
			const actual = toAST(parse(code, { tokens: true }), {
				sourceType: "module",
				dialect: "ts",
			});

			expect(normalize(asReferenceProgramExtent(actual, code))).toEqual(
				normalize(expected),
			);
		});
	}
});

describe("javascript mode output", () => {
	it("omits TypeScript-only properties", () => {
		const ast = toAST(parse("import a from 'b';", { tokens: true }), {
			dialect: "js",
		});
		const declaration = (ast.body as Record<string, unknown>[])[0];

		expect(declaration.importKind).toBeUndefined();
	});

	it("includes TypeScript-only properties in TypeScript mode", () => {
		const ast = toAST(parse("import a from 'b';", { tokens: true }), {
			dialect: "ts",
		});
		const declaration = (ast.body as Record<string, unknown>[])[0];

		expect(declaration.importKind).toBe("value");
	});
});
