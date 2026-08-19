/**
 * @fileoverview Unit tests for one lexical scope and how it closes.
 *
 * `Scope` is the object-graph half of the analyzer: `scope-builder.ts` makes
 * the same decisions over the binary format, and `toScopeManager()` rehydrates
 * a buffer into these objects rather than replaying the walk. Nothing else in
 * the package therefore calls `define()`, `referenceValue()`, or `close()` —
 * but they are exported, so the resolution rules they implement are pinned
 * here directly.
 */

import { describe, expect, it } from "vitest";
import {
	N_ArrowFunctionExpression,
	N_BlockStatement,
	N_ExpressionStatement,
	N_FunctionDeclaration,
	N_Identifier,
	N_Program,
} from "../parse/index.js";
import { SLOT_A, SLOT_C } from "./ast-access.js";
import {
	typeDefinition,
	variableDefinition,
	type Definition,
} from "./definition.js";
import { FakeAst, type FakeNode } from "./fake-ast.spec-helpers.js";
import {
	READ,
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_FUNCTION,
	SCOPE_GLOBAL,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TYPE,
	SCOPE_WITH,
	WRITE,
	type ScopeType,
} from "./kinds.js";
import { resolveOptions } from "./options.js";
import { ScopeManager } from "./scope-manager.js";
import { hasUseStrictDirective, Scope } from "./scope.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/** The handle of the `Program` node in every program these tests build. */
const PROGRAM = 0;

/** A program with nothing in it. */
const EMPTY_PROGRAM: FakeNode[] = [{ kind: N_Program }];

/**
 * A program whose prologue turns strict mode on.
 */
const STRICT_PROGRAM: FakeNode[] = [
	{ kind: N_Program, lists: { [SLOT_A]: [1] } },
	{ kind: N_ExpressionStatement, directive: "use strict" },
];

/**
 * A function at handle 1 whose body is a block starting at offset 10, an
 * identifier at handle 3 written in the parameter list, and one at handle 4
 * written in the body.
 */
const FUNCTION_PROGRAM: FakeNode[] = [
	{ kind: N_Program },
	{ kind: N_FunctionDeclaration, children: { [SLOT_C]: 2 } },
	{ kind: N_BlockStatement, start: 10 },
	{ kind: N_Identifier, start: 5 },
	{ kind: N_Identifier, start: 15 },
];

/** A made-up program with its global scope already open. */
interface World {
	/** The manager the scopes belong to. */
	scopeManager: ScopeManager<number>;

	/** The global scope. */
	global: Scope<number>;

	/**
	 * Opens a scope inside another one.
	 * @param upper The enclosing scope.
	 * @param type The kind of scope to open.
	 * @param block The node opening it.
	 * @param isMethodDefinition Whether the scope is a method body.
	 * @returns The new scope.
	 */
	nest(
		upper: Scope<number>,
		type: ScopeType,
		block?: number,
		isMethodDefinition?: boolean,
	): Scope<number>;
}

/**
 * Builds a made-up program and opens its global scope.
 * @param nodes The nodes, where a node's handle is its index.
 * @returns The manager, the global scope, and a way to nest more.
 */
function world(nodes: FakeNode[] = EMPTY_PROGRAM): World {
	const scopeManager = new ScopeManager(new FakeAst(nodes), resolveOptions());
	const global = new Scope(scopeManager, SCOPE_GLOBAL, null, PROGRAM, false);

	scopeManager.globalScope = global;

	return {
		scopeManager,
		global,
		nest: (upper, type, block = PROGRAM, isMethodDefinition = false) =>
			new Scope(scopeManager, type, upper, block, isMethodDefinition),
	};
}

/**
 * A definition to hang on a value binding, since resolution reads `defs`.
 * @param name The identifier node the definition names.
 * @returns The definition.
 */
function varDef(name: number): Definition<number> {
	return variableDefinition(name, name, name, 0, "var");
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("Scope", () => {
	describe("construction", () => {
		it("registers itself with its manager and its enclosing scope", () => {
			const { scopeManager, global, nest } = world();
			const inner = nest(global, SCOPE_BLOCK);

			expect(scopeManager.scopes).toEqual([global, inner]);
			expect(global.childScopes).toEqual([inner]);
			expect(inner.upper).toBe(global);
		});

		it("gives the global scope an implicit-globals record and nothing else one", () => {
			const { global, nest } = world();

			expect(global.implicit).toEqual({
				set: new Map(),
				variables: [],
				left: [],
			});
			expect(nest(global, SCOPE_BLOCK).implicit).toBeNull();
		});

		it("makes the global and `with` scopes dynamic and the rest static", () => {
			const { global, nest } = world();

			expect(global.isStatic()).toBe(false);
			expect(nest(global, SCOPE_WITH).isStatic()).toBe(false);
			expect(nest(global, SCOPE_BLOCK).isStatic()).toBe(true);
		});

		it("points a non-variable scope at the nearest enclosing variable scope", () => {
			const { global, nest } = world();

			expect(global.variableScope).toBe(global);
			expect(nest(global, SCOPE_BLOCK).variableScope).toBe(global);
		});

		it("takes a caller's word for strictness instead of re-deriving it", () => {
			const scopeManager = new ScopeManager(
				new FakeAst(EMPTY_PROGRAM),
				resolveOptions(),
			);
			const scope = new Scope(
				scopeManager,
				SCOPE_GLOBAL,
				null,
				PROGRAM,
				false,
				true,
			);

			expect(scope.isStrict).toBe(true);
		});
	});

	describe("strictness", () => {
		it("reads a program's `use strict` prologue", () => {
			expect(world(STRICT_PROGRAM).global.isStrict).toBe(true);
			expect(world().global.isStrict).toBe(false);
		});

		it("stops the prologue scan at the first non-directive", () => {
			const { global } = world([
				{ kind: N_Program, lists: { [SLOT_A]: [1, 2] } },
				{ kind: N_ExpressionStatement, directive: null },
				{ kind: N_ExpressionStatement, directive: "use strict" },
			]);

			expect(global.isStrict).toBe(false);
		});

		it("stops the prologue scan at an array hole", () => {
			const { global } = world([
				{ kind: N_Program, lists: { [SLOT_A]: [null, 1] } },
				{ kind: N_ExpressionStatement, directive: "use strict" },
			]);

			expect(global.isStrict).toBe(false);
		});

		it("inherits strictness from the enclosing scope", () => {
			const { global, nest } = world(STRICT_PROGRAM);

			expect(nest(global, SCOPE_BLOCK).isStrict).toBe(true);
		});

		it("treats a method body as strict no matter what encloses it", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);

			expect(nest(global, SCOPE_FUNCTION, 1, true).isStrict).toBe(true);
		});

		it("treats the implicitly strict scope types as strict", () => {
			const { global, nest } = world();

			expect(nest(global, SCOPE_CLASS).isStrict).toBe(true);
			expect(nest(global, SCOPE_MODULE).isStrict).toBe(true);
			expect(nest(global, SCOPE_TYPE).isStrict).toBe(true);
		});

		it("never derives strictness for a block or switch scope", () => {
			const { global, nest } = world();

			expect(nest(global, SCOPE_BLOCK).isStrict).toBe(false);
			expect(nest(global, SCOPE_SWITCH).isStrict).toBe(false);
		});

		it("reads a function body's own prologue", () => {
			const { global, nest } = world([
				{ kind: N_Program },
				{ kind: N_FunctionDeclaration, children: { [SLOT_C]: 2 } },
				{ kind: N_BlockStatement, lists: { [SLOT_A]: [3] } },
				{ kind: N_ExpressionStatement, directive: "use strict" },
			]);

			expect(nest(global, SCOPE_FUNCTION, 1).isStrict).toBe(true);
		});

		it("treats a function with no body as non-strict", () => {
			const { global, nest } = world([
				{ kind: N_Program },
				{ kind: N_FunctionDeclaration },
			]);

			expect(nest(global, SCOPE_FUNCTION, 1).isStrict).toBe(false);
		});

		it("treats an expression-bodied arrow as non-strict", () => {
			const { global, nest } = world([
				{ kind: N_Program },
				// An arrow whose body is an expression, and one with no body.
				{ kind: N_ArrowFunctionExpression, children: { [SLOT_C]: 3 } },
				{ kind: N_ArrowFunctionExpression },
				{ kind: N_Identifier },
			]);

			expect(nest(global, SCOPE_FUNCTION, 1).isStrict).toBe(false);
			expect(nest(global, SCOPE_FUNCTION, 2).isStrict).toBe(false);
		});

		it("reads the program's own prologue for a `globalReturn` wrapper", () => {
			const scopeManager = new ScopeManager(
				new FakeAst(STRICT_PROGRAM),
				resolveOptions(),
			);
			const wrapper = new Scope(
				scopeManager,
				SCOPE_FUNCTION,
				null,
				PROGRAM,
				false,
			);

			expect(wrapper.isStrict).toBe(true);
		});

		it("never derives strictness for a scope type that has no body of its own", () => {
			const { global, nest } = world();

			expect(nest(global, SCOPE_WITH).isStrict).toBe(false);
			expect(nest(global, SCOPE_CATCH).isStrict).toBe(false);
		});
	});

	describe("hasUseStrictDirective()", () => {
		it("finds the directive past an earlier one", () => {
			const ast = new FakeAst([
				{ kind: N_BlockStatement, lists: { [SLOT_A]: [1, 2] } },
				{ kind: N_ExpressionStatement, directive: "use asm" },
				{ kind: N_ExpressionStatement, directive: "use strict" },
			]);

			expect(hasUseStrictDirective(ast, 0)).toBe(true);
		});

		it("reports false for an empty statement list", () => {
			const ast = new FakeAst([{ kind: N_BlockStatement }]);

			expect(hasUseStrictDirective(ast, 0)).toBe(false);
		});
	});

	describe("declaring", () => {
		it("creates the variable the first time a name is seen and reuses it after", () => {
			const { global } = world();

			global.define(1, "a", varDef(1));
			global.define(2, "a", varDef(2));

			const variable = global.set.get("a")!;

			expect(global.variables).toEqual([variable]);
			expect(variable.identifiers).toEqual([1, 2]);
			expect(variable.defs).toHaveLength(2);
			expect(variable.scope).toBe(global);
		});

		it("binds a name with no identifier and no definition", () => {
			const { global } = world();

			global.defineVariable(
				"arguments",
				global.set,
				global.variables,
				null,
				null,
			);

			const variable = global.set.get("arguments")!;

			expect(variable.identifiers).toEqual([]);
			expect(variable.defs).toEqual([]);
		});

		it("files the definition's node and parent as declaring the variable", () => {
			const { scopeManager, global } = world();

			global.define(1, "a", variableDefinition(1, 2, 3, 0, "let"));

			const variable = global.set.get("a")!;

			expect(scopeManager.getDeclaredVariables(2)).toEqual([variable]);
			expect(scopeManager.getDeclaredVariables(3)).toEqual([variable]);
		});

		it("binds the name a string literal spells", () => {
			const { global } = world();

			global.defineLiteral("a", varDef(1));

			expect(global.set.get("a")!.identifiers).toEqual([]);
			expect(global.set.get("a")!.defs).toHaveLength(1);
		});
	});

	describe("referencing", () => {
		it("records a value reference with the defaults of a plain read", () => {
			const { global } = world();

			global.referenceValue(1, "a");

			const [reference] = global.references;

			expect(reference.identifier).toBe(1);
			expect(reference.name).toBe("a");
			expect(reference.from).toBe(global);
			expect(reference.isValueReference).toBe(true);
			expect(reference.isTypeReference).toBe(false);
			expect(reference.isRead()).toBe(true);
			expect(reference.writeExpr).toBeNull();
			expect(global.left).toEqual([reference]);
		});

		it("records a write with everything the caller supplied", () => {
			const { global } = world();
			const implicit = { pattern: 1, node: 2 };

			global.referenceValue(1, "a", WRITE, 3, implicit, true, true);

			const [reference] = global.references;

			expect(reference.isWrite()).toBe(true);
			expect(reference.writeExpr).toBe(3);
			expect(reference.maybeImplicitGlobal).toBe(implicit);
			expect(reference.partial).toBe(true);
			expect(reference.init).toBe(true);
		});

		it("records a type reference", () => {
			const { global } = world();

			global.referenceType(1, "T");

			const [reference] = global.references;

			expect(reference.isTypeReference).toBe(true);
			expect(reference.isValueReference).toBe(false);
		});

		it("records a reference that names either a value or a type", () => {
			const { global } = world();

			global.referenceDualValueType(1, "a");

			const [reference] = global.references;

			expect(reference.isTypeReference).toBe(true);
			expect(reference.isValueReference).toBe(true);
		});
	});

	describe("close()", () => {
		it("resolves a reference to a binding in the same scope", () => {
			const { global } = world();

			global.define(1, "a", varDef(1));
			global.referenceValue(2, "a");

			expect(global.close()).toBeNull();

			const variable = global.set.get("a")!;

			expect(global.references[0].resolved).toBe(variable);
			expect(variable.references).toEqual([global.references[0]]);
			expect(global.through).toEqual([]);
			expect(global.isClosed()).toBe(true);
		});

		it("hands an unresolved reference up and records it as passing through", () => {
			const { global, nest } = world();
			const inner = nest(global, SCOPE_BLOCK);

			global.define(1, "a", varDef(1));
			inner.referenceValue(2, "a");

			expect(inner.close()).toBe(global);
			expect(inner.through).toEqual(inner.references);
			expect(global.left).toEqual(inner.references);

			global.close();

			expect(inner.references[0].resolved).toBe(global.set.get("a"));
		});

		it("marks a reference resolved outside its own function scope as not on the stack", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const inner = nest(global, SCOPE_FUNCTION, 1);

			global.define(1, "a", varDef(1));
			inner.referenceValue(4, "a");
			inner.close();
			global.close();

			expect(global.set.get("a")!.stack).toBe(false);
		});

		it("leaves a name a type binding cannot satisfy for an enclosing scope", () => {
			const { global, nest } = world();
			const inner = nest(global, SCOPE_BLOCK);

			inner.define(1, "T", typeDefinition(1, 1));
			inner.referenceValue(2, "T");
			inner.close();

			expect(inner.references[0].resolved).toBeNull();
			expect(inner.through).toEqual(inner.references);
		});

		it("resolves a type reference to a type binding", () => {
			const { global, nest } = world();
			const inner = nest(global, SCOPE_BLOCK);

			inner.define(1, "T", typeDefinition(1, 1));
			inner.referenceType(2, "T");
			inner.close();

			expect(inner.references[0].resolved).toBe(inner.set.get("T"));
		});

		it("passes every reference through a dynamic scope untouched", () => {
			const { global, nest } = world();
			const middle = nest(global, SCOPE_BLOCK);
			const inner = nest(middle, SCOPE_BLOCK);

			inner.define(1, "a", varDef(1));
			inner.referenceValue(2, "a");
			inner.detectEval();
			inner.close();

			expect(inner.references[0].resolved).toBeNull();
			expect(inner.through).toEqual(inner.references);
			expect(middle.through).toEqual(inner.references);
			expect(global.through).toEqual(inner.references);
		});

		it("taints the references a `with` body could redirect", () => {
			const { global, nest } = world();
			const withScope = nest(global, SCOPE_WITH);

			global.define(1, "a", varDef(1));
			withScope.referenceValue(2, "a");

			expect(withScope.close()).toBe(global);
			expect(withScope.references[0].tainted).toBe(true);
			expect(withScope.isClosed()).toBe(true);

			global.close();

			const variable = global.set.get("a")!;

			expect(variable.tainted).toBe(true);
			expect(global.taints.get("a")).toBe(true);
		});

		it("resolves a `with` body statically once nothing dynamic is left", () => {
			const { global, nest } = world();
			const withScope = nest(global, SCOPE_WITH);

			withScope.dynamic = false;
			withScope.define(1, "a", varDef(1));
			withScope.referenceValue(2, "a");
			withScope.close();

			expect(withScope.references[0].resolved).toBe(
				withScope.set.get("a"),
			);
			expect(withScope.references[0].tainted).toBe(false);
		});

		it("turns an assignment to an undeclared name into an implicit global", () => {
			const { global } = world();

			global.referenceValue(1, "a", WRITE, 2, { pattern: 1, node: 2 });
			global.close();

			const implicit = global.implicit!;

			expect([...implicit.set.keys()]).toEqual(["a"]);
			expect(implicit.variables).toHaveLength(1);
			expect(implicit.variables[0].defs[0].type).toBe(
				"ImplicitGlobalVariable",
			);

			// The name is still unresolved: an implicit global is not a binding.
			expect(global.set.has("a")).toBe(false);
			expect(implicit.left).toEqual(global.through);
		});

		it("does not shadow a real global binding with an implicit one", () => {
			const { global } = world();

			global.define(1, "a", varDef(1));
			global.referenceValue(2, "a", WRITE, 3, { pattern: 2, node: 3 });
			global.close();

			expect(global.implicit!.set.size).toBe(0);
		});

		it("ignores a read that never had an implicit-global record", () => {
			const { global } = world();

			global.referenceValue(1, "a", READ);
			global.close();

			expect(global.implicit!.set.size).toBe(0);
		});
	});

	describe("the parameter-list resolution rule", () => {
		it("refuses a body binding for a reference in the parameter list", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			scope.define(4, "x", varDef(4));
			scope.referenceValue(3, "x");
			scope.close();

			expect(scope.references[0].resolved).toBeNull();
			expect(scope.through).toEqual(scope.references);
		});

		it("accepts a parameter binding for a reference in the parameter list", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			scope.define(3, "x", varDef(3));
			scope.referenceValue(3, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(scope.set.get("x"));
		});

		it("accepts a body binding for a reference in the body", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			scope.define(4, "x", varDef(4));
			scope.referenceValue(4, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(scope.set.get("x"));
		});

		it("accepts a binding that belongs to an enclosing scope", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			global.define(4, "x", varDef(4));
			scope.referenceValue(3, "x");
			scope.close();
			global.close();

			expect(scope.references[0].resolved).toBe(global.set.get("x"));
		});

		it("imposes no parameter rule outside a function scope", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_BLOCK, 1);

			scope.define(4, "x", varDef(4));
			scope.referenceValue(3, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(scope.set.get("x"));
		});

		it("imposes no parameter rule on a `globalReturn` wrapper", () => {
			const scopeManager = new ScopeManager(
				new FakeAst([
					{ kind: N_Program },
					{ kind: N_Identifier, start: 0 },
				]),
				resolveOptions(),
			);
			const scope = new Scope(
				scopeManager,
				SCOPE_FUNCTION,
				null,
				PROGRAM,
				false,
			);

			scope.define(1, "x", varDef(1));
			scope.referenceValue(1, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(scope.set.get("x"));
		});

		it("imposes no parameter rule on a function with no body", () => {
			const { global, nest } = world([
				{ kind: N_Program },
				{ kind: N_FunctionDeclaration },
				{ kind: N_Identifier, start: 5 },
			]);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			scope.define(2, "x", varDef(2));
			scope.referenceValue(2, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(scope.set.get("x"));
		});

		it("accepts a binding declared in the parameter list of a name also declared in the body", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);
			const variable = scope.defineVariable(
				"x",
				scope.set,
				scope.variables,
				3,
				varDef(3),
			);

			variable.defs.push(varDef(4));
			scope.referenceValue(3, "x");
			scope.close();

			expect(scope.references[0].resolved).toBe(variable);
		});
	});

	describe("detectEval()", () => {
		it("makes every enclosing scope dynamic", () => {
			const { global, nest } = world();
			const middle = nest(global, SCOPE_BLOCK);
			const inner = nest(middle, SCOPE_BLOCK);

			inner.detectEval();

			expect(inner.directCallToEvalScope).toBe(true);
			expect(middle.directCallToEvalScope).toBe(false);
			expect(inner.isStatic()).toBe(false);
			expect(middle.isStatic()).toBe(false);
			expect(global.isStatic()).toBe(false);
		});
	});

	describe("queries", () => {
		it("reports `this` only once something says so", () => {
			const { global, nest } = world();
			const scope = nest(global, SCOPE_BLOCK);

			expect(scope.thisFound).toBe(false);
			expect(scope.isThisMaterialized()).toBe(false);

			scope.detectThis();

			expect(scope.thisFound).toBe(true);
			expect(scope.isThisMaterialized()).toBe(true);
		});

		it("reports `this` as materialized in a dynamic scope regardless", () => {
			expect(world().global.isThisMaterialized()).toBe(true);
		});

		it("reports a scope as closed only after `close()`", () => {
			const { global } = world();

			expect(global.isClosed()).toBe(false);

			global.close();

			expect(global.isClosed()).toBe(true);
		});

		it("materializes `arguments` outside a function scope", () => {
			expect(world().global.isArgumentsMaterialized()).toBe(true);
		});

		it("never materializes `arguments` for an arrow", () => {
			const { global, nest } = world([
				{ kind: N_Program },
				{ kind: N_ArrowFunctionExpression },
			]);

			expect(
				nest(global, SCOPE_FUNCTION, 1).isArgumentsMaterialized(),
			).toBe(false);
		});

		it("materializes `arguments` in a dynamic function scope", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const scope = nest(global, SCOPE_FUNCTION, 1);

			scope.detectEval();

			expect(scope.isArgumentsMaterialized()).toBe(true);
		});

		it("reports no `arguments` binding at all as not materialized", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);

			expect(
				nest(global, SCOPE_FUNCTION, 1).isArgumentsMaterialized(),
			).toBe(false);
		});

		it("materializes `arguments` only when something mentions it", () => {
			const { global, nest } = world(FUNCTION_PROGRAM);
			const unused = nest(global, SCOPE_FUNCTION, 1);

			unused.defineVariable(
				"arguments",
				unused.set,
				unused.variables,
				null,
				null,
			);

			expect(unused.isArgumentsMaterialized()).toBe(false);

			const used = nest(global, SCOPE_FUNCTION, 1);

			used.defineVariable(
				"arguments",
				used.set,
				used.variables,
				null,
				null,
			);
			used.referenceValue(4, "arguments");
			used.close();

			expect(used.isArgumentsMaterialized()).toBe(true);
		});

		it("finds the reference recorded for an identifier", () => {
			const { global } = world();

			global.referenceValue(1, "a");
			global.referenceValue(2, "b");

			expect(global.resolveIdentifier(2)).toBe(global.references[1]);
			expect(global.resolveIdentifier(3)).toBeNull();
		});

		it("reports a name as used when it is bound here or passes through", () => {
			const { global, nest } = world();
			const inner = nest(global, SCOPE_BLOCK);

			inner.define(1, "a", varDef(1));
			inner.referenceValue(2, "b");
			inner.close();

			expect(inner.isUsedName("a")).toBe(true);
			expect(inner.isUsedName("b")).toBe(true);
			expect(inner.isUsedName("c")).toBe(false);
		});
	});
});
