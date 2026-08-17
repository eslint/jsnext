/**
 * @fileoverview Turning stored node handles back into nodes.
 *
 * A scope buffer refers to the AST by handle: a byte offset into the binary
 * parse buffer, or a position in the tree enumeration. The consumers that hand
 * nodes back to a caller — `Scopes`, `toScopeManager()`, `toScopeTree()` —
 * need the reverse mapping, and this module supplies it for both paths behind
 * one interface.
 *
 * Note that this module imports both adapters, so unlike `analyze()` and
 * `analyzeTree()` the consumers built on it are not split for tree shaking.
 * That is the cost of one function accepting either representation.
 */

import { AstReader, type ParseResult } from "@eslint/jsparse";
import type { AstAccess } from "./ast-access.js";
import { BinaryAst } from "./binary-ast.js";
import { EstreeAst, type EsTreeNode } from "./estree-ast.js";
import { nodeAtHandle, nodeHandle } from "./handles.js";
import { collectTreeNodes, isEsTreeNode } from "./tree-nodes.js";

/**
 * What a consumer of a scope buffer accepts as "the program": the parse
 * buffer the binary analysis ran over, a reader already constructed over it,
 * or the very `Program` node `analyzeTree()` was given.
 */
export type ScopeSource = ParseResult | AstReader | EsTreeNode;

/**
 * The reverse mapping from stored handles to nodes, plus how to read them.
 *
 * @template TNode How one node is represented.
 */
export interface NodeSource<TNode> {
	/** How to read the program the handles point into. */
	readonly ast: AstAccess<TNode>;

	/** The reader over the parse buffer, or `null` on the tree path. */
	readonly reader: AstReader | null;

	/** The node a handle stores, for a handle that is not `0`. */
	nodeAt(handle: number): TNode;

	/** The handle a node is stored as, or `0` for a node not in the program. */
	handleOf(node: TNode): number;
}

/**
 * Builds the node source for a scope buffer over a binary AST.
 * @param reader The reader over the parse buffer.
 * @returns The node source.
 */
function binaryNodeSource(reader: AstReader): NodeSource<number> {
	return {
		ast: new BinaryAst(reader),
		reader,
		nodeAt: handle => nodeAtHandle(reader, handle),
		handleOf: node => nodeHandle(reader, node),
	};
}

/**
 * Builds the node source for a scope buffer over an ESTree tree.
 * @param root The `Program` node the analysis ran over.
 * @returns The node source.
 */
function treeNodeSource(root: EsTreeNode): NodeSource<EsTreeNode> {
	const nodes = collectTreeNodes(root);
	const handles = new Map<EsTreeNode, number>();

	for (let i = 0; i < nodes.length; i++) {
		handles.set(nodes[i], i + 1);
	}

	return {
		ast: new EstreeAst(),
		reader: null,
		nodeAt: handle => nodes[handle - 1],
		handleOf: node => handles.get(node) ?? 0,
	};
}

/**
 * Resolves whatever the caller supplied as the program into a node source,
 * checking that it matches the path the buffer was written on.
 * @param source The parse result, reader, or `Program` node.
 * @param treeHandles Whether the buffer stores tree handles.
 * @returns The node source.
 * @throws {TypeError} When the source does not match the buffer.
 */
export function resolveNodeSource(
	source: ScopeSource,
	treeHandles: boolean,
): NodeSource<unknown> {
	if (source instanceof AstReader) {
		if (treeHandles) {
			throw new TypeError(
				"This scope buffer came from analyzeTree(); pass the Program node it analyzed.",
			);
		}

		return binaryNodeSource(source);
	}

	if (source instanceof ArrayBuffer) {
		if (treeHandles) {
			throw new TypeError(
				"This scope buffer came from analyzeTree(); pass the Program node it analyzed.",
			);
		}

		return binaryNodeSource(new AstReader(source));
	}

	if (isEsTreeNode(source)) {
		if (!treeHandles) {
			throw new TypeError(
				"This scope buffer came from analyze(); pass the parse result it analyzed.",
			);
		}

		return treeNodeSource(source);
	}

	throw new TypeError(
		"Expected a parse result, an AstReader, or a Program node.",
	);
}
