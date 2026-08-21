/**
 * @fileoverview Unit tests for the low-level scope buffer reader.
 *
 * `Scopes`, `toScopeManager()`, and `toScopeTree()` all read the format
 * through this class, so its accessors are exercised heavily from above. What
 * this file pins is the part above never asks for: `listItem()`, which reads
 * a pool list one entry at a time rather than all at once, and the header
 * check that decides whether the buffer is one of ours at all.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../parse/index.js";
import { analyze, analyzeTree } from "./index.js";
import { S_THROUGH, S_VARIABLES, V_REFERENCES } from "./scope-buffer.js";
import { ScopeBufferReader } from "./scope-buffer-reader.js";
import type { EsTreeNode } from "./estree-ast.js";

/**
 * Parses and analyzes one program on the binary path.
 * @param code The source text.
 * @returns The reader over the scope buffer.
 */
function readerFor(code: string): ScopeBufferReader {
	return new ScopeBufferReader(
		analyze(parse(code), { sourceType: "module" }),
	);
}

describe("ScopeBufferReader", () => {
	describe("the header", () => {
		it("refuses a buffer that is not a scope buffer", () => {
			expect(() => new ScopeBufferReader(new ArrayBuffer(64))).toThrow(
				TypeError,
			);
			expect(() => new ScopeBufferReader(parse("a;"))).toThrow(TypeError);
		});

		it("reports the counts the buffer holds", () => {
			const reader = readerFor(
				"const a = 1; function f(b) { return a; }",
			);

			expect(reader.scopeCount).toBeGreaterThan(1);
			expect(reader.symbolCount).toBeGreaterThan(1);
			expect(reader.referenceCount).toBeGreaterThan(0);
			expect(reader.definitionCount).toBeGreaterThan(0);
		});

		it("records which path wrote the buffer", () => {
			const tree: EsTreeNode = {
				type: "Program",
				body: [],
				range: [0, 0],
			};

			expect(readerFor("a;").treeHandles).toBe(false);
			expect(new ScopeBufferReader(analyzeTree(tree)).treeHandles).toBe(
				true,
			);
		});
	});

	describe("lists", () => {
		it("reads a list one item at a time and all at once alike", () => {
			const reader = readerFor(
				"const a = 1, b = 2; function f() { return a + b + missing; }",
			);
			let checked = 0;

			for (let scope = 0; scope < reader.scopeCount; scope++) {
				for (const field of [S_VARIABLES, S_THROUGH]) {
					const handle = reader.scopeField(scope, field);
					const items = reader.listItems(handle);

					expect(reader.listCount(handle)).toBe(items.length);

					for (let i = 0; i < items.length; i++) {
						expect(reader.listItem(handle, i)).toBe(items[i]);
					}

					checked += items.length;
				}
			}

			for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
				const handle = reader.symbolField(symbol, V_REFERENCES);
				const items = reader.listItems(handle);

				for (let i = 0; i < items.length; i++) {
					expect(reader.listItem(handle, i)).toBe(items[i]);
				}

				checked += items.length;
			}

			expect(checked).toBeGreaterThan(1);
		});

		it("reports the empty handle as an empty list", () => {
			const reader = readerFor("a;");

			expect(reader.listCount(0)).toBe(0);
			expect(reader.listItems(0)).toEqual([]);
		});
	});

	describe("the node indexes", () => {
		it("reports no scopes and no references for a handle it never saw", () => {
			const reader = readerFor("const a = 1;");

			expect(reader.scopesOfNode(0)).toEqual([]);
			expect(reader.referencesAtIdentifier(0)).toEqual([]);
		});
	});
});
