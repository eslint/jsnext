/**
 * @fileoverview The error type thrown for fatal syntax errors.
 */

/**
 * A fatal syntax error detected during `parse()`.
 *
 * Only errors that make it impossible to continue producing tokens or nodes
 * are thrown. Everything that is merely "not allowed here" is reported by
 * `validate()` instead.
 */
export class ParseError extends SyntaxError {
	/** The 0-based offset in the source text where the error was detected. */
	index: number;

	/** The 1-based line number where the error was detected. */
	lineNumber: number;

	/** The 1-based column number where the error was detected. */
	column: number;

	/**
	 * Creates a new parse error.
	 * @param message A description of the problem, without position info.
	 * @param index The 0-based offset where the problem was detected.
	 * @param lineNumber The 1-based line number of `index`.
	 * @param column The 1-based column number of `index`.
	 */
	constructor(
		message: string,
		index: number,
		lineNumber: number,
		column: number,
	) {
		super(`${message} (${lineNumber}:${column})`);

		this.name = "ParseError";
		this.index = index;
		this.lineNumber = lineNumber;
		this.column = column;
	}
}

/**
 * Converts a source offset into a 1-based line and column pair.
 * @param lineStarts The offsets at which each line begins.
 * @param lineCount The number of valid entries in `lineStarts`.
 * @param index The offset to locate.
 * @returns A tuple of the 1-based line number and 1-based column number.
 */
export function locate(
	lineStarts: Uint32Array,
	lineCount: number,
	index: number,
): [number, number] {
	let low = 0;
	let high = lineCount - 1;

	// Binary search for the last line start at or before `index`.
	while (low < high) {
		const middle = (low + high + 1) >> 1;

		if (lineStarts[middle] <= index) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	return [low + 1, index - lineStarts[low] + 1];
}
