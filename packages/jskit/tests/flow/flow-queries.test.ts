/**
 * @fileoverview The recorded writes, the node-block index, and the two ways
 * of reading a flow buffer.
 */

import { analyzeTree, createGraph, toGraphTree } from "../../src/index.js";
import * as espree from "espree";
import { describe, expect, it } from "vitest";
import {
	graphOf,
	handleAt,
	handleOf,
	nodeTextOf,
	writesOf,
} from "./helpers.js";

describe("writes", () => {
	it("classifies each kind of variable write", () => {
		const code = "let a = 1; a = 2; a += 3; a++;";
		const { tree } = graphOf(code);
		const writes = writesOf(tree.graphs[0]);

		expect(
			writes.map(
				write =>
					`${write.symbol}:${write.init ? "init" : ""}${
						write.compound ? "compound" : ""
					}${write.update ? "update" : ""}`,
			),
		).toEqual(["a:init", "a:", "a:compound", "a:update"]);

		// Writes read back in execution order with their values attached.
		expect(writes[0].value?.start).toBe(code.indexOf("1"));
		expect(writes[1].value?.start).toBe(code.indexOf("2"));
	});

	it("records one write per destructured identifier", () => {
		const { tree } = graphOf("const { a, b: [c] } = source;");
		const symbols = writesOf(tree.graphs[0]).map(write => write.symbol);

		expect(symbols).toEqual(["a", "c"]);
		expect(
			writesOf(tree.graphs[0]).every(write => write.init),
		).toBe(true);
	});

	it("records member writes with no symbol", () => {
		const code = "obj.field = compute();";
		const { tree } = graphOf(code);
		const [write] = writesOf(tree.graphs[0]);

		expect(write.member).toBe(true);
		expect(write.symbol).toBeNull();
		expect(write.target.type).toBe("MemberExpression");
		expect(write.value?.start).toBe(code.indexOf("compute"));
	});

	it("records member targets inside destructuring", () => {
		const { tree } = graphOf("let b;\n[obj.a, b] = pair;");
		const writes = writesOf(tree.graphs[0]);

		expect(writes.map(write => write.member)).toEqual([true, false]);
		expect(writes[1].symbol).toBe("b");
	});

	it("records the for...in write against its loop body", () => {
		const { tree } = graphOf("let key;\nfor (key in obj) { use(key); }");
		const [write] = writesOf(tree.graphs[0]);

		expect(write.symbol).toBe("key");

		// The write repeats per iteration, so it sits past the loop head.
		expect(write.blockId).not.toBe(tree.graphs[0].initial);
	});

	it("puts a logical assignment's write on the conditional path", () => {
		const { tree } = graphOf("a ||= fallback();");
		const [graph] = tree.graphs;
		const [write] = writesOf(graph);

		expect(write.compound).toBe(true);
		expect(write.blockId).not.toBe(graph.initial);

		// The write's block is entered only on the falsy edge.
		const entering = graph.blocks.flatMap(block =>
			block.successors.filter(edge => edge.to === write.blockId),
		);

		expect(entering.map(edge => edge.kind)).toEqual(["false"]);
	});

	it("ties a write back to its scope reference by byte offset", () => {
		const fixture = graphOf("let a = 1;");
		const [write] = writesOf(fixture.tree.graphs[0]);

		// The tree resolved the symbol through that offset already.
		expect(write.symbol).toBe("a");
		expect(fixture.reader.writeCount).toBe(1);
	});
});

describe("the node-block index", () => {
	it("answers reachability for any visited node", () => {
		const code = "if (a) { yes(); } else { return; }\ntail();";
		const fixture = graphOf(code, { sourceType: "script" });

		expect(
			fixture.reader.isReachable(
				handleAt(fixture, "CallExpression", code.indexOf("yes")),
			),
		).toBe(true);
		expect(
			fixture.reader.isReachable(
				handleAt(fixture, "CallExpression", code.indexOf("tail")),
			),
		).toBe(true);
	});

	it("has no entry for nodes that never execute", () => {
		const fixture = graphOf("const x: number = f();", { dialect: "ts" });

		expect(
			fixture.reader.blockOfNode(handleOf(fixture, "TSNumberKeyword")),
		).toBe(-1);
		expect(
			fixture.reader.isReachable(handleOf(fixture, "TSNumberKeyword")),
		).toBe(false);
		expect(
			fixture.reader.blockOfNode(handleOf(fixture, "CallExpression")),
		).toBeGreaterThanOrEqual(0);
	});

	it("reads back the other way as each block's nodes", () => {
		const code = "function foo() {\n  return;\n  hi();\n}";
		const { tree } = graphOf(code);
		const graph = tree.graphs[1];

		expect(nodeTextOf(graph.blocks[0], code)).toEqual([
			'FunctionDeclaration "function foo() {\\n  return;\\n  hi();\\n}"',
			'BlockStatement "{\\n  return;\\n  hi();\\n}"',
			'ReturnStatement "return;"',
		]);

		/*
		 * The point of the field: this block performs no write, so
		 * without its nodes it would render exactly like an empty one.
		 */
		expect(graph.blocks[1].reachable).toBe(false);
		expect(graph.blocks[1].writes).toEqual([]);
		expect(nodeTextOf(graph.blocks[1], code)).toEqual([
			'ExpressionStatement "hi();"',
			'CallExpression "hi()"',
			'Identifier "hi"',
		]);
	});

	it("agrees with blockOfNode for every node it lists", () => {
		const fixture = graphOf(
			"function f(a) { while (a) { if (a) { continue; } b(); } return c(); }",
		);

		/*
		 * `blockOfNode()` answers with one block and the tree lists a node
		 * under every block that holds it, so the two agree when the block
		 * it names is one of the blocks listing it. Only function nodes
		 * are ever listed under two, being both the expression that makes
		 * the closure and the entry of the graph it starts.
		 */
		const listing = new Map<string, number[]>();

		for (const graph of fixture.tree.graphs) {
			for (const block of graph.blocks) {
				for (const node of block.nodes) {
					const key = `${node.type}:${node.start}`;

					listing.set(key, [
						...(listing.get(key) ?? []),
						block.blockId,
					]);
				}
			}
		}

		expect(listing.size).toBeGreaterThan(0);

		for (const [key, blocks] of listing) {
			const [type, start] = key.split(":");

			expect(blocks).toContain(
				fixture.reader.blockOfNode(
					handleAt(fixture, type, Number(start)),
				),
			);
		}
	});

	it("lists no node twice and none that never executes", () => {
		const { tree } = graphOf("const x: number = f();", { dialect: "ts" });
		const seen = new Set<string>();

		for (const graph of tree.graphs) {
			for (const block of graph.blocks) {
				for (const node of block.nodes) {
					const key = `${node.type}:${node.start}:${node.end}`;

					expect(seen.has(key)).toBe(false);
					seen.add(key);
				}
			}
		}

		expect([...seen].some(key => key.startsWith("TSNumberKeyword"))).toBe(
			false,
		);
	});

	it("maps nested-function nodes to their own graphs' blocks", () => {
		const fixture = graphOf("function f() { inner(); }\nouter();");
		const { reader, tree } = fixture;
		const innerBlock = reader.blockOfNode(
			handleOf(fixture, "CallExpression", 0),
		);
		const graph = tree.graphs[1];

		expect(innerBlock).toBeGreaterThanOrEqual(graph.blocks[0].blockId);
		expect(innerBlock).toBeLessThanOrEqual(
			graph.blocks[graph.blocks.length - 1].blockId,
		);
	});
});

describe("toGraphTree", () => {
	it("returns a self-contained JSON-serializable tree", () => {
		const { tree } = graphOf(
			"try { a?.b(); } finally { for (const x of items) use(x); }",
		);
		const restored = JSON.parse(JSON.stringify(tree));

		expect(restored).toEqual(tree);
	});

	it("spells nodes as type, start, end", () => {
		const { tree } = graphOf("f();");

		expect(tree.graphs[0].node).toEqual({
			type: "Program",
			start: 0,
			end: 4,
		});
	});
});

describe("input validation", () => {
	it("refuses a scope buffer built from a tree", () => {
		const program = espree.parse("const a = 1;", {
			ecmaVersion: "latest",
			sourceType: "module",
		});
		const scope = analyzeTree(program as never, { sourceType: "module" });
		const { parsed } = graphOf("const a = 1;");

		expect(() => createGraph(parsed, scope)).toThrow(
			/tree handles/u,
		);
	});

	it("refuses buffers that are not what they claim", () => {
		const { parsed, scope, flow } = graphOf("f();");

		expect(() => createGraph(scope, scope)).toThrow(TypeError);
		expect(() => createGraph(parsed, parsed)).toThrow(TypeError);
		expect(() => toGraphTree(parsed, parsed, scope)).toThrow(
			TypeError,
		);
		expect(() => toGraphTree(flow, parsed, parsed)).toThrow(
			TypeError,
		);
	});
});

describe("edges read both ways", () => {
	it("agrees between successors and predecessors", () => {
		const { tree } = graphOf(
			"if (a) { b(); } else { c(); } while (d) { e(); }",
		);

		for (const graph of tree.graphs) {
			for (const block of graph.blocks) {
				for (const edge of block.successors) {
					expect(
						tree.graphs
							.flatMap(g => g.blocks)
							.find(b => b.blockId === edge.to)!
							.predecessors,
					).toContain(block.blockId);
				}
			}
		}
	});
});
