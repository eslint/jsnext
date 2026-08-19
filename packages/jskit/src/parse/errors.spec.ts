/**
 * @fileoverview Unit tests for the parse error type and offset lookup.
 */

import { describe, expect, it } from "vitest";
import { ParseError, locate } from "./errors.js";

describe("ParseError", () => {
	it("is a SyntaxError", () => {
		const error = new ParseError("Unexpected token", 8, 1, 9);

		expect(error).toBeInstanceOf(SyntaxError);
		expect(error).toBeInstanceOf(Error);
	});

	it("names itself", () => {
		expect(new ParseError("Boom", 0, 1, 1).name).toBe("ParseError");
	});

	it("appends the position to the message", () => {
		expect(new ParseError("Unexpected token", 8, 1, 9).message).toBe(
			"Unexpected token (1:9)",
		);
	});

	it("keeps the offset, line, and column", () => {
		const error = new ParseError("Boom", 42, 3, 7);

		expect(error.index).toBe(42);
		expect(error.lineNumber).toBe(3);
		expect(error.column).toBe(7);
	});
});

describe("locate()", () => {
	/** Line starts for `"one\ntwo\nthree"`. */
	const starts = new Uint32Array([0, 4, 8, 0, 0]);

	it("returns a 1-based line and column", () => {
		expect(locate(starts, 3, 0)).toEqual([1, 1]);
		expect(locate(starts, 3, 3)).toEqual([1, 4]);
		expect(locate(starts, 3, 4)).toEqual([2, 1]);
		expect(locate(starts, 3, 9)).toEqual([3, 2]);
	});

	it("ignores the entries past the line count", () => {
		expect(locate(starts, 2, 9)).toEqual([2, 6]);
	});

	it("puts an offset past the end on the last line", () => {
		expect(locate(starts, 3, 1000)).toEqual([3, 993]);
	});

	it("handles a source with a single line", () => {
		const single = new Uint32Array([0]);

		expect(locate(single, 1, 0)).toEqual([1, 1]);
		expect(locate(single, 1, 5)).toEqual([1, 6]);
	});

	it("handles a run of empty lines", () => {
		const empty = new Uint32Array([0, 1, 2, 3]);

		expect(locate(empty, 4, 0)).toEqual([1, 1]);
		expect(locate(empty, 4, 2)).toEqual([3, 1]);
		expect(locate(empty, 4, 3)).toEqual([4, 1]);
	});

	it("finds every line of a long source", () => {
		const lines = 500;
		const long = new Uint32Array(lines);

		for (let i = 0; i < lines; i++) {
			long[i] = i * 10;
		}

		for (const line of [0, 1, 250, 498, 499]) {
			expect(locate(long, lines, line * 10)).toEqual([line + 1, 1]);
			expect(locate(long, lines, line * 10 + 9)).toEqual([line + 1, 10]);
		}
	});
});
