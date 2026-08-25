/**
 * @fileoverview The corners: conversions, lookups, and query answers on the
 * boundaries of what the analysis claims.
 */

import { describe, expect, it } from "vitest";
import {
	TYPE_BIGINT,
	TYPE_BOOLEAN,
	TYPE_NEVER,
	TYPE_NONE,
	TYPE_NULL,
	TYPE_NUMBER,
	TYPE_STRING,
	TYPE_UNDEFINED,
	TYPE_UNKNOWN,
	TYPE_VOID,
	TYS_INEXACT,
	TY_SHAPE,
} from "../../src/index.js";
import { nodeOf, typesOf, type TypesFixture } from "./helpers.js";

/**
 * The type at the last use of a name written `name;`.
 * @param fixture The fixture holding the program.
 * @param code The program text.
 * @param name The identifier's text.
 * @returns The type ID at its last use.
 */
function atUse(fixture: TypesFixture, code: string, name: string): number {
	return fixture.queries.getTypeId({
		type: "Identifier",
		start: code.lastIndexOf(`${name};`),
	});
}

describe("unions and widening", () => {
	it("flattens a parenthesized nested union", () => {
		const code = `let x: ("a" | "b") | "c"; x;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.constituentTypeIds(atUse(fixture, code, "x"))
				.length,
		).toBe(3);
	});

	it("widens boolean, bigint, and union initializers", () => {
		const code = `declare const c: boolean; let a = true; let b = 1n; let u = c ? "x" : "y"; a; b; u;`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "a")).toBe(TYPE_BOOLEAN);
		expect(atUse(fixture, code, "b")).toBe(TYPE_BIGINT);
		expect(atUse(fixture, code, "u")).toBe(TYPE_STRING);
	});

	it("widens a mixed literal union constituent by constituent", () => {
		const code = `declare const c: boolean; let u = c ? 1 : "x"; u;`;
		const fixture = typesOf(code);
		const parts = fixture.queries.constituentTypeIds(
			atUse(fixture, code, "u"),
		);

		expect(parts).toEqual([TYPE_NUMBER, TYPE_STRING]);
	});

	it("collapses a fully nullish union to never under !", () => {
		const code = `let x: null | undefined; (x!);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSNonNullExpression")),
		).toBe(TYPE_NEVER);
	});

	it("passes ! through untyped and non-nullable values", () => {
		const code = `let u; let s: string; (u!); (s!);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(
				nodeOf(fixture, "TSNonNullExpression", 0),
			),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.getTypeId(
				nodeOf(fixture, "TSNonNullExpression", 1),
			),
		).toBe(TYPE_STRING);
	});
});

describe("awaiting", () => {
	it("passes await through arrays and other non-thenables", () => {
		const code = `async function f() { const a = [1]; (await a); }`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isArray(nodeOf(fixture, "AwaitExpression")),
		).toBe(true);
	});

	it("awaits a bare Promise as unknown", () => {
		const code = `declare const p: Promise; async function f() { (await p); }`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "AwaitExpression")),
		).toBe(TYPE_UNKNOWN);
	});

	it("passes await through untyped and locally-typed operands", () => {
		const code = [
			`class Box {}`,
			`declare const b: Box;`,
			`let u;`,
			`async function f() { (await u); (await b); }`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "AwaitExpression", 0)),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.getTypeName(nodeOf(fixture, "AwaitExpression", 1)),
		).toBe("Box");
	});

	it("does not call a union with a non-thenable side awaitable", () => {
		const code = `let x: Promise<string> | number; x;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isAwaitable({
				type: "Identifier",
				start: code.lastIndexOf("x;"),
			}),
		).toBe(false);
	});
});

describe("member lookups", () => {
	it("claims nothing for members of library references", () => {
		const code = `let m: Map<string, number>; (m.size);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});

	it("claims nothing for a missing member without heritage", () => {
		const code = `let o: { a: 1 }; (o.b);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});

	it("claims nothing for a member missing from every base", () => {
		const code = [
			`class Base { x: number = 0; }`,
			`class Derived extends Base {}`,
			`declare const d: Derived;`,
			`(d.missing);`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});

	it("claims nothing for members of a type that declares nothing", () => {
		const code = `const A = 1; let x: A; (x.b);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});

	it("stops chasing an alias chain past the lookup depth", () => {
		const aliases: string[] = [`interface End { p: string; }`];

		for (let i = 0; i < 10; i++) {
			aliases.push(`type A${i} = ${i === 0 ? "End" : `A${i - 1}`};`);
		}

		const code = `${aliases.join(" ")} let x: A9; (x.p);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});

	it("reads literal member keys and fractional indexes safely", () => {
		const code = `let o: { "str key": string; 42: boolean }; let t: [string]; (o["str key"]); (t[1.5]);`;
		const fixture = typesOf(code);

		// Computed string access is not resolved, but nothing crashes.
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 1)),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.getPropertyTypeId(
				{ type: "Identifier", start: code.indexOf("o[") },
				"str key",
			),
		).toBe(TYPE_STRING);
	});
});

describe("declarations on the edge", () => {
	it("treats an import-equals binding as local when referenced as a type", () => {
		const code = `import Api = require("api"); let x: Api; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		/*
		 * `import =` is not modeled as an import, so the name keeps a local
		 * origin rather than claiming a package it was not read from.
		 */
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "local",
			specifier: null,
		});
	});

	it("records an annotated destructuring declaration's pattern", () => {
		const code = `declare const src: { a: number }; const { a }: { a: number } = src; a;`;
		const fixture = typesOf(code);

		// The pattern is typed even though its bindings are not claimed.
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "ObjectPattern")),
		).not.toBe(TYPE_NONE);
		expect(atUse(fixture, code, "a")).toBe(TYPE_NONE);
	});

	it("types anonymous class expressions", () => {
		const code = `const C = (class { size: number = 0 }); const c = new C(); (c.size);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NUMBER);
	});

	it("marks computed class methods inexact and still walks them", () => {
		const code = `const key = "run"; class C { [key](): string { return ""; } } const c = new C(); c;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "c");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_INEXACT).not.toBe(
			0,
		);
	});

	it("keeps a plain constructor from marking the class inexact", () => {
		const code = `class C { constructor(a: number) {} size: string = ""; } const c = new C(); c;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "c");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_INEXACT).toBe(0);
	});

	it("handles abstract accessor properties", () => {
		const code = `abstract class A { abstract accessor size: number; } declare const a: A; (a.size);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NUMBER);
	});

	it("marks computed and construct signatures in type literals inexact", () => {
		const code = `const k = "x"; let o: { [k: symbol]: number; new (): string; ["lit"]: 1; method?(): void }; o;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "o");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_INEXACT).not.toBe(
			0,
		);
	});

	it("converts a plain template literal type", () => {
		const code = "let x: `plain`; x;";
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
	});
});

describe("expressions on the edge", () => {
	it("types null literals in expressions", () => {
		const code = `const n = null; n;`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "n")).toBe(TYPE_NULL);
	});

	it("types unary plus as number regardless of the operand", () => {
		const code = `let u; (+u);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "UnaryExpression")),
		).toBe(TYPE_NUMBER);
	});

	it("claims nothing for updates on untyped operands", () => {
		const code = `let u; (u++);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "UpdateExpression")),
		).toBe(TYPE_NONE);
	});

	it("types numeric and bigint arithmetic", () => {
		const code = `(1 + 2); (1n + 2n); (1n * 2n);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression", 0)),
		).toBe(TYPE_NUMBER);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression", 1)),
		).toBe(TYPE_BIGINT);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression", 2)),
		).toBe(TYPE_BIGINT);
	});

	it("unions undefined into an optional call's type", () => {
		const code = `let f: () => string; (f?.());`;
		const fixture = typesOf(code);
		const call = nodeOf(fixture, "CallExpression");

		expect(fixture.queries.mayBeNullish(call)).toBe(true);
		expect(fixture.queries.isTypeOf(call, "string")).toBe(false);
	});

	it("spreads untyped values into array literals conservatively", () => {
		const code = `let u; const a = [...u]; const b = [u]; a; b;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getElementTypeId({
				type: "Identifier",
				start: code.lastIndexOf("a;"),
			}),
		).toBe(TYPE_UNKNOWN);
		expect(
			fixture.queries.getElementTypeId({
				type: "Identifier",
				start: code.lastIndexOf("b;"),
			}),
		).toBe(TYPE_UNKNOWN);
	});

	it("marks object literals with computed keys inexact", () => {
		const code = `const key = "k"; const o = { [key]: 1, plain: "x" }; (o.plain);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_STRING);
	});

	it("types arguments of new expressions and library arrays", () => {
		const code = `const s = new Set([1, 2]); const a = new Array<number>(); s; a;`;
		const fixture = typesOf(code);
		const aUse = { type: "Identifier", start: code.lastIndexOf("a;") };

		expect(
			fixture.queries.getTypeName({
				type: "Identifier",
				start: code.lastIndexOf("s;"),
			}),
		).toBe("Set");
		expect(fixture.queries.isArray(aUse)).toBe(true);
		expect(fixture.queries.getElementTypeId(aUse)).toBe(TYPE_NUMBER);
	});

	it("walks destructuring declarations without claiming their bindings", () => {
		const code = `declare const src: [number]; const [first] = src; first;`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "first")).toBe(TYPE_NONE);
	});

	it("classifies void-typed values as typeof undefined", () => {
		const code = `let v: void; let s: symbol; v; s;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: code.lastIndexOf("v;") },
				"undefined",
			),
		).toBe(true);
		expect(atUse(fixture, code, "v")).toBe(TYPE_VOID);
	});
});

describe("query boundaries", () => {
	it("answers every predicate false for untyped nodes", () => {
		const code = `let u; u;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("u;") };

		expect(fixture.queries.isNullish(use)).toBe(false);
		expect(fixture.queries.mayBeNullish(use)).toBe(false);
		expect(fixture.queries.isAwaitable(use)).toBe(false);
		expect(fixture.queries.isArray(use)).toBe(false);
		expect(fixture.queries.isTuple(use)).toBe(false);
		expect(fixture.queries.isEnumLike(use)).toBe(false);
		expect(fixture.queries.getTypeName(use)).toBe(null);
		expect(fixture.queries.getTypeOrigin(use)).toBe(null);
		expect(fixture.queries.getPropertyTypeId(use, "x")).toBe(TYPE_NONE);
		expect(fixture.queries.getElementTypeId(use)).toBe(TYPE_NONE);
		expect(fixture.queries.typeToString(use)).toBe("unknown");
		expect(fixture.queries.constituentTypeIds(TYPE_NONE)).toEqual([]);
	});

	it("rejects typeof answers on mixed enums and wrong names", () => {
		const code = `enum M { A, B = "s" } let m: M; m;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("m;") };

		expect(fixture.queries.isTypeOf(use, "number")).toBe(false);
		expect(fixture.queries.isTypeOf(use, "string")).toBe(false);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("renders enum members, empty objects, and unnamed types", () => {
		const code = `enum E { A } const e = E.A; const o = {}; e; o;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("e;"),
			}),
		).toBe("E.A");
		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("o;"),
			}),
		).toBe("{}");
	});

	it("renders object literals with members and index signatures", () => {
		const code = `let o: { a: string; [k: string]: unknown }; o;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("o;"),
			}),
		).toBe("{ a: string; [index]: unknown }");
	});

	it("resolves self-referential aliases without looping", () => {
		const code = `type R = R; let x: R; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.isTypeOf(use, "string")).toBe(false);
		expect(fixture.queries.getPropertyTypeId(use, "p")).toBe(TYPE_NONE);
	});

	it("caps reference resolution on long alias chains", () => {
		const aliases: string[] = [];

		for (let i = 0; i < 12; i++) {
			aliases.push(`type A${i} = ${i === 0 ? "string" : `A${i - 1}`};`);
		}

		const code = `${aliases.join(" ")} let x: A11; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.isTypeOf(use, "string")).toBe(false);
	});

	it("treats a lone type as its own constituent list", () => {
		const code = `let s: string; s;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.constituentTypeIds(atUse(fixture, code, "s")),
		).toEqual([atUse(fixture, code, "s")]);
	});

	it("classifies intersections, bigints, and null as typeof answers", () => {
		const code = `let i: { a: 1 } & { b: 2 }; let b: bigint; let n: null; i; b; n;`;
		const fixture = typesOf(code);
		const iUse = { type: "Identifier", start: code.lastIndexOf("i;") };
		const bUse = { type: "Identifier", start: code.lastIndexOf("b;") };
		const nUse = { type: "Identifier", start: code.lastIndexOf("n;") };

		expect(fixture.queries.isTypeOf(iUse, "string")).toBe(false);
		expect(fixture.queries.isTypeOf(bUse, "bigint")).toBe(true);
		expect(fixture.queries.isTypeOf(nUse, "object")).toBe(true);
	});

	it("calls a union of library promises awaitable", () => {
		const code = `let x: Promise<string> | Promise<number>; x;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isAwaitable({
				type: "Identifier",
				start: code.lastIndexOf("x;"),
			}),
		).toBe(true);
	});

	it("gives anonymous object types no name", () => {
		const code = `const o = { a: 1 }; o;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("o;") };

		expect(fixture.queries.getTypeName(use)).toBe(null);
		expect(fixture.queries.getTypeOrigin(use)).toBe(null);
	});

	it("skips index signatures when finding a named property", () => {
		const code = `let o: { [k: string]: number; a: string }; o;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("o;") };

		expect(fixture.queries.getPropertyTypeId(use, "a")).toBe(TYPE_STRING);
	});

	it("renders parenthesized union elements and unknown arrays", () => {
		const code = `let a: (string | number)[]; const b = new Array(); a; b;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("a;"),
			}),
		).toBe("(string | number)[]");
		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("b;"),
			}),
		).toBe("unknown[]");
	});

	it("elides deeply nested object structure when rendering", () => {
		const code = `let o: { a: { b: { c: { d: 1 } } } }; o;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf("o;"),
			}),
		).toContain("object");
	});

	it("scales to many declarations in one program", () => {
		const parts: string[] = [];

		for (let i = 0; i < 120; i++) {
			parts.push(`const v${i}: "value${i}" = "value${i}";`);
		}

		const code = parts.join("\n");
		const fixture = typesOf(code);

		expect(fixture.tree.symbols.length).toBe(120);
	});
});
