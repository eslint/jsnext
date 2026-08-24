/**
 * @fileoverview Unit tests for offset-to-position conversion.
 */

import { describe, expect, it } from "vitest";
import { LineIndex } from "./locations.js";

/** Line starts for `"one\ntwo\nthree"`. */
const starts = new Uint32Array([0, 4, 8]);

describe("LineIndex", () => {
	it("keeps the line starts it was given", () => {
		expect(new LineIndex(starts).lineStarts).toBe(starts);
	});

	describe("lineIndex()", () => {
		it("returns a 0-based line index", () => {
			const index = new LineIndex(starts);

			expect(index.lineIndex(0)).toBe(0);
			expect(index.lineIndex(3)).toBe(0);
			expect(index.lineIndex(4)).toBe(1);
			expect(index.lineIndex(7)).toBe(1);
			expect(index.lineIndex(8)).toBe(2);
			expect(index.lineIndex(12)).toBe(2);
		});

		it("answers repeated lookups on the same line", () => {
			const index = new LineIndex(starts);

			expect(index.lineIndex(5)).toBe(1);
			expect(index.lineIndex(5)).toBe(1);
			expect(index.lineIndex(6)).toBe(1);
		});

		it("answers a lookup that moves backwards", () => {
			const index = new LineIndex(starts);

			expect(index.lineIndex(9)).toBe(2);
			expect(index.lineIndex(1)).toBe(0);
			expect(index.lineIndex(9)).toBe(2);
		});

		it("puts an offset past the end on the last line", () => {
			expect(new LineIndex(starts).lineIndex(1000)).toBe(2);
		});

		it("handles a source with a single line", () => {
			const index = new LineIndex(new Uint32Array([0]));

			expect(index.lineIndex(0)).toBe(0);
			expect(index.lineIndex(50)).toBe(0);
		});

		it("handles a run of empty lines", () => {
			const index = new LineIndex(new Uint32Array([0, 1, 2, 3, 4]));

			expect(index.lineIndex(0)).toBe(0);
			expect(index.lineIndex(2)).toBe(2);
			expect(index.lineIndex(4)).toBe(4);
		});

		it("finds every line of a long source by binary search", () => {
			const lines = 500;
			const long = new Uint32Array(lines);

			for (let i = 0; i < lines; i++) {
				long[i] = i * 10;
			}

			const index = new LineIndex(long);

			// Jump around so that the remembered line never helps.
			for (const line of [499, 0, 250, 1, 498, 3]) {
				expect(index.lineIndex(line * 10)).toBe(line);
				expect(index.lineIndex(line * 10 + 9)).toBe(line);
			}
		});
	});

	describe("line()", () => {
		it("returns a 1-based line number", () => {
			const index = new LineIndex(starts);

			expect(index.line(0)).toBe(1);
			expect(index.line(4)).toBe(2);
			expect(index.line(8)).toBe(3);
		});
	});

	describe("column()", () => {
		it("returns a 0-based column number", () => {
			const index = new LineIndex(starts);

			expect(index.column(0)).toBe(0);
			expect(index.column(2)).toBe(2);
			expect(index.column(4)).toBe(0);
			expect(index.column(6)).toBe(2);
		});
	});

	describe("position()", () => {
		it("pairs a 1-based line with a 0-based column", () => {
			const index = new LineIndex(starts);

			expect(index.position(0)).toEqual({ line: 1, column: 0 });
			expect(index.position(6)).toEqual({ line: 2, column: 2 });
			expect(index.position(10)).toEqual({ line: 3, column: 2 });
		});
	});

	describe("location()", () => {
		it("converts a pair of offsets", () => {
			expect(new LineIndex(starts).location(1, 9)).toEqual({
				start: { line: 1, column: 1 },
				end: { line: 3, column: 1 },
			});
		});

		it("converts a range that stays on one line", () => {
			expect(new LineIndex(starts).location(4, 7)).toEqual({
				start: { line: 2, column: 0 },
				end: { line: 2, column: 3 },
			});
		});

		it("agrees with position() for every pair, in any lookup order", () => {
			/*
			 * `location()` searches for `end` only below `start`'s line and
			 * leaves the cursor where `start` put it, so it has to be checked
			 * against the definition — two independent `position()` calls —
			 * across every pair, not just the ascending order the decoder
			 * happens to use. Lines of length 0, 1, and 2 put line starts on
			 * adjacent offsets, which is where an off-by-one would live.
			 */
			const jagged = new Uint32Array([0, 1, 2, 4, 4, 5, 8]);
			const oracle = new LineIndex(jagged);
			const pairs = [];

			for (let start = 0; start <= 9; start++) {
				for (let end = start; end <= 9; end++) {
					pairs.push([start, end]);
				}
			}

			// Shuffle deterministically so the cursor sees hostile orders.
			for (let i = pairs.length - 1; i > 0; i--) {
				const j = (i * 31) % (i + 1);

				[pairs[i], pairs[j]] = [pairs[j], pairs[i]];
			}

			const index = new LineIndex(jagged);

			for (const [start, end] of pairs) {
				expect(index.location(start, end)).toEqual({
					start: oracle.position(start),
					end: oracle.position(end),
				});
			}
		});
	});
});
