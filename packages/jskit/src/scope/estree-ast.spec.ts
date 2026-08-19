/**
 * @fileoverview Unit tests for the ESTree tree adapter.
 *
 * `binary-ast.ts` answers the same questions over the parse buffer, and the
 * two must answer them the same way — the conformance run checks that on real
 * programs. What is pinned here is the half a real program rarely reaches: the
 * property that is missing, holds something that is not a node, or belongs to
 * a node type the analyzer has never heard of.
 */

import { describe, expect, it } from "vitest";
import {
	N_Identifier,
	N_Program,
	N_VariableDeclaration,
} from "../parse/index.js";
import { SLOT_A, SLOT_B, SLOT_C } from "./ast-access.js";
import { EstreeAst, type EsTreeNode } from "./estree-ast.js";

/**
 * A node with whatever properties a test needs.
 * @param type The ESTree `type`.
 * @param rest The rest of the node's properties.
 * @returns The node.
 */
function node(type: string, rest: Record<string, unknown> = {}): EsTreeNode {
	return { type, ...rest };
}

describe("EstreeAst", () => {
	describe("kind()", () => {
		it("maps a known type to the kind the analyzer dispatches on", () => {
			const ast = new EstreeAst();

			expect(ast.kind(node("Program"))).toBe(N_Program);
			expect(ast.kind(node("Identifier"))).toBe(N_Identifier);
		});

		it("reports kind 0 for a type it has never heard of", () => {
			expect(new EstreeAst().kind(node("SomeParserExtension"))).toBe(0);
		});

		it("gives the same answer when asked twice, cache or not", () => {
			const ast = new EstreeAst();
			const program = node("Program");
			const identifier = node("Identifier");

			expect(ast.kind(program)).toBe(N_Program);
			expect(ast.kind(program)).toBe(N_Program);
			expect(ast.kind(identifier)).toBe(N_Identifier);
			expect(ast.kind(program)).toBe(N_Program);
		});
	});

	describe("extents", () => {
		it("prefers `range` and falls back to `start`/`end`", () => {
			const ast = new EstreeAst();
			const ranged = node("Identifier", {
				range: [3, 7],
				start: 99,
				end: 99,
			});
			const plain = node("Identifier", { start: 3, end: 7 });

			expect([ast.start(ranged), ast.end(ranged)]).toEqual([3, 7]);
			expect([ast.start(plain), ast.end(plain)]).toEqual([3, 7]);
		});

		it("reports a node's ESTree type", () => {
			expect(new EstreeAst().typeName(node("Program"))).toBe("Program");
		});
	});

	describe("child()", () => {
		it("reads the property a slot names", () => {
			const ast = new EstreeAst();
			const id = node("Identifier", { name: "x" });
			const declarator = node("VariableDeclarator", { id });

			expect(ast.child(declarator, SLOT_A)).toBe(id);
		});

		it("reports null for a slot the node kind does not name", () => {
			const ast = new EstreeAst();
			const declaration = node("VariableDeclaration", {
				kind: "let",
				declarations: [],
			});

			expect(ast.kind(declaration)).toBe(N_VariableDeclaration);
			expect(ast.child(declaration, SLOT_C)).toBeNull();
		});

		it("reports null for a node kind with no slot names at all", () => {
			const ast = new EstreeAst();
			const unknown = node("SomeParserExtension", {
				body: node("Identifier"),
			});

			expect(ast.child(unknown, SLOT_A)).toBeNull();
			expect(ast.listSize(unknown, SLOT_A)).toBe(0);
			expect(ast.listItem(unknown, SLOT_A, 0)).toBeNull();
		});

		it("reports null when the named property holds something that is not a node", () => {
			const ast = new EstreeAst();
			const declarator = node("VariableDeclarator", { id: null });

			expect(ast.child(declarator, SLOT_A)).toBeNull();
		});
	});

	describe("lists", () => {
		it("reads the array a slot names", () => {
			const ast = new EstreeAst();
			const first = node("ExpressionStatement");
			const program = node("Program", { body: [first] });

			expect(ast.listSize(program, SLOT_A)).toBe(1);
			expect(ast.listItem(program, SLOT_A, 0)).toBe(first);
		});

		it("reports an array hole as null", () => {
			const ast = new EstreeAst();
			const array = node("ArrayPattern", { elements: [null] });

			expect(ast.listSize(array, SLOT_A)).toBe(1);
			expect(ast.listItem(array, SLOT_A, 0)).toBeNull();
		});

		it("reports zero for a named property that is not an array", () => {
			const ast = new EstreeAst();
			const declarator = node("VariableDeclarator", {
				id: node("Identifier"),
			});

			expect(ast.listSize(declarator, SLOT_A)).toBe(0);
			expect(ast.listItem(declarator, SLOT_A, 0)).toBeNull();
		});
	});

	describe("unknownChildren()", () => {
		it("finds every node hanging off a node type it does not know", () => {
			const direct = node("Identifier", { name: "a" });
			const inArray = node("Identifier", { name: "b" });
			const parent = node("SomeParserExtension");
			const unknown = node("SomeParserExtension", {
				direct,
				items: [inArray, "not a node", null, 42],
				plain: "text",
				empty: [],
				parent,
			});

			expect(new EstreeAst().unknownChildren(unknown)).toEqual([
				direct,
				inArray,
			]);
		});

		it("returns the same empty array for a node with no children", () => {
			const ast = new EstreeAst();
			const first = ast.unknownChildren(node("SomeParserExtension"));

			expect(first).toEqual([]);
			expect(ast.unknownChildren(node("Other"))).toBe(first);
		});
	});

	describe("scalar properties", () => {
		it("reads a name and a literal's string value", () => {
			const ast = new EstreeAst();

			expect(ast.name(node("Identifier", { name: "x" }))).toBe("x");
			expect(ast.literalString(node("Literal", { value: "a" }))).toBe("a");
		});

		it("reports a directive only when it is a string", () => {
			const ast = new EstreeAst();

			expect(
				ast.directive(
					node("ExpressionStatement", { directive: "use strict" }),
				),
			).toBe("use strict");
			expect(
				ast.directive(node("ExpressionStatement", { directive: null })),
			).toBeNull();
			expect(ast.directive(node("ExpressionStatement"))).toBeNull();
		});

		it("reads `computed` strictly", () => {
			const ast = new EstreeAst();

			expect(ast.computed(node("Property", { computed: true }))).toBe(true);
			expect(ast.computed(node("Property", { computed: false }))).toBe(
				false,
			);
			expect(ast.computed(node("Property"))).toBe(false);
		});

		it("reads a type-only import or export from either property", () => {
			const ast = new EstreeAst();

			expect(
				ast.typeOnly(node("ImportDeclaration", { importKind: "type" })),
			).toBe(true);
			expect(
				ast.typeOnly(node("ExportNamedDeclaration", { exportKind: "type" })),
			).toBe(true);
			expect(
				ast.typeOnly(node("ImportDeclaration", { importKind: "value" })),
			).toBe(false);
		});

		it("reads a declaration keyword and `declare global`", () => {
			const ast = new EstreeAst();

			expect(
				ast.declarationKind(node("VariableDeclaration", { kind: "const" })),
			).toBe("const");
			expect(
				ast.isGlobalModule(node("TSModuleDeclaration", { kind: "global" })),
			).toBe(true);
			expect(
				ast.isGlobalModule(
					node("TSModuleDeclaration", { kind: "namespace" }),
				),
			).toBe(false);
		});

		it("tells a plain assignment from a compound one", () => {
			const ast = new EstreeAst();

			expect(
				ast.isSimpleAssignment(
					node("AssignmentExpression", { operator: "=" }),
				),
			).toBe(true);
			expect(
				ast.isSimpleAssignment(
					node("AssignmentExpression", { operator: "+=" }),
				),
			).toBe(false);
		});
	});

	describe("parameter decorators", () => {
		it("reads the decorators a parameter carries", () => {
			const ast = new EstreeAst();
			const decorator = node("Decorator");
			const parameter = node("Identifier", { decorators: [decorator] });

			expect(ast.parameterDecoratorSize(parameter)).toBe(1);
			expect(ast.parameterDecoratorAt(parameter, 0)).toBe(decorator);
		});

		it("reports none for a parameter with no decorators property", () => {
			const ast = new EstreeAst();
			const parameter = node("Identifier");

			expect(ast.parameterDecoratorSize(parameter)).toBe(0);
			expect(ast.parameterDecoratorAt(parameter, 0)).toBeNull();
		});

		it("reports null for a decorator slot holding something else", () => {
			const ast = new EstreeAst();
			const parameter = node("Identifier", { decorators: ["nope"] });

			expect(ast.parameterDecoratorAt(parameter, 0)).toBeNull();
		});
	});

	describe("mapped types", () => {
		it("reads the key and the constraint when both are nodes", () => {
			const ast = new EstreeAst();
			const key = node("Identifier", { name: "K" });
			const constraint = node("TSTypeOperator");
			const mapped = node("TSMappedType", { key, constraint });

			expect(ast.mappedTypeKey(mapped)).toBe(key);
			expect(ast.mappedTypeConstraint(mapped)).toBe(constraint);
		});

		it("reports null when either is missing", () => {
			const ast = new EstreeAst();
			const mapped = node("TSMappedType");

			expect(ast.mappedTypeKey(mapped)).toBeNull();
			expect(ast.mappedTypeConstraint(mapped)).toBeNull();
		});
	});

	describe("slot caching", () => {
		it("re-reads the slot base after a different node was asked about", () => {
			const ast = new EstreeAst();
			const id = node("Identifier", { name: "x" });
			const declarator = node("VariableDeclarator", { id });

			// `child()` has to notice the node changed since the last `kind()`.
			expect(ast.kind(id)).toBe(N_Identifier);
			expect(ast.child(declarator, SLOT_A)).toBe(id);
			expect(ast.child(declarator, SLOT_B)).toBeNull();
		});
	});
});
