/**
 * @fileoverview The recorded writes, the node-block index, and the two ways
 * of reading a flow buffer.
 */

import {
	analyzeTree,
	createGraph,
	toGraphTree,
	NB_BLOCK,
	NB_NODE,
} from "../../src/index.js";
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

	it("puts a function node in the block that evaluates it", () => {
		const code =
			"function f() { return; const g = () => 1; class A { m() {} static { s(); } } }";
		const fixture = graphOf(code);
		const dead = fixture.reader.blockOfNode(
			handleAt(fixture, "VariableDeclaration", code.indexOf("const g")),
		);

		// The block a `return` leaves behind, which nothing branches into.
		expect(fixture.reader.isReachable(
			handleAt(fixture, "VariableDeclaration", code.indexOf("const g")),
		)).toBe(false);

		/*
		 * Each of these starts a graph of its own, whose entry block is
		 * seeded reachable, and each is also recorded by the walk that
		 * evaluates it. The evaluating block is the answer: creating the
		 * closure is what happens here, and it happens after a `return`.
		 */
		for (const [type, at] of [
			["ArrowFunctionExpression", "() => 1"],
			["FunctionExpression", "() {}"],
			["StaticBlock", "static { s(); }"],
		] as const) {
			const handle = handleAt(fixture, type, code.indexOf(at));

			expect(fixture.reader.blockOfNode(handle)).toBe(dead);
			expect(fixture.reader.isReachable(handle)).toBe(false);
		}
	});

	it("keeps a function's own body reachable inside its graph", () => {
		const code = "function f() { return; const g = () => hi(); }";
		const fixture = graphOf(code);

		// The closure is never created, but its body is its own unit.
		expect(
			fixture.reader.isReachable(
				handleAt(fixture, "ArrowFunctionExpression", code.indexOf("()", 20)),
			),
		).toBe(false);
		expect(
			fixture.reader.isReachable(
				handleAt(fixture, "CallExpression", code.indexOf("hi()")),
			),
		).toBe(true);
	});

	it("holds no node and block pair twice", () => {
		/*
		 * A shorthand import binds one Identifier as both the imported
		 * name and the local one, so the walk reaches it twice in the same
		 * block. The two records say nothing different, and emission drops
		 * the repeat rather than carrying it in the buffer.
		 */
		const fixture = graphOf('import { a } from "m";\nexport { a };\na();');
		const { reader } = fixture;
		const seen = new Set<string>();

		for (let entry = 0; entry < reader.nodeBlockCount; entry++) {
			const key = `${reader.nodeBlockField(entry, NB_NODE)}:${reader.nodeBlockField(entry, NB_BLOCK)}`;

			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}

		expect(
			fixture.tree.graphs[0].blocks[0].nodes.filter(
				node => node.type === "Identifier" && node.start === 9,
			),
		).toHaveLength(1);
	});

	it("orders the index by handle and then by block", () => {
		const fixture = graphOf(
			"function f() { const g = () => 1; class A { m() {} } return g; }",
		);
		const { reader } = fixture;
		let previousNode = -1;
		let previousBlock = -1;

		for (let entry = 0; entry < reader.nodeBlockCount; entry++) {
			const node = reader.nodeBlockField(entry, NB_NODE);
			const block = reader.nodeBlockField(entry, NB_BLOCK);

			expect(
				node > previousNode ||
					(node === previousNode && block >= previousBlock),
			).toBe(true);

			previousNode = node;
			previousBlock = block;
		}
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
