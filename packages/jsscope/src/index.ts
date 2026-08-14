/**
 * @fileoverview The public API: two entry points onto one analysis, and three
 * views over what it produces.
 *
 * `analyze()` reads `@eslint/jsparse`'s binary buffers and `analyzeTree()`
 * reads an ordinary ESTree tree. They share the walk, the scope graph, and
 * every rule; all that differs is how a node is read. Both return the same
 * thing: one `ArrayBuffer` in the binary scope format (`scope-buffer.ts`),
 * where every scope, symbol, reference, and definition has a stable integer
 * ID and every node reference is a handle into the program that was analyzed.
 *
 * Three consumers read that buffer, each shaped for a different job:
 *
 * - `Scopes` answers point queries straight off the words — the exploratory
 *   API for finding out what the format can do.
 * - `toScopeManager()` rebuilds the escope-compatible object graph, for
 *   anything written against `eslint-scope`.
 * - `toScopeTree()` renders a plain JSON tree, for debugging and golden
 *   files.
 *
 * The two entry points are separate exports pulling in separate adapters on
 * purpose. This package sets `sideEffects: false`, so a bundler that sees
 * only one of them imported drops the other adapter — and, with the tree
 * adapter, the slot-name table that only it needs. The buffer consumers
 * accept either representation and therefore import both adapters; they do
 * not split.
 */

import { AstReader, type ParseResult } from "@eslint/jsparse";
import { BinaryAst } from "./binary-ast.js";
import { EstreeAst, type EsTreeNode } from "./estree-ast.js";
import { resolveOptions, type AnalyzeOptions } from "./options.js";
import { Referencer } from "./referencer.js";
import { ScopeBuilder } from "./scope-builder.js";
import { nodeHandle } from "./handles.js";
import { collectTreeNodes } from "./tree-nodes.js";

export { BinaryAst } from "./binary-ast.js";
export { Definition } from "./definition.js";
export { EstreeAst } from "./estree-ast.js";
export { Reference } from "./reference.js";
export { Scope } from "./scope.js";
export { ScopeManager } from "./scope-manager.js";
export { Variable } from "./variable.js";
export { PatternVisitor } from "./pattern-visitor.js";
export { Referencer } from "./referencer.js";
export { Scopes } from "./scopes.js";
export { toScopeManager } from "./to-scope-manager.js";
export type { ToScopeManagerOptions } from "./to-scope-manager.js";
export { toScopeTree } from "./to-scope-tree.js";
export { ScopeBufferReader } from "./scope-buffer-reader.js";

/*
 * The binary scope format itself — header words, record fields, flag bits,
 * enum code tables. Exported so that a tool consuming the buffer another way
 * (`@eslint/jsflow` stores byte offsets into it) reads the layout from the
 * one module that defines it instead of restating magic numbers.
 */
export * from "./scope-buffer.js";
export * from "./ast-access.js";
export * from "./kinds.js";
export type { AnalyzeOptions, ResolvedOptions } from "./options.js";
export type { EsTreeNode } from "./estree-ast.js";
export type { ImplicitGlobals } from "./scope.js";
export type { MaybeImplicitGlobal } from "./reference.js";
export type { PatternCallback, PatternInfo } from "./pattern-visitor.js";
export type { DefinitionType, ScopeType } from "./kinds.js";
export type { NodeSource, ScopeSource } from "./node-source.js";
export type {
	ScopeTree,
	ScopeTreeDefinition,
	ScopeTreeNode,
	ScopeTreeReference,
	ScopeTreeScope,
	ScopeTreeVariable,
} from "./to-scope-tree.js";

/**
 * Runs the analysis over whichever representation the caller supplied.
 * @param builder The graph being built.
 * @param root The `Program` node.
 * @returns The builder, with the whole program analyzed.
 */
function run<TNode>(
	builder: ScopeBuilder<TNode>,
	root: TNode,
): ScopeBuilder<TNode> {
	new Referencer(builder).visit(root);

	if (builder.options.globals !== null) {
		builder.addGlobals(builder.options.globals);
	}

	return builder;
}

/**
 * Finds the scopes of a parsed program and resolves every identifier in it.
 *
 * The analysis runs on the binary buffers `parse()` produced, so nothing is
 * decoded into ESTree objects along the way, and the result is itself binary:
 * an `ArrayBuffer` in the scope buffer format, where every binding has a
 * stable symbol ID and every node reference is the byte offset of the node's
 * record in the AST buffer. Hand it to `Scopes` for direct queries,
 * `toScopeManager()` for the escope-compatible object graph, or
 * `toScopeTree()` for a JSON-ready debugging view — each takes the buffer
 * and the same `ParseResult` given here.
 * @param result The value returned by `@eslint/jsparse`'s `parse()`.
 * @param options How the program should be interpreted.
 * @returns The scope buffer.
 * @throws {TypeError} When the buffer is not a jsparse AST buffer.
 */
export function analyze(
	result: ParseResult,
	options: AnalyzeOptions = {},
): ArrayBuffer {
	const reader = new AstReader(result.ast);
	const builder = new ScopeBuilder(
		new BinaryAst(reader),
		resolveOptions(options),
		node => nodeHandle(reader, node),
	);

	return run(builder, reader.root).finish(false);
}

/**
 * Finds the scopes of an ESTree program and resolves every identifier in it.
 *
 * This is the compatibility path, for a tree that came from `espree`,
 * `@typescript-eslint/parser`, or anything else that produces an
 * ESLint-shaped AST. The result is the same binary representation `analyze()`
 * returns; a node reference is stored as the node's position in a
 * deterministic enumeration of the tree, and the consumers recover the
 * caller's own node objects from it — pass them this buffer and the same
 * `program` given here.
 *
 * A tree has to be built before it can be walked, so this is the slower of
 * the two entry points. Use `analyze()` when the source is yours to parse.
 * @param program The `Program` node to analyze.
 * @param options How the program should be interpreted.
 * @returns The scope buffer.
 */
export function analyzeTree(
	program: EsTreeNode,
	options: AnalyzeOptions = {},
): ArrayBuffer {
	const handles = new Map<EsTreeNode, number>();
	const nodes = collectTreeNodes(program);

	for (let i = 0; i < nodes.length; i++) {
		handles.set(nodes[i], i + 1);
	}

	const builder = new ScopeBuilder(
		new EstreeAst(),
		resolveOptions(options),
		node => {
			const handle = handles.get(node);

			if (handle === undefined) {
				throw new Error(
					"The analysis recorded a node that is not reachable from the program.",
				);
			}

			return handle;
		},
	);

	return run(builder, program).finish(true);
}

export default { analyze, analyzeTree };
