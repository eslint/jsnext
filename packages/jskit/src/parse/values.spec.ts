/**
 * @fileoverview Unit tests for literal value decoding.
 */

import { describe, expect, it } from "vitest";
import { decodeEscapes, decodeNumber } from "./values.js";

describe("decodeEscapes()", () => {
	it("returns text without a backslash unchanged", () => {
		expect(decodeEscapes("plain", false)).toBe("plain");
	});

	it("leaves a carriage return alone outside a template", () => {
		expect(decodeEscapes("a\r\nb", false)).toBe("a\r\nb");
	});

	it("normalizes line endings inside a template", () => {
		expect(decodeEscapes("a\r\nb", true)).toBe("a\nb");
		expect(decodeEscapes("a\rb", true)).toBe("a\nb");
	});

	it("normalizes line endings in a template that also has escapes", () => {
		expect(decodeEscapes("a\r\n\\tb", true)).toBe("a\n\tb");
	});

	it("decodes the single character escapes", () => {
		expect(decodeEscapes("\\n\\t\\r\\b\\f\\v", false)).toBe("\n\t\r\b\f\v");
	});

	it("decodes a hexadecimal escape", () => {
		expect(decodeEscapes("\\x41\\x62", false)).toBe("Ab");
	});

	it("decodes a four-digit unicode escape", () => {
		expect(decodeEscapes("\\u0041\\u00e9", false)).toBe("Aé");
	});

	it("decodes a braced unicode escape", () => {
		expect(decodeEscapes("\\u{41}", false)).toBe("A");
		expect(decodeEscapes("\\u{1F600}", false)).toBe("\u{1f600}");
	});

	it("drops a line continuation", () => {
		expect(decodeEscapes("a\\\nb", false)).toBe("ab");
		expect(decodeEscapes("a\\\r\nb", false)).toBe("ab");
		expect(decodeEscapes("a\\\rb", false)).toBe("ab");
		expect(decodeEscapes("a\\\u2028b", false)).toBe("ab");
		expect(decodeEscapes("a\\\u2029b", false)).toBe("ab");
	});

	it("decodes a legacy octal escape", () => {
		expect(decodeEscapes("\\101", false)).toBe("A");
		expect(decodeEscapes("\\7", false)).toBe("\x07");
	});

	it("stops an octal escape after three digits", () => {
		expect(decodeEscapes("\\1011", false)).toBe("A1");
	});

	it("decodes a null escape", () => {
		expect(decodeEscapes("\\0", false)).toBe("\0");
	});

	it("drops the backslash before an eight or a nine", () => {
		expect(decodeEscapes("\\8\\9", false)).toBe("89");
	});

	it("drops the backslash before any other character", () => {
		expect(decodeEscapes("\\q\\'\\\"\\\\", false)).toBe("q'\"\\");
	});

	it("keeps the text around an escape", () => {
		expect(decodeEscapes("one\\ntwo\\tthree", false)).toBe(
			"one\ntwo\tthree",
		);
	});
});

describe("decodeNumber()", () => {
	it("reads a decimal literal", () => {
		expect(decodeNumber("1")).toBe(1);
		expect(decodeNumber("0")).toBe(0);
		expect(decodeNumber("42")).toBe(42);
	});

	it("reads a fractional literal", () => {
		expect(decodeNumber(".5")).toBe(0.5);
		expect(decodeNumber("0.5")).toBe(0.5);
		expect(decodeNumber("1.25")).toBe(1.25);
	});

	it("reads an exponent", () => {
		expect(decodeNumber("1e3")).toBe(1000);
		expect(decodeNumber("1E-3")).toBe(0.001);
		expect(decodeNumber("0e0")).toBe(0);
	});

	it("reads a hexadecimal literal in either case", () => {
		expect(decodeNumber("0x1f")).toBe(31);
		expect(decodeNumber("0X1F")).toBe(31);
	});

	it("reads an octal literal in either case", () => {
		expect(decodeNumber("0o17")).toBe(15);
		expect(decodeNumber("0O17")).toBe(15);
	});

	it("reads a binary literal in either case", () => {
		expect(decodeNumber("0b101")).toBe(5);
		expect(decodeNumber("0B101")).toBe(5);
	});

	it("reads a legacy octal literal", () => {
		expect(decodeNumber("017")).toBe(15);
		expect(decodeNumber("00")).toBe(0);
	});

	it("reads a leading zero followed by a non-octal digit as decimal", () => {
		expect(decodeNumber("08")).toBe(8);
		expect(decodeNumber("09")).toBe(9);
		expect(decodeNumber("0899")).toBe(899);
	});

	it("ignores numeric separators", () => {
		expect(decodeNumber("1_000")).toBe(1000);
		expect(decodeNumber("0x1_f")).toBe(31);
		expect(decodeNumber("0b1010_1010")).toBe(170);
		expect(decodeNumber("1_0.2_5")).toBe(10.25);
	});
});
