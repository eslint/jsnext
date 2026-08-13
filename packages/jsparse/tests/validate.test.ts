/**
 * @fileoverview Tests for the validation phase.
 */

import { describe, expect, it } from "vitest";
import { parse, validate } from "../src/index.js";

/**
 * Validates a source text and returns the messages.
 * @param code The source text to check.
 * @param options How the program should be interpreted.
 * @returns The message of every problem found.
 */
function messages(
	code: string,
	options: Parameters<typeof validate>[1] = {},
): string[] {
	return validate(parse(code), options).map(problem => problem.message);
}

describe("sourceType", () => {
	it("allows import and export in a module", () => {
		expect(messages("import a from 'b'; export const c = 1;")).toEqual([]);
	});

	it("rejects import and export in a script", () => {
		const found = messages("import a from 'b';", { sourceType: "script" });

		expect(found).toHaveLength(1);
		expect(found[0]).toMatch(/sourceType/u);
	});

	it("rejects import and export in commonjs", () => {
		expect(
			messages("export default 1;", { sourceType: "commonjs" }),
		).toHaveLength(1);
	});

	it("allows top-level await in a module", () => {
		expect(messages("await x;")).toEqual([]);
	});

	it("rejects top-level await in a script", () => {
		expect(messages("await x;", { sourceType: "script" })).toEqual([
			expect.stringMatching(/Top-level 'await'/u),
		]);
	});

	it("reports the position of the problem", () => {
		const problems = validate(parse("\n\n  import a from 'b';"), {
			sourceType: "script",
		});

		expect(problems[0].lineNumber).toBe(3);
		expect(problems[0].column).toBe(3);
	});
});

describe("strict mode", () => {
	it("rejects a with statement in a module", () => {
		expect(messages("with (a) { b; }")).toEqual([
			expect.stringMatching(/with statement/u),
		]);
	});

	it("allows a with statement in a sloppy script", () => {
		expect(messages("with (a) { b; }", { sourceType: "script" })).toEqual(
			[],
		);
	});

	it("rejects a with statement after a use strict directive", () => {
		expect(
			messages("'use strict'; with (a) { b; }", {
				sourceType: "script",
			}),
		).toHaveLength(1);
	});

	it("rejects octal literals in strict code", () => {
		expect(messages("var a = 0755;")).toEqual([
			expect.stringMatching(/Octal/u),
		]);
	});

	it("allows octal literals in sloppy code", () => {
		expect(messages("var a = 0755;", { sourceType: "script" })).toEqual([]);
	});
});

describe("dialect", () => {
	it("allows TypeScript syntax when the dialect is ts", () => {
		expect(messages("let a: number = 1;")).toEqual([]);
	});

	it("rejects TypeScript syntax when the dialect is js", () => {
		const found = messages("let a: number = 1;", { dialect: "js" });

		expect(found.length).toBeGreaterThan(0);
		expect(found[0]).toMatch(/TypeScript syntax/u);
	});

	it("accepts plain JavaScript in either dialect", () => {
		expect(messages("let a = 1;", { dialect: "js" })).toEqual([]);
	});
});

describe("jsx", () => {
	it("rejects JSX by default", () => {
		expect(messages("<div/>;")).toEqual([
			expect.stringMatching(/JSX syntax is not allowed/u),
		]);
	});

	it("rejects a fragment by default", () => {
		expect(messages("<>text</>;")).toEqual([
			expect.stringMatching(/JSX syntax is not allowed/u),
		]);
	});

	it("allows JSX when the option is on", () => {
		expect(messages("<div>{a}</div>;", { jsx: true })).toEqual([]);
	});

	it("rejects JSX in either dialect", () => {
		expect(messages("<div/>;", { dialect: "js" })).toHaveLength(1);
		expect(messages("<div/>;", { dialect: "ts" })).toHaveLength(1);
	});

	it("reports a whole tree once, at its root", () => {
		const problems = validate(
			parse("<div><span>{a}</span><br/></div>;"),
			{},
		);

		expect(problems).toHaveLength(1);
		expect(problems[0].column).toBe(1);
	});

	it("reports each JSX tree that stands on its own", () => {
		expect(messages("<a/>; <b/>;")).toHaveLength(2);
	});

	it("still reports other problems inside a rejected tree", () => {
		expect(messages("<div>{x}</span>;")).toEqual([
			expect.stringMatching(/JSX syntax is not allowed/u),
			expect.stringMatching(/is closed by/u),
		]);
	});
});

describe("declarations", () => {
	it("reports a repeated lexical declaration", () => {
		expect(messages("let a; let a;")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});

	it("allows a repeated var declaration", () => {
		expect(messages("var a; var a;")).toEqual([]);
	});

	it("reports a let that shadows a var in the same scope", () => {
		expect(messages("var a; let a;")).toHaveLength(1);
	});

	it("allows the same name in nested blocks", () => {
		expect(messages("let a; { let a; }")).toEqual([]);
	});

	it("allows a var inside a block that names an outer binding", () => {
		expect(messages("var a; { var a; }")).toEqual([]);
	});

	it("reports a var that escapes a block into a lexical binding", () => {
		expect(messages("{ let a; { var a; } }")).toHaveLength(1);
	});

	it("allows a type and a value to share a name", () => {
		expect(messages("interface A {} const A = 1;")).toEqual([]);
	});

	it("reports a const with no initializer", () => {
		expect(messages("const a;")).toEqual([
			expect.stringMatching(/Missing initializer/u),
		]);
	});

	it("reports return outside of a function", () => {
		expect(messages("return 1;")).toEqual([
			expect.stringMatching(/outside of function/u),
		]);
	});

	it("allows return inside a function", () => {
		expect(messages("function f() { return 1; }")).toEqual([]);
	});

	it("reports a strict-mode reserved word used as a binding", () => {
		expect(messages("let interface = 1;")).toEqual([
			expect.stringMatching(/reserved word/u),
		]);
	});
});

describe("overload signatures", () => {
	it("allows signatures followed by an implementation", () => {
		expect(
			messages(
				"function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: any): void {}",
			),
		).toEqual([]);
	});

	it("allows exported signatures", () => {
		expect(
			messages(
				"export function f(a: string): void;\nexport function f(a: any): void {}",
			),
		).toEqual([]);
	});

	it("allows ambient signatures with no implementation", () => {
		expect(
			messages(
				"declare function f(a: string): void;\ndeclare function f(a: number): void;",
			),
		).toEqual([]);
	});

	it("allows signatures inside a namespace", () => {
		expect(
			messages(
				"declare namespace N {\n\tfunction f(a: string): void;\n\tfunction f(a: number): void;\n}",
			),
		).toEqual([]);
	});

	it("allows signatures inside a block", () => {
		expect(
			messages(
				"{\n\tfunction f(a: string): void;\n\tfunction f(a: any): void {}\n}",
			),
		).toEqual([]);
	});

	it("still reports two implementations of the same name", () => {
		expect(
			messages(
				"function f(a: string): void;\nfunction f(a: any) {}\nfunction f(b: any) {}",
			),
		).toEqual([expect.stringMatching(/already been declared/u)]);
	});

	it("still reports a lexical binding that collides with a signature", () => {
		expect(messages("function f(a: string): void;\nlet f;")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});
});
