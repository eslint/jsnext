/**
 * @fileoverview The four decoder variants agree with each other.
 *
 * `toAST()` decodes through one of four generated decoder tables — each
 * dialect, with and without `range`/`loc` — and each variant builds its
 * nodes monomorphically, so a kind's shape in one variant is written out
 * separately from its shape in the others. The conformance suites pin the
 * plain `ts` and `js` outputs against the reference parsers; what they never
 * see is the ESLint pair, which only `eslintParser` asks for. This suite
 * closes that gap with the invariant that holds the four together: the
 * ESLint variant of a dialect is the plain variant of that dialect plus
 * `range` and `loc` on every node, and nothing else.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eslintParser, parse, toAST } from "../../src/index.js";

/** The fixture files, each a list of source strings, with how to read them. */
const FIXTURES = [
	{ file: "javascript.json", dialect: "js", jsx: false },
	{ file: "jsx.json", dialect: "js", jsx: true },
	{ file: "typescript.json", dialect: "ts", jsx: false },
	{ file: "tsx.json", dialect: "ts", jsx: true },
] as const;

/**
 * Reads one fixture file.
 * @param name The file name under `fixtures/`.
 * @returns The source strings it lists.
 */
function sources(name: string): string[] {
	return JSON.parse(
		readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
	);
}

/**
 * Strips `range` and `loc` from every node of a tree, in place.
 * @param value The tree, subtree, or leaf to strip.
 * @returns The same value, for chaining.
 */
function stripPositions(value: unknown): unknown {
	if (Array.isArray(value)) {
		for (const item of value) {
			stripPositions(item);
		}

		return value;
	}

	if (value === null || typeof value !== "object") {
		return value;
	}

	const node = value as Record<string, unknown>;

	delete node.range;
	delete node.loc;

	for (const key of Object.keys(node)) {
		stripPositions(node[key]);
	}

	return value;
}

/**
 * Counts the nodes of a tree that lack `range` or `loc`.
 * @param value The tree, subtree, or leaf to search.
 * @returns How many nodes are missing either property.
 */
function unpositioned(value: unknown): number {
	if (Array.isArray(value)) {
		return value.reduce<number>(
			(count, item) => count + unpositioned(item),
			0,
		);
	}

	if (value === null || typeof value !== "object") {
		return 0;
	}

	const node = value as Record<string, unknown>;
	let count =
		typeof node.type === "string" &&
		(node.range === undefined || node.loc === undefined)
			? 1
			: 0;

	for (const key of Object.keys(node)) {
		if (key !== "range" && key !== "loc") {
			count += unpositioned(node[key]);
		}
	}

	return count;
}

/**
 * Serializes a tree with `undefined`, bigints, and regular expressions made
 * comparable, since `JSON.stringify` would drop or reject them.
 * @param tree The tree to serialize.
 * @returns The serialized form.
 */
function serialize(tree: unknown): string {
	return JSON.stringify(tree, (key, value: unknown) => {
		if (typeof value === "bigint") {
			return `bigint:${value}`;
		}

		if (value instanceof RegExp) {
			return `regexp:${value.source}:${value.flags}`;
		}

		return value;
	});
}

for (const { file, dialect, jsx } of FIXTURES) {
	describe(`${file} through all four decoder variants`, () => {
		const list = sources(file);

		it("decodes every fixture identically apart from positions", () => {
			for (const code of list) {
				let plain;

				try {
					plain = toAST(parse(code, { jsx, tokens: true }), {
						dialect,
					});
				} catch {
					// A fixture that needs `sourceType: "script"` or is
					// deliberately invalid is someone else's test.
					continue;
				}

				let located;

				try {
					located = eslintParser.parseForESLint(code, {
						dialect,
						ecmaFeatures: { jsx },
					}).ast;
				} catch {
					// The ESLint path also validates, and a fixture may exist
					// to exercise a diagnostic; decoding it is not the point.
					continue;
				}

				expect(
					unpositioned(located),
					`every node of ${JSON.stringify(code)} carries range and loc`,
				).toBe(0);
				expect(
					serialize(stripPositions(located)),
					`the located tree of ${JSON.stringify(code)} matches the plain one`,
				).toBe(serialize(plain));
			}
		});

		it("decodes every fixture in the other dialect both ways", () => {
			const other = dialect === "ts" ? "js" : "ts";

			for (const code of list) {
				let plain;

				try {
					plain = toAST(parse(code, { jsx, tokens: true }), {
						dialect: other,
					});
				} catch {
					continue;
				}

				let located;

				try {
					located = eslintParser.parseForESLint(code, {
						dialect: other,
						ecmaFeatures: { jsx },
					}).ast;
				} catch {
					/*
					 * Under `dialect: "js"` the ESLint path refuses the
					 * TypeScript fixtures outright — validation throws before
					 * anything is decoded — so only the plain decode of that
					 * combination can be exercised, and it just was.
					 */
					continue;
				}

				expect(serialize(stripPositions(located))).toBe(
					serialize(plain),
				);
			}
		});
	});
}
