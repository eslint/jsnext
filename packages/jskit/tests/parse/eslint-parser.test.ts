/**
 * @fileoverview Tests for the ESLint-compatible parser object.
 */

import { Linter } from "eslint";
import * as espree from "espree";
import { describe, expect, it } from "vitest";
import { ParseError, eslintParser, parse, toAST } from "../../src/index.js";

/**
 * Lints a source text with the parser wired into ESLint.
 * @param code The source text to lint.
 * @param filename The name ESLint should treat the file as having.
 * @param rules The rules to run, if any.
 * @returns Every message ESLint produced.
 */
function lint(
	code: string,
	filename = "file.ts",
	rules: Record<string, string> = {},
): Linter.LintMessage[] {
	return new Linter().verify(
		code,
		[
			{
				files: ["**/*.js", "**/*.ts", "**/*.tsx"],
				languageOptions: { parser: eslintParser },
				rules,
			},
		],
		filename,
	) as Linter.LintMessage[];
}

describe("eslintParser.parse()", () => {
	it("returns the Program node directly", () => {
		const ast = eslintParser.parse("const a = 1;");

		expect(ast.type).toBe("Program");
		expect(ast.sourceType).toBe("module");
		expect((ast.body as unknown[]).length).toBe(1);
	});

	it("puts range and loc on every node", () => {
		const ast = eslintParser.parse("const a = 1;");
		const declaration = (ast.body as Record<string, unknown>[])[0];

		expect(declaration.range).toEqual([0, 12]);
		expect(declaration.loc).toEqual({
			start: { line: 1, column: 0 },
			end: { line: 1, column: 12 },
		});
	});

	it("puts range and loc on tokens and comments", () => {
		const ast = eslintParser.parse("// hi\nlet a;");
		const tokens = ast.tokens as Record<string, unknown>[];
		const comments = ast.comments as Record<string, unknown>[];

		expect(tokens[0].range).toEqual([6, 9]);
		expect(tokens[0].loc).toEqual({
			start: { line: 2, column: 0 },
			end: { line: 2, column: 3 },
		});
		expect(comments[0].range).toEqual([0, 5]);
		expect(comments[0].loc).toEqual({
			start: { line: 1, column: 0 },
			end: { line: 1, column: 5 },
		});
	});

	it("makes range and loc plain properties, as espree does", () => {
		const ast = eslintParser.parse("const a = 1;");
		const keys = Object.keys(
			(ast.body as Record<string, unknown>[])[0],
		);

		expect(keys).toContain("range");
		expect(keys).toContain("loc");
	});

	it("leaves range and loc off the AST that toAST() returns", () => {
		const { ast } = toAST(parse("const a = 1;"));

		expect(ast.range).toBeUndefined();
		expect(ast.loc).toBeUndefined();
		expect(
			(ast.body as Record<string, unknown>[])[0].range,
		).toBeUndefined();
	});

	it("throws a positioned error for a syntax error", () => {
		expect(() => eslintParser.parse("const a =\n  ;")).toThrow(ParseError);

		try {
			eslintParser.parse("const a =\n  ;");
		} catch (error) {
			expect((error as ParseError).lineNumber).toBe(2);
			expect((error as ParseError).column).toBe(3);
		}
	});

	it("throws a positioned error for a validation problem", () => {
		try {
			eslintParser.parse("let x;\nlet x;");
			expect.unreachable("should have thrown");
		} catch (error) {
			expect((error as ParseError).message).toMatch(
				/already been declared/u,
			);
			expect((error as ParseError).lineNumber).toBe(2);
			expect((error as ParseError).column).toBe(5);
		}
	});

	it("takes the dialect from the file name", () => {
		expect(() =>
			eslintParser.parse("let a: number;", { filePath: "a.ts" }),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("let a: number;", { filePath: "a.js" }),
		).toThrow(/dialect is "js"/u);
	});

	it("takes JSX from the file name", () => {
		expect(() =>
			eslintParser.parse("<div/>;", { filePath: "a.tsx" }),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("<div/>;", { filePath: "a.jsx" }),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("<div/>;", { filePath: "a.js" }),
		).toThrow(/JSX syntax is not allowed/u);
	});

	it("lets an explicit ecmaFeatures.jsx option win over the file name", () => {
		expect(() =>
			eslintParser.parse("<div/>;", {
				filePath: "a.js",
				ecmaFeatures: { jsx: true },
			}),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("<div/>;", {
				filePath: "a.jsx",
				ecmaFeatures: { jsx: false },
			}),
		).toThrow(/JSX syntax is not allowed/u);
	});

	it("falls back to the file name when ecmaFeatures omits jsx", () => {
		expect(() =>
			eslintParser.parse("<div/>;", {
				filePath: "a.jsx",
				ecmaFeatures: {},
			}),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("<div/>;", {
				filePath: "a.js",
				ecmaFeatures: {},
			}),
		).toThrow(/JSX syntax is not allowed/u);
	});

	it("takes ambience from the file name", () => {
		expect(() =>
			eslintParser.parse("export const a: number;", {
				filePath: "a.d.ts",
			}),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("export const a: number;", {
				filePath: "a.d.mts",
			}),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("export const a: number;", {
				filePath: "a.ts",
			}),
		).toThrow(/Missing initializer/u);
	});

	it("lets an explicit declaration option win over the file name", () => {
		expect(() =>
			eslintParser.parse("export const a: number;", {
				filePath: "a.ts",
				declaration: true,
			}),
		).not.toThrow();
		expect(() =>
			eslintParser.parse("export const a: number;", {
				filePath: "a.d.ts",
				declaration: false,
			}),
		).toThrow(/Missing initializer/u);
	});

	it("lets an explicit dialect win over the file name", () => {
		expect(() =>
			eslintParser.parse("let a: number;", {
				filePath: "a.js",
				dialect: "ts",
			}),
		).not.toThrow();
	});

	it("honors the source type ESLint passes", () => {
		expect(() =>
			eslintParser.parse("import a from 'b';", { sourceType: "script" }),
		).toThrow(/'import'/u);
	});
});

describe("eslintParser inside ESLint", () => {
	it("lints a TypeScript file without complaint", () => {
		expect(lint("export const a: number = 1;")).toEqual([]);
	});

	it("lints a JSX file without complaint", () => {
		expect(lint("export const a = <div x={1}>hi</div>;", "file.tsx")).toEqual(
			[],
		);
	});

	it("reports a syntax error as a fatal message", () => {
		const messages = lint("const a =\n  ;");

		expect(messages).toHaveLength(1);
		expect(messages[0].fatal).toBe(true);
		expect(messages[0].line).toBe(2);
		expect(messages[0].column).toBe(3);
	});

	it("reports TypeScript syntax in a .js file", () => {
		const messages = lint("const a: number = 1;", "file.js");

		expect(messages[0].fatal).toBe(true);
		expect(messages[0].message).toMatch(/dialect is "js"/u);
	});

	it("reports JSX in a file that is not a .jsx or .tsx file", () => {
		const messages = lint("const a = <div/>;", "file.js");

		expect(messages[0].fatal).toBe(true);
		expect(messages[0].message).toMatch(/JSX syntax is not allowed/u);
	});

	it("reports what espree reports, down to the fix range", () => {
		const code = "if (a == null) { b(); }";
		const rules = { eqeqeq: "error" };
		const run = (parser: unknown): Linter.LintMessage[] =>
			new Linter().verify(
				code,
				[
					{
						files: ["**/*.js"],
						languageOptions: {
							parser: parser as Linter.Parser,
							ecmaVersion: "latest",
						},
						rules,
					},
				],
				"file.js",
			) as Linter.LintMessage[];

		expect(run(eslintParser)).toEqual(run(espree));
	});

	it("supports scope analysis, which rules depend on", () => {
		const messages = lint("function f() { var unused = 1; }\nf();", "f.js", {
			"no-unused-vars": "error",
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].message).toMatch(/'unused' is assigned/u);
	});
});
