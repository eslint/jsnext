/**
 * @fileoverview Compares the visitor keys against
 * `@typescript-eslint/visitor-keys`.
 *
 * The table says how a tree this package produced should be walked, so it is
 * right exactly when it matches the table for the tree it reproduces — key for
 * key, and in the same order, since the order is the order a walk visits
 * siblings in.
 *
 * This is also what catches a node kind added without an entry: every kind the
 * parser can emit is checked, not just the ones the table happens to list.
 */

import { visitorKeys as referenceKeys } from "@typescript-eslint/visitor-keys";
import { KEYS as javascriptKeys } from "eslint-visitor-keys";
import { describe, expect, it } from "vitest";
import {
	NODE_KIND_COUNT,
	NODE_KIND_NAMES,
	VISITOR_KEYS,
} from "../../src/index.js";

/** Every node type the parser can produce, in kind order. */
const NODE_TYPES = Array.from(
	{ length: NODE_KIND_COUNT },
	(_, kind) => NODE_KIND_NAMES[kind],
).filter(name => name !== "");

describe("VISITOR_KEYS", () => {
	it("covers every node kind the parser can emit", () => {
		expect(Object.keys(VISITOR_KEYS).sort()).toEqual(
			[...NODE_TYPES].sort(),
		);
	});

	describe("matches @typescript-eslint/visitor-keys", () => {
		for (const type of NODE_TYPES) {
			it(`states the children of ${type}`, () => {
				expect(VISITOR_KEYS[type]).toEqual(referenceKeys[type]);
			});
		}
	});

	/*
	 * `eslint-visitor-keys` is the table ESLint falls back to, and the one the
	 * JavaScript half of the tree has to be walkable with. The entries here
	 * carry the TypeScript properties as well, so the check is that the
	 * JavaScript keys are all present and in the same relative order.
	 */
	it("keeps every JavaScript key eslint-visitor-keys names, in order", () => {
		for (const type of NODE_TYPES) {
			const expected =
				javascriptKeys[type as keyof typeof javascriptKeys];

			if (!expected) {
				continue;
			}

			expect(
				VISITOR_KEYS[type].filter(key =>
					(expected as readonly string[]).includes(key),
				),
			).toEqual([...expected]);
		}
	});
});
