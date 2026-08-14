/**
 * @fileoverview Renders a flow buffer as a plain, JSON-serializable tree.
 *
 * This is the debugging view. Graphs come in build order with their blocks
 * nested inside them, every edge and write is spelled out with its flags,
 * and a node is rendered the way `@eslint/jsparse`'s own AST spells one — a
 * `type` with `start` and `end` — so the output stands on its own: no node
 * objects, no buffers, no live references to anything. `JSON.stringify` the
 * result and nothing is lost.
 *
 * Blocks and edges are numbered with their stable IDs, so cross-links — a
 * graph's returned list, an edge's target — point by ID without repeating
 * anything.
 */

import { AstReader, NODE_KIND_NAMES } from "@eslint/jsparse";
import {
	REFERENCE_WORDS,
	R_RESOLVED,
	ScopeBufferReader,
	H_REFERENCES_BASE,
	V_NAME,
} from "@eslint/jsscope";
import {
	BF_LOOP_HEAD,
	BF_REACHABLE,
	BF_RETURNS,
	BF_THROWS,
	B_FLAGS,
	B_PRED_COUNT,
	B_PRED_FIRST,
	B_SUCC_COUNT,
	B_SUCC_FIRST,
	B_WRITE_COUNT,
	B_WRITE_FIRST,
	EDGE_KIND_MASK,
	EDGE_KIND_NAMES,
	EF_BACK,
	E_COND,
	E_FLAGS,
	E_FROM,
	E_TO,
	G_BLOCK_COUNT,
	G_FIRST_BLOCK,
	G_IMPLICIT,
	G_INITIAL,
	G_NODE,
	G_ORIGIN,
	G_RETURNED,
	G_THROWN,
	G_UPPER,
	ORIGIN_NAMES,
	WF_COMPOUND,
	WF_INIT,
	WF_MEMBER,
	WF_UPDATE,
	W_EXPR,
	W_FLAGS,
	W_REF,
	W_TARGET,
} from "./flow-buffer.js";
import { FlowBufferReader } from "./flow-buffer-reader.js";
import { nodeAtHandle } from "./handles.js";

/** A node, rendered the way `@eslint/jsparse`'s AST spells one. */
export interface FlowTreeNode {
	type: string;
	start: number;
	end: number;
}

/** One recorded write, with its symbol resolved through the scope buffer. */
export interface FlowTreeWrite {
	target: FlowTreeNode;
	value: FlowTreeNode | null;

	/** The written variable's name, or `null` for a member write. */
	symbol: string | null;

	/** The written variable's symbol ID, or `null` for a member write. */
	symbolId: number | null;
	init: boolean;
	compound: boolean;
	update: boolean;
	member: boolean;
}

/** One outgoing edge. */
export interface FlowTreeEdge {
	edgeId: number;
	to: number;
	kind: string;
	back: boolean;
	condition: FlowTreeNode | null;
}

/** One basic block, numbered with its stable ID. */
export interface FlowTreeBlock {
	blockId: number;
	reachable: boolean;
	loopHead: boolean;
	returns: boolean;
	throws: boolean;
	writes: FlowTreeWrite[];
	successors: FlowTreeEdge[];

	/** The IDs of the blocks whose edges land here. */
	predecessors: number[];
}

/** One graph, with its blocks inline. */
export interface FlowTreeGraph {
	graphId: number;
	origin: string;
	node: FlowTreeNode;
	upper: number | null;
	initial: number;
	implicit: number | null;
	returned: number[];
	thrown: number[];
	blocks: FlowTreeBlock[];
}

/** The whole result: every graph, program first. */
export interface FlowTree {
	graphs: FlowTreeGraph[];
}

/**
 * Renders a flow buffer as a self-contained, JSON-serializable tree.
 * @param flow The buffer returned by `createGraph()`.
 * @param ast The AST buffer the graph was built from.
 * @param scope The scope buffer the graph was built with.
 * @returns The tree.
 * @throws {TypeError} When a buffer is not what its parameter claims.
 */
export function toGraphTree(
	flow: ArrayBufferLike,
	ast: ArrayBufferLike,
	scope: ArrayBufferLike,
): FlowTree {
	const reader = new FlowBufferReader(flow);
	const astReader = new AstReader(ast);
	const scopeReader = new ScopeBufferReader(scope);
	const referencesBase = scopeReader.words[H_REFERENCES_BASE];

	/**
	 * Spells a node the way the AST does.
	 * @param handle The node's handle.
	 * @returns The rendered node, or `null` for handle `0`.
	 */
	function nodeOf(handle: number): FlowTreeNode | null {
		if (handle === 0) {
			return null;
		}

		const node = nodeAtHandle(astReader, handle);

		return {
			type: NODE_KIND_NAMES[astReader.kind(node)],
			start: astReader.start(node),
			end: astReader.end(node),
		};
	}

	/**
	 * Renders one block.
	 * @param block The block ID.
	 * @returns The rendered block.
	 */
	function blockOf(block: number): FlowTreeBlock {
		const flags = reader.blockField(block, B_FLAGS);
		const writes: FlowTreeWrite[] = [];
		const writeFirst = reader.blockField(block, B_WRITE_FIRST);
		const writeCount = reader.blockField(block, B_WRITE_COUNT);

		for (let i = 0; i < writeCount; i++) {
			const write = writeFirst + i;
			const ref = reader.writeField(write, W_REF);
			const writeFlags = reader.writeField(write, W_FLAGS);
			let symbol: string | null = null;
			let symbolId: number | null = null;

			if (ref !== 0) {
				const refId =
					(ref / 4 - referencesBase) / REFERENCE_WORDS;
				const resolved = scopeReader.referenceField(refId, R_RESOLVED);

				if (resolved !== 0) {
					symbolId = resolved - 1;
					symbol = scopeReader.string(
						scopeReader.symbolField(symbolId, V_NAME),
					);
				}
			}

			writes.push({
				target: nodeOf(reader.writeField(write, W_TARGET))!,
				value: nodeOf(reader.writeField(write, W_EXPR)),
				symbol,
				symbolId,
				init: (writeFlags & WF_INIT) !== 0,
				compound: (writeFlags & WF_COMPOUND) !== 0,
				update: (writeFlags & WF_UPDATE) !== 0,
				member: (writeFlags & WF_MEMBER) !== 0,
			});
		}

		const successors: FlowTreeEdge[] = [];
		const succFirst = reader.blockField(block, B_SUCC_FIRST);
		const succCount = reader.blockField(block, B_SUCC_COUNT);

		for (let i = 0; i < succCount; i++) {
			const edge = succFirst + i;
			const edgeFlags = reader.edgeField(edge, E_FLAGS);

			successors.push({
				edgeId: edge,
				to: reader.edgeField(edge, E_TO),
				kind: EDGE_KIND_NAMES[edgeFlags & EDGE_KIND_MASK],
				back: (edgeFlags & EF_BACK) !== 0,
				condition: nodeOf(reader.edgeField(edge, E_COND)),
			});
		}

		const predecessors: number[] = [];
		const predFirst = reader.blockField(block, B_PRED_FIRST);
		const predCount = reader.blockField(block, B_PRED_COUNT);

		for (let i = 0; i < predCount; i++) {
			predecessors.push(
				reader.edgeField(reader.predecessorEdge(predFirst + i), E_FROM),
			);
		}

		return {
			blockId: block,
			reachable: (flags & BF_REACHABLE) !== 0,
			loopHead: (flags & BF_LOOP_HEAD) !== 0,
			returns: (flags & BF_RETURNS) !== 0,
			throws: (flags & BF_THROWS) !== 0,
			writes,
			successors,
			predecessors,
		};
	}

	const graphs: FlowTreeGraph[] = [];

	for (let graph = 0; graph < reader.graphCount; graph++) {
		const first = reader.graphField(graph, G_FIRST_BLOCK);
		const count = reader.graphField(graph, G_BLOCK_COUNT);
		const blocks: FlowTreeBlock[] = [];

		for (let i = 0; i < count; i++) {
			blocks.push(blockOf(first + i));
		}

		const upper = reader.graphField(graph, G_UPPER);
		const implicit = reader.graphField(graph, G_IMPLICIT);

		graphs.push({
			graphId: graph,
			origin: ORIGIN_NAMES[reader.graphField(graph, G_ORIGIN)],
			node: nodeOf(reader.graphField(graph, G_NODE))!,
			upper: upper === 0 ? null : upper - 1,
			initial: reader.graphField(graph, G_INITIAL),
			implicit: implicit === 0 ? null : implicit - 1,
			returned: reader.listItems(reader.graphField(graph, G_RETURNED)),
			thrown: reader.listItems(reader.graphField(graph, G_THROWN)),
			blocks,
		});
	}

	return { graphs };
}
