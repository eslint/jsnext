/**
 * @fileoverview The public API: one entry point onto the analysis, and two
 * ways to read what it produces.
 *
 * `createGraph()` reads the parser's binary parse buffer and the scope
 * analyzer's binary scope buffer and returns one `ArrayBuffer` in the binary
 * flow format (`flow-buffer.ts`), where every graph, block, edge, and write
 * has a stable integer ID, every node reference is a byte offset into the
 * parse buffer, and every variable write points at its reference record in
 * the scope buffer by byte offset.
 *
 * Two consumers read that buffer:
 *
 * - `FlowBufferReader` answers point queries straight off the words —
 *   which block holds a node, whether the node is reachable, a block's
 *   writes, successors, and predecessors.
 * - `toGraphTree()` renders a plain JSON tree, for debugging and golden
 *   files.
 */

import { AstReader, native, supplySource } from "../parse/index.js";
import { ScopeBufferReader } from "../scope/index.js";
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
 * Options for `createGraph()`.
 */
export interface CreateGraphOptions {
	/**
	 * The program text the parse buffer was parsed from, for a buffer that
	 * cannot otherwise reach it — one parsed without `{ source: true }` and
	 * then read outside the process that parsed it. A fallback, never an
	 * override. The walk reads text only to match labels, so a program
	 * without them analyzes either way; supplying the text makes the result
	 * independent of what the program happens to contain.
	 */
	text?: string;
}

/**
 * The source text a reader can reach, or `null` when the buffer carries none
 * and none is cached — the one case the reader reports by throwing.
 * @param reader The reader over the parse buffer.
 * @returns The text, or `null`.
 */
function sourceOrNull(reader: AstReader): string | null {
	try {
		return reader.source;
	} catch {
		return null;
	}
}

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
 * @param parsed The parse buffer returned by `parse()`.
 * @param scope The scope buffer returned by `analyze()`.
 * @param options How the program should be read.
 * @returns The flow buffer.
 * @throws {TypeError} When either buffer is not what its parameter claims,
 *      or the scope buffer was produced by `analyzeTree()`, or the text does
 *      not match the parse buffer.
 */
export function createGraph(
	parsed: ArrayBufferLike,
	scope: ArrayBufferLike,
	options: CreateGraphOptions = {},
): ArrayBuffer {
	if (options.text !== undefined) {
		supplySource(parsed, options.text);
	}

	const reader = new AstReader(parsed);
	const scopeReader = new ScopeBufferReader(scope);

	if (scopeReader.treeHandles) {
		throw new TypeError(
			"The scope buffer stores tree handles; createGraph() needs a buffer from analyze() over the same parse result.",
		);
	}

	/*
	 * The native implementation writes the same buffer, so when a binding is
	 * registered the TypeScript walk below never runs. The binding needs the
	 * source text up front, where this walk reads it only to match labels —
	 * so a buffer whose text is unreachable falls through to the TypeScript
	 * path, which fails only if the program actually contains labels.
	 */
	if (native !== null) {
		const text = sourceOrNull(reader);

		if (text !== null) {
			return native.createGraph(
				parsed as ArrayBuffer,
				scope as ArrayBuffer,
				text,
			);
		}
	}

	const builder = new FlowBuilder();

	new FlowWalker(reader, scopeReader, builder).build();

	return builder.finish();
}
