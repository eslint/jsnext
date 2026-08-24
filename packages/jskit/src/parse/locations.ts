/**
 * @fileoverview Conversion from source offsets to line and column numbers.
 *
 * The parser works in offsets throughout, because an offset is a single
 * number that never has to be recomputed as the scanner moves. Line and
 * column numbers are derived here, on demand, only for the consumers that
 * need them: error reporting and the ESLint-compatible AST.
 */

/** A line and column pair, as ESTree spells it. */
export interface Position {
	/** The 1-based line number. */
	line: number;

	/** The 0-based column number, which is what ESTree's `loc` uses. */
	column: number;
}

/** A start and end position pair, as ESTree spells it. */
export interface SourceLocation {
	/** Where the range begins. */
	start: Position;

	/** Where the range ends. */
	end: Position;
}

/**
 * Turns source offsets into line and column numbers.
 *
 * Callers ask about offsets in roughly source order, so the line found last
 * is checked before falling back to a binary search. That turns the common
 * case into two comparisons.
 */
export class LineIndex {
	/** The offset at which each line begins. */
	readonly lineStarts: Uint32Array;

	/** The 0-based index of the line matched by the previous lookup. */
	#lastLine = 0;

	/**
	 * Creates an index over a source text's line offsets.
	 * @param lineStarts The offset at which each line begins.
	 */
	constructor(lineStarts: Uint32Array) {
		this.lineStarts = lineStarts;
	}

	/**
	 * Finds the line an offset falls on.
	 * @param offset The 0-based offset in the source text.
	 * @returns The 0-based index of the line containing the offset.
	 */
	lineIndex(offset: number): number {
		const starts = this.lineStarts;
		const last = this.#lastLine;

		if (
			offset >= starts[last] &&
			(last + 1 >= starts.length || offset < starts[last + 1])
		) {
			return last;
		}

		let low = 0;
		let high = starts.length - 1;

		// Binary search for the last line start at or before the offset.
		while (low < high) {
			const middle = (low + high + 1) >> 1;

			if (starts[middle] <= offset) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}

		this.#lastLine = low;

		return low;
	}

	/**
	 * Finds the line number an offset falls on.
	 * @param offset The 0-based offset in the source text.
	 * @returns The 1-based line number.
	 */
	line(offset: number): number {
		return this.lineIndex(offset) + 1;
	}

	/**
	 * Finds how far into its line an offset sits.
	 * @param offset The 0-based offset in the source text.
	 * @returns The 0-based column number.
	 */
	column(offset: number): number {
		return offset - this.lineStarts[this.lineIndex(offset)];
	}

	/**
	 * Converts an offset into an ESTree position.
	 * @param offset The 0-based offset in the source text.
	 * @returns The 1-based line and 0-based column of the offset.
	 */
	position(offset: number): Position {
		const index = this.lineIndex(offset);

		return { line: index + 1, column: offset - this.lineStarts[index] };
	}

	/**
	 * Converts a pair of offsets into an ESTree location.
	 *
	 * The `end` lookup deliberately leaves the cursor alone. Nodes are decoded
	 * in pre-order and tokens in source order, so the `start` offsets arrive
	 * ascending and keep the cursor hot — but a parent node's `end` sits far
	 * ahead of the next node's `start`, so letting it move the cursor would
	 * turn nearly every later lookup into a miss. Instead `end` searches only
	 * the lines from `start`'s downward, which is also what makes the common
	 * single-line range two comparisons in total.
	 * @param start The 0-based offset where the range begins.
	 * @param end The 0-based offset where the range ends; never before
	 *      `start`.
	 * @returns The positions of both offsets.
	 */
	location(start: number, end: number): SourceLocation {
		const starts = this.lineStarts;
		const startIndex = this.lineIndex(start);
		let low = startIndex;

		if (startIndex + 1 < starts.length && end >= starts[startIndex + 1]) {
			let high = starts.length - 1;

			// Binary search for the last line start at or before the offset.
			while (low < high) {
				const middle = (low + high + 1) >> 1;

				if (starts[middle] <= end) {
					low = middle;
				} else {
					high = middle - 1;
				}
			}
		}

		return {
			start: {
				line: startIndex + 1,
				column: start - starts[startIndex],
			},
			end: { line: low + 1, column: end - starts[low] },
		};
	}
}
