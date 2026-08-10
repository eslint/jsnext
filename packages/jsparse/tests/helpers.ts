/**
 * @fileoverview Shared helpers for the test suite.
 */

/**
 * Produces a comparable copy of an AST with a stable key order.
 *
 * The reference parsers disagree about property order and about whether a
 * position is exposed as `range` or as `start`/`end`, so both are normalized
 * before comparison. `undefined` becomes `null`, which is the one documented
 * difference from `@typescript-eslint/parser`.
 * @param value The value to normalize.
 * @returns A plain value whose JSON form can be compared directly.
 */
export function normalize(value: unknown): unknown {
	if (value === undefined) {
		return null;
	}

	if (value === null || typeof value !== "object") {
		return typeof value === "bigint" ? `#${value}` : value;
	}

	if (Array.isArray(value)) {
		return value.map(normalize);
	}

	if (value instanceof RegExp) {
		return `re:${value.source}/${value.flags}`;
	}

	const source = value as Record<string, unknown>;
	const flat: Record<string, unknown> = {};

	for (const key of Object.keys(source)) {
		if (
			key === "tokens" ||
			key === "comments" ||
			key === "loc" ||
			key === "range" ||
			key === "parent"
		) {
			continue;
		}

		flat[key] = source[key];
	}

	const range = source.range;

	if (Array.isArray(range)) {
		flat.start = range[0];
		flat.end = range[1];
	}

	const result: Record<string, unknown> = {};

	for (const key of Object.keys(flat).sort()) {
		result[key] = normalize(flat[key]);
	}

	return result;
}

/**
 * Reduces a token list to a comparable form.
 * @param tokens The tokens to normalize.
 * @returns One string per token.
 */
export function normalizeTokens(
	tokens: { type: string; value: string; start: number; end: number }[],
): string[] {
	return tokens.map(
		token => `${token.type}|${token.value}|${token.start}|${token.end}`,
	);
}
