/**
 * @fileoverview The behavior of `analyze()` and the objects it returns, as
 * opposed to the differential checks that compare it to another
 * implementation.
 */

import * as espree from "espree";
import { describe, expect, it } from "vitest";
import {
	analyze,
	analyzeTree,
	parse,
	toAST,
	toScopeManager,
	type EsTreeNode,
	type Scope,
	type ScopeManager,
} from "../../src/index.js";

/**
 * Analyzes source text and rehydrates the escope-compatible graph, which is
 * the view this file's assertions are written against.
 * @param code The source text.
 * @param options How the program should be interpreted.
 * @returns The scope graph.
 */
function scopesOf(
	code: string,
	options: Parameters<typeof analyze>[1] = {},
): ScopeManager<number> {
	const parsed = parse(code);

	return toScopeManager(
		analyze(parsed, { sourceType: "module", ...options }),
		parsed,
	);
}

/**
 * The names a scope binds, in the order they were bound.
 * @param scope The scope to read.
 * @returns One name per variable.
 */
function names(scope: Scope): string[] {
	return scope.variables.map(variable => variable.name);
}

describe("scope tree", () => {
	it("puts a module scope inside the global scope", () => {
		const scopeManager = scopesOf("const a = 1;");

		expect(scopeManager.scopes.map(scope => scope.type)).toEqual([
			"global",
			"module",
		]);
		expect(scopeManager.globalScope).toBe(scopeManager.scopes[0]);
		expect(names(scopeManager.scopes[1])).toEqual(["a"]);
	});

	it("wraps a commonjs program in a function scope", () => {
		const scopeManager = scopesOf("var a = 1;", {
			sourceType: "commonjs",
		});

		expect(scopeManager.scopes.map(scope => scope.type)).toEqual([
			"global",
			"function",
		]);
		expect(scopeManager.scopes[0].isStrict).toBe(false);
		expect(names(scopeManager.scopes[1])).toEqual(["arguments", "a"]);
	});

	it("gives a script no module scope", () => {
		const scopeManager = scopesOf("var a = 1;", { sourceType: "script" });

		expect(scopeManager.scopes.map(scope => scope.type)).toEqual([
			"global",
		]);
	});

	it("treats a module as strict and a script as loose", () => {
		expect(scopesOf("a;", { sourceType: "module" }).scopes[1].isStrict).toBe(
			true,
		);
		expect(scopesOf("a;", { sourceType: "script" }).scopes[0].isStrict).toBe(
			false,
		);
	});

	it("honors a use strict directive", () => {
		const scopeManager = scopesOf("'use strict'; a;", {
			sourceType: "script",
		});

		expect(scopeManager.scopes[0].isStrict).toBe(true);
	});

	it("honors impliedStrict", () => {
		const scopeManager = scopesOf("a;", {
			sourceType: "script",
			impliedStrict: true,
		});

		expect(scopeManager.scopes[0].isStrict).toBe(true);
	});

	it("closes every scope it opens", () => {
		const scopeManager = scopesOf(
			"function f() { { let a; } } class C { m() {} }",
		);

		expect(scopeManager.currentScope).toBe(null);

		for (const scope of scopeManager.scopes) {
			expect(scope.isClosed()).toBe(true);
		}
	});
});

describe("resolution", () => {
	it("resolves a reference to the variable it names", () => {
		const scopeManager = scopesOf("const a = 1; a;");
		const moduleScope = scopeManager.scopes[1];
		const [variable] = moduleScope.variables;

		expect(variable.references).toHaveLength(2);
		expect(moduleScope.references.every(ref => ref.resolved === variable)).toBe(
			true,
		);
	});

	it("leaves an unknown name unresolved and passes it through", () => {
		const scopeManager = scopesOf("missing;");

		expect(scopeManager.scopes[1].through).toHaveLength(1);
		expect(scopeManager.globalScope!.through[0].resolved).toBe(null);
	});

	it("records reads, writes, and read-writes", () => {
		const scopeManager = scopesOf("let a = 1; a; a = 2; a += 3;", {
			sourceType: "script",
		});
		const [reference, read, write, readWrite] =
			scopeManager.globalScope!.references;

		expect(reference.isWrite() && reference.init).toBe(true);
		expect(read.isReadOnly()).toBe(true);
		expect(write.isWriteOnly()).toBe(true);
		expect(readWrite.isReadWrite()).toBe(true);
	});

	it("creates an implicit global for an undeclared assignment", () => {
		const scopeManager = scopesOf("undeclared = 1;", {
			sourceType: "script",
		});
		const implicit = scopeManager.globalScope!.implicit!;

		expect(implicit.variables.map(variable => variable.name)).toEqual([
			"undeclared",
		]);
	});

	it("creates no implicit global in strict mode", () => {
		const scopeManager = scopesOf("'use strict'; undeclared = 1;", {
			sourceType: "script",
		});

		expect(scopeManager.globalScope!.implicit!.variables).toHaveLength(0);
	});

	it("does not resolve a default parameter to a body binding", () => {
		const scopeManager = scopesOf(
			"const x = 1; function f(a = x) { const x = 2; return a; }",
		);
		const functionScope = scopeManager.scopes[2];
		const outerX = scopeManager.scopes[1].variables.find(
			variable => variable.name === "x",
		)!;
		const reference = functionScope.references.find(
			ref => ref.name === "x" && ref.isRead(),
		)!;

		expect(reference.resolved).toBe(outerX);
	});

	it("marks scopes dynamic when eval is called directly", () => {
		const scopeManager = scopesOf("function f() { eval('a'); }", {
			sourceType: "script",
		});
		const functionScope = scopeManager.scopes[1];

		expect(functionScope.directCallToEvalScope).toBe(true);
		expect(functionScope.isStatic()).toBe(false);
	});

	it("leaves eval alone when told to ignore it", () => {
		const scopeManager = scopesOf("function f() { eval('a'); }", {
			sourceType: "script",
			ignoreEval: true,
		});

		expect(scopeManager.scopes[1].directCallToEvalScope).toBe(false);
	});

	it("taints the references inside a with statement", () => {
		const scopeManager = scopesOf("with (obj) { a; }", {
			sourceType: "script",
		});
		const withScope = scopeManager.scopes.find(
			scope => scope.type === "with",
		)!;

		/*
		 * The reference is written in the block inside the `with`, so it is
		 * the `with` scope passing it outward that marks it.
		 */
		expect(withScope.through[0].name).toBe("a");
		expect(withScope.through[0].tainted).toBe(true);
		expect(withScope.isStatic()).toBe(false);
	});
});

describe("queries", () => {
	it("finds the scope a node opened", () => {
		const code = "function f() {}";
		const scopeManager = scopesOf(code);
		const functionScope = scopeManager.scopes[2];

		expect(scopeManager.acquire(functionScope.block)).toBe(functionScope);
		expect(scopeManager.nodeType(functionScope.block)).toBe(
			"FunctionDeclaration",
		);
		expect(scopeManager.nodeRange(functionScope.block)).toEqual([
			0,
			code.length,
		]);
	});

	it("skips the scope that only holds a function expression's name", () => {
		const scopeManager = scopesOf("const f = function g() {};");
		const block = scopeManager.scopes[2].block;

		expect(scopeManager.acquireAll(block)).toHaveLength(2);
		expect(scopeManager.acquire(block)!.type).toBe("function");
		expect(scopeManager.scopes[2].type).toBe("function-expression-name");
	});

	it("reports the variables a node declares", () => {
		const scopeManager = scopesOf("const a = 1, b = 2;");
		const declaration = scopeManager.scopes[1].variables[0].defs[0].parent;

		expect(
			scopeManager.getDeclaredVariables(declaration).map(v => v.name),
		).toEqual(["a", "b"]);
		expect(scopeManager.getDeclaredVariables(0)).toEqual([]);
	});

	it("reports whether a name means anything in a scope", () => {
		const scopeManager = scopesOf("const a = 1; missing;");
		const moduleScope = scopeManager.scopes[1];

		expect(moduleScope.isUsedName("a")).toBe(true);
		expect(moduleScope.isUsedName("missing")).toBe(true);
		expect(moduleScope.isUsedName("neither")).toBe(false);
	});

	it("finds the reference recorded for an identifier", () => {
		const scopeManager = scopesOf("const a = 1; a;");
		const moduleScope = scopeManager.scopes[1];
		const identifier = moduleScope.references[1].identifier;

		expect(moduleScope.resolveIdentifier(identifier)).toBe(
			moduleScope.references[1],
		);
		expect(moduleScope.resolveIdentifier(0)).toBe(null);
	});

	it("reports whether arguments and this are needed", () => {
		const plain = scopesOf("function f() {}", { sourceType: "script" });
		const using = scopesOf("function f() { arguments; this; }", {
			sourceType: "script",
		});

		expect(plain.scopes[1].isArgumentsMaterialized()).toBe(false);
		expect(plain.scopes[1].isThisMaterialized()).toBe(false);
		expect(using.scopes[1].isArgumentsMaterialized()).toBe(true);
		expect(using.scopes[1].isThisMaterialized()).toBe(true);
	});
});

describe("globals", () => {
	it("declares supplied globals and resolves what waited for them", () => {
		const scopeManager = scopesOf("console.log(missing);", {
			globals: ["console"],
		});
		const globalScope = scopeManager.globalScope!;
		const console = globalScope.set.get("console")!;

		expect(console.references).toHaveLength(1);
		expect(globalScope.through.map(ref => ref.name)).toEqual(["missing"]);
	});

	it("removes an implicit global that a supplied global covers", () => {
		const scopeManager = scopesOf("undeclared = 1;", {
			sourceType: "script",
			globals: ["undeclared"],
		});

		expect(scopeManager.globalScope!.implicit!.variables).toHaveLength(0);
		expect(scopeManager.globalScope!.set.has("undeclared")).toBe(true);
	});
});

describe("typescript", () => {
	it("binds a type name and resolves a type reference to it", () => {
		const scopeManager = scopesOf("interface A {} let a: A;");
		const moduleScope = scopeManager.scopes[1];
		const type = moduleScope.set.get("A")!;

		expect(type.isTypeVariable).toBe(true);
		expect(type.isValueVariable).toBe(false);
		expect(type.references).toHaveLength(1);
		expect(type.references[0].isTypeReference).toBe(true);
	});

	it("does not resolve a value reference to a type-only name", () => {
		const scopeManager = scopesOf("interface A {} A;");
		const moduleScope = scopeManager.scopes[1];

		expect(moduleScope.set.get("A")!.references).toHaveLength(0);
		expect(moduleScope.through.map(ref => ref.name)).toEqual(["A"]);
	});

	it("opens a scope for an enum, a namespace, and a mapped type", () => {
		const types = scopesOf(
			"enum E { A } namespace N {} type M = { [K in keyof T]: K };",
		).scopes.map(scope => scope.type);

		expect(types).toContain("tsEnum");
		expect(types).toContain("tsModule");
		expect(types).toContain("mappedType");
	});

	it("binds an infer name in the conditional type that encloses it", () => {
		const scopeManager = scopesOf("type A<T> = T extends Array<infer U> ? U : never;");
		const conditional = scopeManager.scopes.find(
			scope => scope.type === "conditionalType",
		)!;

		expect(names(conditional)).toEqual(["U"]);
	});

	it("reports an export specifier as naming both a value and a type", () => {
		const scopeManager = scopesOf("const a = 1; export { a };");
		const reference = scopeManager.scopes[1].references.at(-1)!;

		expect(reference.isValueReference).toBe(true);
		expect(reference.isTypeReference).toBe(true);
	});

	it("reports an export specifier as naming only a value in javascript mode", () => {
		const scopeManager = scopesOf("const a = 1; export { a };", {
			dialect: "js",
		});
		const reference = scopeManager.scopes[1].references.at(-1)!;

		expect(reference.isValueReference).toBe(true);
		expect(reference.isTypeReference).toBe(false);
	});
});

describe("jsx", () => {
	it("references a capitalized tag but not a host tag", () => {
		const scopeManager = scopesOf(
			"const a = <div><Component /></div>;",
		);

		expect(scopeManager.scopes[1].through.map(ref => ref.name)).toEqual([
			"Component",
		]);
	});

	it("references the pragma once when one is configured", () => {
		const scopeManager = scopesOf(
			"import React from 'react'; const a = <div />; const b = <span />;",
			{ jsxPragma: "React" },
		);
		const react = scopeManager.scopes[1].set.get("React")!;

		expect(react.references).toHaveLength(1);
	});

	it("references the fragment factory when one is configured", () => {
		const scopeManager = scopesOf(
			"import { Frag } from 'react'; const a = <>{x}</>;",
			{ jsxFragmentName: "Frag" },
		);

		expect(scopeManager.scopes[1].set.get("Frag")!.references).toHaveLength(
			1,
		);
	});

	/*
	 * The two reference analyzers disagree about the closing tag, and about a
	 * namespaced name; `eslint-scope` is the tiebreak, and both of these are
	 * written up in `docs/deviations.md`.
	 */
	it("references an element's name once, at the opening tag", () => {
		const scopeManager = scopesOf("const C = 1; const a = <C>{x}</C>;");
		const component = scopeManager.scopes[1].set.get("C")!;

		// The declaration's own identifier, and the opening tag. Not `</C>`.
		expect(
			component.references.map(ref => ref.identifier),
		).toHaveLength(2);
	});

	it("references the object of a member name once, at the opening tag", () => {
		const scopeManager = scopesOf(
			"const N = { M: 1 }; const a = <N.M>{x}</N.M>;",
		);

		expect(scopeManager.scopes[1].set.get("N")!.references).toHaveLength(2);
	});

	it("references neither half of a namespaced name", () => {
		const scopeManager = scopesOf("const x = 1; const a = <x:y></x:y>;");

		expect(scopeManager.scopes[1].through).toEqual([]);
		expect(scopeManager.scopes[1].set.get("x")!.references).toHaveLength(1);
	});
});

describe("analyzeTree", () => {
	/**
	 * Analyzes source text through `espree` rather than the binary format.
	 * @param code The source text.
	 * @param options How the program should be interpreted.
	 * @returns The tree that was analyzed and the scope graph.
	 */
	function fromEspree(
		code: string,
		options: Parameters<typeof analyzeTree>[1] = {},
	): { tree: EsTreeNode; scopeManager: ScopeManager<EsTreeNode> } {
		const tree = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
			ecmaFeatures: { jsx: true },
		}) as unknown as EsTreeNode;

		return {
			tree,
			scopeManager: toScopeManager(
				analyzeTree(tree, {
					sourceType: "module",
					dialect: "js",
					...options,
				}),
				tree,
			),
		};
	}

	it("finds the same scopes an espree tree describes", () => {
		const { scopeManager } = fromEspree(
			"const a = 1; function f(b) { return a + b; }",
		);

		expect(scopeManager.scopes.map(scope => scope.type)).toEqual([
			"global",
			"module",
			"function",
		]);
		expect(names(scopeManager.scopes[1])).toEqual(["a", "f"]);
		expect(names(scopeManager.scopes[2])).toEqual(["arguments", "b"]);
	});

	it("hands back the caller's own node objects", () => {
		const code = "const a = 1; a;";
		const { tree, scopeManager } = fromEspree(code);
		const declaration = (tree.body as EsTreeNode[])[0];
		const declarator = (declaration.declarations as EsTreeNode[])[0];
		const moduleScope = scopeManager.scopes[1];
		const [variable] = moduleScope.variables;

		expect(scopeManager.globalScope!.block).toBe(tree);
		expect(variable.identifiers[0]).toBe(declarator.id);
		expect(variable.defs[0].node).toBe(declarator);
		expect(variable.defs[0].parent).toBe(declaration);
		expect(moduleScope.references[1].identifier).toBe(
			((tree.body as EsTreeNode[])[1].expression as EsTreeNode),
		);
	});

	it("reads a node's extent from range or from start and end", () => {
		const withRange = espree.parse("function f(a = x) { const x = 1; }", {
			ecmaVersion: "latest",
			sourceType: "module",
			range: true,
		}) as unknown as EsTreeNode;
		const withoutRange = espree.parse(
			"function f(a = x) { const x = 1; }",
			{ ecmaVersion: "latest", sourceType: "module" },
		) as unknown as EsTreeNode;

		/*
		 * Resolving a default parameter compares offsets, so a tree that
		 * reports them only as `start` and `end` has to work too.
		 */
		for (const tree of [withRange, withoutRange]) {
			const scopeManager = toScopeManager(
				analyzeTree(tree, { sourceType: "module", dialect: "js" }),
				tree,
			);
			const functionScope = scopeManager.scopes[2];
			const read = functionScope.references.find(
				reference => reference.name === "x" && reference.isRead(),
			)!;

			expect(read.resolved).toBe(null);
			expect(functionScope.set.get("x")!.references).toHaveLength(1);
		}
	});

	it("agrees with the binary path on the same program", () => {
		const code =
			"import a from 'm'; export const b = a; class C extends a { m() { return b; } }";
		const result = parse(code);
		const binary = toScopeManager(
			analyze(result, { sourceType: "module", dialect: "ts" }),
			result,
		);
		const program = toAST(result, { sourceType: "module", dialect: "ts" })
			.ast as unknown as EsTreeNode;
		const tree = toScopeManager(
			analyzeTree(program, { sourceType: "module", dialect: "ts" }),
			program,
		);

		expect(tree.scopes.map(scope => scope.type)).toEqual(
			binary.scopes.map(scope => scope.type),
		);
		expect(tree.scopes.map(scope => names(scope))).toEqual(
			binary.scopes.map(scope => names(scope)),
		);
		expect(tree.scopes.map(scope => scope.through.map(r => r.name))).toEqual(
			binary.scopes.map(scope => scope.through.map(r => r.name)),
		);
	});

	it("walks a node type it has never heard of", () => {
		const { tree, scopeManager: before } = fromEspree("const a = 1;");

		expect(before.scopes[1].through).toHaveLength(0);

		/*
		 * A parser with syntax of its own produces types this analyzer cannot
		 * know. Skipping the subtree would silently lose every reference in
		 * it, so the children are found by inspection instead.
		 */
		const invented: EsTreeNode = {
			type: "SomethingNobodyHasHeardOf",
			expression: {
				type: "ExpressionStatement",
				expression: { type: "Identifier", name: "missing" },
			},
		};

		(tree.body as EsTreeNode[]).push(invented);

		const scopeManager = toScopeManager(
			analyzeTree(tree, { sourceType: "module", dialect: "js" }),
			tree,
		);

		expect(scopeManager.scopes[1].through.map(ref => ref.name)).toEqual([
			"missing",
		]);
	});
});
