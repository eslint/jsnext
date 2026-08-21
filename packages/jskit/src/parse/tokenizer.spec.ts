/**
 * @fileoverview Unit tests for the scanner.
 *
 * The parser drives the tokenizer over well-formed programs, so the corpus
 * covers the common path thoroughly and barely touches the rest: `\r\n` line
 * endings, a byte order mark, an unterminated string, an escape that is not
 * one. Those are what this file is for, along with the operators the parser
 * happens to reach by another route.
 */

import { describe, expect, it } from "vitest";
import {
	TF_HAS_ESCAPE,
	TF_INVALID_ESCAPE,
	TF_NEWLINE_BEFORE,
	TOKEN_END,
	TOKEN_KIND_FLAGS,
	TOKEN_START,
} from "./binary.js";
import { ParseError } from "./errors.js";
import {
	T_ASSIGN_AMP,
	T_ASSIGN_CARET,
	T_ASSIGN_MINUS,
	T_ASSIGN_PERCENT,
	T_ASSIGN_PIPE,
	T_ASSIGN_SAR,
	T_ASSIGN_SHL,
	T_ASSIGN_SHR,
	T_ASSIGN_SLASH,
	T_ASSIGN_STAR,
	T_BLOCK_COMMENT,
	T_EOF,
	T_HASHBANG,
	T_IDENT,
	T_LINE_COMMENT,
	T_LT_EQ,
	T_NOT_EQ,
	T_NUMBER,
	T_PRIVATE_IDENT,
	T_REGEXP,
	T_STRING,
	T_TEMPLATE_FULL,
	T_TEMPLATE_HEAD,
	T_TEMPLATE_TAIL,
	T_ARROW,
	T_PAREN_OPEN,
} from "./token-kinds.js";
import { Tokenizer } from "./tokenizer.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/** How many words one token record occupies. */
const TOKEN_WORDS = 4;

/** One token as a test reads it. */
interface Scanned {
	kind: number;
	start: number;
	end: number;
	flags: number;
	text: string;
}

/**
 * Reads a token off a tokenizer.
 * @param tokenizer The tokenizer to read from.
 * @returns The current token.
 */
function current(tokenizer: Tokenizer): Scanned {
	return {
		kind: tokenizer.kind,
		start: tokenizer.start,
		end: tokenizer.end,
		flags: tokenizer.flags,
		text: tokenizer.source.slice(tokenizer.start, tokenizer.end),
	};
}

/**
 * Scans a whole source text.
 * @param source The text to scan.
 * @param isModule Whether to read it as an ES module.
 * @returns Every token up to and including the one at end of input.
 */
function scanAll(source: string, isModule = true): Scanned[] {
	const tokenizer = new Tokenizer(source, isModule);
	const tokens: Scanned[] = [];

	do {
		tokenizer.next();
		tokens.push(current(tokenizer));
	} while (tokenizer.kind !== T_EOF);

	return tokens;
}

/**
 * Reads back the token records the scanner wrote, which is the only place a
 * comment appears: `next()` skips trivia rather than surfacing it.
 * @param source The text to scan.
 * @param isModule Whether to read it as an ES module.
 * @returns Every record written, comments included.
 */
function recordedAll(source: string, isModule = true): Scanned[] {
	const tokenizer = new Tokenizer(source, isModule);

	do {
		tokenizer.next();
	} while (tokenizer.kind !== T_EOF);

	const records: Scanned[] = [];
	const words = tokenizer.records.words;

	for (let i = 0; i < tokenizer.count; i++) {
		const base = i * TOKEN_WORDS;

		records.push({
			kind: words[base + TOKEN_KIND_FLAGS] & 0xffff,
			start: words[base + TOKEN_START],
			end: words[base + TOKEN_END],
			flags: words[base + TOKEN_KIND_FLAGS] >>> 16,
			text: source.slice(
				words[base + TOKEN_START],
				words[base + TOKEN_END],
			),
		});
	}

	return records;
}

/**
 * Scans the first token of a source text.
 * @param source The text to scan.
 * @returns The token.
 */
function scanFirst(source: string): Scanned {
	const tokenizer = new Tokenizer(source);

	tokenizer.next();

	return current(tokenizer);
}

/**
 * The kinds a source text scans into, without the one at end of input.
 * @param source The text to scan.
 * @returns The kinds.
 */
function kinds(source: string): number[] {
	return scanAll(source)
		.slice(0, -1)
		.map(token => token.kind);
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("Tokenizer", () => {
	describe("the start of the text", () => {
		it("skips a byte order mark", () => {
			expect(scanFirst("\uFEFFa")).toMatchObject({
				kind: T_IDENT,
				start: 1,
				end: 2,
			});
		});

		it("records a hashbang comment", () => {
			const [first] = recordedAll("#!/usr/bin/env node\na");

			expect(first).toMatchObject({
				kind: T_HASHBANG,
				text: "#!/usr/bin/env node",
			});
		});

		it("ends a hashbang comment at any line terminator", () => {
			for (const terminator of ["\n", "\r", "\u2028", "\u2029"]) {
				const tokenizer = new Tokenizer(`#!x${terminator}a`);

				tokenizer.next();

				expect(current(tokenizer)).toMatchObject({ text: "a" });
			}
		});

		it("runs a hashbang comment to the end of a text with no newline", () => {
			const tokenizer = new Tokenizer("#!x");

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_EOF);
		});

		it("refuses a `#` that does not begin a private name", () => {
			expect(() => scanAll("# a")).toThrow(/Unexpected character '#'/u);
			expect(() => scanAll("#1")).toThrow(/Unexpected character '#'/u);
			expect(() => scanAll("#é")).toMatchObject({});
		});

		it("scans a private name", () => {
			expect(scanFirst("#a")).toMatchObject({
				kind: T_PRIVATE_IDENT,
				text: "#a",
			});
		});
	});

	describe("line terminators", () => {
		it("counts `\\r\\n` as one line", () => {
			const tokenizer = new Tokenizer("a\r\nb");

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.lineCount).toBe(2);
			expect(tokenizer.flags & TF_NEWLINE_BEFORE).not.toBe(0);
		});

		it("counts a bare `\\r` as a line", () => {
			const tokenizer = new Tokenizer("a\rb");

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.lineCount).toBe(2);
		});

		it("counts the Unicode line separators as lines", () => {
			const tokenizer = new Tokenizer("a\u2028b\u2029c");

			tokenizer.next();
			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.lineCount).toBe(3);
			expect(tokenizer.flags & TF_NEWLINE_BEFORE).not.toBe(0);
		});

		it("grows its line table past the size it started with", () => {
			const lines = 500;
			const tokenizer = new Tokenizer("\n".repeat(lines) + "a");

			tokenizer.next();

			expect(tokenizer.lineCount).toBe(lines + 1);
			expect(tokenizer.kind).toBe(T_IDENT);
		});
	});

	describe("whitespace and comments", () => {
		it("skips the non-ASCII spaces", () => {
			expect(scanFirst("\u00A0\u3000a")).toMatchObject({ kind: T_IDENT });
		});

		it("records a line comment ended by each line terminator", () => {
			for (const terminator of ["\n", "\r", "\u2028", "\u2029"]) {
				expect(recordedAll(`// c${terminator}a`)[0]).toMatchObject({
					kind: T_LINE_COMMENT,
					text: "// c",
				});
			}
		});

		it("runs a line comment to the end of a text with no newline", () => {
			expect(recordedAll("// c")[0]).toMatchObject({
				kind: T_LINE_COMMENT,
				text: "// c",
			});
		});

		it("records a block comment and the newlines inside it", () => {
			expect(recordedAll("/* a */x")[0]).toMatchObject({
				kind: T_BLOCK_COMMENT,
				text: "/* a */",
			});

			const tokenizer = new Tokenizer("/* a\r\nb\rc\u2028 */x");

			tokenizer.next();

			expect(tokenizer.lineCount).toBe(4);
			expect(tokenizer.flags & TF_NEWLINE_BEFORE).not.toBe(0);
		});

		it("refuses an unterminated block comment", () => {
			expect(() => scanAll("/* a")).toThrow(/Unterminated comment/u);
		});

		it("reads Annex B's HTML-like comments in a script and not in a module", () => {
			expect(recordedAll("<!-- c\na", false)[0]).toMatchObject({
				kind: T_LINE_COMMENT,
				text: "<!-- c",
			});
			expect(recordedAll("a\n--> c\nb", false)[1]).toMatchObject({
				kind: T_LINE_COMMENT,
				text: "--> c",
			});

			// In a module the same text is an operator sequence.
			expect(kinds("<!-- c\na")).not.toContain(T_LINE_COMMENT);
		});
	});

	describe("strings", () => {
		it("scans both quote styles", () => {
			expect(scanFirst('"a"')).toMatchObject({
				kind: T_STRING,
				text: '"a"',
			});
			expect(scanFirst("'a'")).toMatchObject({ kind: T_STRING });
		});

		it("refuses an unterminated string", () => {
			expect(() => scanAll('"a')).toThrow(
				/Unterminated string constant/u,
			);
		});

		it("refuses a string broken by a line terminator", () => {
			expect(() => scanAll('"a\nb"')).toThrow(
				/Unterminated string constant/u,
			);
			expect(() => scanAll('"a\rb"')).toThrow(
				/Unterminated string constant/u,
			);
		});

		it("accepts the Unicode line separators inside a string", () => {
			expect(scanFirst('"a\u2028b"')).toMatchObject({ kind: T_STRING });
		});

		it("refuses a string whose escape runs off the end", () => {
			expect(() => scanAll('"a\\')).toThrow(
				/Unterminated string constant/u,
			);
		});

		it("accepts a line continuation, counting the line", () => {
			const tokenizer = new Tokenizer('"a\\\r\nb" c');

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_STRING);
			expect(tokenizer.lineCount).toBe(2);
		});

		it("accepts a line continuation at each line terminator", () => {
			for (const terminator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
				expect(scanFirst(`"a\\${terminator}b"`)).toMatchObject({
					kind: T_STRING,
				});
			}
		});

		it("marks a string that contains an escape", () => {
			expect(scanFirst('"a\\n"').flags & TF_HAS_ESCAPE).not.toBe(0);
		});

		it("refuses an escape that is not a valid one", () => {
			expect(() => scanAll('"\\u{}"')).toThrow(
				/Invalid escape sequence in string/u,
			);
		});
	});

	describe("templates", () => {
		it("scans a template with no substitution", () => {
			expect(scanFirst("`a`")).toMatchObject({
				kind: T_TEMPLATE_FULL,
				text: "`a`",
			});
		});

		it("refuses an unterminated template", () => {
			expect(() => scanAll("`a")).toThrow(/Unterminated template/u);
		});

		it("refuses a template whose escape runs off the end", () => {
			expect(() => scanAll("`a\\")).toThrow(/Unterminated template/u);
		});

		it("counts the newlines inside a template", () => {
			const tokenizer = new Tokenizer("`a\r\nb\rc\u2028d`");

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_TEMPLATE_FULL);
			expect(tokenizer.lineCount).toBe(4);
		});

		it("marks a bad escape rather than refusing it, since a tag may want the raw text", () => {
			expect(scanFirst("`\\u{}`").flags & TF_INVALID_ESCAPE).not.toBe(0);
			expect(scanFirst("`\\xZZ`").flags & TF_INVALID_ESCAPE).not.toBe(0);
			expect(scanFirst("`\\1`").flags & TF_INVALID_ESCAPE).not.toBe(0);
			expect(scanFirst("`\\00`").flags & TF_INVALID_ESCAPE).not.toBe(0);
			expect(scanFirst("`\\0`").flags & TF_INVALID_ESCAPE).toBe(0);
		});

		it("counts a line continuation inside a template", () => {
			for (const terminator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
				const tokenizer = new Tokenizer(`\`a\\${terminator}b\``);

				tokenizer.next();

				expect(tokenizer.kind).toBe(T_TEMPLATE_FULL);
				expect(tokenizer.lineCount).toBe(2);
			}
		});
	});

	describe("identifiers", () => {
		it("scans an identifier written with a Unicode escape", () => {
			const token = scanFirst("\\u0061bc");

			expect(token.kind).toBe(T_IDENT);
			expect(token.flags & TF_HAS_ESCAPE).not.toBe(0);
		});

		it("scans an identifier with a bracketed escape", () => {
			expect(scanFirst("\\u{61}bc")).toMatchObject({ kind: T_IDENT });
		});

		it("refuses an escape that does not spell an identifier start", () => {
			expect(() => scanAll("\\u0020")).toThrow(
				/Invalid escape sequence in identifier/u,
			);
		});

		it("refuses an escape that does not spell an identifier part", () => {
			expect(() => scanAll("a\\u0020")).toThrow(
				/Invalid escape sequence in identifier/u,
			);
		});

		it("refuses an escape that is not `\\u` at all", () => {
			expect(() => scanAll("\\x61")).toThrow(
				/Invalid escape sequence in identifier/u,
			);
		});

		it("scans a non-ASCII identifier", () => {
			expect(scanFirst("été")).toMatchObject({
				kind: T_IDENT,
				text: "été",
			});
		});
	});

	describe("numbers", () => {
		it("scans the radix prefixes", () => {
			expect(scanFirst("0x1f")).toMatchObject({ kind: T_NUMBER });
			expect(scanFirst("0o17")).toMatchObject({ kind: T_NUMBER });
			expect(scanFirst("0b11")).toMatchObject({ kind: T_NUMBER });
		});

		it("refuses a radix prefix with no digits", () => {
			expect(() => scanAll("0x")).toThrow(/Invalid number/u);
			expect(() => scanAll("0b")).toThrow(/Invalid number/u);
			expect(() => scanAll("0o")).toThrow(/Invalid number/u);
		});

		/*
		 * A `LegacyOctalIntegerLiteral` is `0` and octal digits and nothing
		 * else: no fraction, no exponent, no separator. Everything after the
		 * digits is a token of its own, which is what makes `0123.a` a
		 * property access on the number 83.
		 */
		it("ends a legacy octal literal at its last octal digit", () => {
			expect(scanFirst("0123.a")).toMatchObject({
				kind: T_NUMBER,
				text: "0123",
			});
			expect(scanFirst("0123.5")).toMatchObject({
				kind: T_NUMBER,
				text: "0123",
			});
			expect(() => scanAll("01e2")).toThrow(
				/Identifier directly after number/u,
			);
		});

		/*
		 * An `8` or a `9` in the digits makes it a
		 * `NonOctalDecimalIntegerLiteral`, which is a decimal integer and
		 * takes a fraction and an exponent like any other.
		 */
		it("keeps scanning a leading zero followed by a non-octal digit", () => {
			expect(scanFirst("08.5")).toMatchObject({
				kind: T_NUMBER,
				text: "08.5",
			});
			expect(scanFirst("08e2")).toMatchObject({
				kind: T_NUMBER,
				text: "08e2",
			});
			expect(scanFirst("01238.5")).toMatchObject({
				kind: T_NUMBER,
				text: "01238.5",
			});
		});

		/*
		 * Neither leading-zero production admits a separator or a BigInt
		 * suffix in its digits, so both are the identifier the boundary check
		 * refuses.
		 */
		it("refuses a separator or a BigInt suffix on a leading zero", () => {
			expect(() => scanAll("08_0")).toThrow(
				/Identifier directly after number/u,
			);
			expect(() => scanAll("08n")).toThrow(
				/Identifier directly after number/u,
			);
			expect(() => scanAll("0123n")).toThrow(
				/Identifier directly after number/u,
			);
		});

		it("still takes a separator inside the fraction", () => {
			expect(scanFirst("08.5_5")).toMatchObject({
				kind: T_NUMBER,
				text: "08.5_5",
			});
		});

		it("refuses a number run straight into an identifier", () => {
			expect(() => scanAll("1n1")).toThrow();
			expect(() => scanAll("3in")).toThrow();
		});

		it("refuses a number run into a non-ASCII identifier start", () => {
			expect(() => scanAll("1é")).toThrow();
		});
	});

	describe("operators", () => {
		it("scans every compound assignment", () => {
			expect(kinds("a -= 1")).toEqual([
				T_IDENT,
				T_ASSIGN_MINUS,
				T_NUMBER,
			]);
			expect(kinds("a *= 1")).toEqual([T_IDENT, T_ASSIGN_STAR, T_NUMBER]);
			expect(kinds("a %= 1")).toEqual([
				T_IDENT,
				T_ASSIGN_PERCENT,
				T_NUMBER,
			]);
			expect(kinds("a ^= 1")).toEqual([
				T_IDENT,
				T_ASSIGN_CARET,
				T_NUMBER,
			]);
			expect(kinds("a &= 1")).toEqual([T_IDENT, T_ASSIGN_AMP, T_NUMBER]);
			expect(kinds("a |= 1")).toEqual([T_IDENT, T_ASSIGN_PIPE, T_NUMBER]);
			expect(kinds("a <<= 1")).toEqual([T_IDENT, T_ASSIGN_SHL, T_NUMBER]);
			expect(kinds("a >>= 1")).toEqual([T_IDENT, T_ASSIGN_SAR, T_NUMBER]);
			expect(kinds("a >>>= 1")).toEqual([
				T_IDENT,
				T_ASSIGN_SHR,
				T_NUMBER,
			]);
		});

		it("scans `/=` where a regular expression cannot start", () => {
			expect(kinds("a /= 1")).toEqual([
				T_IDENT,
				T_ASSIGN_SLASH,
				T_NUMBER,
			]);
		});

		it("scans the comparisons", () => {
			expect(kinds("a != b")).toEqual([T_IDENT, T_NOT_EQ, T_IDENT]);
			expect(kinds("a <= b")).toEqual([T_IDENT, T_LT_EQ, T_IDENT]);
		});
	});

	describe("regular expressions", () => {
		it("scans one where an expression may start", () => {
			expect(scanFirst("/a/g")).toMatchObject({
				kind: T_REGEXP,
				text: "/a/g",
			});
		});

		it("refuses an unterminated one", () => {
			expect(() => scanAll("/a")).toThrow(
				/Unterminated regular expression/u,
			);
		});

		it("rescans a division as a regular expression", () => {
			const tokenizer = new Tokenizer("a /b/g");

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).not.toBe(T_REGEXP);

			tokenizer.reScanAsRegExp();

			expect(current(tokenizer)).toMatchObject({
				kind: T_REGEXP,
				text: "/b/g",
			});
			expect(tokenizer.count).toBe(2);
		});

		it("rescans a `/=` as a regular expression", () => {
			const tokenizer = new Tokenizer("a /=b/g");

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).toBe(T_ASSIGN_SLASH);

			tokenizer.reScanAsRegExp();

			expect(current(tokenizer)).toMatchObject({
				kind: T_REGEXP,
				text: "/=b/g",
			});
		});
	});

	describe("state", () => {
		it("restores everything a save recorded", () => {
			const tokenizer = new Tokenizer("a b c");

			tokenizer.next();

			const state = tokenizer.save();
			const saved = current(tokenizer);

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).toBe(T_IDENT);
			expect(current(tokenizer).text).toBe("c");

			tokenizer.restore(state);

			expect(current(tokenizer)).toEqual(saved);

			tokenizer.next();

			expect(current(tokenizer).text).toBe("b");
		});

		it("ignores a brace mark taken with nothing open", () => {
			const tokenizer = new Tokenizer("a");

			expect(() => {
				tokenizer.markBrace(true);
				tokenizer.markStatementParen();
			}).not.toThrow();
		});

		it("tells a block from an object literal after a brace", () => {
			const block = new Tokenizer("{} /a/");
			const object = new Tokenizer("({}) /a/g");

			block.next();
			block.markBrace(true);
			block.next();
			block.next();

			expect(block.kind).toBe(T_REGEXP);

			object.next();
			object.next();
			object.markBrace(false);

			expect(object.kind).not.toBe(T_REGEXP);
		});

		it("allows a regular expression after a statement head's `)`", () => {
			const tokenizer = new Tokenizer("if (a) /b/.test(c)");

			// `if`
			tokenizer.next();
			// `(`
			tokenizer.next();
			tokenizer.markStatementParen();
			// `a`
			tokenizer.next();
			// `)`
			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).toBe(T_REGEXP);
		});

		it("grows its context stack past the depth it started with", () => {
			const depth = 300;
			const tokenizer = new Tokenizer("(".repeat(depth) + "a");

			for (let i = 0; i < depth; i++) {
				tokenizer.next();
			}

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_IDENT);
		});

		it("keeps reporting end of input once it is reached", () => {
			const tokenizer = new Tokenizer("a");

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).toBe(T_EOF);

			const count = tokenizer.count;

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_EOF);
			expect(tokenizer.count).toBe(count + 1);
		});
	});

	describe("errors", () => {
		it("reports a fatal error positioned at an offset", () => {
			const tokenizer = new Tokenizer("a\nb");
			const error = tokenizer.error("bad", 2);

			expect(error).toBeInstanceOf(ParseError);
			expect(error.index).toBe(2);
			expect(error.message).toMatch(/bad/u);
		});
	});

	describe("peek()", () => {
		it("reports the next token without advancing", () => {
			const tokenizer = new Tokenizer("a => b");

			tokenizer.next();

			expect(tokenizer.peek()).toBe(T_ARROW);
			expect(tokenizer.kind).toBe(T_IDENT);
			expect(tokenizer.start).toBe(0);
		});

		it("reports whether a line terminator came first", () => {
			const tokenizer = new Tokenizer("a\n=> b");

			tokenizer.next();

			expect(tokenizer.peek()).toBe(T_ARROW);
			expect(tokenizer.peekNewlineBefore).toBe(true);
		});

		it("hands the peeked token to the next advance unchanged", () => {
			const withPeek = new Tokenizer("a /b/ c");
			const without = new Tokenizer("a /b/ c");

			withPeek.next();
			without.next();
			withPeek.peek();
			withPeek.next();
			without.next();

			expect(withPeek.kind).toBe(without.kind);
			expect(withPeek.start).toBe(without.start);
			expect(withPeek.end).toBe(without.end);
			expect(withPeek.count).toBe(without.count);
		});

		it("records comments between the tokens exactly once", () => {
			const tokenizer = new Tokenizer("a /* x */ b");

			tokenizer.next();
			tokenizer.peek();
			tokenizer.peek();
			tokenizer.next();

			// `a`, the comment, and `b`.
			expect(tokenizer.count).toBe(3);
		});

		/*
		 * A template head pushes the context entry its closing `}` looks
		 * for. The push happens during the peeked scan and is rolled back,
		 * so consuming the cached token has to replay it — this is the
		 * regression the conformance suites caught.
		 */
		it("replays the context a peeked template head pushed", () => {
			const tokenizer = new Tokenizer("tag`x${y}`;");

			tokenizer.next();

			expect(tokenizer.peek()).toBe(T_TEMPLATE_HEAD);

			tokenizer.next();
			tokenizer.next();

			expect(tokenizer.kind).toBe(T_IDENT);

			tokenizer.next();

			// With the replayed context, `}` continues the template.
			expect(tokenizer.kind).toBe(T_TEMPLATE_TAIL);
		});

		it("is not fooled by a rescan moving the position back", () => {
			const tokenizer = new Tokenizer("a ( b");

			tokenizer.next();

			expect(tokenizer.peek()).toBe(T_PAREN_OPEN);

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_PAREN_OPEN);

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_IDENT);
		});

		it("scans at the end of the text without caching", () => {
			const tokenizer = new Tokenizer("a");

			tokenizer.next();

			expect(tokenizer.peek()).toBe(T_EOF);

			tokenizer.next();

			expect(tokenizer.kind).toBe(T_EOF);
		});
	});
});
