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

	it("rejects a legacy escape in a strict string", () => {
		for (const code of ['"\\1";', '"\\052";', '"\\8";', '"\\9";']) {
			expect(messages(code)).toEqual([
				expect.stringMatching(/Octal/u),
			]);
			expect(messages(code, { sourceType: "script" })).toEqual([]);
		}
	});

	/*
	 * The tokenizer cannot answer this one, because a function's own
	 * `"use strict"` may arrive after the literal it makes illegal — and it
	 * does arrive after, since a string holding the escape is itself part of
	 * the directive prologue.
	 */
	it("sees strictness a directive turns on later in the same prologue", () => {
		const script = { sourceType: "script" } as const;

		expect(
			messages('function f() { "\\1"; "use strict"; }', script),
		).toEqual([expect.stringMatching(/Octal/u)]);
		expect(
			messages('(function () { "a: \\052"; "use strict"; });', script),
		).toHaveLength(1);
		expect(messages('class C { m() { return "\\1"; } }', script)).toEqual([
			expect.stringMatching(/Octal/u),
		]);
	});

	/*
	 * `01;` is not a directive, so the prologue ends there and the
	 * `"use strict"` after it is an ordinary expression statement.
	 */
	it("does not read a directive past the end of the prologue", () => {
		expect(
			messages('function f() { 01; "use strict"; }', {
				sourceType: "script",
			}),
		).toEqual([]);
	});

	it("still validates a regular expression literal", () => {
		expect(messages("var a = /(?<x>a)(?<x>b)/;")).toEqual([
			"Duplicate capture group name.",
		]);
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

	/*
	 * Annex B forgives two function declarations sharing a sloppy block, and
	 * it names `FunctionDeclaration` alone. A generator or an async function
	 * on either side is outside the rule and collides as any other lexical
	 * binding would.
	 */
	it("reports a generator or async function repeated in a sloppy block", () => {
		const script = { sourceType: "script" } as const;

		expect(
			messages("{ function a(){} function* a(){} }", script),
		).toHaveLength(1);
		expect(
			messages("{ function* a(){} function a(){} }", script),
		).toHaveLength(1);
		expect(
			messages("{ function* a(){} function* a(){} }", script),
		).toHaveLength(1);
		expect(
			messages("{ async function a(){} async function a(){} }", script),
		).toHaveLength(1);
		expect(
			messages("{ async function* a(){} function a(){} }", script),
		).toHaveLength(1);
	});

	it("reports a generator repeated across sloppy switch cases", () => {
		expect(
			messages(
				"switch (q) { case 1: function a(){} default: function* a(){} }",
				{ sourceType: "script" },
			),
		).toHaveLength(1);
	});

	it("still allows a generator repeated in a function scope", () => {
		expect(
			messages("function g(){ function* a(){} function* a(){} }"),
		).toEqual([]);
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

describe("break and continue", () => {
	it("reports a bare break with nothing to leave", () => {
		expect(messages("break;", { sourceType: "script" })).toEqual([
			"'break' must be inside a loop or a switch.",
		]);
	});

	it("reports a bare continue in a switch, which only break may leave", () => {
		expect(
			messages("switch (0) { case 1: continue; }", {
				sourceType: "script",
			}),
		).toEqual(["'continue' must be inside a loop."]);
	});

	it("reports a label that encloses nothing", () => {
		expect(
			messages("L: x = 1; break L;", { sourceType: "script" }),
		).toEqual(["Label 'L' is not enclosing this 'break'."]);
	});

	it("reports a continue naming a label that is not on a loop", () => {
		expect(messages("L: { continue L; }", { sourceType: "script" })).toEqual(
			["Label 'L' is not on a loop, so 'continue' cannot name it."],
		);
	});

	it("follows a chain of labels to what it ends at", () => {
		expect(
			messages("a: b: while (0) continue a;", { sourceType: "script" }),
		).toEqual([]);
	});

	it("reports a duplicate label", () => {
		expect(messages("a: a: while (0);", { sourceType: "script" })).toEqual([
			"Label 'a' has already been declared.",
		]);
	});

	it("reports one nested inside the label of the same name", () => {
		expect(
			messages("a: while(0) { a: while(0); }", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows the same label again once the first has closed", () => {
		expect(
			messages("a: while(0); a: while(0);", { sourceType: "script" }),
		).toEqual([]);
	});

	/*
	 * A label names a statement, and a nested function is inside that
	 * statement rather than part of it — as is a class static block, which
	 * runs where the class is defined.
	 */
	it("does not let a nested function leave an outer loop", () => {
		expect(
			messages("L: while (0) { (function () { break L; })(); }", {
				sourceType: "script",
			}),
		).toHaveLength(1);
	});

	it("does not let a static block leave an enclosing loop", () => {
		expect(
			messages("label: while (false) { class C { static { break; } } }", {
				sourceType: "script",
			}),
		).toHaveLength(1);
	});

	it("still lets a static block have loops of its own", () => {
		expect(
			messages("class C { static { L: while (0) break L; } }", {
				sourceType: "script",
			}),
		).toEqual([]);
	});
});

describe("let as a bound name", () => {
	it("reports a lexical declaration that binds let", () => {
		expect(messages("let let = 1;", { sourceType: "script" })).toEqual([
			"'let' may not be the name a lexical declaration binds.",
		]);
	});

	it("reaches it through a pattern", () => {
		expect(
			messages("let {a: let} = x;", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("reads it through an escape", () => {
		expect(
			messages("let l\\u0065t = 1;", { sourceType: "script" }),
		).toHaveLength(1);
	});

	/*
	 * A `var` never had the ambiguity the lookahead restriction on `let` was
	 * written for, and a catch parameter binds without declaring.
	 */
	it("allows var to bind it", () => {
		expect(messages("var let = 1;", { sourceType: "script" })).toEqual([]);
	});

	it("allows a simple catch parameter to bind it", () => {
		expect(
			messages("try {} catch (let) {}", { sourceType: "script" }),
		).toEqual([]);
	});

	it("reports it inside a catch pattern, which declares", () => {
		expect(
			messages("try {} catch ([let]) {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows it as a function name or a parameter", () => {
		expect(messages("function let() {}", { sourceType: "script" })).toEqual(
			[],
		);
		expect(messages("function f(let) {}", { sourceType: "script" })).toEqual(
			[],
		);
	});
});

describe("for statement heads", () => {
	/*
	 * A `for-in` or `for-of` takes its value from something else, so a
	 * binding with an initializer has nowhere for the value to go and a
	 * second binding has nothing to bind.
	 */
	it("reports an initializer in a lexical for-in head", () => {
		expect(
			messages("for (let a = 0 in {});", { sourceType: "script" }),
		).toEqual(["A for-in or for-of head may not have an initializer."]);
	});

	it("reports one in any for-of head", () => {
		expect(
			messages("for (var a = 0 of []);", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("keeps Annex B's sloppy var form", () => {
		expect(
			messages("for (var a = 0 in {});", { sourceType: "script" }),
		).toEqual([]);
	});

	it("does not keep it in strict code", () => {
		expect(
			messages("'use strict'; for (var a = 0 in {});", {
				sourceType: "script",
			}),
		).toHaveLength(1);
	});

	it("does not keep it for a pattern", () => {
		expect(
			messages("for (var [a] = 0 in {});", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("reports a second binding", () => {
		expect(
			messages("for (let x, y in {});", { sourceType: "script" }),
		).toEqual(["A for-in or for-of head may declare only one binding."]);
	});

	it("leaves a C-style head alone", () => {
		expect(
			messages("for (let x = 1, y = 2; ;);", { sourceType: "script" }),
		).toEqual([]);
	});

	/*
	 * The `async` restriction is on the token, so every way out of it is
	 * lexical.
	 */
	it("reports async as a for-of target", () => {
		expect(messages("for (async of []);", { sourceType: "script" })).toEqual(
			["'async' may not be the target of a for-of loop."],
		);
	});

	it("allows it in parentheses", () => {
		expect(
			messages("for ((async) of []);", { sourceType: "script" }),
		).toEqual([]);
	});

	it("allows it written with an escape", () => {
		expect(
			messages("for (\\u0061sync of [7]);", { sourceType: "script" }),
		).toEqual([]);
	});

	it("allows it after for await, which the rule never covered", () => {
		expect(
			messages("async function f() { for await (async of [7]); }", {
				sourceType: "script",
			}),
		).toEqual([]);
	});
});

describe("class element names", () => {
	it("reports a static element named prototype", () => {
		expect(messages("class C { static prototype() {} }")).toEqual([
			"A static class element may not be named 'prototype'.",
		]);
	});

	it("reports the same name written as a string", () => {
		expect(messages("class C { static 'prototype'; }")).toHaveLength(1);
	});

	it("allows the name on the prototype side", () => {
		expect(messages("class C { prototype() {} }")).toEqual([]);
	});

	/*
	 * All of these are rules about the *name*, which a computed key does not
	 * have until the class is evaluated.
	 */
	it("allows a computed key that spells it", () => {
		expect(messages("class C { static ['prototype']() {} }")).toEqual([]);
	});

	it("reports a constructor that is a generator", () => {
		expect(messages("class C { *constructor() {} }")).toEqual([
			"A class constructor may not be a getter, a setter, a generator, or async.",
		]);
	});

	it("reports a constructor that is a getter", () => {
		expect(messages("class C { get constructor() {} }")).toHaveLength(1);
	});

	it("reports a field named constructor", () => {
		expect(messages("class C { constructor; }")).toEqual([
			"A class field may not be named 'constructor'.",
		]);
	});

	it("reports a static field named constructor", () => {
		expect(messages("class C { static constructor; }")).toHaveLength(1);
	});

	it("allows a static method named constructor", () => {
		expect(messages("class C { static *constructor() {} }")).toEqual([]);
	});

	it("reports two constructors", () => {
		expect(
			messages("class C { constructor() {} constructor() {} }"),
		).toEqual(["A class may not have more than one constructor."]);
	});

	it("counts each class separately", () => {
		expect(
			messages("class C { constructor() { class D { constructor() {} } } }"),
		).toEqual([]);
	});

	/*
	 * A body-less constructor is an overload signature. Signatures describe
	 * the one implementation rather than adding another, so only two
	 * implementations are a mistake.
	 */
	it("allows constructor overload signatures", () => {
		expect(
			messages(
				"class C { constructor(a: string); constructor(a: number); constructor(a: any) {} }",
			),
		).toEqual([]);
	});

	it("allows an ambient class to declare only signatures", () => {
		expect(
			messages("declare class C { constructor(a: string); constructor(a: number); }"),
		).toEqual([]);
	});

	it("still reports two implementations", () => {
		expect(
			messages("class C { constructor() {} constructor(a: any) {} }"),
		).toHaveLength(1);
	});
});

describe("single-statement contexts", () => {
	/*
	 * The body of an `if`, a loop, a `with`, or a label is a `Statement`, and
	 * a `Declaration` is not one. Annex B carves out a plain function
	 * declaration under an `if` or a label in sloppy code, and nothing else.
	 */
	it("reports a lexical declaration as an if body", () => {
		expect(
			messages("if (0) const x = 1;", { sourceType: "script" }),
		).toEqual([
			"A declaration may not appear in a single-statement context.",
		]);
	});

	it("reports a class declaration as a loop body", () => {
		expect(
			messages("while (0) class C {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows var, which is a statement as well as a declaration", () => {
		expect(messages("if (0) var x = 1;", { sourceType: "script" })).toEqual(
			[],
		);
	});

	it("allows Annex B's function under an if in sloppy code", () => {
		expect(
			messages("if (0) function f() {}", { sourceType: "script" }),
		).toEqual([]);
	});

	it("reports the same function in strict code", () => {
		expect(
			messages("'use strict'; if (0) function f() {}", {
				sourceType: "script",
			}),
		).toHaveLength(1);
	});

	it("does not stretch the carve-out to a generator", () => {
		expect(
			messages("if (0) function* g() {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("does not stretch it to a loop body", () => {
		expect(
			messages("while (0) function f() {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows a labelled function in sloppy code", () => {
		expect(messages("l: function f() {}", { sourceType: "script" })).toEqual(
			[],
		);
	});

	it("treats a chain of labels as one position", () => {
		expect(
			messages("l: m: function f() {}", { sourceType: "script" }),
		).toEqual([]);
	});

	it("reports a labelled function that is itself a loop body", () => {
		expect(
			messages("while (0) l: function f() {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows a declaration in a switch case, which is a statement list", () => {
		expect(
			messages("switch (0) { case 1: let x = 1; }", {
				sourceType: "script",
			}),
		).toEqual([]);
	});

	/*
	 * With no declaration possible, `let` in one of these positions is an
	 * ordinary identifier, and a newline after it ends the statement.
	 */
	/*
	 * `let` is the one that splits across both phases. Read as a name, it
	 * leaves `if (0) let x = 1;` with two expressions on one line, which
	 * `parse()` cannot shape into a tree at all — while `const` in the same
	 * place parses cleanly and is reported here.
	 */
	it("lets parse() refuse the let form that cannot be a statement", () => {
		expect(() =>
			parse("if (0) let x = 1;", { sourceType: "script" }),
		).toThrow(/Unexpected token/u);
	});

	it("reads let as a name where no declaration may go", () => {
		expect(
			messages("if (0) let\nx = 1;", { sourceType: "script" }),
		).toEqual([]);
	});

	it("still reports let [ , which no expression may begin with", () => {
		expect(
			messages("if (0) let\n[a] = 0;", { sourceType: "script" }),
		).toHaveLength(1);
	});
});

describe("module item placement", () => {
	/*
	 * A `ModuleItem` is not a `Statement`, so no production puts one inside a
	 * block, a function, or the body of an `if`. TypeScript adds exactly one
	 * place — the body of a namespace or an ambient module — which is why the
	 * rule lives here rather than in the parser.
	 */
	it("allows an import at the top level of a module", () => {
		expect(messages("import v from 'm';")).toEqual([]);
	});

	it("reports an import inside a block", () => {
		expect(messages("{ import v from 'm'; }")).toEqual([
			"'import' and 'export' may only appear at the top level of a module or a namespace.",
		]);
	});

	it("reports an export inside a function", () => {
		expect(messages("function f() { export default null; }")).toHaveLength(
			1,
		);
	});

	it("reports one as the body of an if", () => {
		expect(messages("if (0) import v from 'm';")).toHaveLength(1);
	});

	it("reports one inside a class static block", () => {
		expect(
			messages("class C { static { import v from 'm'; } }"),
		).toHaveLength(1);
	});

	it("keeps the neighbours of a nested one clean", () => {
		expect(messages("import a from 'm';\n{ import b from 'm'; }\nexport {};")).toHaveLength(1);
	});

	it("allows an import in an ambient module body", () => {
		expect(
			messages("declare module 'm' { import { A } from 'other'; }"),
		).toEqual([]);
	});

	it("allows an export in a namespace body", () => {
		expect(messages("namespace N { export const x = 1; }")).toEqual([]);
	});

	it("allows one in a namespace nested in a namespace", () => {
		expect(
			messages("namespace N { namespace M { export const x = 1; } }"),
		).toEqual([]);
	});
});

describe("rest elements", () => {
	/*
	 * A rest element collects everything that is left, so nothing can follow
	 * it. The rule is the same on both sides of an `=`, and the two sides
	 * reach it down different paths — `checkArrayPattern()` for a target,
	 * `declarePattern()` for a binding.
	 */
	it("reports one that is not last in an array binding", () => {
		expect(messages("var [...a, b] = x;", { sourceType: "script" })).toEqual([
			"A rest element must be the last element.",
		]);
	});

	it("reports one that is not last in an array target", () => {
		expect(messages("[...a, b] = x;", { sourceType: "script" })).toEqual([
			"A rest element must be the last element.",
		]);
	});

	it("reports one that is not last in an object binding", () => {
		expect(messages("var {...a, b} = x;", { sourceType: "script" })).toEqual(
			["A rest element must be the last element."],
		);
	});

	it("reaches a pattern nested inside another", () => {
		expect(
			messages("var {a: [...b, c]} = x;", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("reaches a parameter's pattern", () => {
		expect(
			messages("function f([...a, b]) {}", { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("counts a hole after the rest as something following it", () => {
		expect(
			messages("var [...a, ,] = x;", { sourceType: "script" }),
		).toHaveLength(1);
	});

	/*
	 * `[...a,]` and `[...a]` are the same tree, and as array literals both
	 * are legal, so the comma reaches here as a flag the parser set rather
	 * than as anything the tree records.
	 */
	it("reports a comma after the last rest element", () => {
		expect(messages("var [...a,] = x;", { sourceType: "script" })).toEqual([
			"A comma is not allowed after a rest element.",
		]);
	});

	it("reports one after an object pattern's rest", () => {
		expect(messages("({...a,} = x);", { sourceType: "script" })).toEqual([
			"A comma is not allowed after a rest element.",
		]);
	});

	it("allows the same comma in an array literal", () => {
		expect(messages("var x = [...a,];", { sourceType: "script" })).toEqual(
			[],
		);
	});

	it("allows a trailing comma after anything else", () => {
		expect(messages("var [a,] = x;", { sourceType: "script" })).toEqual([]);
	});

	/*
	 * An object pattern's rest collects the leftover properties into one
	 * object, so it binds a plain name. The assignment form stores instead of
	 * binding, and so takes any target.
	 */
	it("reports a pattern as an object binding's rest", () => {
		expect(messages("var {...{a}} = x;", { sourceType: "script" })).toEqual([
			"A rest element in an object pattern must be an identifier.",
		]);
	});

	it("allows a member access as an object target's rest", () => {
		expect(messages("({...a.b} = x);", { sourceType: "script" })).toEqual(
			[],
		);
	});
});

describe("this as a name", () => {
	/*
	 * `this` reaches the binding paths at all only because a parameter list
	 * may bind it: TypeScript's `this` parameter names the receiver rather
	 * than an argument.
	 */
	it("refuses this as a bound name", () => {
		expect(messages("var this = 1;")).toEqual([
			"'this' may not be bound as a name.",
		]);
		expect(messages("try {} catch (this) {}")).toHaveLength(1);
		expect(messages("const [this] = x;")).toHaveLength(1);
	});

	it("still takes a TypeScript this parameter", () => {
		expect(messages("function f(this) {}")).toEqual([]);
		expect(messages("function f(this: T) {}")).toEqual([]);
	});

	it("leaves names that merely begin with a t alone", () => {
		expect(messages("var that = 1, t = 2;")).toEqual([]);
	});
});

describe("switch statements", () => {
	/*
	 * A `default` clause is the one with no test, and a second would be
	 * unreachable: the switch runs the first it finds.
	 */
	it("refuses a second default clause", () => {
		expect(messages("switch (q) { default: ; default: ; }")).toEqual([
			"A switch statement may only have one default clause.",
		]);
	});

	it("allows one default among any number of cases", () => {
		expect(messages("switch (q) { case 1: ; default: ; case 2: ; }")).toEqual(
			[],
		);
		expect(messages("switch (q) {}")).toEqual([]);
	});
});

describe("optional chains", () => {
	const script = { sourceType: "script" } as const;

	/*
	 * `OptionalChain TemplateLiteral` is a production the grammar writes down
	 * only to call it an error: a tag receives the raw text whether or not it
	 * is a function, so there is nothing for a nullish chain to short-circuit
	 * to.
	 */
	it("refuses a template tagged with one", () => {
		expect(messages("a?.fn`h`;", script)).toEqual([
			"A template literal may not be tagged with an optional chain.",
		]);
		expect(messages("a?.b.c`h`;", script)).toHaveLength(1);
		expect(messages("a?.[b]`h`;", script)).toHaveLength(1);
		expect(messages("a?.b`h`.c;", script)).toHaveLength(1);
	});

	/*
	 * The optional link has to be *below* the tag for the tagged thing to be
	 * a chain, and parentheses end a chain and begin another.
	 */
	it("takes a tag the chain is applied to rather than the other way", () => {
		expect(messages("f`h`?.a;", script)).toEqual([]);
		expect(messages("`h`?.[0];", script)).toEqual([]);
		expect(messages("(a?.fn)`h`;", script)).toEqual([]);
		expect(messages("(a?.b)`h`.c;", script)).toEqual([]);
		expect(messages("a.fn`h`;", script)).toEqual([]);
	});
});

describe("delete", () => {
	/*
	 * Deleting a bare name would reach into the scope chain, which is the one
	 * thing an engine relies on being able to resolve ahead of time.
	 * Parentheses are transparent to `delete UnaryExpression`.
	 */
	it("refuses a bare name in strict code", () => {
		expect(messages("delete x;")).toEqual([
			"Deleting a local variable is not allowed in strict mode.",
		]);
		expect(messages("delete ((x));")).toHaveLength(1);
		expect(
			messages('"use strict"; delete x;', { sourceType: "script" }),
		).toHaveLength(1);
	});

	it("allows one in sloppy code, and a property either way", () => {
		expect(messages("delete x;", { sourceType: "script" })).toEqual([]);
		expect(messages("delete x.y;")).toEqual([]);
		expect(messages("delete (x.y);")).toEqual([]);
		expect(messages("delete a[b];")).toEqual([]);
	});
});

describe("new.target and import.meta", () => {
	const script = { sourceType: "script" } as const;

	/*
	 * Both are spelled out in the grammar as two literal words rather than
	 * derived from an identifier, so an escape in the second half spells
	 * nothing at all.
	 */
	it("refuses an escape in either name", () => {
		expect(
			messages("function f() { new.t\\u0061rget; }", script),
		).toEqual(["'new.target' may not be written with an escape."]);
		expect(messages("import.m\\u0065ta;")).toEqual([
			"'import.meta' may not be written with an escape.",
		]);
	});

	/*
	 * `new.target` names the constructor a call was made through, so it needs
	 * something callable around it. An arrow has none of its own and reads
	 * the enclosing one, which is why an arrow at the top level is no help.
	 */
	it("refuses new.target outside anything callable", () => {
		expect(messages("new.target;", script)).toEqual([
			expect.stringMatching(/'new\.target' may only appear/u),
		]);
		expect(messages("() => { new.target; };", script)).toHaveLength(1);
		expect(messages("new.target;")).toHaveLength(1);
	});

	it("takes new.target in every body that has one", () => {
		expect(messages("function f() { new.target; }", script)).toEqual([]);
		expect(messages("class C { m() { new.target; } }", script)).toEqual([]);
		expect(
			messages("function f() { () => new.target; }", script),
		).toEqual([]);
		expect(messages("class C { static { new.target; } }", script)).toEqual(
			[],
		);
		expect(messages("class C { p = new.target; }", script)).toEqual([]);
	});

	it("refuses import.meta outside a module", () => {
		expect(messages("import.meta;", script)).toEqual([
			expect.stringMatching(/'import\.meta' may only appear/u),
		]);
		expect(messages("import.meta;")).toEqual([]);
	});
});

describe("class static blocks", () => {
	const script = { sourceType: "script" } as const;

	/*
	 * A static block runs while the class is being defined, which leaves it
	 * nothing to return from and nothing to suspend — however async or
	 * generative the function around the class is.
	 */
	it("refuses return, await, and yield", () => {
		expect(
			messages("function f() { class C { static { return; } } }", script),
		).toEqual(["'return' outside of function."]);
		expect(
			messages(
				"async function f() { class C { static { await 0; } } }",
				script,
			),
		).toEqual([
			"An await expression may not appear in a class static block.",
		]);
		expect(
			messages(
				"function* g() { class C { static { yield; } } }",
				script,
			),
		).toEqual([
			"A yield expression may not appear in a class static block.",
		]);
	});

	it("stops at the first function inside it", () => {
		expect(
			messages(
				"class C { static { async function g() { await 0; } } }",
				script,
			),
		).toEqual([]);
		expect(
			messages("class C { static { function* g() { yield; } } }", script),
		).toEqual([]);
		expect(
			messages("class C { static { () => { return 1; } } }", script),
		).toEqual([]);
	});
});

describe("module exports", () => {
	it("reports a name exported twice", () => {
		expect(messages("var x; export { x }; export { x };")).toEqual([
			"Duplicate export of 'x'.",
		]);
		expect(
			messages("var x, y; export { x as z }; export { y as z };"),
		).toHaveLength(1);
		expect(
			messages("var x, y; export default x; export { y as default };"),
		).toHaveLength(1);
		expect(
			messages("var x; export { x as z }; export * as z from 'm';"),
		).toHaveLength(1);
		expect(
			messages("export function f() {} export { f };"),
		).toHaveLength(1);
		expect(
			messages("export const { a, b } = q; export { a };"),
		).toHaveLength(1);
	});

	it("allows each name once", () => {
		expect(
			messages("var x; export { x }; export default 1;"),
		).toEqual([]);
		expect(messages("export * from 'm'; export * from 'n';")).toEqual([]);
		expect(messages("export const q = 1; export { q as w };")).toEqual([]);
	});

	/*
	 * An export written without a `from` clause names something the module
	 * itself declares, so a name nothing declares is an error rather than a
	 * re-export.
	 */
	it("reports an export that names nothing the module declares", () => {
		expect(messages("export { unresolvable };")).toEqual([
			"Export 'unresolvable' is not defined in the module.",
		]);
		expect(messages("export { Number };")).toHaveLength(1);
	});

	it("resolves against the whole module scope", () => {
		expect(messages("{ var v; } export { v };")).toEqual([]);
		expect(messages("import a from 'm'; export { a };")).toEqual([]);
		expect(messages("interface I {} export { I };")).toEqual([]);
		expect(
			messages("import p = require('m'); export { p };"),
		).toEqual([]);
	});

	/*
	 * A local binding's name is an identifier, so a string on that side never
	 * resolves however the module spells it.
	 */
	it("refuses a string as the local half of an export", () => {
		expect(
			messages("export { 'foo' as 'bar' }; function foo() {}"),
		).toEqual([
			expect.stringMatching(/may only name an export of another/u),
		]);
		expect(messages("export { 'a' as b } from 'm';")).toEqual([]);
	});

	it("requires a string module export name to be well-formed", () => {
		for (const code of [
			"export { '\ud83d' } from 'm';",
			"import { '\ud83d' as foo } from 'm';",
			"export { '\u263f' as '\ud83d' } from 'm';",
			"var Foo; export { Foo as '\ud83d' };",
		]) {
			expect(messages(code)).toEqual([
				expect.stringMatching(/must be well-formed Unicode/u),
			]);
		}
	});

	it("takes a paired surrogate", () => {
		expect(
			messages("export { '\ud83c\udf19' } from 'm';"),
		).toEqual([]);
	});

	/*
	 * A `with` clause is a set of keys, and a key may be written as an
	 * identifier or as a string, so what the two spell is what decides.
	 */
	it("reports a repeated import attribute", () => {
		expect(
			messages("import x from 'm' with { type: 'json', 'typ\u0065': '' };"),
		).toEqual(["Duplicate import attribute 'type'."]);
		expect(
			messages("import 'm' with { type: 'json', type: '' };"),
		).toHaveLength(1);
		expect(
			messages("export * from 'm' with { type: 'json', type: '' };"),
		).toHaveLength(1);
	});

	it("allows distinct attributes", () => {
		expect(
			messages("import x from 'm' with { a: '1', b: '2' };"),
		).toEqual([]);
	});
});

describe("object literals", () => {
	/*
	 * `{ a }` means `{ a: a }`, so the one word is a name and a reference at
	 * once. A computed key, a string, and a number are names the shorthand
	 * cannot spell back out; a reserved word is a name that is not a
	 * reference.
	 */
	it("requires a shorthand property to be a plain identifier", () => {
		expect(messages("({0});")).toEqual([
			"A shorthand property must be written as a plain identifier.",
		]);
		expect(messages("({[x]});")).toHaveLength(1);
	});

	it("refuses a reserved word as a shorthand name", () => {
		for (const word of ["this", "null", "true", "false"]) {
			expect(messages(`({${word}});`)).toEqual([
				`Unexpected reserved word '${word}'.`,
			]);
		}
	});

	it("refuses one in a pattern too", () => {
		expect(messages("({default}) => {};")).toHaveLength(1);
		expect(messages("({extends}) => {};")).toHaveLength(1);
		expect(messages("var x = { default } = y;")).toHaveLength(1);
	});

	it("still reports a word reserved only by position", () => {
		expect(messages("function* g() { ({yield} = x); }")).toEqual([
			expect.stringMatching(/'yield' cannot be used/u),
		]);
	});

	/*
	 * `{ a = 1 }` is a `CoverInitializedName`, which means something only
	 * once the cover grammar is refined into a pattern.
	 */
	it("refuses a default outside a destructuring pattern", () => {
		expect(messages("({a = 1});")).toEqual([
			"A shorthand property may only take a default inside a destructuring pattern.",
		]);
		expect(messages("({a = 1} = x);")).toEqual([]);
	});

	/*
	 * `__proto__: v` sets the prototype rather than a property, so writing it
	 * twice writes two different things into one place. Only the plain form
	 * does that — the name has to be known before the literal is evaluated,
	 * and a method or an accessor defines an ordinary property.
	 */
	it("refuses a repeated __proto__", () => {
		expect(messages("({__proto__: 1, '__proto__': 2});")).toEqual([
			"An object literal may only set '__proto__' once.",
		]);
	});

	it("counts only the spelling that sets the prototype", () => {
		expect(messages("({__proto__: 1});")).toEqual([]);
		expect(messages("({__proto__: 1, ['__proto__']: 2});")).toEqual([]);
		expect(messages("({__proto__() {}, __proto__: 1});")).toEqual([]);
		expect(messages("({__proto__, __proto__: 1});")).toEqual([]);
	});
});

describe("assignment targets", () => {
	const script = { sourceType: "script" } as const;

	/*
	 * Parentheses are what tell a pattern from a literal. `{a} = b` reparses
	 * the cover grammar as a pattern; `({a}) = b` cannot, because what is
	 * parenthesized is an object literal, whose `AssignmentTargetType` is
	 * invalid.
	 */
	it("refuses a parenthesized destructuring target", () => {
		expect(messages("({}) = 1;")).toEqual(["Invalid assignment target."]);
		expect(messages("([]) = 1;")).toHaveLength(1);
		expect(messages("({a}) = 1;")).toHaveLength(1);
		expect(messages("() => ({}) = 1;")).toHaveLength(1);
		expect(messages("for (({a}) of []) ;")).toHaveLength(1);
		expect(messages("[({a})] = x;")).toHaveLength(1);
	});

	it("still takes the unparenthesized one", () => {
		expect(messages("({} = 1);")).toEqual([]);
		expect(messages("[] = 1;")).toEqual([]);
		expect(messages("({a: {b}} = x);")).toEqual([]);
		expect(messages("(a) = 1;")).toEqual([]);
	});

	/*
	 * A call is assignable in sloppy code by the `~web-compat~` carve-out
	 * (see docs/deviations.md), and that carve-out reaches only as far as it
	 * is written: `&&=`, `||=`, and `??=` each ask for `simple`, which
	 * `~web-compat~` is not.
	 */
	it("refuses a call on the left of a logical assignment", () => {
		expect(messages("f() &&= 1;", script)).toEqual([
			"Invalid assignment target.",
		]);
		expect(messages("f() ||= 1;", script)).toHaveLength(1);
		expect(messages("f() ??= 1;", script)).toHaveLength(1);
		expect(messages("(f()) &&= 1;", script)).toHaveLength(1);
	});

	it("keeps the carve-out for the other operators", () => {
		expect(messages("f() = 1;", script)).toEqual([]);
		expect(messages("f() += 1;", script)).toEqual([]);
		expect(messages("f() &&= 1;")).toHaveLength(1);
		expect(messages("a.b &&= 1;", script)).toEqual([]);
	});
});

describe("private names", () => {
	/*
	 * A private name is not an expression. The parser accepts one wherever an
	 * expression can go — telling `#x in o` from `#x` alone needs the tree —
	 * so every position but the three the grammar names is reported here.
	 */
	it("takes the three positions the grammar gives it", () => {
		expect(
			messages("class C { #x = 1; static #y(){} get #z(){} }"),
		).toEqual([]);
		expect(messages("class C { #x; m() { return this.#x; } }")).toEqual([]);
		expect(messages("class C { #x; m() { return #x in this; } }")).toEqual(
			[],
		);
		expect(messages("class C { #x; m() { return this?.#x; } }")).toEqual(
			[],
		);
	});

	it("reports one written as an object literal's key", () => {
		expect(messages("var o = { #m() {} };")).toEqual([
			expect.stringMatching(/A private name may only be/u),
		]);
		expect(messages("var o = { get #m() {} };")).toHaveLength(1);
		expect(messages("class C { f = { #m() {} } }")).toHaveLength(1);
	});

	it("reports one read out of a destructuring pattern", () => {
		expect(
			messages("class C { #x; m() { const { #x: y } = this; } }"),
		).toHaveLength(1);
	});

	/*
	 * `in` is left-associative, so `#f in #f in this` is `(#f in #f) in this`
	 * and the inner right operand is a private name standing on its own.
	 */
	it("reports one as the right operand of in", () => {
		expect(
			messages("class C { #f; m() { #f in #f in this; } }"),
		).toHaveLength(1);
	});

	it("reports one standing anywhere else", () => {
		expect(messages("(#x);")).toHaveLength(1);
		expect(messages("x = #y;")).toHaveLength(1);
		expect(messages("class C { [#x]() {} }")).toHaveLength(1);
	});
});

describe("using declarations", () => {
	const script = { sourceType: "script" } as const;

	/*
	 * A `using` disposes of what its name holds when the scope ends, so it
	 * needs one name and one value: its `BindingList` is written `~Pattern`
	 * and every element of it carries an initializer.
	 */
	it("requires an initializer on every binding", () => {
		expect(messages("{ using a; }", script)).toEqual([
			"Missing initializer in using declaration.",
		]);
		expect(messages("{ using a = 1, b; }", script)).toHaveLength(1);
		expect(messages("for (using a;;) ;", script)).toHaveLength(1);
		expect(
			messages("async function f() { await using a; }", script),
		).toEqual(["Missing initializer in await using declaration."]);
	});

	it("does not require one where a for-of head supplies the value", () => {
		expect(messages("for (using a of []) ;", script)).toEqual([]);
	});

	it("refuses a destructuring pattern", () => {
		expect(messages("{ using a = 1, [b] = []; }", script)).toEqual([
			"A 'using' declaration may only bind an identifier.",
		]);
		expect(messages("{ using a = 1, {b} = {}; }", script)).toHaveLength(1);
	});

	/*
	 * A `for-of` head hands each value to the binding; a `for-in` head hands
	 * it a key, and a property name is not a thing to dispose of.
	 */
	it("refuses a for-in head", () => {
		expect(messages("for (using a in {}) ;", script)).toEqual([
			"A 'using' declaration may not head a for-in loop.",
		]);
		expect(messages("for (await using a in {}) ;", script)).toHaveLength(1);
	});

	/*
	 * The top level of a script is not a scope anything is disposed at the
	 * end of, and the cases of a `switch` share one scope — so a `using` in
	 * the first case would be disposed at a point the later ones run past.
	 */
	it("refuses the top level of a script and takes it in a module", () => {
		expect(messages("using a = 1;", script)).toEqual([
			expect.stringMatching(/may only appear inside a block/u),
		]);
		expect(messages("using a = 1;")).toEqual([]);
	});

	it("refuses a switch case in either goal", () => {
		expect(
			messages("switch (q) { case 1: using a = 1; }", script),
		).toHaveLength(1);
		expect(messages("switch (q) { default: using a = 1; }")).toHaveLength(
			1,
		);
	});

	it("takes every place that does close a scope", () => {
		expect(messages("{ using a = 1; }", script)).toEqual([]);
		expect(messages("function f() { using a = 1; }", script)).toEqual([]);
		expect(messages("try {} catch (e) { using a = 1; }", script)).toEqual(
			[],
		);
		expect(
			messages("class C { static { using a = 1; } }", script),
		).toEqual([]);
		expect(messages("for (using a = 1;;) ;", script)).toEqual([]);
	});
});

describe("template literals", () => {
	/*
	 * The tokenizer records an escape it cannot read instead of throwing,
	 * because a tagged template is handed the raw text and takes `undefined`
	 * for the cooked value. Untagged there is no one to hand it to.
	 */
	it("reports an escape an untagged template cannot cook", () => {
		for (const code of [
			"`\\u1`",
			"`\\u{}`",
			"`\\u{110000}`",
			"`\\xZ`",
			"`\\01`",
			"`\\8`",
			"`${x}\\u{}`",
		]) {
			expect(messages(code)).toEqual([
				expect.stringMatching(/untagged template literal/u),
			]);
		}
	});

	it("allows every one of them under a tag", () => {
		for (const code of [
			"tag`\\u1`",
			"tag`\\u{110000}`",
			"tag`a${1}\\xZ`",
			"tag`\\01`",
		]) {
			expect(messages(code)).toEqual([]);
		}
	});

	/*
	 * The tag is walked before the template it is applied to is marked, so a
	 * tag that ends in a tagged template of its own does not take the mark.
	 */
	it("sees which template a tag reaches when tags are chained", () => {
		expect(messages("tag`a`.b`\\u1`")).toEqual([]);
		expect(messages("`${ tag`\\u1` }`")).toEqual([]);
		expect(messages("tag`${ `\\u1` }`")).toHaveLength(1);
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

describe("the default export slot", () => {
	/*
	 * An interface exports a type and nothing else, so it merges with
	 * whatever exports the value under the same name.
	 */
	it("allows an interface beside a default function", () => {
		expect(
			messages(
				"export default function foo(): void {}\nexport default interface Foo {}",
			),
		).toEqual([]);
	});

	it("allows an interface beside a default class", () => {
		expect(
			messages(
				"export default class Foo {}\nexport default interface Foo {}",
			),
		).toEqual([]);
	});

	it("allows an interface before a default function", () => {
		expect(
			messages(
				"export default interface A { a: string }\nexport default function () { return 1; }",
			),
		).toEqual([]);
	});

	it("still reports two default values", () => {
		expect(
			messages("export default 0;\nexport default function () {}"),
		).toEqual([expect.stringMatching(/Duplicate export of 'default'/u)]);
	});

	it("still reports two default classes", () => {
		expect(
			messages("export default class A {}\nexport default class B {}"),
		).toEqual([expect.stringMatching(/Duplicate export of 'default'/u)]);
	});
});

describe("ambient class merging", () => {
	/*
	 * TypeScript states this rule from the other side, in the error it
	 * reports when the class is not ambient: "Function with bodies can only
	 * merge with classes that are ambient."
	 */
	it("allows an ambient class before a function implementation", () => {
		expect(messages("declare class f {}\nfunction f() {}")).toEqual([]);
	});

	it("allows an ambient class after a function implementation", () => {
		expect(messages("function f() {}\ndeclare class f {}")).toEqual([]);
	});

	it("allows an ambient class beside an overload signature", () => {
		expect(
			messages("declare function f(): void;\ndeclare class f {}"),
		).toEqual([]);
	});

	it("still reports a concrete class beside a function", () => {
		expect(messages("class f {}\nfunction f() {}")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});

	it("still reports an ambient class beside a var", () => {
		expect(messages("declare class f {}\nvar f: any;")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});

	it("still reports two ambient classes", () => {
		expect(messages("declare class f {}\ndeclare class f {}")).toEqual([
			expect.stringMatching(/already been declared/u),
		]);
	});
});

describe("parameter properties", () => {
	/*
	 * The accessibility modifier says what the class does with the binding,
	 * not what form the binding takes, so the parameter underneath is still a
	 * plain identifier and the list is still simple.
	 */
	it("allows a use strict directive after a parameter property", () => {
		expect(
			messages(
				'class C { constructor(public x: number) { "use strict"; } }',
			),
		).toEqual([]);
	});

	it("allows a use strict directive after a readonly parameter property", () => {
		expect(
			messages(
				'class C { constructor(readonly x: number) { "use strict"; } }',
			),
		).toEqual([]);
	});

	it("still reports one after a destructured parameter", () => {
		expect(
			messages('class C { constructor({ x }: any) { "use strict"; } }'),
		).toEqual([expect.stringMatching(/non-simple parameter list/u)]);
	});

	it("still reports one after a defaulted parameter property", () => {
		expect(
			messages(
				'class C { constructor(public x = 1) { "use strict"; } }',
			),
		).toEqual([expect.stringMatching(/non-simple parameter list/u)]);
	});
});

describe("definite assignment assertions", () => {
	it("allows one on an annotated let", () => {
		expect(messages("let x!: number;")).toEqual([]);
	});

	it("allows one on an annotated class field", () => {
		expect(messages("class C { x!: number; }")).toEqual([]);
	});

	it("reports one beside an initializer", () => {
		expect(messages("let x!: number = 1;")).toEqual([
			expect.stringMatching(/may not be combined with an initializer/u),
		]);
	});

	it("reports one on a class field beside an initializer", () => {
		expect(messages("class C { x!: number = 1; }")).toEqual([
			expect.stringMatching(/may not be combined with an initializer/u),
		]);
	});

	it("reports one with no type annotation", () => {
		expect(messages("let x!;")).toEqual([
			expect.stringMatching(/requires a type annotation/u),
		]);
	});

	it("reports one on a class field with no type annotation", () => {
		expect(messages("class C { x!; }")).toEqual([
			expect.stringMatching(/requires a type annotation/u),
		]);
	});

	/*
	 * `const`, `using`, `declare`, and `abstract` each settle whether the
	 * binding is assigned, so the assertion has nothing left to promise.
	 */
	it("reports one on a const", () => {
		expect(messages("const x!: number = 1;")).toEqual([
			expect.stringMatching(/not allowed here/u),
		]);
	});

	it("reports one on a declared variable", () => {
		expect(messages("declare let x!: number;")).toEqual([
			expect.stringMatching(/not allowed here/u),
		]);
	});

	it("reports one on a using declaration", () => {
		expect(messages("using x!: number = f();")).toEqual([
			expect.stringMatching(/not allowed here/u),
		]);
	});

	it("reports one on an abstract property", () => {
		expect(
			messages("abstract class C { abstract x!: number; }"),
		).toEqual([expect.stringMatching(/not allowed here/u)]);
	});

	/*
	 * The reference parser reads the `declare` written on the declaration
	 * itself, not the ambient context it may sit in.
	 */
	it("allows one inside an ambient namespace", () => {
		expect(messages("declare namespace N { let x!: number; }")).toEqual(
			[],
		);
	});
});

describe("abstract class elements", () => {
	/*
	 * `abstract` says a derived class supplies the member, so supplying it
	 * here is the one thing the modifier rules out. A signature is what an
	 * abstract member is supposed to be.
	 */
	it("allows an abstract method signature", () => {
		expect(
			messages("abstract class C { abstract m(): void; }"),
		).toEqual([]);
	});

	it("allows an abstract property with only a type", () => {
		expect(
			messages("abstract class C { abstract x: number; }"),
		).toEqual([]);
	});

	it("allows an abstract accessor signature", () => {
		expect(
			messages("abstract class C { abstract get x(): number; }"),
		).toEqual([]);
	});

	it("reports an abstract method with a body", () => {
		expect(messages("abstract class C { abstract m() {} }")).toEqual([
			expect.stringMatching(/may not have an implementation/u),
		]);
	});

	it("reports an abstract getter with a body", () => {
		expect(
			messages("abstract class C { abstract get x() { return 1; } }"),
		).toEqual([expect.stringMatching(/may not have an implementation/u)]);
	});

	it("reports an abstract setter with a body", () => {
		expect(
			messages("abstract class C { abstract set x(v) {} }"),
		).toEqual([expect.stringMatching(/may not have an implementation/u)]);
	});

	it("reports an abstract property with an initializer", () => {
		expect(messages("abstract class C { abstract x = 1; }")).toEqual([
			expect.stringMatching(/may not have an initializer/u),
		]);
	});

	it("still allows a concrete member beside abstract ones", () => {
		expect(
			messages("abstract class C { abstract m(): void; n() {} x = 1; }"),
		).toEqual([]);
	});
});

describe("ambient function declarations", () => {
	it("allows a declared signature", () => {
		expect(messages("declare function f(): void;")).toEqual([]);
	});

	it("reports a declared function with a body", () => {
		expect(messages("declare function f() {}")).toEqual([
			expect.stringMatching(/may not have a body/u),
		]);
	});

	it("reports a declared async function", () => {
		expect(
			messages("declare async function f(): Promise<void>;"),
		).toEqual([expect.stringMatching(/may not be async/u)]);
	});

	it("reports a declared generator", () => {
		expect(
			messages("declare function* f(): Iterable<number>;"),
		).toEqual([expect.stringMatching(/may not be a generator/u)]);
	});

	/*
	 * The same objection from the other side: being a generator is a fact
	 * about a body, and a signature has none.
	 */
	it("reports a body-less generator signature", () => {
		expect(messages("function* f(): Iterable<number>;")).toEqual([
			expect.stringMatching(/signature may not be a generator/u),
		]);
	});

	it("still allows an ordinary generator and async function", () => {
		expect(messages("function* g() {}\nasync function h() {}")).toEqual(
			[],
		);
	});

	/*
	 * The reference parser reads the keyword on the declaration itself, not
	 * the ambient context around it.
	 */
	it("allows a function with a body inside an ambient namespace", () => {
		expect(messages("declare namespace N { function f() {} }")).toEqual(
			[],
		);
	});

	it("allows a method with a body in an ambient class", () => {
		expect(messages("declare class C { m() {} }")).toEqual([]);
	});
});

describe("ambient variable initializers", () => {
	it("allows a declared variable with no initializer", () => {
		expect(messages("declare let x: number;")).toEqual([]);
	});

	/*
	 * `declare const x = 1` with no type written is the one that stands: the
	 * value is what says what the type is, so TypeScript keeps it.
	 */
	it("allows a declared const whose value stands in for a type", () => {
		expect(messages("declare const x = 1;")).toEqual([]);
	});

	it("reports an initializer on a declared let", () => {
		expect(messages("declare let x: number = 1;")).toEqual([
			expect.stringMatching(/may not have an initializer/u),
		]);
	});

	it("reports an initializer on a declared var", () => {
		expect(messages("declare var x: number = 1;")).toEqual([
			expect.stringMatching(/may not have an initializer/u),
		]);
	});

	it("reports an initializer on an annotated declared const", () => {
		expect(messages("declare const x: number = 1;")).toEqual([
			expect.stringMatching(/may not have an initializer/u),
		]);
	});
});

describe("modifier placement", () => {
	it("reports readonly on a method", () => {
		expect(messages("class C { readonly m() {} }")).toEqual([
			expect.stringMatching(/may not be marked 'readonly'/u),
		]);
	});

	it("reports declare on a method", () => {
		expect(messages("class C { declare m() {} }")).toEqual([
			expect.stringMatching(/may not be marked 'declare'/u),
		]);
	});

	it("still allows readonly and declare on a field", () => {
		expect(
			messages("class C { readonly x = 1; declare y: number; }"),
		).toEqual([]);
	});

	it("reports an accessibility modifier on an index signature", () => {
		expect(
			messages("class C { public [k: string]: number; }"),
		).toEqual([
			expect.stringMatching(/may not have an accessibility modifier/u),
		]);
	});

	/*
	 * `static` and `readonly` are the two modifiers an index signature can
	 * actually carry.
	 */
	it("still allows static and readonly on an index signature", () => {
		expect(
			messages(
				"class C { static [k: string]: number; }\nclass D { readonly [k: string]: number; }",
			),
		).toEqual([]);
	});
});

describe("variance annotations", () => {
	it("allows in and out on a class type parameter", () => {
		expect(messages("class C<in T, out U> { x?: T; y?: U; }")).toEqual([]);
	});

	it("allows in on an interface type parameter", () => {
		expect(messages("interface I<in T> { x: T; }")).toEqual([]);
	});

	it("allows in on a type alias type parameter", () => {
		expect(messages("type A<in T> = (x: T) => void;")).toEqual([]);
	});

	it("reports one on a function type parameter", () => {
		expect(messages("function f<in T>(x: T) {}")).toEqual([
			expect.stringMatching(/variance annotation/u),
		]);
	});

	it("reports one on a function type's type parameter", () => {
		expect(messages("type F = <in T>(x: T) => void;")).toEqual([
			expect.stringMatching(/variance annotation/u),
		]);
	});

	it("still allows a plain type parameter on a function", () => {
		expect(messages("function f<T>(x: T) {}")).toEqual([]);
	});
});

describe("parameter properties", () => {
	it("allows one in a constructor implementation", () => {
		expect(
			messages("class C { constructor(private x: number) {} }"),
		).toEqual([]);
	});

	it("allows readonly, optional, and defaulted forms", () => {
		expect(
			messages(
				"class C { constructor(readonly a: number, private b?: number, protected c = 1) {} }",
			),
		).toEqual([]);
	});

	it("reports one on an ordinary method", () => {
		expect(messages("class C { m(private x: number) {} }")).toEqual([
			expect.stringMatching(/only appear in a constructor/u),
		]);
	});

	it("reports one on a plain function", () => {
		expect(messages("function f(private x: number) {}")).toEqual([
			expect.stringMatching(/only appear in a constructor/u),
		]);
	});

	/*
	 * A parameter property is an assignment the constructor performs, and a
	 * signature performs nothing.
	 */
	it("reports one on a constructor overload signature", () => {
		expect(
			messages(
				"class C { constructor(private x: number); constructor(x: number) {} }",
			),
		).toEqual([expect.stringMatching(/only appear in a constructor/u)]);
	});

	it("reports one in an ambient class", () => {
		expect(
			messages("declare class C { constructor(private x: number); }"),
		).toEqual([expect.stringMatching(/only appear in a constructor/u)]);
	});

	it("reports one on a rest parameter", () => {
		expect(
			messages("class C { constructor(private ...x: number[]) {} }"),
		).toEqual([expect.stringMatching(/may not be a rest parameter/u)]);
	});

	it("reports one on an object binding pattern", () => {
		expect(
			messages("class C { constructor(private { x }: any) {} }"),
		).toEqual([expect.stringMatching(/may not use a binding pattern/u)]);
	});

	it("reports one on an array binding pattern", () => {
		expect(
			messages("class C { constructor(private [x]: any) {} }"),
		).toEqual([expect.stringMatching(/may not use a binding pattern/u)]);
	});
});

describe("empty type lists", () => {
	it("reports an empty type parameter list", () => {
		expect(messages("function f<>() {}")).toEqual([
			expect.stringMatching(/type parameter list may not be empty/u),
		]);
	});

	it("reports an empty type argument list", () => {
		expect(messages("const x = f<>();")).toEqual([
			expect.stringMatching(/type argument list may not be empty/u),
		]);
	});

	it("reports an empty type parameter list on a class", () => {
		expect(messages("class C<> {}")).toEqual([
			expect.stringMatching(/type parameter list may not be empty/u),
		]);
	});

	it("still allows lists with entries", () => {
		expect(messages("function f<T>() {}\nconst x = f<number>();")).toEqual(
			[],
		);
	});
});

describe("a class outside its body", () => {
	/*
	 * The type parameters, the heritage clause's type arguments, and the
	 * `implements` list all sit outside the class body, which the walk
	 * descends into separately. Until they were visited too, none of them
	 * was examined at all.
	 */
	it("rejects class type parameters under dialect js", () => {
		expect(messages("class C<T> {}", { dialect: "js" })[0]).toMatch(
			/not allowed when the dialect is "js"/u,
		);
	});

	it("rejects an implements clause under dialect js", () => {
		expect(
			messages("class C implements I {}", { dialect: "js" })[0],
		).toMatch(/not allowed when the dialect is "js"/u);
	});

	it("rejects heritage type arguments under dialect js", () => {
		expect(
			messages("class C extends B<T> {}", { dialect: "js" })[0],
		).toMatch(/not allowed when the dialect is "js"/u);
	});

	it("still allows all three under dialect ts", () => {
		expect(
			messages("class C<T> extends B<T> implements I {}"),
		).toEqual([]);
	});
});

describe("enum member names", () => {
	it("allows identifier and string names", () => {
		expect(messages("enum E { A = 1, B, 'a b' = 2 }")).toEqual([]);
	});

	it("reports a computed name", () => {
		expect(messages("enum E { [x] = 1 }")).toEqual([
			expect.stringMatching(/may not be computed/u),
		]);
	});

	/*
	 * An enum keeps a reverse mapping from value to name, which a numeric
	 * name would collide with.
	 */
	it("reports a numeric name", () => {
		expect(messages("enum E { 1 = 2 }")).toEqual([
			expect.stringMatching(/numeric name/u),
		]);
	});
});

describe("object literal methods", () => {
	it("allows a method with a body", () => {
		expect(messages("const o = { m() {} };")).toEqual([]);
	});

	it("reports a method without one", () => {
		expect(messages("const o = { m() };")).toEqual([
			expect.stringMatching(/must have a body/u),
		]);
	});
});

describe("class declaration names", () => {
	it("allows a named class declaration", () => {
		expect(messages("class C {}")).toEqual([]);
	});

	it("allows an unnamed default export", () => {
		expect(messages("export default class {}")).toEqual([]);
	});

	it("reports an unnamed class declaration", () => {
		expect(messages("class {}")).toEqual([
			expect.stringMatching(/must have a name/u),
		]);
	});

	it("still allows an unnamed class expression", () => {
		expect(messages("const C = class {};")).toEqual([]);
	});
});

describe("decorators on overloads", () => {
	it("allows a decorator on an implementation", () => {
		expect(messages("class C { @dec m() {} }")).toEqual([]);
	});

	it("reports one on an overload signature", () => {
		expect(messages("class C { @dec m(); m() {} }")).toEqual([
			expect.stringMatching(/overload signature/u),
		]);
	});

	it("still allows an undecorated overload set", () => {
		expect(messages("class C { m(): void; m() {} }")).toEqual([]);
	});
});

describe("import meta-properties and type-only imports", () => {
	it("allows import.meta", () => {
		expect(messages("import.meta;")).toEqual([]);
	});

	it("reports any other import meta-property", () => {
		expect(messages("import.foo;")).toEqual([
			expect.stringMatching(/no meta-property but 'import.meta'/u),
		]);
	});

	it("allows a type-only default or named import alone", () => {
		expect(
			messages(
				"import type A from 'm';\nimport type { B } from 'n';",
			),
		).toEqual([]);
	});

	it("allows both on an ordinary import", () => {
		expect(messages("import A, { B } from 'm';")).toEqual([]);
	});

	it("reports both on a type-only import", () => {
		expect(messages("import type A, { B } from 'm';")).toEqual([
			expect.stringMatching(/but not both/u),
		]);
	});
});

describe("namespace names", () => {
	it("allows an identifier name", () => {
		expect(messages("namespace N {}")).toEqual([]);
	});

	/*
	 * `declare module "m"` names another file, which is why a string stands
	 * there. A namespace names a binding in this one.
	 */
	it("allows a string name on a module declaration", () => {
		expect(messages("declare module 'n' {}")).toEqual([]);
	});

	it("reports a string name on a namespace", () => {
		expect(messages("namespace 'n' {}")).toEqual([
			expect.stringMatching(/may not be named by a string/u),
		]);
	});
});
