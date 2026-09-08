/**
 * @fileoverview Tests for `parse()`'s `dialect` option — the third place two
 * readings of the same text are both valid, after `sourceType` and `jsx`.
 *
 * `f<A, B>(a + b)` is a call with explicit type arguments in TypeScript and
 * the two comparisons `(f < A)` and `(B > (a + b))` in JavaScript. No tree
 * stands for both, so phase one has to be told which language it is reading.
 */

import { describe, expect, it } from "vitest";
import { parse, toAST, validate } from "../../src/index.js";
import type { ExpressionStatement, Node } from "../../src/index.js";

/**
 * Reduces the first expression of a program to a compact shape string, so a
 * test can state the tree it expects on one line.
 * @param code The source text to parse.
 * @param dialect Which language phase one should read the text as.
 * @returns The shape of the first statement's expression.
 */
function shape(code: string, dialect: "js" | "ts"): string {
	const ast = toAST(parse(code, { dialect }), { dialect });
	const statement = ast.body[0];

	if (statement.type !== "ExpressionStatement") {
		throw new TypeError(`${code} is not an expression statement.`);
	}

	/**
	 * Walks one node.
	 * @param node The node to describe.
	 * @returns Its shape.
	 */
	function describeNode(node: Node): string {
		switch (node.type) {
			case "Identifier":
				return node.name;

			case "Literal":
				return String(node.value);

			case "BinaryExpression":
				return `(${describeNode(node.left)} ${node.operator} ${describeNode(node.right)})`;

			case "SequenceExpression":
				return `seq[${node.expressions.map(describeNode).join(", ")}]`;

			case "CallExpression":
				return `call(${describeNode(node.callee)}${node.typeArguments ? "<>" : ""})`;

			case "NewExpression":
				return `new(${describeNode(node.callee)}${node.typeArguments ? "<>" : ""})`;

			case "TaggedTemplateExpression":
				return `tag(${describeNode(node.tag)}${node.typeArguments ? "<>" : ""})`;

			case "TSInstantiationExpression":
				return `inst(${describeNode(node.expression)}<>)`;

			default:
				return node.type;
		}
	}

	return describeNode(statement.expression);
}

describe("the dialect option", () => {
	describe("reads an ambiguous `<` as the named language does", () => {
		const cases: [string, string, string][] = [
			// [source, the JavaScript reading, the TypeScript reading]
			[
				"f < A , B > ( a + b )",
				"seq[(f < A), (B > (a + b))]",
				"call(f<>)",
			],
			["f < A > ( b )", "((f < A) > b)", "call(f<>)"],
			["f < 1 , 2 > ( 3 )", "seq[(f < 1), (2 > 3)]", "call(f<>)"],
			["f < A > `t`", "((f < A) > TemplateLiteral)", "tag(f<>)"],
			["new f < A > ( c )", "((new(f) < A) > c)", "new(f<>)"],
			["new f < A , B > ( c )", "seq[(new(f) < A), (B > c)]", "new(f<>)"],
		];

		for (const [code, js, ts] of cases) {
			it(`reads ${JSON.stringify(code)} as JavaScript`, () => {
				expect(shape(code, "js")).toBe(js);
			});

			it(`reads ${JSON.stringify(code)} as TypeScript`, () => {
				expect(shape(code, "ts")).toBe(ts);
			});
		}
	});

	describe("agrees with itself where the text is not ambiguous", () => {
		/*
		 * Nothing that can continue a call follows the `>`, so the type
		 * arguments cannot be what was meant and both dialects read
		 * comparisons. These are the cases that were already right, and the
		 * ones that prove `"ts"` narrows nothing on its own.
		 */
		const cases: [string, string][] = [
			["f < A , B > c", "seq[(f < A), (B > c)]"],
			["a < b , c > d", "seq[(a < b), (c > d)]"],
			["new f < A > c", "((new(f) < A) > c)"],
			["new f < A , B > c", "seq[(new(f) < A), (B > c)]"],
		];

		for (const [code, expected] of cases) {
			it(`reads ${JSON.stringify(code)} the same either way`, () => {
				expect(shape(code, "js")).toBe(expected);
				expect(shape(code, "ts")).toBe(expected);
			});
		}
	});

	it("defaults to the TypeScript reading", () => {
		const statement = toAST(parse("f < A , B > ( a + b )")).body[0];

		expect(statement.type).toBe("ExpressionStatement");
		expect((statement as ExpressionStatement).expression.type).toBe(
			"CallExpression",
		);
	});

	it("leaves unambiguous TypeScript syntax to validate()", () => {
		/*
		 * `dialect: "js"` decides one ambiguity; it does not turn phase one
		 * into a JavaScript-only parser. A type annotation still parses, and
		 * phase two is still the one to say it was not allowed.
		 */
		const result = parse("let x: number = 1;", { dialect: "js" });
		const problems = validate(result, { dialect: "js" });

		expect(problems.length).toBeGreaterThan(0);
		expect([...new Set(problems.map(problem => problem.message))]).toEqual([
			'TypeScript syntax is not allowed when the dialect is "js".',
		]);
	});

	it("reports no problem for a comparison chain read as JavaScript", () => {
		/*
		 * The regression this option exists for: read as TypeScript, the
		 * three identifiers become type references and phase two reports
		 * three problems against a program that is valid JavaScript.
		 */
		const code = "console.log(f < A , B > ( a + b ));";

		expect(
			validate(parse(code, { dialect: "js" }), { dialect: "js" }),
		).toEqual([]);
		expect(
			validate(parse(code, { dialect: "ts" }), { dialect: "ts" }),
		).toEqual([]);
	});
});
