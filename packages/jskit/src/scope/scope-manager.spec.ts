/**
 * @fileoverview Unit tests for the scope index.
 *
 * The `nest*` methods are the walk's constructor API and the queries are what
 * an ESLint rule reaches for, so both halves are exercised over a made-up
 * program rather than through a parse.
 */

import { describe, expect, it } from "vitest";
import {
	N_ArrowFunctionExpression,
	N_ClassDeclaration,
	N_FunctionDeclaration,
	N_Program,
} from "../parse/index.js";
import { variableDefinition } from "./definition.js";
import { FakeAst, type FakeNode } from "./fake-ast.spec-helpers.js";
import {
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FOR,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_FUNCTION_TYPE,
	SCOPE_GLOBAL,
	SCOPE_MAPPED_TYPE,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
	SCOPE_WITH,
	WRITE,
} from "./kinds.js";
import { resolveOptions, type AnalyzeOptions } from "./options.js";
import { ScopeManager } from "./scope-manager.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * The program every test here indexes: a `Program`, a function, an arrow, and
 * a class.
 */
const PROGRAM = 0;
const FUNCTION = 1;
const ARROW = 2;
const CLASS = 3;

const NODES: FakeNode[] = [
	{ kind: N_Program, type: "Program", start: 0, end: 40 },
	{
		kind: N_FunctionDeclaration,
		type: "FunctionDeclaration",
		start: 0,
		end: 20,
	},
	{
		kind: N_ArrowFunctionExpression,
		type: "ArrowFunctionExpression",
		start: 20,
		end: 30,
	},
	{ kind: N_ClassDeclaration, type: "ClassDeclaration", start: 30, end: 40 },
];

/**
 * Builds an empty manager over that program.
 * @param options The options the analysis runs with.
 * @returns The manager.
 */
function manager(options: AnalyzeOptions = {}): ScopeManager<number> {
	return new ScopeManager(new FakeAst(NODES), resolveOptions(options));
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("ScopeManager", () => {
	describe("nesting", () => {
		it("opens the global scope and remembers it", () => {
			const scopeManager = manager();
			const scope = scopeManager.nestGlobalScope(PROGRAM);

			expect(scope.type).toBe(SCOPE_GLOBAL);
			expect(scopeManager.globalScope).toBe(scope);
			expect(scopeManager.currentScope).toBe(scope);
			expect(scopeManager.scopes).toEqual([scope]);
		});

		it("makes each new scope current and nests it inside the last", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);
			const module = scopeManager.nestModuleScope(PROGRAM);

			expect(module.type).toBe(SCOPE_MODULE);
			expect(module.upper).toBe(global);
			expect(scopeManager.currentScope).toBe(module);
		});

		it("gives a function scope its own `arguments` binding", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			const scope = scopeManager.nestFunctionScope(FUNCTION, false);

			expect(scope.type).toBe(SCOPE_FUNCTION);
			expect(scope.set.has("arguments")).toBe(true);
			expect(scope.taints.get("arguments")).toBe(true);
		});

		it("gives an arrow no `arguments` binding of its own", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			expect(
				scopeManager
					.nestFunctionScope(ARROW, false)
					.set.has("arguments"),
			).toBe(false);
		});

		it("makes a method body strict", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			expect(
				scopeManager.nestFunctionScope(FUNCTION, true).isStrict,
			).toBe(true);
		});

		it("marks a function expression name scope as one", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			const scope =
				scopeManager.nestFunctionExpressionNameScope(FUNCTION);

			expect(scope.type).toBe(SCOPE_FUNCTION_EXPRESSION_NAME);
			expect(scope.functionExpressionScope).toBe(true);
		});

		it("opens each remaining scope type with the type it names", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			expect(scopeManager.nestBlockScope(PROGRAM).type).toBe(SCOPE_BLOCK);
			expect(scopeManager.nestSwitchScope(PROGRAM).type).toBe(
				SCOPE_SWITCH,
			);
			expect(scopeManager.nestCatchScope(PROGRAM).type).toBe(SCOPE_CATCH);
			expect(scopeManager.nestWithScope(PROGRAM).type).toBe(SCOPE_WITH);
			expect(scopeManager.nestForScope(PROGRAM).type).toBe(SCOPE_FOR);
			expect(scopeManager.nestClassScope(CLASS).type).toBe(SCOPE_CLASS);
			expect(scopeManager.nestTypeScope(PROGRAM).type).toBe(SCOPE_TYPE);
			expect(scopeManager.nestFunctionTypeScope(PROGRAM).type).toBe(
				SCOPE_FUNCTION_TYPE,
			);
			expect(scopeManager.nestConditionalTypeScope(PROGRAM).type).toBe(
				SCOPE_CONDITIONAL_TYPE,
			);
			expect(scopeManager.nestMappedTypeScope(PROGRAM).type).toBe(
				SCOPE_MAPPED_TYPE,
			);
			expect(scopeManager.nestTSEnumScope(PROGRAM).type).toBe(
				SCOPE_TS_ENUM,
			);
			expect(scopeManager.nestTSModuleScope(PROGRAM).type).toBe(
				SCOPE_TS_MODULE,
			);
		});

		it("makes a class field initializer and a static block strict", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			const field = scopeManager.nestClassFieldInitializerScope(CLASS);
			const staticBlock = scopeManager.nestClassStaticBlockScope(CLASS);

			expect(field.type).toBe(SCOPE_CLASS_FIELD_INITIALIZER);
			expect(field.isStrict).toBe(true);
			expect(staticBlock.type).toBe(SCOPE_CLASS_STATIC_BLOCK);
			expect(staticBlock.isStrict).toBe(true);
		});
	});

	describe("options", () => {
		it("reports whether the program is a module", () => {
			expect(manager({ sourceType: "module" }).isModule()).toBe(true);
			expect(manager({ sourceType: "script" }).isModule()).toBe(false);
		});

		it("reports `globalReturn` for CommonJS as well as for the option", () => {
			expect(manager({ sourceType: "script" }).isGlobalReturn()).toBe(
				false,
			);
			expect(manager({ globalReturn: true }).isGlobalReturn()).toBe(true);
			expect(manager({ sourceType: "commonjs" }).isGlobalReturn()).toBe(
				true,
			);
		});

		it("reports implied strictness", () => {
			expect(manager().isImpliedStrict()).toBe(false);
			expect(manager({ impliedStrict: true }).isImpliedStrict()).toBe(
				true,
			);
		});
	});

	describe("declared variables", () => {
		it("returns an empty array for a node that declares nothing", () => {
			expect(manager().getDeclaredVariables(PROGRAM)).toEqual([]);
		});

		it("records a variable once per declaring node", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);
			const variable = global.defineVariable(
				"a",
				global.set,
				global.variables,
				1,
				variableDefinition(1, FUNCTION, FUNCTION, 0, "var"),
			);

			// The definition names the same node twice, so it is filed once.
			expect(scopeManager.getDeclaredVariables(FUNCTION)).toEqual([
				variable,
			]);
			expect(scopeManager.declaredVariableEntries()).toEqual([
				[FUNCTION, [variable]],
			]);
		});

		it("files nothing for a definition with no parent", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);

			global.defineVariable(
				"a",
				global.set,
				global.variables,
				null,
				null,
			);

			expect(scopeManager.declaredVariableEntries()).toEqual([]);
		});
	});

	describe("acquire()", () => {
		it("returns null for a node that opened no scope", () => {
			expect(manager().acquire(PROGRAM)).toBeNull();
		});

		it("returns the only scope a node opened", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);

			expect(scopeManager.acquire(PROGRAM)).toBe(global);
		});

		it("prefers the outermost scope, or the innermost when asked", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);
			const module = scopeManager.nestModuleScope(PROGRAM);

			expect(scopeManager.acquire(PROGRAM)).toBe(global);
			expect(scopeManager.acquire(PROGRAM, true)).toBe(module);
		});

		it("skips the scope that holds a function expression's name", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			const nameScope =
				scopeManager.nestFunctionExpressionNameScope(FUNCTION);
			const body = scopeManager.nestFunctionScope(FUNCTION, false);

			expect(scopeManager.acquire(FUNCTION)).toBe(body);
			expect(scopeManager.acquire(FUNCTION, true)).toBe(body);
			expect(scopeManager.acquireAll(FUNCTION)).toEqual([
				nameScope,
				body,
			]);
		});

		it("returns null when every scope a node opened is a name scope", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);
			scopeManager.nestFunctionExpressionNameScope(FUNCTION);
			scopeManager.nestFunctionExpressionNameScope(FUNCTION);

			expect(scopeManager.acquire(FUNCTION)).toBeNull();
			expect(scopeManager.acquire(FUNCTION, true)).toBeNull();
		});

		it("returns undefined from acquireAll() for a node that opened none", () => {
			expect(manager().acquireAll(PROGRAM)).toBeUndefined();
		});
	});

	describe("release()", () => {
		it("returns null for a node that opened no scope", () => {
			expect(manager().release(FUNCTION)).toBeNull();
		});

		it("returns null for the outermost scope", () => {
			const scopeManager = manager();

			scopeManager.nestGlobalScope(PROGRAM);

			expect(scopeManager.release(PROGRAM)).toBeNull();
		});

		it("returns the scope enclosing the one a node opened", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);

			scopeManager.nestFunctionScope(FUNCTION, false);

			expect(scopeManager.release(FUNCTION)).toBe(global);
		});

		it("passes `inner` on to the enclosing node's lookup", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);
			const module = scopeManager.nestModuleScope(PROGRAM);

			scopeManager.nestFunctionScope(FUNCTION, false);

			expect(scopeManager.release(FUNCTION)).toBe(global);
			expect(scopeManager.release(FUNCTION, true)).toBe(module);
			expect(module.upper).toBe(global);
		});
	});

	describe("addGlobals()", () => {
		it("does nothing when there is no global scope", () => {
			const scopeManager = manager();

			expect(() => scopeManager.addGlobals(["a"])).not.toThrow();
		});

		it("declares the name and resolves what was waiting for it", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);

			global.referenceValue(1, "a");
			global.referenceValue(2, "b");
			global.close();

			expect(global.through).toHaveLength(2);

			scopeManager.addGlobals(["a"]);

			const variable = global.set.get("a")!;

			expect(variable.references).toEqual([global.references[0]]);
			expect(global.references[0].resolved).toBe(variable);
			expect(global.through.map(reference => reference.name)).toEqual([
				"b",
			]);
		});

		it("replaces an implicit global with the real binding", () => {
			const scopeManager = manager();
			const global = scopeManager.nestGlobalScope(PROGRAM);

			global.referenceValue(1, "a", WRITE, 2, { pattern: 1, node: 2 });
			global.close();

			expect(global.implicit!.variables).toHaveLength(1);
			expect(global.implicit!.left).toHaveLength(1);

			scopeManager.addGlobals(["a"]);

			expect(global.implicit!.set.has("a")).toBe(false);
			expect(global.implicit!.variables).toEqual([]);
			expect(global.implicit!.left).toEqual([]);
			expect(global.set.has("a")).toBe(true);
		});
	});

	describe("node queries", () => {
		it("reports a node's ESTree type", () => {
			expect(manager().nodeType(CLASS)).toBe("ClassDeclaration");
		});

		it("reports a node's extent", () => {
			expect(manager().nodeRange(ARROW)).toEqual([20, 30]);
		});
	});
});
