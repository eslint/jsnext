/**
 * @fileoverview The shape of the graphs `createGraph()` builds: blocks,
 * edges, reachability, and the per-graph exit lists.
 */

import { describe, expect, it } from "vitest";
import { blockById, edgesOf, graphOf, handleAt, handleOf } from "./helpers.js";

describe("straight-line code", () => {
	it("puts a whole program in one reachable block", () => {
		const { tree } = graphOf("const a = 1; use(a);");
		const [graph] = tree.graphs;

		expect(tree.graphs).toHaveLength(1);
		expect(graph.origin).toBe("program");
		expect(graph.node.type).toBe("Program");
		expect(graph.upper).toBeNull();
		expect(graph.blocks).toHaveLength(1);
		expect(graph.blocks[0].reachable).toBe(true);
		expect(graph.initial).toBe(graph.blocks[0].blockId);
		expect(graph.implicit).toBe(graph.blocks[0].blockId);
		expect(graph.returned).toEqual([graph.blocks[0].blockId]);
		expect(graph.thrown).toEqual([]);
	});
});

describe("branches", () => {
	it("forks an if on its condition and joins after", () => {
		const code = "if (cond) { a(); } else { b(); }";
		const { tree } = graphOf(code);
		const [graph] = tree.graphs;
		const edges = edgesOf(graph);
		const trueEdge = edges.find(edge => edge.kind === "true")!;
		const falseEdge = edges.find(edge => edge.kind === "false")!;

		expect(trueEdge.condition?.start).toBe(code.indexOf("cond"));
		expect(falseEdge.condition?.start).toBe(code.indexOf("cond"));
		expect(trueEdge.to).not.toBe(falseEdge.to);

		// Both arms join, and everything stays reachable.
		expect(graph.blocks.every(block => block.reachable)).toBe(true);
		expect(blockById(graph, trueEdge.to).successors[0].to).toBe(
			blockById(graph, falseEdge.to).successors[0].to,
		);
	});

	it("distributes && so each edge tests the operand it leaves", () => {
		const code = "if (a && b) { c(); }";
		const { tree } = graphOf(code);
		const conditions = edgesOf(tree.graphs[0])
			.filter(edge => edge.condition !== null)
			.map(edge => `${edge.kind}:${edge.condition!.start}`)
			.sort();

		// Two edges test `a`, two test `b` — never the whole expression.
		expect(conditions).toEqual([
			`false:${code.indexOf("a &&")}`,
			`false:${code.indexOf("b)")}`,
			`true:${code.indexOf("a &&")}`,
			`true:${code.indexOf("b)")}`,
		]);
	});

	it("swaps the branches of a ! condition", () => {
		const code = "if (!a) { b(); }";
		const { tree } = graphOf(code);
		const edges = edgesOf(tree.graphs[0]);
		const trueEdge = edges.find(edge => edge.kind === "true")!;

		// The truthy direction of `a` is the *skip* direction of the if.
		expect(trueEdge.condition?.start).toBe(code.indexOf("a)"));

		const thenBlock = edges.find(edge => edge.kind === "false")!.to;

		expect(blockById(tree.graphs[0], thenBlock).reachable).toBe(true);
	});

	it("forks ?? on nullishness", () => {
		const { tree } = graphOf("const x = a ?? b;");
		const kinds = edgesOf(tree.graphs[0]).map(edge => edge.kind);

		expect(kinds).toContain("nullish");
		expect(kinds).toContain("not-nullish");
	});

	it("short-circuits an optional chain to its join", () => {
		const code = "a?.b.c;";
		const { tree } = graphOf(code);
		const edges = edgesOf(tree.graphs[0]);
		const nullish = edges.find(edge => edge.kind === "nullish")!;
		const continued = edges.find(edge => edge.kind === "not-nullish")!;

		expect(nullish.condition?.start).toBe(code.indexOf("a"));
		expect(nullish.from).toBe(continued.from);
		expect(nullish.to).not.toBe(continued.to);
	});
});

describe("loops", () => {
	it("marks the loop head and the back edge of a while", () => {
		const { tree } = graphOf("while (cond) { body(); }");
		const [graph] = tree.graphs;
		const back = edgesOf(graph).find(edge => edge.back)!;

		expect(back.kind).toBe("normal");
		expect(blockById(graph, back.to).loopHead).toBe(true);
		expect(graph.blocks.every(block => block.reachable)).toBe(true);
	});

	it("makes code after while (true) unreachable", () => {
		const fixture = graphOf("while (true) { spin(); }\nafter();");
		const statement = handleOf(fixture, "ExpressionStatement", 1);

		expect(fixture.reader.isReachable(statement)).toBe(false);

		// The loop never exits, so the program never completes.
		expect(fixture.tree.graphs[0].returned).toEqual([]);
	});

	it("lets a break out of while (true)", () => {
		const fixture = graphOf("while (true) { break; }\nafter();");

		expect(
			fixture.reader.isReachable(
				handleOf(fixture, "ExpressionStatement", 0),
			),
		).toBe(true);
	});

	it("skips the loop-repeating edge of do...while (false)", () => {
		const { tree } = graphOf("do { body(); } while (false);\nafter();");
		const edges = edgesOf(tree.graphs[0]);

		expect(edges.some(edge => edge.kind === "true")).toBe(false);
		expect(edges.some(edge => edge.back)).toBe(false);
	});

	it("repeats do...while through a true-edge back into its body", () => {
		const { tree } = graphOf("do { body(); } while (cond);");
		const back = edgesOf(tree.graphs[0]).find(edge => edge.back)!;

		expect(back.kind).toBe("true");
		expect(blockById(tree.graphs[0], back.to).loopHead).toBe(true);
	});

	it("iterates for (;;) unconditionally", () => {
		const { tree } = graphOf("for (;;) { spin(); }");
		const [graph] = tree.graphs;

		expect(graph.returned).toEqual([]);
		expect(edgesOf(graph).some(edge => edge.back)).toBe(true);
	});

	it("routes continue to the update of a for loop", () => {
		const code = "for (let i = 0; i < n; i++) { if (skip) continue; body(); }";
		const fixture = graphOf(code);
		const [graph] = fixture.tree.graphs;

		// The update's write executes in its own block, fed by the continue.
		const update = graph.blocks.find(block =>
			block.writes.some(write => write.update),
		)!;

		expect(update.predecessors.length).toBeGreaterThan(1);
	});

	it("gives for...of iterate and done edges and a per-iteration write", () => {
		const code = "for (const v of items) { use(v); }";
		const { tree } = graphOf(code);
		const [graph] = tree.graphs;
		const edges = edgesOf(graph);
		const iterate = edges.find(edge => edge.kind === "iterate")!;
		const done = edges.find(edge => edge.kind === "done")!;

		expect(iterate.condition?.start).toBe(code.indexOf("items"));
		expect(done.from).toBe(iterate.from);
		expect(blockById(graph, iterate.from).loopHead).toBe(true);

		const bodyWrites = blockById(graph, iterate.to).writes;

		expect(bodyWrites).toHaveLength(1);
		expect(bodyWrites[0].symbol).toBe("v");
	});
});

describe("switch", () => {
	it("chains the tests and falls through the bodies", () => {
		const code =
			"switch (d) { case 1: one(); default: dft(); case 2: two(); break; }\nafter();";
		const fixture = graphOf(code);
		const [graph] = fixture.tree.graphs;
		const edges = edgesOf(graph);
		const matches = edges.filter(edge => edge.kind === "true");

		// One match edge per non-default case, testing that case's value.
		expect(matches.map(edge => edge.condition?.start).sort()).toEqual([
			code.indexOf("1:"),
			code.indexOf("2:"),
		]);

		// Everything runs somewhere: the break makes `after()` reachable.
		expect(
			fixture.reader.isReachable(
				handleAt(fixture, "ExpressionStatement", code.indexOf("after")),
			),
		).toBe(true);
	});

	it("routes a missed switch with no default past every case", () => {
		const fixture = graphOf("switch (d) { case 1: never(); }\nafter();");

		expect(
			fixture.reader.isReachable(
				handleOf(fixture, "ExpressionStatement", 1),
			),
		).toBe(true);
	});
});

describe("exceptions", () => {
	it("wires every block of a try region into its handler", () => {
		const { tree } = graphOf("try { a(); b(); } catch (e) { handle(); }");
		const [graph] = tree.graphs;
		const exception = edgesOf(graph).filter(
			edge => edge.kind === "exception",
		);

		expect(exception.length).toBeGreaterThan(0);

		const handlerEntry = exception[0].to;

		expect(exception.every(edge => edge.to === handlerEntry)).toBe(true);
		expect(blockById(graph, handlerEntry).reachable).toBe(true);
	});

	it("treats a caught throw as handled, not a graph exit", () => {
		const { tree } = graphOf(
			"function f() { try { throw x; } catch { return 1; } }",
		);
		const graph = tree.graphs[1];

		expect(graph.thrown).toEqual([]);
		expect(graph.returned).toHaveLength(1);
	});

	it("reports an uncaught throw on the graph", () => {
		const { tree } = graphOf("function f() { throw new Error(); }");
		const graph = tree.graphs[1];

		expect(graph.returned).toEqual([]);
		expect(graph.thrown).toHaveLength(1);
		expect(blockById(graph, graph.thrown[0]).throws).toBe(true);
	});

	it("routes a return through the finally and seals the normal exit", () => {
		const fixture = graphOf(
			"function f(x) { try { return g(x); } finally { cleanup(); } }\nafter();",
		);
		const graph = fixture.tree.graphs[1];
		const returning = graph.blocks.find(block => block.returns)!;
		const abrupt = returning.successors.find(
			edge => edge.kind === "abrupt",
		)!;

		// The return detours through the finalizer...
		expect(graph.returned).toEqual([abrupt.to]);

		// ...and nothing after the try can run: the body always returns.
		expect(graph.implicit).not.toBeNull();
		expect(blockById(graph, graph.implicit!).reachable).toBe(false);
	});

	it("routes a labeled break through the finally to its target", () => {
		const fixture = graphOf(
			"outer: for (;;) { try { break outer; } finally { f(); } }\nafter();",
		);

		expect(
			fixture.reader.isReachable(
				handleOf(fixture, "ExpressionStatement", 1),
			),
		).toBe(true);
	});
});

describe("function exits", () => {
	it("lists both exits of a sometimes-returning function", () => {
		const { tree } = graphOf("function f() { if (x) { return 1; } }");
		const graph = tree.graphs[1];

		// One explicit return, plus the reachable implicit exit at the end.
		expect(graph.returned).toHaveLength(2);
		expect(graph.returned).toContain(graph.implicit);
	});

	it("drops the implicit exit when the body cannot fall off the end", () => {
		const { tree } = graphOf("function f() { return 1; }");
		const graph = tree.graphs[1];
		const returning = graph.blocks.find(block => block.returns)!;

		expect(graph.returned).toEqual([returning.blockId]);
	});

	it("marks statements after a return unreachable", () => {
		const fixture = graphOf("function f() { return 1; never(); }");

		expect(
			fixture.reader.isReachable(
				handleOf(fixture, "ExpressionStatement", 0),
			),
		).toBe(false);
	});
});

describe("execution units", () => {
	it("gives methods, field initializers, and static blocks their own graphs", () => {
		const { tree } = graphOf(
			"class C { m() { a(); } x = f(); static { s(); } }",
		);

		expect(
			tree.graphs.map(graph => `${graph.origin}<-${graph.upper}`),
		).toEqual([
			"program<-null",
			"function<-0",
			"class-field-initializer<-0",
			"class-static-block<-0",
		]);
		expect(tree.graphs[2].node.type).toBe("CallExpression");
		expect(tree.graphs[3].node.type).toBe("StaticBlock");
	});

	it("keeps each graph's blocks contiguous and owned", () => {
		const { tree } = graphOf(
			"if (a) { f(); }\nfunction f() { if (b) { g(); } }",
		);

		let expected = 0;

		for (const graph of tree.graphs) {
			for (const block of graph.blocks) {
				expect(block.blockId).toBe(expected++);
			}
		}
	});

	it("splits blocks at await and yield with resume edges", () => {
		const code =
			"async function f() { const x = 1; await g(); const y = 2; }";
		const { tree } = graphOf(code);
		const graph = tree.graphs[1];
		const resume = edgesOf(graph).find(edge => edge.kind === "resume")!;

		expect(resume.condition?.type).toBe("AwaitExpression");

		const before = graph.blocks.find(block =>
			block.writes.some(write => write.symbol === "x"),
		)!;
		const following = graph.blocks.find(block =>
			block.writes.some(write => write.symbol === "y"),
		)!;

		expect(before.blockId).not.toBe(following.blockId);
		expect(resume.from).toBe(before.blockId);
		expect(resume.to).toBe(following.blockId);
	});
});
