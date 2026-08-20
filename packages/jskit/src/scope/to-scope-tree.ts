/**
 * @fileoverview Renders a scope buffer as a plain, JSON-serializable tree.
 *
 * This is the debugging view. Scopes nest the way they nest in the program,
 * every variable and reference is spelled out with its flags, and a node is
 * rendered the way the parser's own AST spells one — a `type` with
 * `start` and `end` — so the output stands on its own: no node objects, no
 * buffer, no live references to anything. `JSON.stringify` the result and
 * nothing is lost.
 *
 * References appear inline in the scope that recorded them and are numbered
 * with their stable IDs, so the cross-links — a variable's references, a
 * scope's `through` list — can point at them by ID without repeating them.
 */

import type { DefinitionType, ScopeType } from "./kinds.js";
import { resolveNodeSource, type ScopeSource } from "./node-source.js";
import { ScopeBufferReader } from "./scope-buffer-reader.js";
import {
	D_FLAGS,
	D_INDEX,
	D_KIND,
	D_NAME,
	D_NODE,
	D_PARENT,
	D_TYPE,
	DEFINITION_TYPE_CODES,
	DF_REST,
	SCOPE_H_OPTIONS,
	OPT_SOURCE_TYPE_COMMONJS,
	OPT_SOURCE_TYPE_MASK,
	OPT_SOURCE_TYPE_MODULE,
	R_FLAGS,
	R_IDENTIFIER,
	R_NAME,
	R_RESOLVED,
	R_WRITE_EXPR,
	RF_INIT,
	RF_PARTIAL,
	RF_READ,
	RF_TAINTED,
	RF_TYPE,
	RF_VALUE,
	RF_WRITE,
	S_BLOCK,
	S_FLAGS,
	S_IMPLICIT,
	S_REFERENCES,
	S_THROUGH,
	S_TYPE,
	S_UPPER,
	S_VARIABLE_SCOPE,
	S_VARIABLES,
	SCOPE_TYPE_CODES,
	SF_DIRECT_EVAL,
	SF_DYNAMIC,
	SF_FUNCTION_EXPRESSION_SCOPE,
	SF_STRICT,
	SF_THIS_FOUND,
	V_DEFINITIONS,
	V_FLAGS,
	V_IDENTIFIERS,
	V_NAME,
	V_READ_COUNT,
	V_REFERENCES,
	V_WRITE_COUNT,
	VF_STACK,
	VF_TAINTED,
} from "./scope-buffer.js";

/** A node, rendered the way the parser's AST spells one. */
export interface ScopeTreeNode {
	type: string;
	start: number;
	end: number;
}

/** One definition of a variable, fully spelled out. */
export interface ScopeTreeDefinition {
	type: DefinitionType;
	name: ScopeTreeNode;
	node: ScopeTreeNode;
	parent: ScopeTreeNode | null;
	index: number | null;
	kind: string | null;
	rest: boolean;
}

/** One variable, with its definitions inline and its references by ID. */
export interface ScopeTreeVariable {
	symbolId: number;
	name: string;
	tainted: boolean;
	stack: boolean;
	identifiers: ScopeTreeNode[];
	defs: ScopeTreeDefinition[];
	references: number[];
	readCount: number;
	writeCount: number;
}

/** One reference, numbered with its stable ID. */
export interface ScopeTreeReference {
	referenceId: number;
	identifier: ScopeTreeNode;
	name: string;
	read: boolean;
	write: boolean;
	init: boolean;
	partial: boolean;
	tainted: boolean;
	valueReference: boolean;
	typeReference: boolean;
	resolved: number | null;
	writeExpr: ScopeTreeNode | null;
}

/** One scope, with its children nested inside it. */
export interface ScopeTreeScope {
	scopeId: number;
	type: ScopeType;
	block: ScopeTreeNode;
	isStrict: boolean;
	dynamic: boolean;
	functionExpressionScope: boolean;
	directCallToEvalScope: boolean;
	thisFound: boolean;
	variableScope: number;
	variables: ScopeTreeVariable[];
	references: ScopeTreeReference[];
	through: number[];
	implicit: ScopeTreeVariable[] | null;
	childScopes: ScopeTreeScope[];
}

/** The whole tree: the global scope, with everything nested under it. */
export interface ScopeTree {
	sourceType: "script" | "module" | "commonjs" | null;
	root: ScopeTreeScope | null;
}

/**
 * Renders a scope buffer as a plain, self-contained scope tree.
 * @param scopes The buffer `analyze()` or `analyzeTree()` returned.
 * @param source The parse result the buffer was produced from, or the
 *      `Program` node when the buffer came from `analyzeTree()`.
 * @returns The tree, ready for `JSON.stringify`.
 * @throws {TypeError} When the buffer is not a scope buffer, or the source
 *      does not match the path it was written on.
 */
export function toScopeTree(
	scopes: ArrayBuffer,
	source: ScopeSource,
): ScopeTree {
	const buffer = new ScopeBufferReader(scopes);
	const nodes = resolveNodeSource(source, buffer.treeHandles);
	const ast = nodes.ast;

	/**
	 * Renders the node a handle stores.
	 * @param handle The stored handle.
	 * @returns The rendered node, or `null` for handle `0`.
	 */
	function node(handle: number): ScopeTreeNode | null {
		if (handle === 0) {
			return null;
		}

		const value = nodes.nodeAt(handle);

		return {
			type: ast.typeName(value),
			start: ast.start(value),
			end: ast.end(value),
		};
	}

	/**
	 * Renders one variable.
	 * @param symbol The symbol ID.
	 * @returns The rendered variable.
	 */
	function variable(symbol: number): ScopeTreeVariable {
		const flags = buffer.symbolField(symbol, V_FLAGS);

		return {
			symbolId: symbol,
			name: buffer.string(buffer.symbolField(symbol, V_NAME)),
			tainted: (flags & VF_TAINTED) !== 0,
			stack: (flags & VF_STACK) !== 0,
			identifiers: buffer
				.listItems(buffer.symbolField(symbol, V_IDENTIFIERS))
				.map(handle => node(handle)!),
			defs: buffer
				.listItems(buffer.symbolField(symbol, V_DEFINITIONS))
				.map(definition => {
					const definitionFlags = buffer.definitionField(
						definition,
						D_FLAGS,
					);
					const index = buffer.definitionField(definition, D_INDEX);
					const kind = buffer.definitionField(definition, D_KIND);

					return {
						type: DEFINITION_TYPE_CODES[
							buffer.definitionField(definition, D_TYPE)
						],
						name: node(buffer.definitionField(definition, D_NAME))!,
						node: node(buffer.definitionField(definition, D_NODE))!,
						parent: node(
							buffer.definitionField(definition, D_PARENT),
						),
						index: index === 0 ? null : index - 1,
						kind: kind === 0 ? null : buffer.string(kind - 1),
						rest: (definitionFlags & DF_REST) !== 0,
					};
				}),
			references: buffer.listItems(
				buffer.symbolField(symbol, V_REFERENCES),
			),
			readCount: buffer.symbolField(symbol, V_READ_COUNT),
			writeCount: buffer.symbolField(symbol, V_WRITE_COUNT),
		};
	}

	/**
	 * Renders one reference.
	 * @param reference The reference ID.
	 * @returns The rendered reference.
	 */
	function renderReference(reference: number): ScopeTreeReference {
		const flags = buffer.referenceField(reference, R_FLAGS);
		const resolved = buffer.referenceField(reference, R_RESOLVED);

		return {
			referenceId: reference,
			identifier: node(buffer.referenceField(reference, R_IDENTIFIER))!,
			name: buffer.string(buffer.referenceField(reference, R_NAME)),
			read: (flags & RF_READ) !== 0,
			write: (flags & RF_WRITE) !== 0,
			init: (flags & RF_INIT) !== 0,
			partial: (flags & RF_PARTIAL) !== 0,
			tainted: (flags & RF_TAINTED) !== 0,
			valueReference: (flags & RF_VALUE) !== 0,
			typeReference: (flags & RF_TYPE) !== 0,
			resolved: resolved === 0 ? null : resolved - 1,
			writeExpr: node(buffer.referenceField(reference, R_WRITE_EXPR)),
		};
	}

	// Children of each scope, recovered from the stored upper pointers.
	const children: number[][] = Array.from(
		{ length: buffer.scopeCount },
		() => [],
	);

	for (let i = 0; i < buffer.scopeCount; i++) {
		const upper = buffer.scopeField(i, S_UPPER);

		if (upper !== 0) {
			children[upper - 1].push(i);
		}
	}

	/**
	 * Renders one scope and everything nested inside it.
	 * @param scope The scope ID.
	 * @returns The rendered scope.
	 */
	function renderScope(scope: number): ScopeTreeScope {
		const flags = buffer.scopeField(scope, S_FLAGS);
		const implicit = buffer.scopeField(scope, S_IMPLICIT);
		const isGlobal =
			SCOPE_TYPE_CODES[buffer.scopeField(scope, S_TYPE)] === "global";

		return {
			scopeId: scope,
			type: SCOPE_TYPE_CODES[buffer.scopeField(scope, S_TYPE)],
			block: node(buffer.scopeField(scope, S_BLOCK))!,
			isStrict: (flags & SF_STRICT) !== 0,
			dynamic: (flags & SF_DYNAMIC) !== 0,
			functionExpressionScope:
				(flags & SF_FUNCTION_EXPRESSION_SCOPE) !== 0,
			directCallToEvalScope: (flags & SF_DIRECT_EVAL) !== 0,
			thisFound: (flags & SF_THIS_FOUND) !== 0,
			variableScope: buffer.scopeField(scope, S_VARIABLE_SCOPE),
			variables: buffer
				.listItems(buffer.scopeField(scope, S_VARIABLES))
				.map(variable),
			references: buffer
				.listItems(buffer.scopeField(scope, S_REFERENCES))
				.map(renderReference),
			through: buffer.listItems(buffer.scopeField(scope, S_THROUGH)),
			implicit: isGlobal ? buffer.listItems(implicit).map(variable) : null,
			childScopes: children[scope].map(renderScope),
		};
	}

	const options = readSourceType(buffer);

	return {
		sourceType: options,
		root: buffer.scopeCount === 0 ? null : renderScope(0),
	};
}

/**
 * Reads the source type the analysis ran with out of the header.
 * @param buffer The reader over the scope buffer.
 * @returns The source type.
 */
function readSourceType(
	buffer: ScopeBufferReader,
): "script" | "module" | "commonjs" {
	const stored = buffer.words[SCOPE_H_OPTIONS] & OPT_SOURCE_TYPE_MASK;

	return stored === OPT_SOURCE_TYPE_MODULE
		? "module"
		: stored === OPT_SOURCE_TYPE_COMMONJS
			? "commonjs"
			: "script";
}
