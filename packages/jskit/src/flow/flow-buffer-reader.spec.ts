/**
 * @fileoverview Unit tests for the low-level flow buffer reader.
 *
 * Everything that consumes the flow format reads it through this class, so a
 * mistake here is a mistake everywhere. `toGraphTree()` exercises the record
 * accessors thoroughly on its way to a tree; what this file adds is the
 * header check, the two list accessors read against each other, and the
 * binary search over the node-block index — including the misses, which a
 * rendered tree never asks about.
 */

import { describe, expect, it } from "vitest";
import { analyze } from "../scope/index.js";
import { AstReader, parse } from "../parse/index.js";
import {
	G_BLOCK_COUNT,
	G_FIRST_BLOCK,
	G_RETURNED,
	G_THROWN,
} from "./flow-buffer.js";
import { FlowBufferReader } from "./flow-buffer-reader.js";
import { createGraph } from "./index.js";
import { nodeHandle } from "./handles.js";

/**
 * Parses, analyzes, and graphs one program.
 * @param code The source text.
 * @returns The reader over the flow buffer, and one over the parse buffer.
 */
function graphOf(code: string): { reader: FlowBufferReader; ast: AstReader } {
	const parsed = parse(code);
	const scope = analyze(parsed, { sourceType: "module" });

	return {
		reader: new FlowBufferReader(createGraph(parsed, scope)),
		ast: new AstReader(parsed),
	};
}

describe("FlowBufferReader", () => {
	describe("the header", () => {
		it("refuses a buffer that is not a flow buffer", () => {
			expect(() => new FlowBufferReader(new ArrayBuffer(64))).toThrow(
				TypeError,
			);
			expect(() => new FlowBufferReader(parse("a;"))).toThrow(
				/Not a jskit flow buffer/u,
			);
		});

		it("reports the counts the buffer holds", () => {
			const { reader } = graphOf("if (a) { b(); } else { c(); }");

			expect(reader.graphCount).toBe(1);
			expect(reader.blockCount).toBeGreaterThan(1);
			expect(reader.edgeCount).toBeGreaterThan(1);
		});

		it("counts the writes a program records", () => {
			const { reader } = graphOf("let a = 1; a = 2;");

			expect(reader.writeCount).toBe(2);
		});
	});

	describe("lists", () => {
		it("reads a list one item at a time and all at once alike", () => {
			const { reader } = graphOf(
				"function f(p) { if (p) { return 1; } throw e; }",
			);
			let checked = 0;

			for (let graph = 0; graph < reader.graphCount; graph++) {
				for (const field of [G_RETURNED, G_THROWN]) {
					const handle = reader.graphField(graph, field);
					const items = reader.listItems(handle);

					expect(reader.listCount(handle)).toBe(items.length);

					for (let i = 0; i < items.length; i++) {
						expect(reader.listItem(handle, i)).toBe(items[i]);
					}

					checked += items.length;
				}
			}

			expect(checked).toBeGreaterThan(1);
		});

		it("reports the empty handle as an empty list", () => {
			const { reader } = graphOf("a;");

			expect(reader.listCount(0)).toBe(0);
			expect(reader.listItems(0)).toEqual([]);
		});
	});

	describe("the node-block index", () => {
		it("finds the block a node executes in", () => {
			const { reader, ast } = graphOf("a;");
			const graphBlock = reader.graphField(0, G_FIRST_BLOCK);

			// The root is the program, which sits in the graph's first block.
			expect(reader.blockOfNode(nodeHandle(ast, ast.root))).toBe(
				graphBlock,
			);
			expect(reader.graphField(0, G_BLOCK_COUNT)).toBeGreaterThan(0);
		});

		it("reports -1 for a handle the walk never recorded", () => {
			const { reader } = graphOf("a;");

			// Before the first entry, after the last, and between two.
			expect(reader.blockOfNode(0)).toBe(-1);
			expect(reader.blockOfNode(0xffffff)).toBe(-1);
			expect(reader.blockOfNode(1)).toBe(-1);
		});

		it("reports an unrecorded node as unreachable", () => {
			const { reader, ast } = graphOf("a;");

			expect(reader.isReachable(0)).toBe(false);
			expect(reader.isReachable(nodeHandle(ast, ast.root))).toBe(true);
		});

		it("tells a reachable node from an unreachable one", () => {
			const { reader, ast } = graphOf("function f() { return; g(); }");
			let sawReachable = false;
			let sawUnreachable = false;

			for (let node = 1; node < ast.nodeCount; node++) {
				const block = reader.blockOfNode(nodeHandle(ast, node));

				if (block < 0) {
					continue;
				}

				if (reader.isReachable(nodeHandle(ast, node))) {
					sawReachable = true;
				} else {
					sawUnreachable = true;
				}
			}

			expect(sawReachable).toBe(true);
			expect(sawUnreachable).toBe(true);
		});
	});

	describe("predecessors", () => {
		it("reads the predecessor section entry by entry", () => {
			const { reader } = graphOf("if (a) { b(); }");

			expect(reader.predecessorEdge(0)).toBeTypeOf("number");
		});
	});
});
