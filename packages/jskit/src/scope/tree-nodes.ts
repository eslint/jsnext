/**
 * @fileoverview The deterministic enumeration behind tree-path node handles.
 *
 * A scope buffer stores node references as integers, and on the tree path
 * there is no byte offset to use: a node is the caller's own object. The
 * handle is instead the node's one-based position in the enumeration this
 * module produces.
 *
 * The whole scheme rests on one property: **the same tree enumerates the same
 * way every time.** `analyzeTree()` runs the enumeration to assign handles
 * while writing the buffer, and a consumer — `toScopeManager()`, `Scopes`,
 * `toScopeTree()` — runs it again on the same tree to turn handles back into
 * the very same objects. That holds because the walk below is pure and its
 * order depends only on the objects themselves: own-property order, depth
 * first, `parent` skipped to avoid cycles.
 *
 * The walk is deliberately generic — every own property that holds a node or
 * an array of nodes, not just the slots the analyzer knows — because the
 * analysis descends into unknown node types the same way, and a handle must
 * exist for anything the walk could have recorded.
 */

import type { EsTreeNode } from "./estree-ast.js";

/**
 * Reports whether a value is a node rather than some other property value.
 * @param value The property value to test.
 * @returns `true` when the value looks like an AST node.
 */
export function isEsTreeNode(value: unknown): value is EsTreeNode {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as EsTreeNode).type === "string"
	);
}

/**
 * Enumerates every node reachable from a root, depth first, in a fixed order.
 * @param root The `Program` node.
 * @returns Every reachable node. A node's handle is its index here plus one.
 */
export function collectTreeNodes(root: EsTreeNode): EsTreeNode[] {
	const nodes: EsTreeNode[] = [];
	const seen = new Set<EsTreeNode>();
	const stack: EsTreeNode[] = [root];

	while (stack.length > 0) {
		const node = stack.pop()!;

		if (seen.has(node)) {
			continue;
		}

		seen.add(node);
		nodes.push(node);

		/*
		 * Children go onto the stack in reverse so they come off in property
		 * order. The order itself does not matter; only that it is the same
		 * on every run over the same tree.
		 */
		const keys = Object.keys(node);

		for (let k = keys.length - 1; k >= 0; k--) {
			const key = keys[k];

			if (key === "parent") {
				continue;
			}

			/*
			 * The root's token and comment arrays can dwarf the tree itself,
			 * and skipping them is safe precisely because the root is a
			 * known kind: the walk reads a `Program` through its slots, so
			 * nothing under these two properties can ever be recorded. An
			 * unknown node type keeps them, because the walk's fallback
			 * inspects every property and the enumeration must reach
			 * whatever it could.
			 */
			if (node === root && (key === "tokens" || key === "comments")) {
				continue;
			}

			const value = node[key];

			if (isEsTreeNode(value)) {
				stack.push(value);
			} else if (Array.isArray(value)) {
				for (let i = value.length - 1; i >= 0; i--) {
					if (isEsTreeNode(value[i])) {
						stack.push(value[i]);
					}
				}
			}
		}
	}

	return nodes;
}
