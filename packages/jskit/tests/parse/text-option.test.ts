/**
 * @fileoverview The `text` option: reading a buffer that was parsed without
 * `{ source: true }` outside the process that parsed it, by handing the
 * consumer the original program.
 *
 * A transferred or persisted buffer is simulated with `slice(0)` — a copy is
 * a different object, so the in-process source cache misses, which is exactly
 * what a buffer looks like after any real crossing.
 */

import { describe, expect, it } from "vitest";
import { parse, toAST, validate } from "../../src/index.js";

const CODE = "const answer = 42; { const answer = 1; }";

/**
 * Parses the program without embedding its text and hands back a copy the
 * cache cannot reach.
 * @param code The source text.
 * @returns The foreign buffer.
 */
function foreign(code: string): ArrayBuffer {
	return parse(code, { tokens: true }).slice(0);
}

describe("toAST({ text })", () => {
	it("decodes a foreign, text-less buffer", () => {
		const program = toAST(foreign(CODE), { text: CODE });

		expect(program.body[0].type).toBe("VariableDeclaration");
		expect(program.tokens?.[1].value).toBe("answer");
	});

	it("throws without the text", () => {
		expect(() => toAST(foreign(CODE))).toThrow(/carries no source text/u);
	});

	it("refuses text of the wrong length", () => {
		expect(() => toAST(foreign(CODE), { text: `${CODE} ` })).toThrow(
			/exact source/u,
		);
	});
});

describe("validate({ text })", () => {
	it("validates a foreign, text-less buffer", () => {
		// The redeclaration check reads names, so it needs the text.
		const problems = validate(foreign("let a; let a;"), {
			text: "let a; let a;",
		});

		expect(problems).toHaveLength(1);
		expect(problems[0].message).toMatch(/already been declared/u);
	});

	it("refuses text of the wrong length", () => {
		expect(() => validate(foreign(CODE), { text: `${CODE} ` })).toThrow(
			/exact source/u,
		);
	});
});
