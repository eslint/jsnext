/**
 * @fileoverview `Scopes#isCapturedReference()` and the reference-record bit
 * behind it: whether a reference resolved to a binding declared outside its
 * own variable scope — what a closure captures.
 */

import * as espree from "espree";
import { describe, expect, it } from "vitest";
import {
	analyze,
	analyzeTree,
	parse,
	R_FLAGS,
	RF_CAPTURED,
	ScopeBufferReader,
	Scopes,
	toScopeTree,
	type EsTreeNode,
	type ScopeTreeReference,
	type ScopeTreeScope,
} from "../../src/index.js";

type SourceType = "module" | "script";

interface Analyzed {
	scopes: Scopes;
	code: string;
}

/**
 * Parses and analyzes source text on the binary path.
 * @param code The source text.
 * @param sourceType How the program should be interpreted.
 * @param globals Configured globals.
 * @returns The `Scopes` view and the source text.
 */
function analyzed(
	code: string,
	sourceType: SourceType = "module",
	globals: string[] = [],
): Analyzed {
	const parsed = parse(code, { sourceType });

	return {
		scopes: new Scopes(analyze(parsed, { sourceType, globals }), parsed),
		code,
	};
}

/**
 * Whether the identifier at the last occurrence of `name` is captured.
 * @param analysis The analyzed program.
 * @param name The identifier's text.
 * @returns What `isCapturedReference()` answers.
 */
function capturedLast({ scopes, code }: Analyzed, name: string): boolean {
	const start = code.search(
		new RegExp(`\\b${name}\\b(?![\\s\\S]*\\b${name}\\b)`, "u"),
	);

	expect(start).toBeGreaterThanOrEqual(0);

	return scopes.isCapturedReference({
		type: "Identifier",
		start,
		end: start + name.length,
	});
}

/**
 * Every reference in a rendered scope tree, from each scope's own list.
 * @param scope The scope to start at.
 * @returns The references, each once.
 */
function treeReferences(scope: ScopeTreeScope): ScopeTreeReference[] {
	return [...scope.references, ...scope.childScopes.flatMap(treeReferences)];
}

describe("Scopes#isCapturedReference()", () => {
	it.each([
		["let x = 1; function f() { x; }", "x"],
		["let x = 1; () => x;", "x"],
		["let x = 1; function f() { if (x) { { x; } } }", "x"],
		["function f(p) { return () => p; }", "p"],
		["function f() { let x; return function () { x; }; }", "x"],
		["function f() { () => arguments; }", "arguments"],
		["(function g() { g(); });", "g"],
		["class C { m() { C; } }", "C"],
		["let x; class C { y = x; }", "x"],
		["let x; class C { static { x; } }", "x"],
		["let x; function f(a = x) {}", "x"],
	])("reports a reference across a function boundary: %s", (code, name) => {
		expect(capturedLast(analyzed(code), name)).toBe(true);
	});

	it.each([
		["let x = 1; x;", "x"],
		["let x = 1; { { x; } }", "x"],
		["function f() { let x; if (x) { for (;;) { x; } } }", "x"],
		["function f(p) { p; }", "p"],
		["function f() { arguments; }", "arguments"],
		["function f() { function g() {} g(); }", "g"],
		["try {} catch (e) { e; }", "e"],
	])(
		"does not report a reference within its own function: %s",
		(code, name) => {
			expect(capturedLast(analyzed(code), name)).toBe(false);
		},
	);

	it("reports a script's global variables from inside a function only", () => {
		const analysis = analyzed(
			"var v = 1; v; function f() { v; }",
			"script",
		);
		const { scopes, code } = analysis;
		const first = code.indexOf("v;");

		expect(
			scopes.isCapturedReference({ type: "Identifier", start: first }),
		).toBe(false);
		expect(capturedLast(analysis, "v")).toBe(true);
	});

	it("never reports an unresolved reference", () => {
		expect(
			capturedLast(analyzed("function f() { missing; }"), "missing"),
		).toBe(false);
		expect(
			capturedLast(analyzed("let x; function f() { eval(''); x; }"), "x"),
		).toBe(false);
	});

	it("reports a configured global from any variable scope but the global one", () => {
		expect(
			capturedLast(
				analyzed("Promise;", "script", ["Promise"]),
				"Promise",
			),
		).toBe(false);
		expect(
			capturedLast(
				analyzed("function f() { Promise; }", "script", ["Promise"]),
				"Promise",
			),
		).toBe(true);
		// The module scope is its own variable scope; the global is outside.
		expect(
			capturedLast(
				analyzed("Promise;", "module", ["Promise"]),
				"Promise",
			),
		).toBe(true);
	});

	it("reports a TypeScript namespace's bindings from its functions", () => {
		const code = "namespace N { const a = 1; function f() { a; } }";
		const parsed = parse(code, { sourceType: "module" });
		const scopes = new Scopes(
			analyze(parsed, { sourceType: "module" }),
			parsed,
		);
		const start = code.lastIndexOf("a;");

		expect(scopes.isCapturedReference({ type: "Identifier", start })).toBe(
			true,
		);
	});

	it("answers false for an identifier that is not a reference", () => {
		const analysis = analyzed("let x = 1; function f() { x; }");

		expect(
			analysis.scopes.isCapturedReference({
				type: "Identifier",
				start: analysis.code.indexOf("f"),
			}),
		).toBe(false);
	});

	it("agrees with referenceIsCaptured() and the buffer's flag", () => {
		const code =
			"let x; function f(p) { x; p; { let y; y; () => y; } } x; missing;";
		const parsed = parse(code, { sourceType: "module" });
		const buffer = analyze(parsed, { sourceType: "module" });
		const scopes = new Scopes(buffer, parsed);
		const reader = new ScopeBufferReader(buffer);
		const captured: string[] = [];

		for (let ref = 0; ref < reader.referenceCount; ref++) {
			const flag =
				(reader.referenceField(ref, R_FLAGS) & RF_CAPTURED) !== 0;

			expect(scopes.referenceIsCaptured(ref)).toBe(flag);

			if (flag) {
				captured.push(scopes.referenceName(ref));
			}
		}

		expect(captured).toEqual(["x", "y"]);
	});

	it("answers the same on the tree path", () => {
		const code =
			"let x; function f(p) { x; p; { let y; y; () => y; } } x; Promise;";
		const tree = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
		}) as unknown as EsTreeNode;
		const parsed = parse(code, { sourceType: "module" });
		const options = { sourceType: "module", globals: ["Promise"] } as const;

		const flags = (scopes: Scopes, count: number) =>
			Array.from({ length: count }, (_, ref) =>
				scopes.referenceIsCaptured(ref),
			);
		const binary = new Scopes(analyze(parsed, options), parsed);
		const treeScopes = new Scopes(analyzeTree(tree, options), tree);
		const count = new ScopeBufferReader(analyze(parsed, options))
			.referenceCount;

		expect(flags(treeScopes, count)).toEqual(flags(binary, count));
		expect(flags(binary, count).filter(Boolean)).toHaveLength(3);
	});
});

describe("toScopeTree() captured references", () => {
	it("renders captured on every reference", () => {
		const code =
			"let x; function f(p) { x; p; { let y; y; () => y; } } x; missing;";
		const parsed = parse(code, { sourceType: "module" });
		const tree = toScopeTree(
			analyze(parsed, { sourceType: "module" }),
			parsed,
		);
		const references = treeReferences(tree.root!);

		expect(
			references.map(reference => [reference.name, reference.captured]),
		).toEqual(
			expect.arrayContaining([
				["x", true],
				["p", false],
				["y", false],
				["y", true],
				["x", false],
				["missing", false],
			]),
		);
		expect(references.filter(reference => reference.captured)).toHaveLength(
			2,
		);
	});
});
