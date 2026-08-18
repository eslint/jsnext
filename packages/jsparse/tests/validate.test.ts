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
	/*
	 * The source type goes to both phases. It decides how a few constructs
	 * *read*, so the buffer records it and `validate()` refuses to be told
	 * the opposite of what the text was parsed as.
	 */
	return validate(
		parse(code, { sourceType: options.sourceType }),
		options,
	).map(problem => problem.message);
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

	/*
	 * `await` is not an operator in a script, so this is not a validation
	 * problem at all — it is two expressions side by side, which `parse()`
	 * rejects once it is told which reading to take.
	 */
	it("rejects top-level await in a script", () => {
		expect(() => parse("await x;", { sourceType: "script" })).toThrow(
			/'await' is only an operator/u,
		);
	});

	it("allows await as a name in a script", () => {
		expect(messages("var await = 1; await.x;", { sourceType: "script" }))
			.toEqual([]);
	});

	it("reports the position of the problem", () => {
		const problems = validate(
			parse("\n\n  import a from 'b';", { sourceType: "script" }),
			{ sourceType: "script" },
		);

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

	/*
	 * Two bindings collide when their `StringValue`s match. That is the name
	 * alone — an `Identifier` node runs on through whatever TypeScript hung
	 * off it — and it is what the escapes in the name mean rather than how
	 * they are spelled.
	 */
	it("reports a repeated declaration whose bindings are annotated", () => {
		expect(messages("let a: number; let a: string;")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});

	it("reports a repeated declarator in one annotated statement", () => {
		expect(
			messages("const a: string = '', a: number = 1;"),
		).toHaveLength(1);
	});

	it("reports a repeated annotated parameter", () => {
		expect(messages("function f(a: number, a: string) {}")).toHaveLength(1);
	});

	it("sees past a definite assignment assertion", () => {
		expect(messages("let a!: number; let a = 1;")).toHaveLength(1);
	});

	it("reports a repeated declaration written with an escape", () => {
		expect(messages("let \u0061; let a;")).toHaveLength(1);
	});

	/*
	 * A type-only import names something that exists in type space alone, so
	 * a value may take the same name. Whether it really may depends on what
	 * the other module exports, which is a question about the module graph
	 * rather than about this file, so the reading that accepts wins.
	 */
	it("allows a value to take the name of a type-only import", () => {
		expect(
			messages("import type { A } from 'm'; let A: number;"),
		).toEqual([]);
	});

	it("allows a value to take the name of an inline type import", () => {
		expect(messages("import { type A } from 'm'; let A = 1;")).toEqual([]);
	});

	it("still reports a value that takes the name of a value import", () => {
		expect(messages("import { A } from 'm'; let A = 1;")).toHaveLength(1);
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

	it("reports a var that a lexical declaration later shadows", () => {
		expect(messages("{ var a; let a; }")).toHaveLength(1);
	});

	it("reports a lexical declaration a nested var reaches", () => {
		expect(messages("{ { var a; } let a; }")).toHaveLength(1);
	});

	it("reports a repeated import binding", () => {
		expect(messages("import a from 'x'; let a;")).toHaveLength(1);
	});

	it("reports a lexical redeclaration across switch cases", () => {
		expect(messages("switch (q) { case 1: let a; case 2: let a; }")).toHaveLength(1);
	});

	it("allows the same name in separate blocks of one switch case", () => {
		expect(
			messages("switch (q) { case 1: { let a; } case 2: { let a; } }"),
		).toEqual([]);
	});

	it("reports a var in the body that a for head already binds", () => {
		expect(messages("for (let a of q) { var a; }")).toHaveLength(1);
	});

	it("allows a let in the body that a for head binds with var", () => {
		expect(messages("for (var a of q) { let a; }")).toEqual([]);
	});

	it("does not require an initializer in a for-of head", () => {
		expect(messages("for (const a of q) { a; }")).toEqual([]);
	});
});

describe("function declarations", () => {
	it("allows a var alongside a function at the top level of a script", () => {
		expect(
			messages("function a(){} var a;", { sourceType: "script" }),
		).toEqual([]);
		expect(
			messages("var a; function a(){}", { sourceType: "script" }),
		).toEqual([]);
	});

	it("reports a var alongside a function at the top level of a module", () => {
		expect(messages("function a(){} var a;")).toHaveLength(1);
		expect(messages("var a; function a(){}")).toHaveLength(1);
	});

	it("allows a var alongside a function in a function body", () => {
		expect(messages("function g(){ function a(){} var a; }")).toEqual([]);
	});

	it("allows a function that reuses a parameter name", () => {
		expect(messages("function g(a){ function a(){} }")).toEqual([]);
	});

	it("allows repeated functions in a function scope, even in strict mode", () => {
		expect(messages("function g(){ function a(){} function a(){} }")).toEqual(
			[],
		);
	});

	it("reports repeated functions at the top level of a module", () => {
		expect(messages("function a(){} function a(){}")).toHaveLength(1);
	});

	it("allows repeated functions in a sloppy block but not a strict one", () => {
		expect(
			messages("{ function a(){} function a(){} }", {
				sourceType: "script",
			}),
		).toEqual([]);
		expect(messages("{ function a(){} function a(){} }")).toHaveLength(1);
	});

	it("reports a var that a block-scoped function shadows", () => {
		expect(messages("{ function a(){} var a; }")).toHaveLength(1);
		expect(messages("{ var a; function a(){} }")).toHaveLength(1);
	});

	it("allows a function in a block beside a var outside it", () => {
		expect(messages("var a; { function a(){} }")).toEqual([]);
		expect(messages("{ function a(){} } var a;")).toEqual([]);
	});

	// A static block is a variable scope. See docs/deviations.md.
	it("treats a static block as a variable scope", () => {
		expect(messages("class C { static { var a; function a(){} } }")).toEqual(
			[],
		);
		expect(
			messages("class C { static { function a(){} function a(){} } }"),
		).toEqual([]);
	});
});

describe("catch clauses", () => {
	it("allows a var that reuses a simple parameter name", () => {
		expect(messages("try {} catch (a) { var a; }")).toEqual([]);
		expect(messages("try {} catch (a) { { var a; } }")).toEqual([]);
	});

	it("reports a var that reuses a destructured parameter name", () => {
		expect(messages("try {} catch ([a]) { var a; }")).toHaveLength(1);
	});

	it("reports a lexical declaration that reuses a parameter name", () => {
		expect(messages("try {} catch (a) { let a; }")).toHaveLength(1);
		expect(messages("try {} catch (a) { function a(){} }")).toHaveLength(1);
	});

	it("allows the same name in a nested block", () => {
		expect(messages("try {} catch (a) { { let a; } }")).toEqual([]);
	});
});

describe("eval and arguments", () => {
	it("names the word and the rule when a binding is refused", () => {
		expect(messages("var eval;")).toEqual([
			"'eval' cannot be bound in strict mode.",
		]);
	});

	it("names the word and the rule when an assignment is refused", () => {
		expect(messages("arguments = 1;")).toEqual([
			"'arguments' cannot be assigned to in strict mode.",
		]);
	});

	it("reports where the initializer mentions arguments, not the field", () => {
		const problems = validate(
			parse("class C { x = () => arguments; }", {
				sourceType: "script",
			}),
			{ sourceType: "script" },
		);

		expect(problems).toEqual([
			{
				message:
					"'arguments' cannot be used in a class field initializer.",
				lineNumber: 1,
				column: 21,
			},
		]);
	});

	it("reports arguments in a class static block", () => {
		expect(
			messages("class C { static { arguments; } }", {
				sourceType: "script",
			}),
		).toEqual(["'arguments' cannot be used in a class static block."]);
	});

	/*
	 * These rules govern what a program *binds*, and an ambient declaration
	 * binds nothing — it describes something declared elsewhere. TypeScript's
	 * own `lib.es5.d.ts` opens with `declare function eval(x: string): any`,
	 * so reading these as ordinary declarations would report the standard
	 * library.
	 */
	it("allows eval as the name of an ambient declaration", () => {
		expect(messages("declare function eval(x: string): any;")).toEqual([]);
	});

	it("allows arguments as an overload signature's parameter", () => {
		expect(
			messages(
				"declare function f(...arguments: unknown[]): void;",
			),
		).toEqual([]);
	});

	it("allows eval as the name of an ambient variable", () => {
		expect(messages("declare var eval: unknown;")).toEqual([]);
	});

	it("still reports a signature that has a body", () => {
		expect(messages("function eval(x: string): any {}")).toEqual([
			"'eval' cannot be bound in strict mode.",
		]);
	});
});

describe("ambient declarations", () => {
	/*
	 * Nothing under a `declare`, and nothing at all in a `.d.ts`, brings
	 * anything into being — each describes something that exists elsewhere.
	 * A `const` there has nothing to initialize, which is why TypeScript
	 * accepts the missing initializer that is an error anywhere else.
	 */
	it("reports a const with no initializer", () => {
		expect(messages("const a: number;")).toEqual([
			expect.stringMatching(/Missing initializer/u),
		]);
	});

	it("allows an ambient const", () => {
		expect(messages("declare const a: number;")).toEqual([]);
	});

	it("allows a const inside an ambient module", () => {
		expect(messages("declare module 'm' { const a: number; }")).toEqual(
			[],
		);
	});

	it("allows a const inside an ambient namespace", () => {
		expect(messages("declare namespace N { const a: number; }")).toEqual(
			[],
		);
	});

	it("carries ambience into a nested namespace", () => {
		expect(
			messages("declare namespace N { namespace M { const a: number; } }"),
		).toEqual([]);
	});

	/*
	 * A namespace written without the keyword is ordinary code, and
	 * TypeScript reports the same missing initializer in one that it reports
	 * at the top level of a file.
	 */
	it("still reports a const inside a plain namespace", () => {
		expect(messages("namespace N { const a: number; }")).toHaveLength(1);
	});

	it("allows every const in a declaration file", () => {
		expect(
			messages("export const a: number;", { declaration: true }),
		).toEqual([]);
	});

	it("reports the same file when it is not a declaration file", () => {
		expect(messages("export const a: number;")).toHaveLength(1);
	});

	/*
	 * An ambient function signature and an ambient class of the same name are
	 * one declaration described twice. Drop either `declare` and TypeScript
	 * reports the pair, so both halves have to be ambient for this to hold.
	 */
	it("allows an ambient signature to merge with an ambient class", () => {
		expect(
			messages("declare function f(): void;\ndeclare class f {}"),
		).toEqual([]);
	});

	it("allows the merge written the other way round", () => {
		expect(
			messages("declare class f {}\ndeclare function f(): void;"),
		).toEqual([]);
	});

	it("allows the merge a declaration file writes without the keyword", () => {
		expect(
			messages(
				"export default function f(): undefined;\nexport default class f {}",
				{ declaration: true },
			),
		).toEqual([]);
	});

	it("still reports two ambient classes", () => {
		expect(
			messages("declare class f {}\ndeclare class f {}"),
		).toHaveLength(1);
	});

	it("still reports a signature beside a class that is not ambient", () => {
		expect(messages("declare function f(): void;\nclass f {}")).toHaveLength(
			1,
		);
	});

	it("still reports an ambient const beside an ambient class", () => {
		expect(
			messages("declare const f: number;\ndeclare class f {}"),
		).toHaveLength(1);
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
