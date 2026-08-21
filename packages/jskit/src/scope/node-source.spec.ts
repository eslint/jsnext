/**
 * @fileoverview Unit tests for turning stored handles back into nodes.
 *
 * A scope buffer's handles mean one thing on the binary path and another on
 * the tree path, and nothing in the buffer's own bytes says which. The
 * consumer supplies the program, and this module's job is to reject a program
 * from the wrong path loudly rather than hand back nodes that are not the
 * caller's.
 */

import { describe, expect, it } from "vitest";
import { AstReader, parse } from "../parse/index.js";
import type { EsTreeNode } from "./estree-ast.js";
import { nodeHandle } from "./handles.js";
import { resolveNodeSource } from "./node-source.js";

/** A parse buffer for a program with one statement in it. */
const BUFFER = parse("let a = 1;");

describe("resolveNodeSource()", () => {
	describe("the binary path", () => {
		it("accepts a parse result", () => {
			const source = resolveNodeSource(BUFFER, false);

			expect(source.reader).toBeInstanceOf(AstReader);
			expect(source.ast.typeName(source.reader!.root)).toBe("Program");
		});

		it("accepts a reader already built over one", () => {
			const reader = new AstReader(BUFFER);
			const source = resolveNodeSource(reader, false);

			expect(source.reader).toBe(reader);
		});

		it("round-trips a node through its handle", () => {
			const reader = new AstReader(BUFFER);
			const source = resolveNodeSource(reader, false);
			const handle = nodeHandle(reader, reader.root);

			expect(source.handleOf(reader.root)).toBe(handle);
			expect(source.nodeAt(handle)).toBe(reader.root);
		});

		it("refuses a parse result for a buffer that stores tree handles", () => {
			expect(() => resolveNodeSource(BUFFER, true)).toThrow(
				/came from analyzeTree\(\)/u,
			);
		});

		it("refuses a reader for a buffer that stores tree handles", () => {
			expect(() =>
				resolveNodeSource(new AstReader(BUFFER), true),
			).toThrow(/came from analyzeTree\(\)/u);
		});
	});

	describe("the tree path", () => {
		/**
		 * Builds a small tree to enumerate.
		 * @returns The `Program` node and the one node under it.
		 */
		function tree(): { program: EsTreeNode; identifier: EsTreeNode } {
			const identifier: EsTreeNode = { type: "Identifier", name: "a" };
			const program: EsTreeNode = {
				type: "Program",
				body: [{ type: "ExpressionStatement", expression: identifier }],
			};

			return { program, identifier };
		}

		it("accepts the `Program` node the analysis ran over", () => {
			const { program } = tree();
			const source = resolveNodeSource(program, true);

			expect(source.reader).toBeNull();
			expect(source.ast.typeName(program)).toBe("Program");
		});

		it("round-trips a node through its handle", () => {
			const { program, identifier } = tree();
			const source = resolveNodeSource(program, true);

			expect(source.handleOf(program)).toBe(1);
			expect(source.nodeAt(1)).toBe(program);
			expect(source.nodeAt(source.handleOf(identifier))).toBe(identifier);
		});

		it("reports a node that is not in the program as handle 0", () => {
			const { program } = tree();
			const source = resolveNodeSource(program, true);

			expect(source.handleOf({ type: "Identifier", name: "z" })).toBe(0);
		});

		it("refuses a `Program` node for a buffer that stores binary handles", () => {
			expect(() => resolveNodeSource(tree().program, false)).toThrow(
				/came from analyze\(\)/u,
			);
		});
	});

	it("refuses anything that is neither", () => {
		for (const value of [null, undefined, 42, "Program", {}]) {
			expect(() => resolveNodeSource(value as never, false)).toThrow(
				/Expected a parse result, an AstReader, or a Program node/u,
			);
		}
	});
});
