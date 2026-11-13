/**
 * @fileoverview The core classification queries: what kind of value is
 * this, in one word?
 */

import { describe, expect, it } from "vitest";
import {
	TYF_NUMBER,
	TYF_STRING,
	TYF_STRING_LITERAL,
	TYF_UNION,
	TYPE_NONE,
	TYPE_NUMBER,
	TYPE_STRING,
} from "../../src/index.js";
import { nodeOf, refAt, typesOf } from "./helpers.js";

describe("annotations", () => {
	it("types an annotated variable", () => {
		const code = `let x: string; x;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "x;").start;
		const ref = { type: "Identifier", start: use };

		expect(fixture.queries.getTypeId(ref)).toBe(TYPE_STRING);
		expect(fixture.queries.isTypeOf(ref, "string")).toBe(true);
		expect(fixture.queries.isTypeOf(ref, "number")).toBe(false);
	});

	it("types a union annotation with the OR of its flags", () => {
		const code = `let x: string | number; x;`;
		const fixture = typesOf(code);
		const ref = refAt(fixture, code, "Identifier", "x;");
		const flags = fixture.queries.getTypeFlags({
			type: "Identifier",
			start: ref.start,
		});

		expect(flags & TYF_UNION).not.toBe(0);
		expect(flags & TYF_STRING).not.toBe(0);
		expect(flags & TYF_NUMBER).not.toBe(0);
		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: ref.start },
				"string",
			),
		).toBe(false);
	});

	it("keeps a literal annotation a literal", () => {
		const code = `let x: "on" | "off"; x;`;
		const fixture = typesOf(code);
		const ref = refAt(fixture, code, "Identifier", "x;");
		const node = { type: "Identifier", start: ref.start };

		expect(fixture.queries.isTypeOf(node, "string")).toBe(true);

		const parts = fixture.queries.constituentTypeIds(
			fixture.queries.getTypeId(node),
		);

		expect(parts).toHaveLength(2);
		expect(
			fixture.queries.typeFlagsById(parts[0]) & TYF_STRING_LITERAL,
		).not.toBe(0);
	});

	it("follows a type alias to its target", () => {
		const code = `type Id = number; let x: Id; x;`;
		const fixture = typesOf(code);
		const ref = refAt(fixture, code, "Identifier", "x;");

		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: ref.start },
				"number",
			),
		).toBe(true);
	});
});

describe("initializers", () => {
	it("keeps a const literal narrow and widens a let", () => {
		const code = `const a = "on"; let b = "on"; a; b;`;
		const fixture = typesOf(code);
		const useA = refAt(fixture, code, "Identifier", "a;");
		const useB = refAt(fixture, code, "Identifier", "b;");
		const typeA = fixture.queries.getTypeId({
			type: "Identifier",
			start: useA.start,
		});

		expect(
			fixture.queries.typeFlagsById(typeA) & TYF_STRING_LITERAL,
		).not.toBe(0);
		expect(
			fixture.queries.getTypeId({
				type: "Identifier",
				start: useB.start,
			}),
		).toBe(TYPE_STRING);
	});

	it("types literals and template literals", () => {
		const code = `const n = 1.5; const t = \`a\${n}\`; t;`;
		const fixture = typesOf(code);
		const useT = refAt(fixture, code, "Identifier", "t;");

		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: useT.start },
				"string",
			),
		).toBe(true);
	});

	it("claims nothing about an unannotated, uninitialized variable", () => {
		const code = `let x; x;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "x;");

		expect(
			fixture.queries.getTypeId({
				type: "Identifier",
				start: use.start,
			}),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.isTypeOf(
				{ type: "Identifier", start: use.start },
				"string",
			),
		).toBe(false);
	});
});

describe("operators", () => {
	it("types comparisons, typeof, and negation", () => {
		const code = `let a; (a === 1); (typeof a); (!a);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.isTypeOf(
				nodeOf(fixture, "BinaryExpression"),
				"boolean",
			),
		).toBe(true);
		expect(
			fixture.queries.isTypeOf(
				nodeOf(fixture, "UnaryExpression", 0),
				"string",
			),
		).toBe(true);
		expect(
			fixture.queries.isTypeOf(
				nodeOf(fixture, "UnaryExpression", 1),
				"boolean",
			),
		).toBe(true);
	});

	it("types + as string when either side is string-like", () => {
		const code = `let a; ("x" + a);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression")),
		).toBe(TYPE_STRING);
	});

	it("claims nothing for arithmetic over two unknowns", () => {
		const code = `let a, b; (a - b);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression")),
		).toBe(TYPE_NONE);
	});

	it("types arithmetic as number once one side is known", () => {
		const code = `let a; (a - 1);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "BinaryExpression")),
		).toBe(TYPE_NUMBER);
	});
});

describe("nullishness", () => {
	it("reports a definitely nullish union", () => {
		const code = `let x: null | undefined; x;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "x;");
		const node = { type: "Identifier", start: use.start };

		expect(fixture.queries.isNullish(node)).toBe(true);
		expect(fixture.queries.mayBeNullish(node)).toBe(true);
	});

	it("reports a maybe-nullish union without claiming isNullish", () => {
		const code = `let x: string | null; x;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "x;");
		const node = { type: "Identifier", start: use.start };

		expect(fixture.queries.isNullish(node)).toBe(false);
		expect(fixture.queries.mayBeNullish(node)).toBe(true);
	});

	it("treats unknown and any as maybe nullish", () => {
		const code = `let x: unknown; x;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "x;");

		expect(
			fixture.queries.mayBeNullish({
				type: "Identifier",
				start: use.start,
			}),
		).toBe(true);
	});

	it("strips nullishness through a non-null assertion", () => {
		const code = `let x: string | null; (x!);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "TSNonNullExpression")),
		).toBe(TYPE_STRING);
	});
});

describe("promises", () => {
	it("recognizes a Promise annotation as awaitable, with provenance", () => {
		const code = `let p: Promise<string>; p;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "p;");
		const node = { type: "Identifier", start: use.start };

		expect(fixture.queries.isAwaitable(node)).toBe(true);
		expect(fixture.queries.getTypeName(node)).toBe("Promise");
		expect(fixture.queries.getTypeOrigin(node)).toEqual({
			kind: "lib",
			specifier: null,
		});
	});

	it("does not call a local class Promise the library's", () => {
		const code = `class Promise {} let p: Promise; p;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "p;");
		const node = { type: "Identifier", start: use.start };

		expect(fixture.queries.isAwaitable(node)).toBe(false);
		expect(fixture.queries.getTypeOrigin(node)).toEqual({
			kind: "local",
			specifier: null,
		});
	});

	it("recognizes a hand-rolled thenable structurally", () => {
		const code = `let t: { then(cb: () => void): void }; t;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "t;");

		expect(
			fixture.queries.isAwaitable({
				type: "Identifier",
				start: use.start,
			}),
		).toBe(true);
	});

	it("unwraps await over an async function's return", () => {
		const code = [
			`async function f(): Promise<number> { return 1; }`,
			`async function g() { (await f()); }`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "AwaitExpression")),
		).toBe(TYPE_NUMBER);
	});

	it("types an async function's implicit return as a Promise", () => {
		const code = `async function f() {} const p = f(); p;`;
		const fixture = typesOf(code);
		const use = refAt(fixture, code, "Identifier", "p;");

		expect(
			fixture.queries.isAwaitable({
				type: "Identifier",
				start: use.start,
			}),
		).toBe(true);
	});
});

describe("arrays and tuples", () => {
	it("types annotations, literals, and elements", () => {
		const code = `let a: string[]; const b = [1, 2]; let c: [string, number]; a; b; c;`;
		const fixture = typesOf(code);
		const useA = { type: "Identifier", start: code.indexOf("a;") };
		const useB = { type: "Identifier", start: code.indexOf("b;") };
		const useC = { type: "Identifier", start: code.indexOf("c;") };

		expect(fixture.queries.isArray(useA)).toBe(true);
		expect(fixture.queries.getElementTypeId(useA)).toBe(TYPE_STRING);
		expect(fixture.queries.isArray(useB)).toBe(true);
		expect(fixture.queries.getElementTypeId(useB)).toBe(TYPE_NUMBER);
		expect(fixture.queries.isTuple(useC)).toBe(true);
		expect(fixture.queries.isArray(useC)).toBe(false);
	});

	it("types indexing into arrays and tuples", () => {
		const code = `let a: string[]; let t: [string, number]; (a[0]); (t[1]);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 1)),
		).toBe(TYPE_NUMBER);
	});
});

describe("tuple positions", () => {
	/**
	 * The rendered type of an expression statement's expression.
	 * @param code The source text.
	 * @param snippet The expression's source text.
	 * @returns The rendered type, `"unknown"` when nothing is recorded.
	 */
	function typeOf(code: string, snippet: string): string {
		const start = code.lastIndexOf(snippet);

		return typesOf(code).queries.typeToString({
			type: "MemberExpression",
			start,
			end: start + snippet.length,
		});
	}

	it("reads a rest element's elements from the rest on", () => {
		const code = `declare const t: [number, ...boolean[]]; t[0]; t[1]; t[5];`;

		expect(typeOf(code, "t[0]")).toBe("number");
		expect(typeOf(code, "t[1]")).toBe("boolean");
		expect(typeOf(code, "t[5]")).toBe("boolean");
	});

	it("unions a middle rest with the elements after it", () => {
		const code = `declare const t: [number, ...boolean[], string]; t[0]; t[1]; t[2];`;

		expect(typeOf(code, "t[0]")).toBe("number");
		expect(typeOf(code, "t[1]")).toBe("boolean | string");
		expect(typeOf(code, "t[2]")).toBe("boolean | string");
	});

	it("reads through a labeled rest", () => {
		const code = `declare const t: [a: number, ...rest: boolean[]]; t[1];`;

		expect(typeOf(code, "t[1]")).toBe("boolean");
	});

	it("admits undefined for an optional element", () => {
		const code = `declare const t: [number, string?]; t[0]; t[1];`;

		expect(typeOf(code, "t[0]")).toBe("number");
		expect(typeOf(code, "t[1]")).toBe("string | undefined");
	});

	it("claims nothing past the end of a fixed tuple", () => {
		const code = `declare const t: [number, string]; t[2];`;

		expect(typeOf(code, "t[2]")).toBe("unknown");
	});

	it("claims nothing from a spread tuple on", () => {
		// The checker flattens `...[A, B]` into positions; the record does not.
		const code = `declare const t: [number, ...[string, boolean]]; t[0]; t[1];`;

		expect(typeOf(code, "t[0]")).toBe("number");
		expect(typeOf(code, "t[1]")).toBe("unknown");
	});

	it("renders rest and optional markers", () => {
		const code = `declare const a: [number, ...boolean[]]; declare const b: [a: number, b?: string]; a; b;`;
		const fixture = typesOf(code);
		const render = (snippet: string): string =>
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.lastIndexOf(snippet),
			});

		expect(render("a;")).toBe("[number, ...boolean[]]");
		expect(render("b;")).toBe("[number, string?]");
	});
});

describe("enums", () => {
	it("classifies enums and their members", () => {
		const code = `enum Direction { Up, Down } let d: Direction; d;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("d;") };

		expect(fixture.queries.isEnumLike(use)).toBe(true);
		expect(fixture.queries.isTypeOf(use, "number")).toBe(true);
		expect(fixture.queries.getTypeName(use)).toBe("Direction");
	});

	it("classifies a string enum as string-valued", () => {
		const code = `enum Level { Low = "low", High = "high" } let l: Level; l;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.lastIndexOf("l;") };

		expect(fixture.queries.isTypeOf(use, "string")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "number")).toBe(false);
	});
});

describe("rendering", () => {
	it("renders the common shapes readably", () => {
		const code = `let a: string | number; let b: Map<string, number[]>; let c: [boolean, "x"]; a; b; c;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.indexOf("a;"),
			}),
		).toBe("string | number");
		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.indexOf("b;"),
			}),
		).toBe("Map<string, number[]>");
		expect(
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.indexOf("c;"),
			}),
		).toBe('[boolean, "x"]');
	});

	it("renders a union of literals as a union, not as one literal", () => {
		const code = `let a: 1 | 2; let b: "x" | "y"; let c: 1 | "x"; a; b; c;`;
		const fixture = typesOf(code);
		const render = (snippet: string): string =>
			fixture.queries.typeToString({
				type: "Identifier",
				start: code.indexOf(snippet),
			});

		expect(render("a;")).toBe("1 | 2");
		expect(render("b;")).toBe('"x" | "y"');
		expect(render("c;")).toBe('1 | "x"');
	});
});
