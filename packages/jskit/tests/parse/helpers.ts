/**
 * @fileoverview Shared helpers for the test suite.
 */

/**
 * Produces a comparable copy of an AST with a stable key order.
 *
 * The reference parsers disagree about property order and about whether a
 * position is exposed as `range` or as `start`/`end`, so both are normalized
 * before comparison. A property that is `null`, `undefined`, or absent is
 * dropped, because this parser always spells "nothing here" as `null` while
 * the reference parsers sometimes leave the property off entirely. That
 * difference is deliberate and documented in `docs/deviations.md`.
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

		// A property with no value compares the same as no property at all.
		if (source[key] === null || source[key] === undefined) {
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

/**
 * Restates a `Program`'s extent the way `@typescript-eslint/parser` states it.
 *
 * Both dialects report `espree`'s extent here — the first and last statement,
 * or the whole text for an empty program — while
 * `@typescript-eslint/parser` runs a program to the end of the source. That is
 * a deliberate deviation, documented in `docs/deviations.md`. Deriving the
 * reference's answer from ours rather than dropping the field keeps the
 * comparison total: an extent that is wrong for any other reason still fails.
 * @param program The `Program` node this parser produced.
 * @param code The source text it was parsed from.
 * @returns A shallow copy carrying the reference parser's extent.
 */
export function asReferenceProgramExtent(
	program: Record<string, unknown>,
	code: string,
): Record<string, unknown> {
	return {
		...program,
		start:
			(program.body as unknown[]).length === 0
				? code.length
				: program.start,
		end: code.length,
	};
}
