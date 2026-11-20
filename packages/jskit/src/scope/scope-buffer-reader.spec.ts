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
import {
	BINDING_ORIGIN_ARGUMENTS,
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_FUNCTION_NAME,
	BINDING_ORIGIN_IMPLICIT_GLOBAL,
	BINDING_ORIGIN_PARAMETER,
	BINDING_ORIGIN_UNRESOLVED,
	BINDING_ORIGIN_VARIABLE,
	R_IDENTIFIER,
	R_NAME,
	S_THROUGH,
	S_VARIABLES,
	V_REFERENCES,
} from "./scope-buffer.js";
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
			expect(reader.firstReferenceAtIdentifier(0)).toBe(-1);
		});

		it("finds the first reference at every recorded identifier", () => {
			const reader = readerFor(
				"let a = 1; a += 2; function f(b) { return a + b + missing; } f(a);",
			);

			expect(reader.referenceCount).toBeGreaterThan(5);

			for (let ref = 0; ref < reader.referenceCount; ref++) {
				const handle = reader.referenceField(ref, R_IDENTIFIER);

				expect(reader.firstReferenceAtIdentifier(handle)).toBe(
					reader.referencesAtIdentifier(handle)[0],
				);
			}
		});

		it("misses a handle between, before, or after the recorded ones", () => {
			const reader = readerFor("a; b; c;");
			const handles = Array.from(
				{ length: reader.referenceCount },
				(_, ref) => reader.referenceField(ref, R_IDENTIFIER),
			).sort((x, y) => x - y);

			expect(handles).toHaveLength(3);
			expect(reader.firstReferenceAtIdentifier(handles[0] - 1)).toBe(-1);
			expect(reader.firstReferenceAtIdentifier(handles[1] - 1)).toBe(-1);
			expect(reader.firstReferenceAtIdentifier(handles[2] + 1)).toBe(-1);
		});
	});

	describe("binding origins", () => {
		/**
		 * Analyzes a script with `Promise` configured, and answers the
		 * origins of the first reference to each name.
		 * @param code The source text.
		 * @returns The origins by name.
		 */
		function originsByName(code: string): Map<string, number> {
			const reader = new ScopeBufferReader(
				analyze(parse(code, { sourceType: "script" }), {
					sourceType: "script",
					globals: ["Promise"],
				}),
			);
			const origins = new Map<string, number>();

			for (let ref = 0; ref < reader.referenceCount; ref++) {
				const name = reader.string(reader.referenceField(ref, R_NAME));

				if (!origins.has(name)) {
					origins.set(name, reader.referenceOrigins(ref));
				}
			}

			return origins;
		}

		it("answers each kind of origin for a reference", () => {
			const origins = originsByName(
				"var v; function f(p) { arguments; v; p; Promise; missing; made; } made = 1; var f;",
			);

			expect(origins.get("v")).toBe(BINDING_ORIGIN_VARIABLE);
			expect(origins.get("p")).toBe(BINDING_ORIGIN_PARAMETER);
			expect(origins.get("arguments")).toBe(BINDING_ORIGIN_ARGUMENTS);
			expect(origins.get("Promise")).toBe(
				BINDING_ORIGIN_CONFIGURED_GLOBAL,
			);
			expect(origins.get("missing")).toBe(BINDING_ORIGIN_UNRESOLVED);
			expect(origins.get("made")).toBe(BINDING_ORIGIN_IMPLICIT_GLOBAL);
		});

		it("answers a symbol's origins as the union of its declarations", () => {
			const reader = new ScopeBufferReader(
				analyze(
					parse("var f; function f() {}", { sourceType: "script" }),
					{
						sourceType: "script",
					},
				),
			);

			expect(reader.symbolOrigins(0)).toBe(
				BINDING_ORIGIN_VARIABLE | BINDING_ORIGIN_FUNCTION_NAME,
			);
		});
	});
});
