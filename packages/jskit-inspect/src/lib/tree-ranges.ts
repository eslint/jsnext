/**
 * @fileoverview Connects the rows of an analysis tree to the stretches of
 * source they stand for, in both directions: from a row to its range, for
 * highlighting what a click picked, and from an offset to the row that
 * covers it most tightly, for following the editor's cursor.
 */

/** A stretch of the source, as UTF-16 offsets. */
export interface SourceRange {
	start: number;
	end: number;
}

/** A row found under an offset, with every row above it. */
export interface Location {
	/** The row's path, as the tree view builds it. */
	path: string;

	/** The source the row stands for. */
	range: SourceRange;

	/** The paths of the row's ancestors, outermost first. */
	ancestors: string[];
}

/**
 * The properties that hold the source of an object with none of its own,
 * in the order they are tried: a scope's `block`, a reference's
 * `identifier`, a definition's `name`, and the `node` of a flow graph or a
 * typed node entry. A variable, the remaining case, is handled apart
 * because it reaches its identifier through an array.
 */
const STAND_INS = ["block", "identifier", "name", "node"] as const;

/**
 * Decides whether a value gets a chevron and children of its own.
 * @param value The value to test.
 * @returns `true` for arrays and plain-ish objects with at least one entry.
 */
export function isExpandable(value: unknown): value is object {
	if (
		typeof value !== "object" ||
		value === null ||
		value instanceof RegExp
	) {
		return false;
	}

	return Array.isArray(value)
		? value.length > 0
		: Object.keys(value).length > 0;
}

/**
 * The entries of an object or array, in insertion order.
 * @param value The expandable value.
 * @returns The name/value pairs to render.
 */
export function entriesOf(value: object): [string, unknown][] {
	return Array.isArray(value)
		? value.map((item, index): [string, unknown] => [String(index), item])
		: Object.entries(value);
}

/**
 * Reads the numeric `start` and `end` a value carries itself.
 * @param value The value to test.
 * @returns The range, or `null` when the value has none.
 */
function ownRange(value: unknown): SourceRange | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const { start, end } = value as Record<string, unknown>;

	return typeof start === "number" && typeof end === "number"
		? { start, end }
		: null;
}

/**
 * Reads the source range an object stands for: its own, when it is an AST
 * node or a node reference, or else the range of the node that names it —
 * so a scope stands for its block and a variable for its declaration.
 * @param value The value to test.
 * @returns The range, or `null` when the value has none.
 */
export function rangeOf(value: object): SourceRange | null {
	const own = ownRange(value);

	if (own !== null || Array.isArray(value)) {
		return own;
	}

	const record = value as Record<string, unknown>;

	for (const key of STAND_INS) {
		const range = ownRange(record[key]);

		if (range !== null) {
			return range;
		}
	}

	const { identifiers } = record;

	return Array.isArray(identifiers) ? ownRange(identifiers[0]) : null;
}

/**
 * Decides whether a scope tree row is a scope, a variable, or a reference
 * — the three things that tree is about. Everything else in it is a node
 * one of those points at, which says less about the cursor than the
 * innermost scope does.
 * @param value The row's value.
 * @returns `true` for a scope, a variable, or a reference.
 */
export function isScopeEntity(value: object): boolean {
	return "scopeId" in value || "symbolId" in value || "referenceId" in value;
}

/**
 * Finds the row whose source most tightly covers an offset. The shortest
 * range wins; between two of the same length, one the offset is strictly
 * inside beats one it merely touches the end of, and then the shallower
 * row wins, so a reference is picked over the identifier inside it.
 *
 * A `Program`'s token and comment lists are skipped: each token covers the
 * same text as the node it was read into, and the node is what is wanted.
 * @param data The tree's root value.
 * @param rootLabel The root row's name, which starts every path.
 * @param offset The offset to look under.
 * @param accepts Decides which rows may be picked; every row is still
 * descended into. Omitted, any row with a range may be.
 * @returns The row, or `null` when nothing covers the offset.
 */
export function locate(
	data: unknown,
	rootLabel: string,
	offset: number,
	accepts: (value: object) => boolean = () => true,
): Location | null {
	let best: Location | null = null;
	let bestLength = Infinity;
	let bestStrict = false;
	let bestDepth = Infinity;
	const ancestors: string[] = [];

	/**
	 * Visits one value and everything below it.
	 * @param value The value.
	 * @param path Its row's path.
	 */
	function visit(value: unknown, path: string): void {
		if (!isExpandable(value)) {
			return;
		}

		const range = accepts(value) ? rangeOf(value) : null;

		if (range !== null && range.start <= offset && offset <= range.end) {
			const length = range.end - range.start;
			const strict = offset < range.end;
			const depth = ancestors.length;

			if (
				length < bestLength ||
				(length === bestLength &&
					(strict !== bestStrict ? strict : depth < bestDepth))
			) {
				best = { path, range, ancestors: [...ancestors] };
				bestLength = length;
				bestStrict = strict;
				bestDepth = depth;
			}
		}

		const isProgram = (value as Record<string, unknown>).type === "Program";

		ancestors.push(path);

		for (const [name, child] of entriesOf(value)) {
			if (isProgram && (name === "tokens" || name === "comments")) {
				continue;
			}

			visit(child, `${path}.${name}`);
		}

		ancestors.pop();
	}

	visit(data, rootLabel);

	return best;
}
