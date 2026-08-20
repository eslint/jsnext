/**
 * @fileoverview Compares the JavaScript AST and token stream against `espree`.
 */

import { readFileSync } from "node:fs";
import * as espree from "espree";
import { describe, expect, it } from "vitest";
import { parse, toAST } from "../../src/index.js";
import { normalize, normalizeTokens } from "./helpers.js";

const samples: string[] = JSON.parse(
	readFileSync(new URL("./fixtures/javascript.json", import.meta.url), "utf8"),
);

describe("espree conformance", () => {
	for (const code of samples) {
		it(`matches espree for ${JSON.stringify(code)}`, () => {
			/*
			 * `range` is requested because `espree` only fills in the start
			 * and end of a merged template token when it is on.
			 */
			const expected = espree.parse(code, {
				ecmaVersion: "latest",
				sourceType: "module",
				tokens: true,
				comment: true,
				range: true,
			});
			const actual = toAST(parse(code), {
				sourceType: "module",
				dialect: "js",
			}).ast;

			expect(normalize(actual)).toEqual(normalize(expected));
			expect(normalizeTokens(actual.tokens as never)).toEqual(
				normalizeTokens(expected.tokens as never),
			);
			expect(normalizeTokens(actual.comments as never)).toEqual(
				normalizeTokens(expected.comments as never),
			);
		});
	}
});

/*
 * Programs that only exist in sloppy code, which the fixture list cannot hold:
 * every fixture is parsed as a module, and a module is strict. A leading-zero
 * literal is an early error there, so the one place its *shape* can be checked
 * against `espree` is here.
 */
const sloppySamples = [
	"0123.a;",
	"0777.foo;",
	"0123.toString();",
	"08.5 + 08e2 + 01238.5;",
	"01['prop'];",
	"05 .toExponential();",
	"with (a) { b; }",
];

describe("espree conformance in sloppy code", () => {
	for (const code of sloppySamples) {
		it(`matches espree for ${JSON.stringify(code)}`, () => {
			const expected = espree.parse(code, {
				ecmaVersion: "latest",
				sourceType: "script",
				tokens: true,
				comment: true,
				range: true,
			});
			const actual = toAST(parse(code, { sourceType: "script" }), {
				sourceType: "script",
				dialect: "js",
			}).ast;

			expect(normalize(actual)).toEqual(normalize(expected));
			expect(normalizeTokens(actual.tokens as never)).toEqual(
				normalizeTokens(expected.tokens as never),
			);
		});
	}
});

const jsxSamples: string[] = JSON.parse(
	readFileSync(new URL("./fixtures/jsx.json", import.meta.url), "utf8"),
);

describe("espree conformance for JSX", () => {
	for (const code of jsxSamples) {
		it(`matches espree for ${JSON.stringify(code)}`, () => {
			const expected = espree.parse(code, {
				ecmaVersion: "latest",
				sourceType: "module",
				ecmaFeatures: { jsx: true },
				tokens: true,
				comment: true,
				range: true,
			});
			const actual = toAST(parse(code), {
				sourceType: "module",
				dialect: "js",
				jsx: true,
			}).ast;

			expect(normalize(actual)).toEqual(normalize(expected));
			expect(normalizeTokens(actual.tokens as never)).toEqual(
				normalizeTokens(expected.tokens as never),
			);
		});
	}
});

describe("espree token types", () => {
	/**
	 * Collects the reported type of every token.
	 * @param code The source text to tokenize.
	 * @returns One `type:value` string per token.
	 */
	function types(code: string): string[] {
		const { ast } = toAST(parse(code), {
			sourceType: "module",
			dialect: "js",
		});

		return (ast.tokens as { type: string; value: string }[]).map(
			token => `${token.type}:${token.value}`,
		);
	}

	it("reports let, static, and yield as keywords", () => {
		expect(types("let a; class C { static m(){} } function* g(){yield 1}")).toContain(
			"Keyword:let",
		);
		expect(types("class C { static m(){} }")).toContain("Keyword:static");
		expect(types("function* g(){ yield 1; }")).toContain("Keyword:yield");
	});

	it("reports contextual keywords as identifiers", () => {
		expect(types("async function f(){}")).toContain("Identifier:async");
		expect(types("for (a of b);")).toContain("Identifier:of");
		expect(types("import a from 'b';")).toContain("Identifier:from");
	});

	it("reports a keyword used as a property name as an identifier", () => {
		expect(types("a.default = 1;")).toContain("Identifier:default");
		expect(types("({ if: 1 });")).toContain("Identifier:if");
	});

	it("reports booleans and null with their own types", () => {
		expect(types("true; false; null;")).toEqual([
			"Boolean:true",
			"Punctuator:;",
			"Boolean:false",
			"Punctuator:;",
			"Null:null",
			"Punctuator:;",
		]);
	});

	it("merges template pieces the way espree does", () => {
		expect(types("`a${b}c`;")).toEqual([
			"Template:`a${",
			"Identifier:b",
			"Template:}c`",
			"Punctuator:;",
		]);
	});

	it("strips the hash from a private identifier's value", () => {
		expect(types("class C { #x; }")).toContain("PrivateIdentifier:x");
	});
});
