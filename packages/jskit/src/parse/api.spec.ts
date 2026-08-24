/**
 * @fileoverview Unit tests for the parts of the public entry points that
 * nothing else reaches.
 *
 * `parse()`, `validate()`, and `toAST()` are covered from end to end by the
 * conformance suites and by `tests/parse/`. `tokenStartsLine()` is the one
 * export with no consumer inside the package: the ESLint parser object builds
 * its token list through `decodeTokens()` instead, so this is the only place
 * the flag is read back through the documented function.
 */

import { describe, expect, it } from "vitest";
import { parse, tokenStartsLine } from "./api.js";
import { TokenReader } from "./reader.js";

/**
 * Parses a program and hands back a reader over its tokens.
 * @param code The source text.
 * @returns The token reader.
 */
function tokensOf(code: string): TokenReader {
	return new TokenReader(parse(code, { tokens: true }));
}

describe("tokenStartsLine()", () => {
	it("reports the first token on each line and nothing else", () => {
		const reader = tokensOf("a;\nb;\nc;");
		const flags: boolean[] = [];

		for (let index = 0; index < reader.count; index++) {
			flags.push(tokenStartsLine(reader, index));
		}

		// The very first token has nothing before it, so no newline precedes it.
		expect(flags[0]).toBe(false);
		expect(flags.filter(Boolean)).toHaveLength(2);
	});

	it("reports false throughout a program written on one line", () => {
		const reader = tokensOf("a; b; c;");

		for (let index = 0; index < reader.count; index++) {
			expect(tokenStartsLine(reader, index)).toBe(false);
		}
	});

	it("counts every line terminator, not just `\\n`", () => {
		for (const terminator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
			const reader = tokensOf(`a;${terminator}b;`);
			const starts: number[] = [];

			for (let index = 0; index < reader.count; index++) {
				if (tokenStartsLine(reader, index)) {
					starts.push(index);
				}
			}

			expect(starts).toHaveLength(1);
		}
	});

	it("counts a newline inside a comment as preceding the token after it", () => {
		const reader = tokensOf("a; /* \n */ b;");
		let found = false;

		for (let index = 0; index < reader.count; index++) {
			found ||= tokenStartsLine(reader, index);
		}

		expect(found).toBe(true);
	});
});
