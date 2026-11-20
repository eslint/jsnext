/**
 * @fileoverview `Scopes#getBindingOrigins()` and the symbol-record bits behind
 * it: where the binding an identifier refers to comes from, answered from
 * the buffer without walking a definition list.
 */

import * as espree from "espree";
import { describe, expect, it } from "vitest";
import {
	analyze,
	analyzeTree,
	BINDING_ORIGIN_ARGUMENTS,
	BINDING_ORIGIN_CATCH_CLAUSE,
	BINDING_ORIGIN_CLASS_NAME,
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_FUNCTION_NAME,
	BINDING_ORIGIN_IMPLICIT_GLOBAL,
	BINDING_ORIGIN_IMPORT_BINDING,
	BINDING_ORIGIN_PARAMETER,
	BINDING_ORIGIN_TS_ENUM_MEMBER,
	BINDING_ORIGIN_TS_ENUM_NAME,
	BINDING_ORIGIN_TS_MODULE_NAME,
	BINDING_ORIGIN_TYPE,
	BINDING_ORIGIN_UNRESOLVED,
	BINDING_ORIGIN_VARIABLE,
	parse,
	Scopes,
	type EsTreeNode,
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
 * The origins of the identifier at the last occurrence of `name` — the use
 * after its declarations, in every program below.
 * @param analysis The analyzed program.
 * @param name The identifier's text.
 * @returns The `BINDING_ORIGIN_*` bitmask.
 */
function originsOfLast({ scopes, code }: Analyzed, name: string): number {
	const start = code.search(
		new RegExp(`\\b${name}\\b(?![\\s\\S]*\\b${name}\\b)`, "u"),
	);

	expect(start).toBeGreaterThanOrEqual(0);

	return scopes.getBindingOrigins({
		type: "Identifier",
		start,
		end: start + name.length,
	});
}

describe("Scopes#getBindingOrigins()", () => {
	it.each([
		["var x = 1; x;", "x"],
		["let x = 1; x;", "x"],
		["const x = 1; x;", "x"],
		["{ using x = null; x; }", "x"],
	])("reports a variable declaration: %s", (code, name) => {
		expect(originsOfLast(analyzed(code), name)).toBe(
			BINDING_ORIGIN_VARIABLE,
		);
	});

	it.each([
		["function f() {} f();", "f", BINDING_ORIGIN_FUNCTION_NAME],
		["(function g() { g(); });", "g", BINDING_ORIGIN_FUNCTION_NAME],
		["class C {} new C();", "C", BINDING_ORIGIN_CLASS_NAME],
		["import { a } from 'm'; a;", "a", BINDING_ORIGIN_IMPORT_BINDING],
		["import a from 'm'; a;", "a", BINDING_ORIGIN_IMPORT_BINDING],
		["import * as a from 'm'; a;", "a", BINDING_ORIGIN_IMPORT_BINDING],
		["function f(p) { p; }", "p", BINDING_ORIGIN_PARAMETER],
		["function f({ p }) { p; }", "p", BINDING_ORIGIN_PARAMETER],
		["try {} catch (e) { e; }", "e", BINDING_ORIGIN_CATCH_CLAUSE],
		["function f() { arguments; }", "arguments", BINDING_ORIGIN_ARGUMENTS],
	])("reports where %s binds its name", (code, name, origin) => {
		expect(originsOfLast(analyzed(code), name)).toBe(origin);
	});

	it.each([
		["type T = 1; let x: T;", "T", BINDING_ORIGIN_TYPE],
		["interface I {} let x: I;", "I", BINDING_ORIGIN_TYPE],
		["enum E { A } E.A;", "E", BINDING_ORIGIN_TS_ENUM_NAME],
		["enum E { A = 1, B = A }", "A", BINDING_ORIGIN_TS_ENUM_MEMBER],
		["namespace N {} N;", "N", BINDING_ORIGIN_TS_MODULE_NAME],
	])("reports a TypeScript declaration: %s", (code, name, origin) => {
		expect(originsOfLast(analyzed(code), name)).toBe(origin);
	});

	it("sets one bit per kind of declaration on a name declared twice", () => {
		for (const code of [
			"var f; function f() {} f;",
			"function f() {} var f = 1; f();",
		]) {
			expect(originsOfLast(analyzed(code, "script"), "f")).toBe(
				BINDING_ORIGIN_VARIABLE | BINDING_ORIGIN_FUNCTION_NAME,
			);
		}

		expect(
			originsOfLast(analyzed("function f(a) { var a; a; }"), "a"),
		).toBe(BINDING_ORIGIN_PARAMETER | BINDING_ORIGIN_VARIABLE);
	});

	it("reports an unshadowed configured global, and only that", () => {
		const analysis = analyzed("Promise.resolve();", "module", ["Promise"]);

		expect(originsOfLast(analysis, "Promise")).toBe(
			BINDING_ORIGIN_CONFIGURED_GLOBAL,
		);
	});

	it("reports a configured global the file declares as its declaration", () => {
		const analysis = analyzed("var Array = 1; Array;", "script", ["Array"]);

		expect(originsOfLast(analysis, "Array")).toBe(BINDING_ORIGIN_VARIABLE);
	});

	it("agrees with isGlobalReference() on configured globals", () => {
		const code =
			"Promise; function f(Promise) { Promise; } var Array; Array; missing;";
		const { scopes } = analyzed(code, "script", ["Promise", "Array"]);

		for (const [needle, expected] of [
			["Promise;", true],
			["Promise; }", false],
			["Array; m", false],
			["missing", false],
		] as const) {
			const start = code.indexOf(needle);
			const ref = {
				type: "Identifier",
				start,
				end: start + needle.search(/[^\w]|$/u),
			};

			expect(scopes.isGlobalReference(ref), needle).toBe(expected);
			expect(
				scopes.getBindingOrigins(ref) ===
					BINDING_ORIGIN_CONFIGURED_GLOBAL,
				needle,
			).toBe(expected);
		}
	});

	it("reports a name nothing declares as unresolved", () => {
		expect(originsOfLast(analyzed("missing();"), "missing")).toBe(
			BINDING_ORIGIN_UNRESOLVED,
		);
	});

	it("reports every reference to an implicit global, not only its assignment", () => {
		const code = "x; x = 1; x;";
		const { scopes } = analyzed(code, "script");

		for (const start of [0, 3, 10]) {
			expect(
				scopes.getBindingOrigins({
					type: "Identifier",
					start,
					end: start + 1,
				}),
			).toBe(BINDING_ORIGIN_IMPLICIT_GLOBAL);
		}
	});

	it("does not report an implicit global in strict code", () => {
		expect(
			originsOfLast(analyzed('"use strict"; x = 1; x;', "script"), "x"),
		).toBe(BINDING_ORIGIN_UNRESOLVED);
		expect(originsOfLast(analyzed("x = 1; x;", "module"), "x")).toBe(
			BINDING_ORIGIN_UNRESOLVED,
		);
	});

	it("answers 0 for an identifier that is not a reference", () => {
		const code = "const o = {}; o.prop;";
		const { scopes } = analyzed(code);
		const start = code.indexOf("prop");

		expect(
			scopes.getBindingOrigins({
				type: "Identifier",
				start,
				end: start + 4,
			}),
		).toBe(0);
	});

	it("answers the same on the tree path", () => {
		const code =
			"import a from 'm'; function f(p) { var v; a; p; v; f; arguments; missing; }";
		const tree = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module",
		}) as unknown as EsTreeNode;
		const treeScopes = new Scopes(
			analyzeTree(tree, { sourceType: "module" }),
			tree,
		);
		const binary = analyzed(code);
		const tail = code.lastIndexOf("{");

		for (const name of ["a", "p", "v", "f", "arguments", "missing"]) {
			const start = code.indexOf(`${name};`, tail);
			const ref = { type: "Identifier", start, end: start + name.length };

			expect(treeScopes.getBindingOrigins(ref), name).toBe(
				binary.scopes.getBindingOrigins(ref),
			);
		}
	});
});
