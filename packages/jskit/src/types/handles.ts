/**
 * @fileoverview The handle arithmetic, in both directions.
 *
 * A node reference in a type buffer is a **handle**: the byte offset of the
 * node's record inside the parse buffer the analysis ran over, exactly as the
 * scope and flow buffers store them. This module is deliberately the only
 * place the arithmetic is written down.
 */

import { type AstReader } from "../parse/index.js";

/**
 * The handle of a node: where its record sits in the parse buffer, in bytes.
 * @param reader The reader over the parse buffer the node belongs to.
 * @param node The node's index.
 * @returns The node's handle.
 */
export function typeNodeHandle(reader: AstReader, node: number): number {
	return (reader.nodesBase + node * reader.nodeWords) * 4;
}

/**
 * The node a handle names.
 * @param reader The reader over the parse buffer the handle points into.
 * @param handle The node's handle.
 * @returns The node's index.
 */
export function typeNodeAtHandle(reader: AstReader, handle: number): number {
	return (handle / 4 - reader.nodesBase) / reader.nodeWords;
}
