/**
 * @fileoverview The handle arithmetic for the binary path.
 *
 * A scope buffer written by `analyze()` refers to a node by the byte offset
 * of its record in the parse buffer. The offset and the node index each
 * determine the other through the reader's layout, and these two functions
 * are the only place that arithmetic is written down.
 *
 * They live in their own module, importing nothing but a type, so that
 * `analyze()` can compute handles without pulling in the consumers' node
 * resolution machinery — and, through it, the tree adapter.
 */

import type { AstReader } from "../parse/index.js";

/**
 * The two layout numbers the arithmetic needs: a reader over the parse
 * buffer has them, and so does the node table `toAST()` records, which
 * outlives the buffer.
 */
export type NodeLayout = Pick<AstReader, "nodesBase" | "nodeWords">;

/**
 * The handle the binary path stores for a node: the byte offset of its
 * record in the parse buffer.
 * @param reader The reader over the parse buffer, or its layout.
 * @param node The node index.
 * @returns The byte offset.
 */
export function nodeHandle(reader: NodeLayout, node: number): number {
	return (reader.nodesBase + node * reader.nodeWords) * 4;
}

/**
 * The node index a stored handle names.
 * @param reader The reader over the parse buffer, or its layout.
 * @param handle The byte offset of the node's record.
 * @returns The node index.
 */
export function nodeAtHandle(reader: NodeLayout, handle: number): number {
	return (handle / 4 - reader.nodesBase) / reader.nodeWords;
}
