/**
 * @fileoverview Unit tests for the character classification tables.
 */

import { describe, expect, it } from "vitest";
import {
	ASCII_LIMIT,
	CHAR_FLAGS,
	MASK_DIGIT,
	MASK_HEX_DIGIT,
	MASK_ID_PART,
	MASK_ID_START,
	MASK_NEWLINE,
	MASK_SPACE,
	isLineTerminator,
	isNonAsciiIdPart,
	isNonAsciiIdStart,
	isNonAsciiSpace,
} from "./chars.js";

/**
 * Reports whether a character's entry has a mask set.
 * @param char The character to look up.
 * @param mask The bit mask to test for.
 * @returns `true` when the table has the bit set for the character.
 */
function has(char: string, mask: number): boolean {
	return (CHAR_FLAGS[char.charCodeAt(0)] & mask) !== 0;
}

describe("CHAR_FLAGS", () => {
	it("covers the ASCII range and no more", () => {
		expect(CHAR_FLAGS).toHaveLength(ASCII_LIMIT);
	});

	it("marks letters, the dollar sign, and the underscore as identifier starts", () => {
		for (const char of "azAZ$_") {
			expect(has(char, MASK_ID_START)).toBe(true);
			expect(has(char, MASK_ID_PART)).toBe(true);
		}
	});

	it("marks a digit as an identifier part but not an identifier start", () => {
		expect(has("0", MASK_ID_START)).toBe(false);
		expect(has("9", MASK_ID_PART)).toBe(true);
	});

	it("marks no punctuation as an identifier character", () => {
		for (const char of "-+.:;,#@!") {
			expect(has(char, MASK_ID_START)).toBe(false);
			expect(has(char, MASK_ID_PART)).toBe(false);
		}
	});

	it("marks the decimal digits", () => {
		for (const char of "0123456789") {
			expect(has(char, MASK_DIGIT)).toBe(true);
		}

		expect(has("a", MASK_DIGIT)).toBe(false);
	});

	it("marks the hexadecimal digits in either case", () => {
		for (const char of "0123456789abcdefABCDEF") {
			expect(has(char, MASK_HEX_DIGIT)).toBe(true);
		}

		for (const char of "gGzZ") {
			expect(has(char, MASK_HEX_DIGIT)).toBe(false);
		}
	});

	it("marks the whitespace that does not end a line", () => {
		for (const char of " \t\v\f") {
			expect(has(char, MASK_SPACE)).toBe(true);
			expect(has(char, MASK_NEWLINE)).toBe(false);
		}
	});

	it("marks the line terminators", () => {
		for (const char of "\n\r") {
			expect(has(char, MASK_NEWLINE)).toBe(true);
			expect(has(char, MASK_SPACE)).toBe(false);
		}
	});

	it("leaves a control character unclassified", () => {
		expect(CHAR_FLAGS[0]).toBe(0);
		expect(CHAR_FLAGS[0x07]).toBe(0);
	});
});

describe("isNonAsciiIdStart()", () => {
	it("accepts a letter from another script", () => {
		expect(isNonAsciiIdStart("é".codePointAt(0)!)).toBe(true);
		expect(isNonAsciiIdStart("日".codePointAt(0)!)).toBe(true);
		expect(isNonAsciiIdStart("𐀀".codePointAt(0)!)).toBe(true);
	});

	it("rejects a combining mark, which may only continue a name", () => {
		expect(isNonAsciiIdStart(0x0301)).toBe(false);
	});

	it("rejects a byte order mark", () => {
		expect(isNonAsciiIdStart(0xfeff)).toBe(false);
	});

	it("rejects a symbol", () => {
		expect(isNonAsciiIdStart("\u{1f600}".codePointAt(0)!)).toBe(false);
	});
});

describe("isNonAsciiIdPart()", () => {
	it("accepts what may start a name", () => {
		expect(isNonAsciiIdPart("é".codePointAt(0)!)).toBe(true);
	});

	it("accepts a combining mark", () => {
		expect(isNonAsciiIdPart(0x0301)).toBe(true);
	});

	it("accepts the two zero-width joiners the grammar allows", () => {
		expect(isNonAsciiIdPart(0x200c)).toBe(true);
		expect(isNonAsciiIdPart(0x200d)).toBe(true);
	});

	it("rejects a byte order mark", () => {
		expect(isNonAsciiIdPart(0xfeff)).toBe(false);
	});

	it("rejects a symbol", () => {
		expect(isNonAsciiIdPart("\u{1f600}".codePointAt(0)!)).toBe(false);
	});
});

describe("isNonAsciiSpace()", () => {
	it("accepts the Unicode space separators", () => {
		for (const code of [
			0xa0, 0x1680, 0x2000, 0x2005, 0x200a, 0x202f, 0x205f, 0x3000,
		]) {
			expect(isNonAsciiSpace(code)).toBe(true);
		}
	});

	it("accepts a byte order mark, which counts as whitespace", () => {
		expect(isNonAsciiSpace(0xfeff)).toBe(true);
	});

	it("rejects the line separators, which end a line instead", () => {
		expect(isNonAsciiSpace(0x2028)).toBe(false);
		expect(isNonAsciiSpace(0x2029)).toBe(false);
	});

	it("rejects a zero-width space, which is not whitespace in the grammar", () => {
		expect(isNonAsciiSpace(0x200b)).toBe(false);
	});
});

describe("isLineTerminator()", () => {
	it("accepts the four code points that end a line", () => {
		expect(isLineTerminator(0x0a)).toBe(true);
		expect(isLineTerminator(0x0d)).toBe(true);
		expect(isLineTerminator(0x2028)).toBe(true);
		expect(isLineTerminator(0x2029)).toBe(true);
	});

	it("rejects the other whitespace", () => {
		expect(isLineTerminator(0x20)).toBe(false);
		expect(isLineTerminator(0x09)).toBe(false);
		expect(isLineTerminator(0x0b)).toBe(false);
		expect(isLineTerminator(0x0c)).toBe(false);
		expect(isLineTerminator(0xa0)).toBe(false);
	});
});
