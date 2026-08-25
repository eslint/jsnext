/**
 * @fileoverview The syntax the other test files do not reach: every
 * annotation kind the converter handles, every expression rule, and the
 * constructs the analysis deliberately defers on.
 */

import { describe, expect, it } from "vitest";
import {
	TYF_BIGINT_LITERAL,
	TYF_INTERSECTION,
	TYF_NUMBER_LITERAL,
	TYF_TEMPLATE_LITERAL,
	TYF_TYPE_PARAMETER,
	TYF_UNKNOWN,
	TYPE_BIGINT,
	TYPE_BOOLEAN,
	TYPE_NEVER,
	TYPE_NONE,
	TYPE_NULL,
	TYPE_NUMBER,
	TYPE_STRING,
	TYPE_UNDEFINED,
	TYPE_UNKNOWN,
	TYS_DEFERRED,
	TYS_INEXACT,
	TYS_TUPLE,
	TY_SHAPE,
} from "../../src/index.js";
import { nodeOf, typesOf, type TypesFixture } from "./helpers.js";

/**
 * The type at the last statement-expression identifier of a program.
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

describe("annotation kinds", () => {
	it("converts every keyword type", () => {
		const code = `let a: any, b: unknown, c: never, d: void, e: undefined, f: null, g: symbol, h: object, i: bigint, j: boolean; a; b; c; d; e; f; g; h; i; j;`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "b")).toBe(TYPE_UNKNOWN);
		expect(atUse(fixture, code, "c")).toBe(TYPE_NEVER);
		expect(atUse(fixture, code, "e")).toBe(TYPE_UNDEFINED);
		expect(atUse(fixture, code, "f")).toBe(TYPE_NULL);
		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: code.lastIndexOf("g;") },
				"symbol",
			),
		).toBe(true);
		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: code.lastIndexOf("h;") },
				"object",
			),
		).toBe(true);
		expect(atUse(fixture, code, "i")).toBe(TYPE_BIGINT);
		expect(atUse(fixture, code, "j")).toBe(TYPE_BOOLEAN);
	});

	it("converts literal types of every flavor", () => {
		const code = `let a: 1 | -2 | 3n | true | "s"; a;`;
		const fixture = typesOf(code);
		const parts = fixture.queries.constituentTypeIds(
			atUse(fixture, code, "a"),
		);
		const flagsOf = (i: number): number =>
			fixture.queries.typeFlagsById(parts[i]);

		expect(parts).toHaveLength(5);
		expect(flagsOf(0) & TYF_NUMBER_LITERAL).not.toBe(0);
		expect(flagsOf(1) & TYF_NUMBER_LITERAL).not.toBe(0);
		expect(flagsOf(2) & TYF_BIGINT_LITERAL).not.toBe(0);
		expect(fixture.queries.typeToStringById(parts[1])).toBe("-2");
		expect(fixture.queries.typeToStringById(parts[2])).toBe("3n");
		expect(fixture.queries.typeToStringById(parts[3])).toBe("true");
	});

	it("treats template literal types as string-like", () => {
		const code = "let a: `on-${string}`; a;";
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("a;") };

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
		expect(
			fixture.queries.getTypeFlags(use) & TYF_TEMPLATE_LITERAL,
		).not.toBe(0);
	});

	it("converts intersections with the OR of their flags", () => {
		const code = `let a: string & { tag: true }; a;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("a;") };
		const flags = fixture.queries.getTypeFlags(use);

		expect(flags & TYF_INTERSECTION).not.toBe(0);
		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
	});

	it("converts tuples with labels, optional slots, and rest", () => {
		const code = `let t: [first: string, second?: number, ...rest: boolean[]]; t;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "t");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_TUPLE).not.toBe(
			0,
		);
	});

	it("converts function and constructor types", () => {
		const code = `let f: (a: string) => number; let c: new () => Set<string>; f; c;`;
		const fixture = typesOf(code);
		const fUse = { type: "Identifier", start: code.lastIndexOf("f;") };
		const cUse = { type: "Identifier", start: code.lastIndexOf("c;") };

		expect(fixture.queries.isTypeOf(fUse, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(cUse, "function")).toBe(true);
		expect(fixture.queries.typeToString(cUse)).toBe(
			"new () => Set<string>",
		);
	});

	it("records type literals with method, accessor, and index members", () => {
		const code = [
			`let o: {`,
			`  plain: string;`,
			`  method(x: number): boolean;`,
			`  get read(): number;`,
			`  set write(v: number);`,
			`  [key: string]: unknown;`,
			`  [index: number]: unknown;`,
			`};`,
			`o;`,
		].join("\n");
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("o;") };

		expect(fixture.queries.getPropertyTypeId(use, "plain")).toBe(
			TYPE_STRING,
		);
		expect(fixture.queries.getPropertyTypeId(use, "read")).toBe(
			TYPE_NUMBER,
		);
		expect(fixture.queries.getPropertyTypeId(use, "write")).toBe(
			TYPE_NUMBER,
		);
		expect(
			fixture.queries.isTypeOfById(
				fixture.queries.getPropertyTypeId(use, "method"),
				"function",
			),
		).toBe(true);
	});

	it("marks a type literal with a call signature inexact", () => {
		const code = `let o: { (x: number): string; tag: string }; o;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "o");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_INEXACT).not.toBe(
			0,
		);
		expect(fixture.queries.propertyTypeIdById(type, "tag")).toBe(
			TYPE_STRING,
		);
	});

	it("defers on the constructs it does not model", () => {
		const code = [
			`type A<T> = T extends string ? 1 : 2;`,
			`type B = { [K in "a" | "b"]: number };`,
			`type C = keyof { a: 1 };`,
			`let x: { a: 1 }["a"]; let y: typeof x; let z: import("./m.js").Thing;`,
			`x; y; z;`,
		].join("\n");
		const fixture = typesOf(code);

		for (const name of ["x", "y", "z"]) {
			const type = atUse(fixture, code, name);

			expect(
				fixture.reader.typeField(type, TY_SHAPE) & TYS_DEFERRED,
			).not.toBe(0);
			expect(fixture.queries.typeFlagsById(type) & TYF_UNKNOWN).not.toBe(
				0,
			);
		}
	});

	it("resolves qualified names to a deferred reference with provenance", () => {
		const code = `import { NS } from "pkg"; let x: NS.Inner; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.getTypeName(use)).toBe("NS.Inner");
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "package",
			specifier: "pkg",
		});
	});

	it("resolves an unresolved qualified name as a global", () => {
		const code = `let x: SomeSpace.Inner; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "global",
			specifier: null,
		});
	});

	it("treats a type predicate as boolean", () => {
		const code = `let f: (x: unknown) => x is string; const b = f(0); b;`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "b")).toBe(TYPE_BOOLEAN);
	});

	it("converts readonly arrays through ReadonlyArray", () => {
		const code = `let a: ReadonlyArray<string>; a;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("a;") };

		expect(fixture.queries.isArray(use)).toBe(true);
		expect(fixture.queries.getElementTypeId(use)).toBe(TYPE_STRING);
	});
});

describe("declaration forms", () => {
	it("binds destructuring parameter annotations to the pattern", () => {
		const code = `function f({ a }: { a: string }, [b]: number[]) {}`;

		expect(() => typesOf(code)).not.toThrow();
	});

	it("binds parameter defaults through the assignment pattern", () => {
		const code = `function f(count: number = 1) { count; }`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "count")).toBe(TYPE_NUMBER);
	});

	it("binds a rest parameter's annotation", () => {
		const code = `function f(...items: string[]) { items; }`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("items;") };

		expect(fixture.queries.isArray(use)).toBe(true);
	});

	it("binds parameter properties inside the constructor", () => {
		const code = `class C { constructor(private size: number) { size; } }`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "size")).toBe(TYPE_NUMBER);
	});

	it("marks a class with parameter properties inexact", () => {
		const code = `class C { constructor(private size: number) {} } const c = new C(); c;`;
		const fixture = typesOf(code);
		const type = atUse(fixture, code, "c");

		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_INEXACT).not.toBe(
			0,
		);
	});

	it("types a catch parameter through its annotation", () => {
		const code = `try {} catch (error: unknown) { error; }`;
		const fixture = typesOf(code);

		expect(atUse(fixture, code, "error")).toBe(TYPE_UNKNOWN);
	});

	it("skips static and computed class members without losing the rest", () => {
		const code = [
			`const key = "k";`,
			`class C {`,
			`  static shared: string;`,
			`  [key]: number;`,
			`  #secret: boolean = false;`,
			`  plain: string = "";`,
			`}`,
			`const c = new C(); (c.plain);`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_STRING);
	});

	it("handles abstract classes and accessor properties", () => {
		const code = [
			`abstract class Shape {`,
			`  abstract area(): number;`,
			`  accessor label: string = "";`,
			`}`,
			`declare const s: Shape;`,
			`(s.label);`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_STRING);
	});

	it("declares namespaces and modules", () => {
		const code = `namespace Utils { export const x = 1; } declare module "ext" {} Utils;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("Utils;") };

		expect(fixture.queries.getTypeName(use)).toBe("Utils");
	});

	it("declares interfaces extending library and unresolved names", () => {
		const code = [
			`interface Mine extends Error, Vendor { own: string; }`,
			`let m: Mine; m;`,
		].join("\n");
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("m;") };

		expect(fixture.queries.getPropertyTypeId(use, "own")).toBe(TYPE_STRING);
	});

	it("handles namespace imports and string import names", () => {
		const code = `import * as everything from "./all.js"; import { "weird name" as w } from "pkg"; everything; w;`;
		const fixture = typesOf(code);
		const nsUse = {
			type: "Identifier",
			start: code.lastIndexOf("everything;"),
		};
		const wUse = { type: "Identifier", start: code.lastIndexOf("w;") };

		expect(fixture.queries.getTypeName(nsUse)).toBe("everything");
		expect(fixture.queries.getTypeName(wUse)).toBe("weird name");
	});

	it("types enum members without initializers as numeric", () => {
		const code = `enum E { A, B = "s", C = 2 } let e: E; (E.A);`;
		const fixture = typesOf(code);
		const member = nodeOf(fixture, "MemberExpression");
		const flags = fixture.queries.getTypeFlags(member);

		expect(flags & TYF_NUMBER_LITERAL).not.toBe(0);
	});

	it("widens an enum member back to its enum", () => {
		const code = `enum E { A, B } let x = E.A; x;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("x;") };

		expect(fixture.queries.getTypeName(use)).toBe("E");
		expect(fixture.queries.isEnumLike(use)).toBe(true);
	});

	it("records generic constraints and defaults on type parameters", () => {
		const code = `function f<T extends number = 1>(v: T) { v; }`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("v;") };
		const type = fixture.queries.getTypeId(use);

		expect(
			fixture.queries.typeFlagsById(type) & TYF_TYPE_PARAMETER,
		).not.toBe(0);
	});
});

describe("expression rules", () => {
	it("types logical and conditional expressions as unions", () => {
		const code = `declare const c: boolean; const a = c ? 1 : "x"; const b = c || "y"; a; b;`;
		const fixture = typesOf(code);
		const aUse = { type: "Identifier", start: code.lastIndexOf("a;") };

		expect(fixture.queries.isTypeOf(aUse, "string")).toBe(false);
		expect(
			fixture.queries.constituentTypeIds(fixture.queries.getTypeId(aUse))
				.length,
		).toBe(2);
	});

	it("types sequences by their last expression", () => {
		const code = `let a; ((a, "done"));`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isTypeOf(
				nodeOf(fixture, "SequenceExpression"),
				"string",
			),
		).toBe(true);
	});

	it("types assignments, compound and logical", () => {
		const code = `let a: number = 0; let u; (a = 2); (a += 1); (a -= 1); (u ||= 1); (a **= 2);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(
				nodeOf(fixture, "AssignmentExpression", 0),
			),
		).not.toBe(TYPE_NONE);
		expect(
			fixture.queries.getTypeId(
				nodeOf(fixture, "AssignmentExpression", 3),
			),
		).toBe(TYPE_NONE);
	});

	it("types updates on bigints as bigint", () => {
		const code = `let b = 10n; (b++);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "UpdateExpression")),
		).toBe(TYPE_BIGINT);
	});

	it("types void, delete, and regexp literals", () => {
		const code = `let o: { p?: number }; (void 0); (delete o.p); (/x/u);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "UnaryExpression", 0)),
		).toBe(TYPE_UNDEFINED);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "UnaryExpression", 1)),
		).toBe(TYPE_BOOLEAN);
		// Literal 0 is `void 0`'s `0`; the regular expression is next.
		expect(fixture.queries.getTypeName(nodeOf(fixture, "Literal", 1))).toBe(
			"RegExp",
		);
	});

	it("spreads arrays into array literals", () => {
		const code = `const a: number[] = []; const b = [...a, 1]; const c = [..."chars"]; b; c;`;
		const fixture = typesOf(code);
		const bUse = { type: "Identifier", start: code.lastIndexOf("b;") };
		const cUse = { type: "Identifier", start: code.lastIndexOf("c;") };

		expect(fixture.queries.getElementTypeId(bUse)).toBe(TYPE_NUMBER);
		expect(fixture.queries.getElementTypeId(cUse)).toBe(TYPE_UNKNOWN);
	});

	it("types empty and hole-carrying array literals conservatively", () => {
		const code = `const a = []; const b = [1, , 2]; a; b;`;
		const fixture = typesOf(code);
		const aUse = { type: "Identifier", start: code.lastIndexOf("a;") };

		expect(fixture.queries.isArray(aUse)).toBe(true);
		expect(fixture.queries.getElementTypeId(aUse)).toBe(TYPE_UNKNOWN);
	});

	it("types object literal getters, setters, and methods", () => {
		const code = [
			`const o = {`,
			`  count: 1,`,
			`  get label(): string { return ""; },`,
			`  set label(v: string) {},`,
			`  run(): boolean { return true; },`,
			`};`,
			`(o.label); (o.run());`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "CallExpression")),
		).toBe(TYPE_BOOLEAN);
	});

	it("propagates optional chains as possibly undefined", () => {
		const code = `let o: { p: string } | undefined; (o?.p);`;
		const fixture = typesOf(code);
		const chain = nodeOf(fixture, "ChainExpression");

		// The union object is unclaimed, so the chain claims nothing.
		expect(fixture.queries.getTypeId(chain)).toBe(TYPE_NONE);

		const known = `let o: { p: string }; (o?.p);`;
		const knownFixture = typesOf(known);
		const knownChain = nodeOf(knownFixture, "ChainExpression");

		expect(knownFixture.queries.mayBeNullish(knownChain)).toBe(true);
		expect(knownFixture.queries.isTypeOf(knownChain, "string")).toBe(false);
	});

	it("types await over any, unknown, unions, and plain values", () => {
		const code = [
			`declare const anyValue: any;`,
			`declare const plain: number;`,
			`declare const either: Promise<string> | Promise<number>;`,
			`async function f() {`,
			`  (await anyValue); (await plain); (await either);`,
			`}`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "AwaitExpression", 1)),
		).toBe(TYPE_NUMBER);

		const eitherType = fixture.queries.getTypeId(
			nodeOf(fixture, "AwaitExpression", 2),
		);

		expect(fixture.queries.constituentTypeIds(eitherType).length).toBe(2);
	});

	it("types dynamic import as an awaitable promise", () => {
		const code = `async function f() { (await import("./m.js")); }`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isAwaitable(nodeOf(fixture, "ImportExpression")),
		).toBe(true);
	});

	it("types assertions in both spellings, satisfies, and instantiation", () => {
		const code = [
			`declare const v: unknown;`,
			`declare function pick<T>(): T;`,
			`(v as string); (<number>v); (v satisfies unknown); (pick<string>);`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSAsExpression")),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSTypeAssertion")),
		).toBe(TYPE_NUMBER);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSSatisfiesExpression")),
		).toBe(TYPE_UNKNOWN);
	});

	it("erases nullish-only types to never through non-null assertions", () => {
		const code = `let n: null; (n!);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSNonNullExpression")),
		).toBe(TYPE_NEVER);
	});

	it("walks generators, yields, tagged templates, and JSX", () => {
		const code = [
			`function* gen() { yield 1; }`,
			`async function* agen() {}`,
			`declare function tag(parts: TemplateStringsArray): string;`,
			"const t = tag`x`;",
			`const el = <div attr={1}>{t}</div>;`,
		].join("\n");

		expect(() => typesOf(code, { jsx: true })).not.toThrow();
	});

	it("reads well-known constructors but not shadowed ones", () => {
		const code = `class Date {} const d = new Date(); const s = new Set(); d; s;`;
		const fixture = typesOf(code);
		const dUse = { type: "Identifier", start: code.lastIndexOf("d;") };
		const sUse = { type: "Identifier", start: code.lastIndexOf("s;") };

		expect(fixture.queries.getTypeOrigin(dUse)).toEqual({
			kind: "local",
			specifier: null,
		});
		expect(fixture.queries.getTypeOrigin(sUse)).toEqual({
			kind: "lib",
			specifier: null,
		});
	});

	it("indexes tuples out of range and with non-literal keys safely", () => {
		const code = `let t: [string]; let i: number; (t[9]); (t[i]); (t.length);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 2)),
		).toBe(TYPE_NUMBER);
	});

	it("reads array length and export default expressions", () => {
		const code = `const a: string[] = []; (a.length); export default { tag: 1 };`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NUMBER);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "ObjectExpression")),
		).not.toBe(TYPE_NONE);
	});
});
