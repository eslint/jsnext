/**
 * @fileoverview Reduces a scope graph to a comparable string form.
 *
 * `jsscope` identifies nodes by their index in a binary buffer and the two
 * reference implementations identify them by object identity, so neither shape
 * can be compared to the other directly. Both are reduced to the same thing
 * instead: a node becomes `Type@start-end`, a variable becomes its name and
 * the scope it lives in, and a reference becomes the node it occurs at.
 *
 * The parts that only one implementation has are switched off by the flags,
 * because comparing against a field the other side never fills in would only
 * report a difference that does not exist.
 */

import { NODE_A, NODE_KIND_NAMES } from "@eslint/jsparse";

/**
 * Renders a node as a string that both sides can produce.
 * @param type The node's ESTree type.
 * @param start The offset the node starts at.
 * @param end The offset just past the node.
 * @returns The node key.
 */
function nodeKey(type, start, end) {
	return `${type}@${start}-${end}`;
}

/**
 * Renders an ESTree node from one of the reference implementations.
 * @param node The node, or a nullish value.
 * @returns The node key, or `null`.
 */
function esKey(node) {
	if (node === null || node === undefined) {
		return null;
	}

	const start = node.range ? node.range[0] : node.start;
	const end = node.range ? node.range[1] : node.end;

	return nodeKey(node.type, start, end);
}

/**
 * Renders a node index from a `jsscope` analysis.
 *
 * The root gets special treatment in TypeScript mode for the same reason
 * `jsparse`'s decoder gives it special treatment: the two reference parsers
 * disagree about how far a `Program` reaches, so the binary record carries
 * `espree`'s answer and `@typescript-eslint/parser`'s is derived from it.
 * @param reader The reader over the AST buffer.
 * @param node The node index, or `0`.
 * @param tsProgramExtent Whether the root should span the whole source.
 * @returns The node key, or `null`.
 */
function binaryKey(reader, node, tsProgramExtent) {
	if (node === null) {
		return null;
	}

	let start = reader.start(node);
	let end = reader.end(node);

	if (tsProgramExtent && node === reader.root) {
		end = reader.source.length;

		if (reader.listSize(reader.field(node, NODE_A)) === 0) {
			start = end;
		}
	}

	return nodeKey(NODE_KIND_NAMES[reader.kind(node)], start, end);
}

/**
 * Reduces one scope graph to a comparable structure.
 * @param scopes Every scope, in creation order.
 * @param toKey Turns whatever the implementation calls a node into a key.
 * @param flags Which optional fields to include.
 * @returns The comparable structure.
 */
function serializeScopes(scopes, toKey, flags) {
	const indexOf = new Map();

	scopes.forEach((scope, index) => indexOf.set(scope, index));

	/**
	 * Names the variable a reference resolved to.
	 * @param variable The variable, or `null`.
	 * @returns A name qualified by the scope that holds it, or `null`.
	 */
	function variableKey(variable) {
		if (!variable) {
			return null;
		}

		return `${indexOf.get(variable.scope) ?? "?"}:${variable.name}`;
	}

	/**
	 * Reduces a definition.
	 * @param def The definition.
	 * @returns The comparable form.
	 */
	function definition(def) {
		const result = {
			type: def.type,
			name: toKey(def.name),
			node: toKey(def.node),
			parent: toKey(def.parent),
		};

		if (flags.index) {
			result.index = def.index ?? null;
			result.kind = def.kind ?? null;
		}

		if (def.type === "Parameter") {
			result.rest = !!def.rest;
		}

		return result;
	}

	/**
	 * Reduces a reference.
	 * @param reference The reference.
	 * @returns The comparable form.
	 */
	function reference(reference) {
		const result = {
			at: toKey(reference.identifier),
			read: reference.isRead(),
			write: reference.isWrite(),
			resolved: variableKey(reference.resolved),
		};

		if (reference.isWrite()) {
			result.init = !!reference.init;
			result.writeExpr = toKey(reference.writeExpr);

			if (flags.partial) {
				result.partial = !!reference.partial;
			}
		}

		if (flags.typeRefs) {
			result.type = reference.isTypeReference;
			result.value = reference.isValueReference;
		}

		return result;
	}

	return scopes.map(scope => ({
		type: scope.type,
		block: toKey(scope.block),
		isStrict: scope.isStrict,
		functionExpressionScope: !!scope.functionExpressionScope,
		upper: scope.upper ? indexOf.get(scope.upper) : null,
		variableScope: indexOf.get(scope.variableScope) ?? null,
		variables: scope.variables
			.filter(
				variable =>
					!flags.dropLibVariables ||
					!isLibVariable(scope, variable),
			)
			.map(variable => ({
				name: variable.name,
				identifiers: variable.identifiers.map(toKey),
				defs: variable.defs.map(definition),
				references: variable.references.map(ref => toKey(ref.identifier)),
			})),
		references: scope.references.map(reference),
		through: scope.through.map(ref => toKey(ref.identifier)),
	}));
}

/**
 * Reports whether a variable came from TypeScript's standard library rather
 * than from the source being analyzed.
 *
 * `@typescript-eslint/scope-manager` marks its own with a field; a global that
 * `addGlobals()` supplied to `jsscope` has no marker, but it is equally not
 * part of the program, and nothing the program declares reaches the global
 * scope without a definition.
 * @param scope The scope the variable belongs to.
 * @param variable The variable to test.
 * @returns `true` for a variable that describes the host, not the program.
 */
function isLibVariable(scope, variable) {
	return (
		"eslintImplicitGlobalSetting" in variable ||
		(scope.type === "global" && variable.defs.length === 0)
	);
}

/**
 * Reduces a `jsscope` analysis.
 * @param scopeManager The manager `analyze()` returned.
 * @param flags Which optional fields to include.
 * @returns The comparable structure.
 */
export function serializeBinary(scopeManager, flags) {
	const reader = scopeManager.reader;

	return serializeScopes(
		scopeManager.scopes,
		node => binaryKey(reader, node, !!flags.tsProgramExtent),
		flags,
	);
}

/**
 * Reduces an analysis from `eslint-scope` or
 * `@typescript-eslint/scope-manager`.
 * @param scopeManager The manager their `analyze()` returned.
 * @param flags Which optional fields to include.
 * @returns The comparable structure.
 */
export function serializeReference(scopeManager, flags) {
	return serializeScopes(scopeManager.scopes, esKey, flags);
}

/**
 * Finds where two serialized graphs first differ.
 * @param expected The reference implementation's structure.
 * @param actual The `jsscope` structure.
 * @returns A description of the first difference, or `null` when they match.
 */
export function firstDifference(expected, actual) {
	const a = JSON.stringify(expected, null, 0);
	const b = JSON.stringify(actual, null, 0);

	if (a === b) {
		return null;
	}

	let i = 0;

	while (i < a.length && i < b.length && a[i] === b[i]) {
		i++;
	}

	const from = Math.max(0, i - 90);

	return `exp ${a.slice(from, i + 110)}\n   got ${b.slice(from, i + 110)}`;
}
