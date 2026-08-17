/**
 * @fileoverview The public API: one entry point onto the analysis, and two
 * ways to read what it produces.
 *
 * `createGraph()` reads `@eslint/jsparse`'s binary parse buffer and
 * `@eslint/jsscope`'s binary scope buffer and returns one `ArrayBuffer` in
 * the binary flow format (`flow-buffer.ts`), where every graph, block, edge,
 * and write has a stable integer ID, every node reference is a byte offset
 * into the parse buffer, and every variable write points at its reference
 * record in the scope buffer by byte offset.
 *
 * Two consumers read that buffer:
 *
 * - `FlowBufferReader` answers point queries straight off the words —
 *   which block holds a node, whether the node is reachable, a block's
 *   writes, successors, and predecessors.
 * - `toGraphTree()` renders a plain JSON tree, for debugging and golden
 *   files.
 */

import { AstReader } from "@eslint/jsparse";
import { ScopeBufferReader } from "@eslint/jsscope";
import { FlowBuilder } from "./flow-builder.js";
import { FlowWalker } from "./flow-walker.js";

export { FlowBufferReader } from "./flow-buffer-reader.js";
export { toGraphTree } from "./to-graph-tree.js";
export type {
	FlowTree,
	FlowTreeBlock,
	FlowTreeEdge,
	FlowTreeGraph,
	FlowTreeNode,
	FlowTreeWrite,
} from "./to-graph-tree.js";
export { nodeAtHandle, nodeHandle } from "./handles.js";
export * from "./flow-buffer.js";

/**
 * Builds the control flow graph of a parsed program.
 *
 * The analysis runs on the binary buffers directly, so nothing is decoded
 * into ESTree objects along the way, and the result is itself binary: an
 * `ArrayBuffer` in the flow buffer format. Hand it to `FlowBufferReader`
 * for direct queries or `toGraphTree()` for a JSON-ready debugging view.
 *
 * The scope buffer must come from `analyze()` over the same parse result —
 * both buffers name nodes by the same byte offsets, and that is also how
 * the flow buffer ties a write to its scope reference. A buffer from
 * `analyzeTree()` names nodes another way and is refused.
 * @param parsed The parse buffer returned by `@eslint/jsparse`'s `parse()`.
 * @param scope The scope buffer returned by `@eslint/jsscope`'s `analyze()`.
 * @returns The flow buffer.
 * @throws {TypeError} When either buffer is not what its parameter claims,
 *      or the scope buffer was produced by `analyzeTree()`.
 */
export function createGraph(
	parsed: ArrayBufferLike,
	scope: ArrayBufferLike,
): ArrayBuffer {
	const reader = new AstReader(parsed);
	const scopeReader = new ScopeBufferReader(scope);

	if (scopeReader.treeHandles) {
		throw new TypeError(
			"The scope buffer stores tree handles; createGraph() needs a buffer from analyze() over the same parse result.",
		);
	}

	const builder = new FlowBuilder();

	new FlowWalker(reader, scopeReader, builder).build();

	return builder.finish();
}

export default { createGraph };
