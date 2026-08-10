/**
 * @fileoverview The public API: two entry points onto one analysis.
 *
 * `analyze()` reads `@eslint/jsparse`'s binary buffers and `analyzeTree()`
 * reads an ordinary ESTree tree. They share the walk, the scope graph, and
 * every rule; all that differs is how a node is read.
 *
 * The two are separate exports pulling in separate adapters on purpose. This
 * package sets `sideEffects: false`, so a bundler that sees only one of them
 * imported drops the other adapter — and, with the tree adapter, the slot-name
 * table that only it needs.
 */

import { AstReader, type ParseResult } from "@eslint/jsparse";
import { BinaryAst } from "./binary-ast.js";
import { EstreeAst, type EsTreeNode } from "./estree-ast.js";
import { resolveOptions, type AnalyzeOptions } from "./options.js";
import { Referencer } from "./referencer.js";
import { ScopeManager } from "./scope-manager.js";

export { BinaryAst } from "./binary-ast.js";
export { Definition } from "./definition.js";
export { EstreeAst } from "./estree-ast.js";
export { Reference } from "./reference.js";
export { Scope } from "./scope.js";
export { ScopeManager } from "./scope-manager.js";
export { Variable } from "./variable.js";
export { PatternVisitor } from "./pattern-visitor.js";
export { Referencer } from "./referencer.js";
export * from "./ast-access.js";
export * from "./kinds.js";
export type { AnalyzeOptions, ResolvedOptions } from "./options.js";
export type { EsTreeNode } from "./estree-ast.js";
export type { ImplicitGlobals } from "./scope.js";
export type { MaybeImplicitGlobal } from "./reference.js";
export type { PatternCallback, PatternInfo } from "./pattern-visitor.js";
export type { DefinitionType, ScopeType } from "./kinds.js";

/**
 * Runs the analysis over whichever representation the caller supplied.
 * @param ast How to read the program.
 * @param root The `Program` node.
 * @param options How the program should be interpreted.
 * @returns The finished scope graph.
 */
function run<TNode>(
	ast: ConstructorParameters<typeof ScopeManager<TNode>>[0],
	root: TNode,
	options: AnalyzeOptions,
): ScopeManager<TNode> {
	const resolved = resolveOptions(options);
	const scopeManager = new ScopeManager(ast, resolved);
	const referencer = new Referencer(scopeManager);

	referencer.visit(root);

	if (resolved.globals !== null) {
		scopeManager.addGlobals(resolved.globals);
	}

	return scopeManager;
}

/**
 * Finds the scopes of a parsed program and resolves every identifier in it.
 *
 * The analysis runs on the binary buffers `parse()` produced, so nothing is
 * decoded into ESTree objects along the way. Every node the result refers to —
 * a scope's `block`, a reference's `identifier`, a definition's `name` — is a
 * node index into that buffer, and `null` means there is no node. `AstReader`,
 * or the `nodeType` and `nodeRange` helpers on the returned manager, turn an
 * index back into something a caller can read.
 * @param result The value returned by `@eslint/jsparse`'s `parse()`.
 * @param options How the program should be interpreted.
 * @returns Every scope in the program, with each reference resolved to the
 *      variable it names wherever one could be found.
 * @throws {TypeError} When the buffer is not a jsparse AST buffer.
 */
export function analyze(
	result: ParseResult,
	options: AnalyzeOptions = {},
): ScopeManager<number> {
	const reader = new AstReader(result.ast);
	const scopeManager = run(new BinaryAst(reader), reader.root, options);

	scopeManager.reader = reader;

	return scopeManager;
}

/**
 * Finds the scopes of an ESTree program and resolves every identifier in it.
 *
 * This is the compatibility path, for a tree that came from `espree`,
 * `@typescript-eslint/parser`, or anything else that produces an
 * ESLint-shaped AST. Nodes in the result are the tree's own objects, so a
 * caller can compare them by identity with the nodes it already holds.
 *
 * A tree has to be built before it can be walked, so this is the slower of the
 * two entry points. Use `analyze()` when the source is yours to parse.
 * @param program The `Program` node to analyze.
 * @param options How the program should be interpreted.
 * @returns Every scope in the program, with each reference resolved to the
 *      variable it names wherever one could be found.
 */
export function analyzeTree(
	program: EsTreeNode,
	options: AnalyzeOptions = {},
): ScopeManager<EsTreeNode> {
	return run(new EstreeAst(), program, options);
}

export default { analyze, analyzeTree };
