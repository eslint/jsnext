/**
 * @fileoverview The handle arithmetic for node references.
 *
 * A flow buffer refers to a node by the byte offset of its record in the AST
 * buffer the graph was built from — the same scheme `@eslint/jsscope`'s
 * binary path uses, so a handle read out of either buffer names the same
 * node. The offset and the node index each determine the other through the
 * reader's layout, and these two functions are the only place that
 * arithmetic is written down.
 */

import type { AstReader } from "@eslint/jsparse";

/**
 * The handle stored for a node: the byte offset of its record in the AST
 * buffer.
 * @param reader The reader over the parse buffer.
 * @param node The node index.
 * @returns The byte offset.
 */
export function nodeHandle(reader: AstReader, node: number): number {
	return (reader.nodesBase + node * reader.nodeWords) * 4;
}

/**
 * The node index a stored handle names.
 * @param reader The reader over the parse buffer.
 * @param handle The byte offset of the node's record.
 * @returns The node index.
 */
export function nodeAtHandle(reader: AstReader, handle: number): number {
	return (handle / 4 - reader.nodesBase) / reader.nodeWords;
}
