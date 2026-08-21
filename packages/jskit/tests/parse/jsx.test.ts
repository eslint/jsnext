/**
 * @fileoverview Tests for the JSX-specific parts of the scanner and parser.
 */

import { describe, expect, it } from "vitest";
import { parse, toAST, validate } from "../../src/index.js";

/**
 * Collects the reported type and value of every token.
 * @param code The source text to tokenize.
 * @returns One `type:value` string per token.
 */
function types(code: string): string[] {
	const { ast } = toAST(parse(code), {
		sourceType: "module",
		dialect: "js",
		jsx: true,
	});

	return (ast.tokens as { type: string; value: string }[]).map(
		token => `${token.type}:${token.value}`,
	);
}

/**
 * Parses a source text and returns the first expression.
 * @param code The source text to parse.
 * @returns The expression of the first statement.
 */
function firstExpression(code: string): Record<string, unknown> {
	const { ast } = toAST(parse(code), {
		sourceType: "module",
		dialect: "js",
		jsx: true,
	});

	return (ast.body as Record<string, unknown>[])[0].expression as Record<
		string,
		unknown
	>;
}

describe("JSX scanning", () => {
	it("reads child text as a single token", () => {
		expect(types("<div>a + b</div>;")).toEqual([
			"Punctuator:<",
			"JSXIdentifier:div",
			"Punctuator:>",
			"JSXText:a + b",
			"Punctuator:<",
			"Punctuator:/",
			"JSXIdentifier:div",
			"Punctuator:>",
			"Punctuator:;",
		]);
	});

	it("allows a dash inside a JSX name", () => {
		expect(types("<foo-bar data-x/>;")).toContain("JSXIdentifier:foo-bar");
		expect(types("<foo-bar data-x/>;")).toContain("JSXIdentifier:data-x");
	});

	it("reads a quoted attribute value without processing escapes", () => {
		const attribute = (
			firstExpression(String.raw`<div a="x\ny"/>;`)
				.openingElement as Record<string, unknown>
		).attributes as Record<string, unknown>[];
		const value = attribute[0].value as Record<string, unknown>;

		expect(value.value).toBe(String.raw`x\ny`);
		expect(value.raw).toBe(String.raw`"x\ny"`);
	});

	it("resolves entity references in text and attribute values", () => {
		const element = firstExpression('<div a="&amp;">&#65;&#x42;</div>;');
		const attribute = (
			(element.openingElement as Record<string, unknown>)
				.attributes as Record<string, unknown>[]
		)[0];

		expect(
			(attribute.value as Record<string, unknown>).value as string,
		).toBe("&");
		expect(
			(element.children as Record<string, unknown>[])[0].value as string,
		).toBe("AB");
	});

	it("leaves an incomplete entity reference alone", () => {
		const element = firstExpression("<div>&notreal; x</div>;");

		expect((element.children as Record<string, unknown>[])[0].value).toBe(
			"&notreal; x",
		);
	});

	it("does not read a closing tag's slash as a regular expression", () => {
		expect(() => parse("<div>a</div>;")).not.toThrow();
	});

	it("keeps division working outside JSX", () => {
		expect(types("a / b;")).toEqual([
			"Identifier:a",
			"Punctuator:/",
			"Identifier:b",
			"Punctuator:;",
		]);
	});
});

describe("JSX parsing", () => {
	it("parses a self-closing element", () => {
		const element = firstExpression("<br/>;");

		expect(element.type).toBe("JSXElement");
		expect(
			(element.openingElement as Record<string, unknown>).selfClosing,
		).toBe(true);
		expect(element.closingElement).toBeNull();
	});

	it("parses a fragment", () => {
		const fragment = firstExpression("<>text</>;");

		expect(fragment.type).toBe("JSXFragment");
		expect(fragment.children).toHaveLength(1);
	});

	it("parses a namespaced name", () => {
		const element = firstExpression("<a:b/>;");

		expect(
			(element.openingElement as Record<string, unknown>).name,
		).toMatchObject({ type: "JSXNamespacedName" });
	});

	it("parses a dotted name", () => {
		const element = firstExpression("<A.B.C/>;");

		expect(
			(element.openingElement as Record<string, unknown>).name,
		).toMatchObject({ type: "JSXMemberExpression" });
	});

	it("parses an empty expression container", () => {
		const element = firstExpression("<div>{}</div>;");
		const container = (element.children as Record<string, unknown>[])[0];

		expect(container.type).toBe("JSXExpressionContainer");
		expect((container.expression as Record<string, unknown>).type).toBe(
			"JSXEmptyExpression",
		);
	});

	it("parses nested elements inside a container", () => {
		const element = firstExpression("<ul>{items.map(i => <li/>)}</ul>;");

		expect(element.children).toHaveLength(1);
	});

	it("still parses an old-style type assertion when JSX does not fit", () => {
		const { ast } = toAST(parse("const a = <string>b;"), {
			dialect: "ts",
		});
		const declaration = (ast.body as Record<string, unknown>[])[0];
		const init = (
			(declaration.declarations as Record<string, unknown>[])[0]
				.init as Record<string, unknown>
		).type;

		expect(init).toBe("TSTypeAssertion");
	});

	it("reports the JSX problem when an element is unterminated", () => {
		expect(() => parse("<div a={1}>text")).toThrow(
			/Unterminated JSX element/u,
		);
	});

	it("reports a mismatched closing tag during validation", () => {
		const problems = validate(parse("<div>{x}</span>;"), { jsx: true });

		expect(problems).toEqual([
			{
				message: "JSX element <div> is closed by </span>.",
				lineNumber: 1,
				column: 9,
			},
		]);
	});

	it("accepts a matching pair", () => {
		expect(validate(parse("<A.B>{x}</A.B>;"), { jsx: true })).toEqual([]);
	});

	it("falls back to a type assertion when JSX cannot fit", () => {
		/*
		 * `<div>text` is an unterminated element, but it is also a perfectly
		 * good type assertion, so that is what it becomes. Asking for the
		 * JavaScript dialect is what turns it back into a reported problem.
		 */
		const result = parse("<div>text");

		expect(toAST(result, { dialect: "ts" }).ast.body).toMatchObject([
			{ expression: { type: "TSTypeAssertion" } },
		]);
		expect(validate(result, { dialect: "js" })).not.toHaveLength(0);
	});

	it("keeps both names when a closing tag does not match", () => {
		const element = firstExpression("<a></b>;");

		expect(
			(element.closingElement as Record<string, unknown>).name,
		).toMatchObject({ name: "b" });
	});
});
