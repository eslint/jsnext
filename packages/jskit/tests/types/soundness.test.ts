/**
 * @fileoverview The claims the checker differential proved out: every case
 * here is a pattern where an earlier walk either claimed something
 * `ts.TypeChecker` contradicts or stayed silent where it could speak.
 * `scripts/types/conformance-ts.mjs` checks the same claims over the
 * corpus; these pin the fixes.
 */

import { describe, expect, it } from "vitest";
import { TYPE_NONE, TYPE_VOID } from "../../src/index.js";
import { nodeOf, refAt, typesOf } from "./helpers.js";

/**
 * A start-anchored reference to the identifier a snippet begins with.
 * @param code The source text.
 * @param snippet The snippet whose first occurrence marks the identifier.
 * @returns The positional reference.
 */
function identAt(
	code: string,
	snippet: string,
): { type: string; start: number } {
	return { type: "Identifier", start: code.indexOf(snippet) };
}

describe("optionality admits undefined", () => {
	it("widens an optional parameter to include undefined", () => {
		const code = `function f(x?: string) { x; }`;
		const fixture = typesOf(code);
		const use = identAt(code, "x;");

		expect(fixture.queries.isTypeOf(use, "string")).toBe(false);
		expect(fixture.queries.mayBeNullish(use)).toBe(true);
		expect(fixture.queries.typeToString(use)).toBe("string | undefined");
	});

	it("keeps a required parameter exact", () => {
		const code = `function f(x: string) { x; }`;
		const fixture = typesOf(code);
		const use = identAt(code, "x;");

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
		expect(fixture.queries.mayBeNullish(use)).toBe(false);
	});

	it("reads an optional member as possibly undefined", () => {
		const code = `let o: { a?: number }; o.a;`;
		const fixture = typesOf(code);
		const access = nodeOf(fixture, "MemberExpression");

		expect(fixture.queries.isTypeOf(access, "number")).toBe(false);
		expect(fixture.queries.mayBeNullish(access)).toBe(true);
	});
});

describe("callable object types", () => {
	it("classifies a callable interface as a function", () => {
		const code = `interface F { (x: number): string; extra: boolean }
let f: F; f;`;
		const fixture = typesOf(code);
		const use = identAt(code, "f;");

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("classifies a construct-signature literal as a function", () => {
		const code = `let w: { new (): object }; w;`;
		const fixture = typesOf(code);
		const use = identAt(code, "w;");

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("claims nothing for an interface with an unknowable base", () => {
		const code = `import { Base } from "elsewhere";
interface I extends Base {} let i: I; i;`;
		const fixture = typesOf(code);
		const use = identAt(code, "i;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
		expect(fixture.queries.isTypeOf(use, "function")).toBe(false);
	});

	it("claims nothing for a qualified heritage name either", () => {
		const code = `import * as React from "react";
interface J extends React.FC {} let j: J; j;`;
		const fixture = typesOf(code);
		const use = identAt(code, "j;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
		expect(fixture.queries.isTypeOf(use, "function")).toBe(false);
	});

	it("still calls a self-contained interface an object", () => {
		const code = `interface P { x: number } let p: P; p;`;
		const fixture = typesOf(code);
		const use = identAt(code, "p;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(true);
	});

	it("inherits callability through a chain of bases", () => {
		const code = `interface Fn { (): void }
interface Mid extends Fn {}
interface Top extends Mid {}
let t: Top; t;`;
		const fixture = typesOf(code);
		const use = identAt(code, "t;");

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("keeps a chain of plain bases an object", () => {
		const code = `interface Leaf { x: number }
interface Mid extends Leaf {}
interface Top extends Mid {}
let t: Top; t;`;
		const fixture = typesOf(code);
		const use = identAt(code, "t;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(true);
	});
});

describe("intersections", () => {
	it("lets a primitive constituent pin typeof", () => {
		const code = `let b: string & {}; b;`;
		const fixture = typesOf(code);
		const use = identAt(code, "b;");

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("lets a callable constituent make the whole a function", () => {
		const code = `let g: { kind: 1 } & (() => void); g;`;
		const fixture = typesOf(code);
		const use = identAt(code, "g;");

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("claims nothing when a constituent commits to nothing", () => {
		const code = `import { Mixin } from "elsewhere";
let u: { a: 1 } & Mixin; u;`;
		const fixture = typesOf(code);
		const use = identAt(code, "u;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
		expect(fixture.queries.isTypeOf(use, "function")).toBe(false);
	});

	it("still calls an all-object intersection an object", () => {
		const code = `let m: { a: 1 } & { b: 2 }; m;`;
		const fixture = typesOf(code);
		const use = identAt(code, "m;");

		expect(fixture.queries.isTypeOf(use, "object")).toBe(true);
	});
});

describe("evolving bindings", () => {
	it("leaves a nullish-initialized let untyped", () => {
		const code = `let x = null; x = compute(); x;`;
		const fixture = typesOf(code);
		const use = identAt(code, "x;");

		expect(fixture.queries.getTypeId(use)).toBe(TYPE_NONE);
		expect(fixture.queries.isNullish(use)).toBe(false);
	});

	it("keeps a nullish const nullish", () => {
		const code = `const y = null; y;`;
		const fixture = typesOf(code);
		const use = identAt(code, "y;");

		expect(fixture.queries.isNullish(use)).toBe(true);
	});
});

describe("loop variables", () => {
	/**
	 * The rendered type of the loop variable's read in the loop body.
	 * @param code The source text, whose body reads the variable as `v;`.
	 * @returns The rendered type, `"unknown"` when nothing is recorded.
	 */
	function bodyType(code: string): string {
		return typesOf(code).queries.typeToString(identAt(code, "v;"));
	}

	it("binds an array's element type", () => {
		expect(
			bodyType(`declare const xs: number[]; for (const v of xs) v;`),
		).toBe("number");
	});

	it("does not widen a literal element under let", () => {
		expect(
			bodyType(`declare const xs: (1 | 2)[]; for (let v of xs) v;`),
		).toBe("1 | 2");
	});

	it("binds the union of a tuple's elements, spreading a rest", () => {
		expect(
			bodyType(`declare const t: [1, "a"]; for (const v of t) v;`),
		).toBe('1 | "a"');
		expect(
			bodyType(
				`declare const t: [number, ...boolean[]]; for (const v of t) v;`,
			),
		).toBe("number | boolean");
		expect(bodyType(`declare const t: []; for (const v of t) v;`)).toBe(
			"never",
		);
	});

	it("admits undefined for a tuple's optional element", () => {
		// The checker's answer under `strict`, as for an optional parameter.
		expect(
			bodyType(
				`declare const t: [number, string?]; for (const v of t) v;`,
			),
		).toBe("number | string | undefined");
		expect(
			bodyType(
				`declare const t: [a: number, b?: string]; for (const v of t) v;`,
			),
		).toBe("number | string | undefined");
	});

	it("spreads a labeled rest element", () => {
		expect(
			bodyType(
				`declare const t: [a: number, ...rest: boolean[]]; for (const v of t) v;`,
			),
		).toBe("number | boolean");
	});

	it("binds string from a string and any from any", () => {
		expect(bodyType(`declare const s: "ab"; for (const v of s) v;`)).toBe(
			"string",
		);
		expect(bodyType(`declare const a: any; for (const v of a) v;`)).toBe(
			"any",
		);
	});

	it("binds each union member's element type", () => {
		expect(
			bodyType(
				`declare const u: string | number[]; for (const v of u) v;`,
			),
		).toBe("string | number");
	});

	it("claims nothing for iterables it does not model", () => {
		expect(
			bodyType(`declare const s: Set<number>; for (const v of s) v;`),
		).toBe("unknown");
		expect(
			bodyType(
				`declare const u: number[] | Set<number>; for (const v of u) v;`,
			),
		).toBe("unknown");
		expect(bodyType(`for (const v of unknownThing) v;`)).toBe("unknown");
	});

	it("awaits each element under for await", () => {
		expect(
			bodyType(
				`declare const ps: Promise<number>[]; async function f() { for await (const v of ps) v; }`,
			),
		).toBe("number");
	});

	it("binds string keys from a non-generic object", () => {
		expect(
			bodyType(
				`declare const r: Record<string, number>; for (const v in r) v;`,
			),
		).toBe("string");
		expect(
			bodyType(`declare const xs: number[]; for (const v in xs) v;`),
		).toBe("string");
	});

	it("claims nothing for keys of a possibly generic object", () => {
		// The checker types these as `Extract<keyof T, string>`.
		expect(bodyType(`function f<T>(t: T) { for (const v in t) v; }`)).toBe(
			"unknown",
		);
		expect(
			bodyType(
				`function f<T>(r: Record<keyof T, 1>) { for (const v in r) v; }`,
			),
		).toBe("unknown");
		expect(
			bodyType(
				`function f<T>() { type M = { [K in keyof T]: 1 }; let m!: M; for (const v in m) v; }`,
			),
		).toBe("unknown");
		expect(bodyType(`for (const v in unknownThing) v;`)).toBe("unknown");
	});

	it("types the loop's binding, not an Annex B initializer", () => {
		expect(
			bodyType(
				`declare const r: Record<string, number>; for (var v = 0 in r) v;`,
			),
		).toBe("string");
	});

	it("leaves an assignment target loop untouched", () => {
		const code = `let v: number; for (v of ["a"]) v;`;

		expect(bodyType(code)).toBe("number");
	});
});

describe("declarations that bind a value and a type", () => {
	it("types the enum object as an object and its members by base", () => {
		const code = `enum E { A, B } E; E.A; let e: E; e;`;
		const fixture = typesOf(code);
		const object = identAt(code, "E;");
		const member = nodeOf(fixture, "MemberExpression");
		const annotated = identAt(code, "e;");

		expect(fixture.queries.isTypeOf(object, "object")).toBe(true);
		expect(fixture.queries.isTypeOf(object, "number")).toBe(false);
		expect(fixture.queries.isTypeOf(member, "number")).toBe(true);
		expect(fixture.queries.isTypeOf(annotated, "number")).toBe(true);
	});

	it("keeps a merged namespace's value the function it merges with", () => {
		const code = `function fn(): void {}
namespace fn { export const x = 1; }
fn;`;
		const fixture = typesOf(code);
		const use = identAt(code, "fn;");
		const declaration = nodeOf(fixture, "TSModuleDeclaration");

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(declaration, "function")).toBe(true);
		expect(fixture.queries.isTypeOf(declaration, "object")).toBe(false);
	});

	it("still types a plain namespace as an object", () => {
		const code = `namespace N { export const x = 1; }`;
		const fixture = typesOf(code);
		const declaration = nodeOf(fixture, "TSModuleDeclaration");

		expect(fixture.queries.isTypeOf(declaration, "object")).toBe(true);
	});

	it("resolves a merged namespace's type reference to the type", () => {
		const code = `namespace MarkupKind { export const PlainText = "plaintext"; }
type MarkupKind = "plaintext" | "markdown";
let k: MarkupKind; k;`;
		const fixture = typesOf(code);
		const use = identAt(code, "k;");

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});
});

describe("names are not expressions", () => {
	it("records nothing for a type-only export's identifier", () => {
		const code = `class C {} export type { C };`;
		const fixture = typesOf(code);
		const specifier = nodeOf(fixture, "Identifier", 1);

		expect(fixture.queries.getTypeId(specifier)).toBe(TYPE_NONE);
	});

	it("still types a value export's identifier", () => {
		const code = `class C {} export { C };`;
		const fixture = typesOf(code);
		const specifier = nodeOf(fixture, "Identifier", 1);

		expect(fixture.queries.isTypeOf(specifier, "function")).toBe(true);
	});

	it("records nothing for a module declaration's name literal", () => {
		const code = `declare module "*.css" { const css: string; }`;
		const fixture = typesOf(code);
		const name = nodeOf(fixture, "Literal");

		expect(fixture.queries.getTypeId(name)).toBe(TYPE_NONE);
	});

	it("records nothing for a class member's literal key", () => {
		const code = `class K { "a"() {} }`;
		const fixture = typesOf(code);
		const key = nodeOf(fixture, "Literal");

		expect(fixture.queries.getTypeId(key)).toBe(TYPE_NONE);
	});

	it("does not read an annotation identifier as a value", () => {
		const code = `class Wanted {}
function g(): Wanted { return new Wanted(); }`;
		const fixture = typesOf(code);
		const annotation = refAt(
			fixture,
			code,
			"Identifier",
			"Wanted { return",
		);

		expect(
			fixture.queries.getTypeId({
				type: "Identifier",
				start: annotation.start,
				end: annotation.start + "Wanted".length,
			}),
		).toBe(TYPE_NONE);
	});
});

describe("shapes the checker normalizes", () => {
	it("reads a rest-only tuple as the array it spreads", () => {
		const code = `let t: [...string[]]; t;`;
		const fixture = typesOf(code);
		const use = identAt(code, "t;");

		expect(fixture.queries.isArray(use)).toBe(true);
		expect(fixture.queries.isTuple(use)).toBe(false);
	});

	it("keeps a mixed tuple a tuple", () => {
		const code = `let t: [number, ...string[]]; t;`;
		const fixture = typesOf(code);
		const use = identAt(code, "t;");

		expect(fixture.queries.isTuple(use)).toBe(true);
	});

	it("types an asserting predicate as returning nothing", () => {
		const code = `declare function assertFoo(x: unknown): asserts x is string;
assertFoo(1);`;
		const fixture = typesOf(code);
		const call = nodeOf(fixture, "CallExpression");

		expect(fixture.queries.getTypeId(call)).toBe(TYPE_VOID);
	});

	it("types a plain predicate as returning a boolean", () => {
		const code = `declare function isFoo(x: unknown): x is string;
isFoo(1);`;
		const fixture = typesOf(code);
		const call = nodeOf(fixture, "CallExpression");

		expect(fixture.queries.isTypeOf(call, "boolean")).toBe(true);
	});

	it("has no element type for an empty tuple", () => {
		const code = `let e: []; e;`;
		const fixture = typesOf(code);
		const use = identAt(code, "e;");

		expect(fixture.queries.isTuple(use)).toBe(true);
		expect(fixture.queries.getElementTypeId(use)).toBe(TYPE_NONE);
	});
});
