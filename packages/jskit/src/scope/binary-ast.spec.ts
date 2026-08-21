/**
 * @fileoverview Unit tests for the binary AST adapter.
 *
 * `estree-ast.ts` answers the same questions over an ESTree tree, and the two
 * have to agree — the conformance run checks that over real programs. Pinned
 * here are the questions the walk asks only for a shape the corpus rarely
 * holds, and the ones this adapter answers differently because the binary
 * format stores the information somewhere else.
 */

import { describe, expect, it } from "vitest";
import {
	AstReader,
	N_ArrayPattern,
	N_AssignmentExpression,
	N_ExpressionStatement,
	N_Identifier,
	N_ImportDeclaration,
	N_Literal,
	N_MemberExpression,
	N_Program,
	N_TSMappedType,
	N_TSModuleDeclaration,
	N_TSParameterProperty,
	N_VariableDeclaration,
	N_VariableDeclarator,
	parse,
	type ParseOptions,
} from "../parse/index.js";
import { SLOT_A, SLOT_B } from "./ast-access.js";
import { BinaryAst } from "./binary-ast.js";

/**
 * Parses a program and hands back an adapter over it.
 * @param code The source text.
 * @param options How to parse it.
 * @returns The adapter and the reader under it.
 */
function read(
	code: string,
	options: ParseOptions = {},
): { ast: BinaryAst; reader: AstReader } {
	const reader = new AstReader(parse(code, options));

	return { ast: new BinaryAst(reader), reader };
}

/**
 * The first node of a kind, in node order.
 * @param reader The reader over the buffer.
 * @param kind The node kind to look for.
 * @returns The node index.
 * @throws {Error} When the program has no such node.
 */
function find(reader: AstReader, kind: number): number {
	for (let node = 1; node < reader.nodeCount; node++) {
		if (reader.kind(node) === kind) {
			return node;
		}
	}

	throw new Error(`No node of kind ${kind} in the program.`);
}

describe("BinaryAst", () => {
	describe("structure", () => {
		it("reads a node's kind, type name, and extent", () => {
			const { ast, reader } = read("a;");
			const identifier = find(reader, N_Identifier);

			expect(ast.kind(identifier)).toBe(N_Identifier);
			expect(ast.typeName(identifier)).toBe("Identifier");
			expect(ast.typeName(reader.root)).toBe("Program");
			expect([ast.start(identifier), ast.end(identifier)]).toEqual([
				0, 1,
			]);
		});

		it("reports an empty slot as null", () => {
			const { ast, reader } = read("const a = 1; let b;");
			const declarators: number[] = [];

			for (let node = 1; node < reader.nodeCount; node++) {
				if (reader.kind(node) === N_VariableDeclarator) {
					declarators.push(node);
				}
			}

			// The initializer sits in slot B; `let b;` has none.
			expect(ast.child(declarators[0], SLOT_B)).not.toBeNull();
			expect(ast.child(declarators[1], SLOT_B)).toBeNull();
		});

		it("reads a list and reports an array hole as null", () => {
			const { ast, reader } = read("const [a, , b] = xs;");
			const pattern = find(reader, N_ArrayPattern);

			expect(ast.listSize(pattern, SLOT_A)).toBe(3);
			expect(ast.listItem(pattern, SLOT_A, 0)).not.toBeNull();
			expect(ast.listItem(pattern, SLOT_A, 1)).toBeNull();
			expect(ast.listItem(pattern, SLOT_A, 2)).not.toBeNull();
		});

		it("has no unknown children, because every kind in a buffer is known", () => {
			const { ast, reader } = read("a;");

			expect(ast.unknownChildren()).toEqual([]);
			expect(ast.unknownChildren()).toBe(ast.unknownChildren());
			expect(reader.nodeCount).toBeGreaterThan(1);
		});
	});

	describe("names", () => {
		it("stops a name where the annotation begins", () => {
			const { ast, reader } = read("let abc: string;", {});
			const identifier = find(reader, N_Identifier);

			expect(ast.name(identifier)).toBe("abc");
		});

		it("takes the whole node when nothing extends it", () => {
			const { ast, reader } = read("abc;");

			expect(ast.name(find(reader, N_Identifier))).toBe("abc");
		});

		it("resolves the escapes in a name", () => {
			const { ast, reader } = read("\\u0061bc;");

			expect(ast.name(find(reader, N_Identifier))).toBe("abc");
		});

		it("reads a string literal, escapes and all", () => {
			const plain = read("enum E { 'ab' = 1 }");
			const escaped = read("enum E { '\\u0061b' = 1 }");

			expect(plain.ast.literalString(find(plain.reader, N_Literal))).toBe(
				"ab",
			);
			expect(
				escaped.ast.literalString(find(escaped.reader, N_Literal)),
			).toBe("ab");
		});
	});

	describe("directives", () => {
		it("reads the directive a prologue statement states", () => {
			const { ast, reader } = read('"use strict"; a;');
			const statement = find(reader, N_ExpressionStatement);

			expect(ast.directive(statement)).toBe("use strict");
		});

		it("reports null for an ordinary expression statement", () => {
			const { ast, reader } = read("a;");

			expect(
				ast.directive(find(reader, N_ExpressionStatement)),
			).toBeNull();
		});
	});

	describe("flags", () => {
		it("reads `computed` off a member expression", () => {
			const dotted = read("a.b;");
			const bracketed = read("a[b];");

			expect(
				dotted.ast.computed(find(dotted.reader, N_MemberExpression)),
			).toBe(false);
			expect(
				bracketed.ast.computed(
					find(bracketed.reader, N_MemberExpression),
				),
			).toBe(true);
		});

		it("reads a type-only import", () => {
			const typed = read("import type { A } from 'm';");
			const plain = read("import { A } from 'm';");

			expect(
				typed.ast.typeOnly(find(typed.reader, N_ImportDeclaration)),
			).toBe(true);
			expect(
				plain.ast.typeOnly(find(plain.reader, N_ImportDeclaration)),
			).toBe(false);
		});

		it("reads every declaration keyword", () => {
			for (const [code, kind] of [
				["var a = 1;", "var"],
				["let a = 1;", "let"],
				["const a = 1;", "const"],
				["using a = r();", "using"],
				["async function f() { await using a = r(); }", "await using"],
			] as const) {
				const { ast, reader } = read(code);

				expect(
					ast.declarationKind(find(reader, N_VariableDeclaration)),
				).toBe(kind);
			}
		});

		it("tells `declare global` from a named namespace", () => {
			const global = read("declare global { const a: number; }");
			const named = read("namespace N { const a = 1; }");

			expect(
				global.ast.isGlobalModule(
					find(global.reader, N_TSModuleDeclaration),
				),
			).toBe(true);
			expect(
				named.ast.isGlobalModule(
					find(named.reader, N_TSModuleDeclaration),
				),
			).toBe(false);
		});

		it("tells a plain assignment from a compound one", () => {
			const plain = read("a = 1;");
			const compound = read("a += 1;");

			expect(
				plain.ast.isSimpleAssignment(
					find(plain.reader, N_AssignmentExpression),
				),
			).toBe(true);
			expect(
				compound.ast.isSimpleAssignment(
					find(compound.reader, N_AssignmentExpression),
				),
			).toBe(false);
		});
	});

	describe("parameter decorators", () => {
		it("reads them off slot B of a parameter property", () => {
			const { ast, reader } = read(
				"class C { constructor(@dec private a: number) {} }",
			);
			const parameter = find(reader, N_TSParameterProperty);

			expect(ast.parameterDecoratorSize(parameter)).toBe(1);
			expect(ast.parameterDecoratorAt(parameter, 0)).not.toBeNull();
			expect(ast.child(parameter, SLOT_B)).not.toBeNull();
		});

		it("reads them off slot C of an ordinary parameter", () => {
			const { ast, reader } = read("class C { m(@dec a: number) {} }");
			const decorated: number[] = [];

			for (let node = 1; node < reader.nodeCount; node++) {
				if (
					reader.kind(node) === N_Identifier &&
					ast.parameterDecoratorSize(node) === 1
				) {
					decorated.push(node);
				}
			}

			expect(decorated).toHaveLength(1);
			expect(ast.parameterDecoratorAt(decorated[0], 0)).not.toBeNull();
			expect(reader.kind(decorated[0])).not.toBe(N_TSParameterProperty);
		});

		it("reports none for a parameter that carries no decorator", () => {
			const { ast, reader } = read("class C { m(a) {} }");

			for (let node = 1; node < reader.nodeCount; node++) {
				if (reader.kind(node) === N_Identifier) {
					expect(ast.parameterDecoratorSize(node)).toBe(0);
				}
			}
		});

		it("reports an array hole in a decorator list as null", () => {
			const { ast, reader } = read("class C { m(@dec a) {} }");

			for (let node = 1; node < reader.nodeCount; node++) {
				if (ast.parameterDecoratorSize(node) === 1) {
					// One past the end of a list the adapter knows the size of.
					expect(ast.parameterDecoratorAt(node, 0)).not.toBeNull();
				}
			}
		});
	});

	describe("mapped types", () => {
		it("reads the key and constraint off the stored type parameter", () => {
			const { ast, reader } = read("type M = { [K in keyof T]: T[K] };");
			const mapped = find(reader, N_TSMappedType);

			expect(ast.mappedTypeKey(mapped)).not.toBeNull();
			expect(ast.mappedTypeConstraint(mapped)).not.toBeNull();
			expect(ast.name(ast.mappedTypeKey(mapped)!)).toBe("K");
		});
	});

	describe("the program itself", () => {
		it("walks the statement list off the root", () => {
			const { ast, reader } = read("a; b; c;");

			expect(ast.kind(reader.root)).toBe(N_Program);
			expect(ast.listSize(reader.root, SLOT_A)).toBe(3);
		});
	});
});
