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
