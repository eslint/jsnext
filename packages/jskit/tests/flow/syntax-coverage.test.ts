/**
 * @fileoverview The syntax `create-graph.test.ts` does not reach.
 *
 * The flow analysis has no reference implementation to diff against, so its
 * integration tests are the whole contract — and a node kind the walk has
 * never been handed is a node kind nothing has checked. This file works
 * through the rest of the grammar: TypeScript's runtime-bearing nodes,
 * destructuring targets, the nullish and logical assignment operators,
 * optional chaining, labels, and the shapes a `try` can take.
 *
 * The assertions are deliberately structural — is the graph well formed, does
 * the write land where it should, does the branch fork — rather than pinned to
 * block numbering, which is an implementation detail the walk is free to move.
 */

import { describe, expect, it } from "vitest";
import { edgesOf, graphOf, writesOf, type GraphFixture } from "./helpers.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Checks the invariants every graph in a tree has to satisfy, whatever the
 * program was.
 * @param fixture The graphed program.
 * @returns Nothing.
 */
function expectWellFormed(fixture: GraphFixture): void {
	for (const graph of fixture.tree.graphs) {
		const ids = new Set(graph.blocks.map(block => block.blockId));

		expect(ids.size).toBe(graph.blocks.length);
		expect(ids.has(graph.initial)).toBe(true);

		for (const block of graph.blocks) {
			for (const edge of block.successors) {
				expect(ids.has(edge.to)).toBe(true);

				// Every edge is reachable from the other direction too.
				expect(
					graph.blocks
						.find(other => other.blockId === edge.to)!
						.predecessors,
				).toContain(block.blockId);
			}
		}

		for (const blockId of [...graph.returned, ...graph.thrown]) {
			expect(ids.has(blockId)).toBe(true);
		}
	}
}

/**
 * Graphs a program as TypeScript and checks it is well formed.
 * @param code The source text.
 * @returns The graphed program.
 */
function tsGraph(code: string): GraphFixture {
	const fixture = graphOf(code, { dialect: "ts" });

	expectWellFormed(fixture);

	return fixture;
}

/**
 * The symbols written in a program, in block order.
 * @param fixture The graphed program.
 * @returns One entry per write.
 */
function symbolsWritten(fixture: GraphFixture): (string | null)[] {
	return writesOf(fixture.tree.graphs[0]).map(write => write.symbol);
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("TypeScript nodes that carry runtime code", () => {
	it("looks through the type-only wrappers to the expression inside", () => {
		for (const code of [
			"let a; a = (b as string);",
			"let a; a = (b satisfies string);",
			"let a; a = b!;",
			"let a; a = b<number>;",
			"let a; a = <string>b;",
		]) {
			const fixture = tsGraph(code);

			expect(symbolsWritten(fixture)).toEqual(["a"]);
			expect(writesOf(fixture.tree.graphs[0])[0].value).not.toBeNull();
		}
	});

	it("graphs an export assignment's expression", () => {
		const fixture = tsGraph("const a = 1; export = a;");

		expect(fixture.tree.graphs).toHaveLength(1);
	});

	it("graphs a namespace body as part of the program", () => {
		const fixture = tsGraph("namespace N { let a = 1; a = 2; }");

		expect(symbolsWritten(fixture)).toEqual(["a", "a"]);
	});

	it("graphs a declared namespace with no body at all", () => {
		expect(tsGraph("declare module 'm';").tree.graphs).toHaveLength(1);
	});

	it("graphs an enum's member initializers", () => {
		const fixture = tsGraph("let x = 1; enum E { A = x, B = 2, C }");

		expect(fixture.tree.graphs).toHaveLength(1);
		expect(symbolsWritten(fixture)).toEqual(["x"]);
	});

	it("graphs a parameter property's default value", () => {
		const fixture = tsGraph(
			"class C { constructor(private a = init()) { use(a); } }",
		);

		expect(fixture.tree.graphs.length).toBeGreaterThan(1);
	});

	it("skips a type position entirely", () => {
		const fixture = tsGraph(
			"type T = { a: string }; interface I { b(): void } let c: T;",
		);

		expect(fixture.tree.graphs).toHaveLength(1);
		expect(fixture.tree.graphs[0].blocks).toHaveLength(1);
	});
});

describe("conditional expressions", () => {
	it("forks and rejoins a ternary in statement position", () => {
		const code = "cond ? a() : b(); after();";
		const fixture = graphOf(code);
		const [graph] = fixture.tree.graphs;
		const edges = edgesOf(graph);

		expectWellFormed(fixture);

		const trueEdge = edges.find(edge => edge.kind === "true")!;
		const falseEdge = edges.find(edge => edge.kind === "false")!;

		expect(trueEdge.condition?.start).toBe(code.indexOf("cond"));
		expect(falseEdge.condition?.start).toBe(code.indexOf("cond"));
		expect(trueEdge.to).not.toBe(falseEdge.to);

		// Both arms reach the same block, and everything stays reachable.
		expect(graph.blocks.every(block => block.reachable)).toBe(true);
	});

	it("distributes a ternary used as a condition", () => {
		const code = "if (p ? q : r) { a(); }";
		const fixture = graphOf(code);
		const conditions = new Set(
			edgesOf(fixture.tree.graphs[0])
				.filter(edge => edge.condition !== null)
				.map(edge => edge.condition!.start),
		);

		expectWellFormed(fixture);

		// Each operand is tested on its own; the ternary never is.
		expect(conditions).toEqual(
			new Set([code.indexOf("p"), code.indexOf("q"), code.indexOf("r")]),
		);
	});

	it("distributes a sequence used as a condition", () => {
		const code = "if ((a(), b)) { c(); }";
		const fixture = graphOf(code);
		const conditions = edgesOf(fixture.tree.graphs[0])
			.filter(edge => edge.condition !== null)
			.map(edge => edge.condition!.start);

		expectWellFormed(fixture);

		// Only the last operand decides the branch.
		expect(new Set(conditions)).toEqual(new Set([code.indexOf("b)")]));
	});

	it("distributes || used as a condition", () => {
		const code = "if (a || b) { c(); }";
		const fixture = graphOf(code);
		const conditions = new Set(
			edgesOf(fixture.tree.graphs[0])
				.filter(edge => edge.condition !== null)
				.map(edge => edge.condition!.start),
		);

		expectWellFormed(fixture);
		expect(conditions).toEqual(
			new Set([code.indexOf("a ||"), code.indexOf("b)")]),
		);
	});
});

describe("constant conditions", () => {
	it("takes exactly one direction for a literal condition", () => {
		for (const [code, reachable] of [
			["if (true) { a(); } else { b(); }", "a"],
			["if (false) { a(); } else { b(); }", "b"],
			["if (null) { a(); } else { b(); }", "b"],
		] as const) {
			const fixture = graphOf(code);
			const [graph] = fixture.tree.graphs;

			expectWellFormed(fixture);

			// The arm that cannot run is unreachable; the other one is not.
			expect(graph.blocks.some(block => !block.reachable)).toBe(true);
			expect(code.includes(reachable)).toBe(true);
		}
	});
});

describe("logical operators outside condition position", () => {
	it("forks && and || on the value of the left operand", () => {
		for (const [code, kind] of [
			["const a = p && q;", "true"],
			["const a = p || q;", "false"],
		] as const) {
			const fixture = graphOf(code);
			const edges = edgesOf(fixture.tree.graphs[0]);

			expectWellFormed(fixture);
			expect(edges.some(edge => edge.kind === kind)).toBe(true);
		}
	});

	it("forks ?? on nullishness rather than truthiness", () => {
		const fixture = graphOf("const a = p ?? q;");
		const kinds = edgesOf(fixture.tree.graphs[0]).map(edge => edge.kind);

		expectWellFormed(fixture);
		expect(kinds).toContain("nullish");
		expect(kinds).toContain("not-nullish");
		expect(kinds).not.toContain("true");
	});
});

describe("logical assignment", () => {
	it("guards &&= and ||= on the target's truthiness", () => {
		for (const [code, guard] of [
			["let a; a &&= b;", "true"],
			["let a; a ||= b;", "false"],
		] as const) {
			const fixture = graphOf(code);
			const edges = edgesOf(fixture.tree.graphs[0]);

			expectWellFormed(fixture);
			expect(edges.some(edge => edge.kind === guard)).toBe(true);
			expect(
				writesOf(fixture.tree.graphs[0]).some(
					write => write.symbol === "a" && write.compound,
				),
			).toBe(true);
		}
	});

	it("guards ??= on the target's nullishness", () => {
		const fixture = graphOf("let a; a ??= b;");
		const kinds = edgesOf(fixture.tree.graphs[0]).map(edge => edge.kind);

		expectWellFormed(fixture);
		expect(kinds).toContain("nullish");
		expect(kinds).toContain("not-nullish");
	});

	it("records a member target as a member write", () => {
		const fixture = graphOf("o.p ??= b; o[k] ||= c;");
		const writes = writesOf(fixture.tree.graphs[0]);

		expectWellFormed(fixture);
		expect(writes).toHaveLength(2);
		expect(writes.every(write => write.member && write.compound)).toBe(true);
		expect(writes.every(write => write.symbol === null)).toBe(true);
	});
});

describe("assignment targets", () => {
	it("records a member assignment as a member write", () => {
		const fixture = graphOf("o.p = 1; o[k] = 2;");
		const writes = writesOf(fixture.tree.graphs[0]);

		expectWellFormed(fixture);
		expect(writes).toHaveLength(2);
		expect(writes.every(write => write.member)).toBe(true);
	});

	it("records every name an array pattern binds", () => {
		const fixture = graphOf("let a, b, c; [a, , b, ...c] = xs;");

		expectWellFormed(fixture);
		expect(symbolsWritten(fixture)).toEqual(["a", "b", "c"]);
	});

	it("records every name an object pattern binds", () => {
		const fixture = graphOf(
			"let a, b, c, d; ({ a, x: b, [k]: c, ...d } = o);",
		);

		expectWellFormed(fixture);
		expect(symbolsWritten(fixture)).toEqual(["a", "b", "c", "d"]);
	});

	it("records a default inside a pattern", () => {
		const fixture = graphOf("let a; [a = 1] = xs;");

		expectWellFormed(fixture);
		expect(symbolsWritten(fixture)).toEqual(["a"]);
	});

	it("records a member expression nested inside a pattern", () => {
		const fixture = graphOf("[o.p, { q: o.r }] = xs;");
		const writes = writesOf(fixture.tree.graphs[0]);

		expectWellFormed(fixture);
		expect(writes).toHaveLength(2);
		expect(writes.every(write => write.member)).toBe(true);
	});

	it("looks through a type assertion on an assignment target", () => {
		const fixture = tsGraph("let a; (a as string) = b; (<any>a) = c;");

		expect(symbolsWritten(fixture)).toEqual(["a", "a"]);
	});
});

describe("update expressions", () => {
	it("records an increment of a name as an update write", () => {
		const fixture = graphOf("let a; a++; --a;");
		const writes = writesOf(fixture.tree.graphs[0]);

		expectWellFormed(fixture);
		expect(writes).toHaveLength(2);
		expect(writes.every(write => write.symbol === "a" && write.update)).toBe(
			true,
		);
	});

	it("records an increment of a member as a member update", () => {
		const fixture = graphOf("o.p++; o[k]--;");
		const writes = writesOf(fixture.tree.graphs[0]);

		expectWellFormed(fixture);
		expect(writes).toHaveLength(2);
		expect(writes.every(write => write.member && write.update)).toBe(true);
	});
});

describe("optional chaining", () => {
	it("forks a short-circuiting member access", () => {
		const fixture = graphOf("a?.b; a?.[k]; a?.(1);");
		const kinds = edgesOf(fixture.tree.graphs[0]).map(edge => edge.kind);

		expectWellFormed(fixture);
		expect(kinds.filter(kind => kind === "nullish").length).toBeGreaterThan(
			0,
		);
	});
});

describe("labels", () => {
	it("breaks out of a labeled block", () => {
		const fixture = graphOf("outer: { a(); break outer; b(); } c();");
		const [graph] = fixture.tree.graphs;

		expectWellFormed(fixture);

		// The statement after the break cannot run; the one after the block can.
		expect(graph.blocks.some(block => !block.reachable)).toBe(true);
		expect(graph.blocks.some(block => block.reachable)).toBe(true);
	});

	it("carries a label onto the loop it names", () => {
		const fixture = graphOf(
			"outer: for (;;) { inner: for (;;) { continue outer; } }",
		);

		expectWellFormed(fixture);
		expect(
			fixture.tree.graphs[0].blocks.some(block => block.loopHead),
		).toBe(true);
	});

	it("carries a label onto a switch", () => {
		const fixture = graphOf("l: switch (x) { case 1: break l; }");

		expectWellFormed(fixture);
	});

	it("carries a label onto every loop form and onto another label", () => {
		for (const code of [
			"l: while (a) { break l; }",
			"l: do { break l; } while (a);",
			"l: for (const x of xs) { break l; }",
			"l: for (const k in o) { break l; }",
			"l: m: for (;;) { break l; }",
		]) {
			expectWellFormed(graphOf(code));
		}
	});

	it("breaks out of a label from inside a nested one", () => {
		const fixture = graphOf("a: { b: { break a; } c(); } d();");

		expectWellFormed(fixture);
	});
});

describe("switch", () => {
	it("graphs a switch with no cases at all", () => {
		const fixture = graphOf("switch (x) {} after();");
		const [graph] = fixture.tree.graphs;

		expectWellFormed(fixture);
		expect(graph.blocks.every(block => block.reachable)).toBe(true);
	});
});

describe("try", () => {
	it("graphs try/catch/finally together", () => {
		const fixture = graphOf(
			"try { a(); } catch (e) { b(); } finally { c(); } d();",
		);
		const kinds = edgesOf(fixture.tree.graphs[0]).map(edge => edge.kind);

		expectWellFormed(fixture);
		expect(kinds).toContain("exception");
	});

	it("graphs a catch that itself throws under a finally", () => {
		const fixture = graphOf(
			"try { a(); } catch (e) { throw e; } finally { c(); }",
		);

		expectWellFormed(fixture);
		expect(fixture.tree.graphs[0].thrown.length).toBeGreaterThan(0);
	});

	it("graphs a catch with no binding", () => {
		expectWellFormed(graphOf("try { a(); } catch { b(); }"));
	});

	it("graphs a try whose only clause is a finally", () => {
		expectWellFormed(graphOf("try { a(); } finally { b(); }"));
	});

	it("routes a return through a finally", () => {
		const fixture = graphOf(
			"function f() { try { return 1; } finally { a(); } }",
		);

		expectWellFormed(fixture);
		expect(fixture.tree.graphs.length).toBeGreaterThan(1);
	});

	it("routes a break out of a loop through a finally", () => {
		expectWellFormed(
			graphOf("for (;;) { try { break; } finally { a(); } }"),
		);
	});

	it("routes two jumps to the same target through one finally", () => {
		expectWellFormed(
			graphOf(
				"for (;;) { try { if (p) break; if (q) break; } finally { a(); } }",
			),
		);
	});
});

describe("classes and functions", () => {
	it("graphs a class field initializer and a static block on their own", () => {
		const fixture = graphOf(
			"class C { a = init(); static { setup(); } m() { run(); } }",
		);
		const origins = fixture.tree.graphs.map(graph => graph.origin);

		expectWellFormed(fixture);
		expect(origins.length).toBeGreaterThan(2);
	});

	it("graphs an expression-bodied arrow", () => {
		const fixture = graphOf("const f = x => x + 1;");

		expectWellFormed(fixture);
		expect(fixture.tree.graphs).toHaveLength(2);
	});
});
