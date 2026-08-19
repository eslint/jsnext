/**
 * @fileoverview Rehydrates a scope buffer into the escope-compatible object
 * graph.
 *
 * This is the compatibility bar for the whole format: everything
 * `eslint-scope` puts on a `ScopeManager` — and that
 * `@eslint-community/eslint-utils`' `ReferenceTracker`, `findVariable`, and
 * `getStaticValue` read — has to come back out of the buffer exactly as the
 * walk originally built it. The conformance suites compare the rehydrated
 * graph against the reference implementations, so any field the buffer
 * dropped or reordered shows up there as a mismatch.
 *
 * The same classes the walk builds are reused rather than mimicked, so a
 * consumer cannot tell a rehydrated graph from a freshly built one. The one
 * addition is `Variable#symbolId`, which carries the buffer's stable ID.
 */

import { N_ArrowFunctionExpression } from "../parse/index.js";
import { Definition } from "./definition.js";
import type { DefinitionType, ScopeType } from "./kinds.js";
import { READ, REF_TYPE, REF_VALUE, SCOPE_FUNCTION, WRITE } from "./kinds.js";
import {
	resolveNodeSource,
	type NodeSource,
	type ScopeSource,
} from "./node-source.js";
import type { ResolvedOptions } from "./options.js";
import { Reference, type MaybeImplicitGlobal } from "./reference.js";
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
	DF_TYPE_DEFINITION,
	DF_VARIABLE_DEFINITION,
	SCOPE_H_DECLARED_BASE,
	SCOPE_H_DECLARED_COUNT,
	SCOPE_H_JSX_FRAGMENT,
	SCOPE_H_JSX_PRAGMA,
	SCOPE_H_OPTIONS,
	OPT_DIALECT_TS,
	OPT_GLOBAL_RETURN,
	OPT_IGNORE_EVAL,
	OPT_IMPLIED_STRICT,
	OPT_JSX,
	OPT_SOURCE_TYPE_COMMONJS,
	OPT_SOURCE_TYPE_MASK,
	OPT_SOURCE_TYPE_MODULE,
	R_FLAGS,
	R_FROM,
	R_IDENTIFIER,
	R_IG_NODE,
	R_IG_PATTERN,
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
	S_REFERENCES,
	S_THROUGH,
	S_TYPE,
	S_UPPER,
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
	V_REFERENCES,
	V_SCOPE,
	VF_IMPLICIT_GLOBAL,
	VF_STACK,
	VF_TAINTED,
} from "./scope-buffer.js";
import { Scope } from "./scope.js";
import { ScopeManager } from "./scope-manager.js";
import type { Scopes } from "./scopes.js";
import { Variable } from "./variable.js";
import type { EsTreeNode } from "./estree-ast.js";
import type { AstReader, ParseResult } from "../parse/index.js";

/**
 * The two methods of `Scopes` the shared-usage bridge actually calls. The
 * implementation signature accepts this structural supertype so that one
 * implementation can sit under both overloads.
 */
interface SymbolUseSink {
	markSymbolAsUsed(symbol: number): void;
	isSymbolUsed(symbol: number): boolean;
}

/**
 * Options for `toScopeManager()`.
 *
 * @template TNode How one node is represented.
 */
export interface ToScopeManagerOptions<TNode> {
	/**
	 * A `Scopes` view over the same buffer to share usage marks with. When
	 * given, every rehydrated `Variable#eslintUsed` becomes an accessor over
	 * that instance's side bitset, so `markVariableAsUsed()`-style writes on
	 * one view are visible from `isSymbolUsed()` on the other. Marks only
	 * accumulate: setting `eslintUsed` back to `false` is ignored, which is
	 * all ESLint's own machinery ever needs.
	 */
	scopes?: Scopes<TNode>;
}

/**
 * Reconstructs the options word into the resolved options the analysis ran
 * with. `globals` comes back as `null` because supplied globals are already
 * materialized as variables in the buffer.
 * @param reader The reader over the scope buffer.
 * @returns The options.
 */
function readOptions(reader: ScopeBufferReader): ResolvedOptions {
	const stored = reader.words[SCOPE_H_OPTIONS];
	const sourceTypeCode = stored & OPT_SOURCE_TYPE_MASK;
	const pragma = reader.words[SCOPE_H_JSX_PRAGMA];
	const fragment = reader.words[SCOPE_H_JSX_FRAGMENT];

	return {
		sourceType:
			sourceTypeCode === OPT_SOURCE_TYPE_MODULE
				? "module"
				: sourceTypeCode === OPT_SOURCE_TYPE_COMMONJS
					? "commonjs"
					: "script",
		dialect: (stored & OPT_DIALECT_TS) !== 0 ? "ts" : "js",
		jsx: (stored & OPT_JSX) !== 0,
		impliedStrict: (stored & OPT_IMPLIED_STRICT) !== 0,
		globalReturn: (stored & OPT_GLOBAL_RETURN) !== 0,
		ignoreEval: (stored & OPT_IGNORE_EVAL) !== 0,
		globals: null,
		jsxPragma: pragma === 0 ? null : reader.string(pragma - 1),
		jsxFragmentName: fragment === 0 ? null : reader.string(fragment - 1),
	};
}

/**
 * Rehydrates one scope buffer over one node source.
 * @param buffer The reader over the scope buffer.
 * @param nodes The node source matching the buffer's handles.
 * @returns The reconstructed manager.
 */
function rehydrate<TNode>(
	buffer: ScopeBufferReader,
	nodes: NodeSource<TNode>,
	sharedUse: SymbolUseSink | undefined,
): ScopeManager<TNode> {
	const manager = new ScopeManager<TNode>(nodes.ast, readOptions(buffer));

	/**
	 * The node a stored handle names, or `null` for handle `0`.
	 * @param handle The stored handle.
	 * @returns The node or `null`.
	 */
	function nodeAt(handle: number): TNode | null {
		return handle === 0 ? null : nodes.nodeAt(handle);
	}

	//-------------------------------------------------------------------------
	// Scopes
	//-------------------------------------------------------------------------

	/*
	 * Scopes are stored in creation order and every scope's parent precedes
	 * it, so creating them in stored order rebuilds `childScopes`, the
	 * manager's scope list, and the node-to-scope map as side effects of the
	 * constructor — the same side effects the walk relied on.
	 */
	const scopes: Scope<TNode>[] = new Array(buffer.scopeCount);

	for (let i = 0; i < buffer.scopeCount; i++) {
		const flags = buffer.scopeField(i, S_FLAGS);
		const upperStored = buffer.scopeField(i, S_UPPER);
		const scope = new Scope(
			manager,
			SCOPE_TYPE_CODES[buffer.scopeField(i, S_TYPE)] as ScopeType,
			upperStored === 0 ? null : scopes[upperStored - 1],
			nodes.nodeAt(buffer.scopeField(i, S_BLOCK)),
			false,
			(flags & SF_STRICT) !== 0,
		);

		scope.scopeId = i;
		scope.dynamic = (flags & SF_DYNAMIC) !== 0;
		scope.functionExpressionScope =
			(flags & SF_FUNCTION_EXPRESSION_SCOPE) !== 0;
		scope.directCallToEvalScope = (flags & SF_DIRECT_EVAL) !== 0;
		scope.thisFound = (flags & SF_THIS_FOUND) !== 0;
		scopes[i] = scope;
	}

	manager.globalScope = scopes[0] ?? null;

	//-------------------------------------------------------------------------
	// Symbols and definitions
	//-------------------------------------------------------------------------

	const variables: Variable<TNode>[] = new Array(buffer.symbolCount);

	for (let i = 0; i < buffer.symbolCount; i++) {
		const scope = scopes[buffer.symbolField(i, V_SCOPE)];
		const flags = buffer.symbolField(i, V_FLAGS);
		const variable = new Variable(
			buffer.string(buffer.symbolField(i, V_NAME)),
			scope,
		);

		variable.tainted = (flags & VF_TAINTED) !== 0;
		variable.stack = (flags & VF_STACK) !== 0;
		variable.symbolId = i;

		if (sharedUse !== undefined) {
			const symbolId = i;

			Object.defineProperty(variable, "eslintUsed", {
				get: () => sharedUse.isSymbolUsed(symbolId),
				set: (value: boolean) => {
					if (value) {
						sharedUse.markSymbolAsUsed(symbolId);
					}
				},
				enumerable: true,
				configurable: true,
			});
		}

		for (const handle of buffer.listItems(
			buffer.symbolField(i, V_IDENTIFIERS),
		)) {
			variable.identifiers.push(nodes.nodeAt(handle));
		}

		for (const definition of buffer.listItems(
			buffer.symbolField(i, V_DEFINITIONS),
		)) {
			const definitionFlags = buffer.definitionField(definition, D_FLAGS);
			const index = buffer.definitionField(definition, D_INDEX);
			const kind = buffer.definitionField(definition, D_KIND);
			const hydrated = new Definition(
				DEFINITION_TYPE_CODES[
					buffer.definitionField(definition, D_TYPE)
				] as DefinitionType,
				nodes.nodeAt(buffer.definitionField(definition, D_NAME)),
				nodes.nodeAt(buffer.definitionField(definition, D_NODE)),
				nodeAt(buffer.definitionField(definition, D_PARENT)),
				index === 0 ? null : index - 1,
				kind === 0 ? null : buffer.string(kind - 1),
				(definitionFlags & DF_REST) !== 0,
				(definitionFlags & DF_TYPE_DEFINITION) !== 0,
				(definitionFlags & DF_VARIABLE_DEFINITION) !== 0,
			);

			hydrated.definitionId = definition;
			variable.defs.push(hydrated);
		}

		/*
		 * An implicit global lives in the global scope's implicit lists; every
		 * other variable lives in its scope's own map and list.
		 */
		if ((flags & VF_IMPLICIT_GLOBAL) !== 0) {
			scope.implicit!.set.set(variable.name, variable);
			scope.implicit!.variables.push(variable);
		} else {
			scope.set.set(variable.name, variable);
			scope.variables.push(variable);
		}

		if (variable.tainted) {
			scope.taints.set(variable.name, true);
		}

		variables[i] = variable;
	}

	/*
	 * A non-arrow function scope taints `arguments` at creation, before any
	 * resolution happens, so it is re-derived here the same way rather than
	 * stored.
	 */
	for (const scope of scopes) {
		if (
			scope.type === SCOPE_FUNCTION &&
			nodes.ast.kind(scope.block) !== N_ArrowFunctionExpression
		) {
			scope.taints.set("arguments", true);
		}
	}

	//-------------------------------------------------------------------------
	// References
	//-------------------------------------------------------------------------

	const references: Reference<TNode>[] = new Array(buffer.referenceCount);

	for (let i = 0; i < buffer.referenceCount; i++) {
		const flags = buffer.referenceField(i, R_FLAGS);
		const patternHandle = buffer.referenceField(i, R_IG_PATTERN);
		const implicitGlobal: MaybeImplicitGlobal<TNode> | null =
			patternHandle === 0
				? null
				: {
						pattern: nodes.nodeAt(patternHandle),
						node: nodes.nodeAt(buffer.referenceField(i, R_IG_NODE)),
					};
		const reference = new Reference(
			nodes.nodeAt(buffer.referenceField(i, R_IDENTIFIER)),
			buffer.string(buffer.referenceField(i, R_NAME)),
			scopes[buffer.referenceField(i, R_FROM)],
			(flags & RF_READ ? READ : 0) | (flags & RF_WRITE ? WRITE : 0),
			nodeAt(buffer.referenceField(i, R_WRITE_EXPR)),
			implicitGlobal,
			(flags & RF_PARTIAL) !== 0,
			(flags & RF_INIT) !== 0,
			(flags & RF_VALUE ? REF_VALUE : 0) | (flags & RF_TYPE ? REF_TYPE : 0),
		);

		const resolved = buffer.referenceField(i, R_RESOLVED);

		reference.referenceId = i;
		reference.resolved = resolved === 0 ? null : variables[resolved - 1];
		reference.tainted = (flags & RF_TAINTED) !== 0;
		references[i] = reference;
	}

	//-------------------------------------------------------------------------
	// Wire the lists
	//-------------------------------------------------------------------------

	for (let i = 0; i < buffer.scopeCount; i++) {
		const scope = scopes[i];

		for (const ref of buffer.listItems(buffer.scopeField(i, S_REFERENCES))) {
			scope.references.push(references[ref]);
		}

		for (const ref of buffer.listItems(buffer.scopeField(i, S_THROUGH))) {
			scope.through.push(references[ref]);
		}

		// A closed scope has resolved everything it was ever going to.
		scope.left = null;
	}

	for (let i = 0; i < buffer.symbolCount; i++) {
		const variable = variables[i];

		for (const ref of buffer.listItems(
			buffer.symbolField(i, V_REFERENCES),
		)) {
			variable.references.push(references[ref]);
		}
	}

	if (manager.globalScope !== null) {
		manager.globalScope.implicit!.left = [...manager.globalScope.through];
	}

	//-------------------------------------------------------------------------
	// The declared-variables index
	//-------------------------------------------------------------------------

	const declaredBase = buffer.words[SCOPE_H_DECLARED_BASE];
	const declaredCount = buffer.words[SCOPE_H_DECLARED_COUNT];

	for (let i = 0; i < declaredCount; i++) {
		const node = nodes.nodeAt(buffer.words[declaredBase + i * 2]);

		for (const symbol of buffer.listItems(
			buffer.words[declaredBase + i * 2 + 1],
		)) {
			manager.addDeclaredVariable(variables[symbol], node);
		}
	}

	manager.reader = nodes.reader;

	return manager;
}

/**
 * Rebuilds the escope-compatible object graph out of a scope buffer.
 *
 * The result is indistinguishable from what the walk itself used to return:
 * the same classes, the same field values, the same list orders. It is the
 * view to hand to anything written against `eslint-scope` — including
 * `@eslint-community/eslint-utils`, whose `ReferenceTracker`, `findVariable`,
 * and `getStaticValue` read it directly. `Variable#eslintUsed` is an
 * ordinary writable field, as those consumers expect.
 * @param scopes The buffer `analyze()` or `analyzeTree()` returned.
 * @param source The parse result the buffer was produced from, or the
 *      `Program` node when the buffer came from `analyzeTree()`.
 * @param options How to reconstruct, including a `Scopes` view to share
 *      usage marks with.
 * @returns The reconstructed scope manager: over node indexes for a parse
 *      result or reader, over the tree's own objects for a `Program` node.
 * @throws {TypeError} When the buffer is not a scope buffer, or the source
 *      does not match the path it was written on.
 */
export function toScopeManager<TSource extends ScopeSource>(
	scopes: ArrayBuffer,
	source: TSource,
	options: ToScopeManagerOptions<RehydratedNode<TSource>> = {},
): ScopeManager<RehydratedNode<TSource>> {
	const buffer = new ScopeBufferReader(scopes);

	return rehydrate(
		buffer,
		resolveNodeSource(source, buffer.treeHandles),
		options.scopes,
	) as ScopeManager<RehydratedNode<TSource>>;
}

/**
 * The node representation a source rehydrates to: the tree's own objects when
 * the source is a `Program` node, node indexes otherwise.
 */
export type RehydratedNode<TSource extends ScopeSource> =
	TSource extends ParseResult | AstReader ? number : EsTreeNode;
