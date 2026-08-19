/**
 * @fileoverview Types for the shared conformance serializer, so that the
 * TypeScript test suite and the plain-JavaScript conformance scripts can use
 * one implementation between them.
 */

/** Which optional fields a comparison should include. */
export interface SerializeFlags {
	/** Include a definition's position and declaration keyword. */
	index?: boolean;

	/** Include whether a write covers only part of the assigned value. */
	partial?: boolean;

	/** Include whether a reference names a type, a value, or both. */
	typeRefs?: boolean;

	/** Leave out the globals a TypeScript `lib` injects. */
	dropLibVariables?: boolean;

	/** Report the root the way `@typescript-eslint/parser` reports it. */
	tsProgramExtent?: boolean;
}

/**
 * Reduces a scope analysis to a comparable structure.
 * @param scopeManager The manager `analyze()` returned.
 * @param flags Which optional fields to include.
 * @returns The comparable structure.
 */
export function serializeBinary(
	scopeManager: unknown,
	flags: SerializeFlags,
): unknown;

/**
 * Reduces an analysis from one of the reference implementations.
 * @param scopeManager The manager their `analyze()` returned.
 * @param flags Which optional fields to include.
 * @returns The comparable structure.
 */
export function serializeReference(
	scopeManager: unknown,
	flags: SerializeFlags,
): unknown;

/**
 * Finds where two serialized graphs first differ.
 * @param expected The reference implementation's structure.
 * @param actual The scope analyzer's structure.
 * @returns A description of the first difference, or `null` when they match.
 */
export function firstDifference(
	expected: unknown,
	actual: unknown,
): string | null;
