/**
 * @fileoverview Unit tests for the tree-path handle enumeration.
 *
 * A tree handle is a node's position in this enumeration, and a consumer runs
 * the enumeration a second time to turn handles back into objects. Everything
 * here is really one property: **the same tree enumerates the same way every
 * time**, and it holds for trees a real parser would never produce.
 */

import { describe, expect, it } from "vitest";
import { collectTreeNodes, isEsTreeNode } from "./tree-nodes.js";
import type { EsTreeNode } from "./estree-ast.js";

/**
 * A node with whatever properties a test needs.
 * @param type The ESTree `type`.
 * @param rest The rest of the node's properties.
 * @returns The node.
 */
function node(type: string, rest: Record<string, unknown> = {}): EsTreeNode {
	return { type, ...rest };
}

describe("isEsTreeNode()", () => {
	it("accepts an object with a string `type`", () => {
		expect(isEsTreeNode(node("Identifier"))).toBe(true);
	});

	it("rejects everything else", () => {
		expect(isEsTreeNode(null)).toBe(false);
		expect(isEsTreeNode(undefined)).toBe(false);
		expect(isEsTreeNode("Identifier")).toBe(false);
		expect(isEsTreeNode(42)).toBe(false);
		expect(isEsTreeNode({})).toBe(false);
		expect(isEsTreeNode({ type: 1 })).toBe(false);
		expect(isEsTreeNode([])).toBe(false);
	});
});

describe("collectTreeNodes()", () => {
	it("enumerates the root first, then depth first in property order", () => {
		const a = node("Identifier", { name: "a" });
		const b = node("Identifier", { name: "b" });
		const inner = node("ExpressionStatement", { expression: a });
		const program = node("Program", { body: [inner, b] });

		expect(collectTreeNodes(program)).toEqual([program, inner, a, b]);
	});

	it("gives every node a distinct one-based handle", () => {
		const a = node("Identifier", { name: "a" });
		const program = node("Program", { body: [a] });
		const nodes = collectTreeNodes(program);

		expect(nodes.indexOf(program) + 1).toBe(1);
		expect(nodes.indexOf(a) + 1).toBe(2);
	});

	it("enumerates the same tree the same way every time", () => {
		const program = node("Program", {
			body: [
				node("ExpressionStatement", {
					expression: node("Identifier", { name: "a" }),
				}),
				node("ExpressionStatement", {
					expression: node("Identifier", { name: "b" }),
				}),
			],
		});

		expect(collectTreeNodes(program)).toEqual(collectTreeNodes(program));
	});

	it("skips `parent` so a linked tree does not cycle", () => {
		const program = node("Program", { body: [] });
		const child = node("Identifier", { name: "a", parent: program });

		(program.body as unknown[]).push(child);

		expect(collectTreeNodes(program)).toEqual([program, child]);
	});

	it("visits a node reachable twice only once", () => {
		const shared = node("Identifier", { name: "a" });
		const program = node("Program", { body: [shared], extra: shared });

		expect(collectTreeNodes(program)).toEqual([program, shared]);
	});

	it("skips the root's tokens and comments", () => {
		const token = node("Punctuator");
		const comment = node("Line");
		const body = node("ExpressionStatement");
		const program = node("Program", {
			body: [body],
			tokens: [token],
			comments: [comment],
		});

		expect(collectTreeNodes(program)).toEqual([program, body]);
	});

	it("keeps tokens and comments on a node that is not the root", () => {
		const token = node("Punctuator");
		const inner = node("SomeParserExtension", { tokens: [token] });
		const program = node("Program", { body: [inner] });

		expect(collectTreeNodes(program)).toEqual([program, inner, token]);
	});

	it("descends into properties of a node type it does not know", () => {
		const inner = node("Identifier", { name: "a" });
		const unknown = node("SomeParserExtension", {
			whatever: inner,
			plain: "text",
			mixed: ["text", null, 7],
		});
		const program = node("Program", { body: [unknown] });

		expect(collectTreeNodes(program)).toEqual([program, unknown, inner]);
	});

	it("enumerates a root with nothing under it", () => {
		const program = node("Program", { body: [] });

		expect(collectTreeNodes(program)).toEqual([program]);
	});
});
