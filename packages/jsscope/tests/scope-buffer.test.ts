/**
 * @fileoverview The scope buffer and its three consumers, as a consumer sees
 * them: `Scopes` queries against the buffer, `toScopeTree()`'s serializable
 * view, `toScopeManager()`'s object graph, and the properties the format
 * guarantees — stable IDs, determinism, and path checking.
 *
 * The conformance suites already prove the rehydrated graph matches the
 * reference implementations; this file covers what is new in the binary
 * contract itself.
 */

import * as espree from "espree";
import { describe, expect, it } from "vitest";
import { parse } from "@eslint/jsparse";
import {
	analyze,
	analyzeTree,
	Scopes,
	toScopeManager,
	toScopeTree,
	type EsTreeNode,
} from "../src/index.js";

/**
 * Parses and analyzes source text on the binary path.
 * @param code The source text.
 * @param options How the program should be interpreted.
 * @returns The parse result and the scope buffer.
 */
function analyzed(
	code: string,
	options: Parameters<typeof analyze>[1] = {},
): { parsed: ReturnType<typeof parse>; buffer: ArrayBuffer } {
	const parsed = parse(code);

	return {
		parsed,
		buffer: analyze(parsed, { sourceType: "module", ...options }),
	};
}

describe("the scope buffer", () => {
	it("is deterministic for the same program and options", () => {
		const first = analyzed("const a = 1; a; missing;");
		const second = analyzed("const a = 1; a; missing;");

		expect(new Uint8Array(first.buffer)).toEqual(
			new Uint8Array(second.buffer),
		);
	});

	it("rejects a buffer that is not a scope buffer", () => {
		const { parsed } = analyzed("a;");

		expect(() => new Scopes(parsed.ast, parsed)).toThrow(
			/Not a jsscope scope buffer/u,
		);
	});

	it("rejects a source from the other path", () => {
		const { parsed, buffer } = analyzed("a;");
		const tree = espree.parse("a;", {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
		}) as unknown as EsTreeNode;
		const treeBuffer = analyzeTree(tree, { sourceType: "module" });

		expect(() => toScopeManager(buffer, tree)).toThrow(
			/came from analyze\(\)/u,
		);
		expect(() => toScopeManager(treeBuffer, parsed)).toThrow(
			/came from analyzeTree\(\)/u,
		);
	});
});

describe("Scopes", () => {
	it("answers isGlobalReference exactly as ESLint does", () => {
		const { parsed, buffer } = analyzed(
			"console.log(missing); function f(console) { console.log(1); }",
			{ globals: ["console"] },
		);
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);
		const consoleVar = manager.globalScope!.set.get("console")!;
		const globalUse = consoleVar.references[0].identifier;
		const shadowedUse = manager.scopes
			.find(scope => scope.type === "function")!
			.references.find(reference => reference.name === "console")!
			.identifier;
		const unresolvedUse = manager.globalScope!.through[0].identifier;

		expect(scopes.isGlobalReference(globalUse)).toBe(true);
		expect(scopes.isGlobalReference(shadowedUse)).toBe(false);
		expect(scopes.isGlobalReference(unresolvedUse)).toBe(false);
	});

	it("returns resolved and unresolved references to a global name", () => {
		const { parsed, buffer } = analyzed("console.log(1); console.error(2);", {
			globals: ["console"],
		});
		const scopes = new Scopes(buffer, parsed);

		expect(scopes.getGlobalReferences("console")).toHaveLength(2);
		expect(scopes.getGlobalReferences("Symbol")).toHaveLength(0);

		const unshimmed = analyzed("Symbol('a');");
		const unresolved = new Scopes(unshimmed.buffer, unshimmed.parsed);
		const [reference] = unresolved.getGlobalReferences("Symbol");

		expect(unresolved.referenceResolved(reference)).toBe(null);
		expect(unresolved.referenceName(reference)).toBe("Symbol");
	});

	it("maps a declaration node to its symbols", () => {
		const { parsed, buffer } = analyzed("const a = 1, b = 2;");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);
		const declaration = manager.scopes[1].variables[0].defs[0].parent!;

		expect(
			scopes.getDeclaredSymbols(declaration).map(id => scopes.symbolName(id)),
		).toEqual(["a", "b"]);
	});

	it("iterates a symbol's references with read and write flags", () => {
		const { parsed, buffer } = analyzed("let a = 1; a; a = 2;");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);
		const symbol = manager.scopes[1].set.get("a")!.symbolId;
		const references = scopes.getReferences(symbol);

		expect(references).toHaveLength(3);
		expect(references.map(id => scopes.referenceIsWrite(id))).toEqual([
			true,
			false,
			true,
		]);
		expect(references.map(id => scopes.referenceIsRead(id))).toEqual([
			false,
			true,
			false,
		]);
		expect(references.map(id => scopes.referenceIsInit(id))).toEqual([
			true,
			false,
			false,
		]);
		expect(scopes.symbolHasDefinitions(symbol)).toBe(true);
		expect(scopes.symbolDefinitionTypes(symbol)).toEqual(["Variable"]);
	});

	it("reports unresolved references per scope", () => {
		const { parsed, buffer } = analyzed(
			"function f() { return outer + inner; } let inner;",
		);
		const scopes = new Scopes(buffer, parsed);
		const functionScope = scopes.scopeCount - 1;

		expect(
			scopes
				.getUnresolvedReferences(scopes.globalScope)
				.map(id => scopes.referenceName(id)),
		).toEqual(["outer"]);

		// A function's through list is what it closes over.
		expect(
			scopes
				.getUnresolvedReferences(functionScope)
				.map(id => scopes.referenceName(id))
				.sort(),
		).toEqual(["inner", "outer"]);
	});

	it("walks the scope chain", () => {
		const { parsed, buffer } = analyzed(
			"'use strict'; function f() { { let a; } }",
			{ sourceType: "script" },
		);
		const scopes = new Scopes(buffer, parsed);
		const block = scopes.scopeCount - 1;

		expect(scopes.scopeType(scopes.globalScope)).toBe("global");
		expect(scopes.scopeType(block)).toBe("block");
		expect(scopes.upper(scopes.globalScope)).toBe(null);
		expect(scopes.scopeType(scopes.upper(block)!)).toBe("function");
		expect(scopes.scopeType(scopes.variableScope(block))).toBe("function");
		expect(scopes.isStrict(scopes.globalScope)).toBe(true);
	});

	it("finds the scope a node opened", () => {
		const { parsed, buffer } = analyzed("const f = function g() {};");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);
		const functionNode = manager.scopes.find(
			scope => scope.type === "function",
		)!.block;

		// The function-expression-name scope is skipped, as acquire() skips it.
		expect(scopes.scopeType(scopes.getScope(functionNode)!)).toBe(
			"function",
		);
		expect(scopes.getScope(manager.scopes[1].variables[0].identifiers[0])).toBe(
			null,
		);
	});

	it("resolves a single identifier to its reference", () => {
		const { parsed, buffer } = analyzed("const a = 1; a;");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);
		const identifier = manager.scopes[1].references[1].identifier;
		const reference = scopes.resolveReference(identifier)!;

		expect(scopes.referenceIdentifier(reference)).toBe(identifier);
		expect(scopes.symbolName(scopes.referenceResolved(reference)!)).toBe(
			"a",
		);
		expect(scopes.referenceScope(reference)).toBe(1);
	});

	it("keeps usage marks in a side table, not the buffer", () => {
		const { parsed, buffer } = analyzed("const a = 1;");
		const before = new Uint8Array(buffer).slice();
		const scopes = new Scopes(buffer, parsed);

		expect(scopes.isSymbolUsed(0)).toBe(false);
		scopes.markSymbolAsUsed(0);
		expect(scopes.isSymbolUsed(0)).toBe(true);
		expect(new Uint8Array(buffer)).toEqual(before);

		// A fresh view over the same buffer starts clean.
		expect(new Scopes(buffer, parsed).isSymbolUsed(0)).toBe(false);
	});

	it("hands back the caller's own nodes on the tree path", () => {
		const tree = espree.parse("const a = 1; a;", {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
		}) as unknown as EsTreeNode;
		const buffer = analyzeTree(tree, { sourceType: "module" });
		const scopes = new Scopes<EsTreeNode>(buffer, tree);
		const statement = (tree.body as EsTreeNode[])[1];
		const identifier = statement.expression as EsTreeNode;
		const reference = scopes.resolveReference(identifier)!;

		expect(scopes.referenceIdentifier(reference)).toBe(identifier);
		expect(scopes.isGlobalReference(identifier)).toBe(false);
	});
});

describe("toScopeManager", () => {
	it("shares usage marks with a Scopes view when asked", () => {
		const { parsed, buffer } = analyzed("const a = 1;");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed, { scopes });
		const variable = manager.scopes[1].set.get("a")!;

		expect(variable.eslintUsed).toBe(false);
		variable.eslintUsed = true;
		expect(scopes.isSymbolUsed(variable.symbolId)).toBe(true);

		scopes.markSymbolAsUsed(manager.scopes[1].set.get("a")!.symbolId);
		expect(variable.eslintUsed).toBe(true);
	});

	it("assigns each variable its stable symbol ID", () => {
		const { parsed, buffer } = analyzed("const a = 1; function f(b) {}");
		const scopes = new Scopes(buffer, parsed);
		const manager = toScopeManager(buffer, parsed);

		for (const scope of manager.scopes) {
			for (const variable of scope.variables) {
				expect(scopes.symbolName(variable.symbolId)).toBe(variable.name);
				expect(scopes.symbolScope(variable.symbolId)).toBe(
					manager.scopes.indexOf(scope),
				);
			}
		}
	});
});

describe("toScopeTree", () => {
	it("produces a self-contained, JSON-serializable tree", () => {
		const { parsed, buffer } = analyzed(
			"const a = 1; function f() { return a; } undeclared = 2;",
			{ sourceType: "script" },
		);
		const tree = toScopeTree(buffer, parsed);

		expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
		expect(tree.sourceType).toBe("script");

		const root = tree.root!;

		expect(root.type).toBe("global");
		expect(root.block).toEqual({
			type: "Program",
			start: 0,
			end: expect.any(Number),
		});
		expect(root.variables.map(variable => variable.name)).toEqual([
			"a",
			"f",
		]);
		expect(root.implicit!.map(variable => variable.name)).toEqual([
			"undeclared",
		]);
		expect(root.childScopes).toHaveLength(1);
		expect(root.childScopes[0].type).toBe("function");

		const read = root.childScopes[0].references[0];

		expect(read.name).toBe("a");
		expect(read.read).toBe(true);
		expect(read.resolved).toBe(
			root.variables.find(variable => variable.name === "a")!.symbolId,
		);
	});

	it("renders the same shape from both paths", () => {
		const code = "let x = 1; x++;";
		const { parsed, buffer } = analyzed(code, { dialect: "js" });
		const tree = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
		}) as unknown as EsTreeNode;
		const treeBuffer = analyzeTree(tree, {
			sourceType: "module",
			dialect: "js",
		});

		expect(toScopeTree(treeBuffer, tree)).toEqual(
			toScopeTree(buffer, parsed),
		);
	});
});
