/**
 * @fileoverview The low-level reader over a flow buffer.
 *
 * Everything that consumes the binary flow format reads it through this
 * class, so the layout knowledge lives in exactly two places: the builder
 * and here.
 *
 * Reads are cheap on purpose. A record field is one multiply, one add, and a
 * typed-array load; the node-block index is a binary search over sorted word
 * pairs, which is what makes "is this node reachable" one call with no
 * consumer-side segment tracking.
 */

import {
	BF_REACHABLE,
	BLOCK_WORDS,
	B_FLAGS,
	EDGE_WORDS,
	FLOW_BUFFER_MAGIC,
	FLOW_BUFFER_VERSION,
	GRAPH_WORDS,
	FLOW_H_BLOCKS_BASE,
	FLOW_H_BLOCK_COUNT,
	FLOW_H_EDGES_BASE,
	FLOW_H_EDGE_COUNT,
	FLOW_H_GRAPHS_BASE,
	FLOW_H_GRAPH_COUNT,
	FLOW_H_MAGIC,
	FLOW_H_NODE_BLOCK_BASE,
	FLOW_H_NODE_BLOCK_COUNT,
	FLOW_H_POOL_BASE,
	FLOW_H_PREDS_BASE,
	FLOW_H_VERSION,
	FLOW_H_WRITES_BASE,
	FLOW_H_WRITE_COUNT,
	NB_BLOCK,
	NB_NODE,
	NODE_BLOCK_WORDS,
	WRITE_WORDS,
} from "./flow-buffer.js";

/**
 * Reads graphs, blocks, edges, writes, and the node-block index out of a
 * flow buffer.
 */
export class FlowBufferReader {
	/** The whole buffer, viewed as 32-bit words. */
	readonly words: Uint32Array;

	/** How many graphs the buffer holds. */
	readonly graphCount: number;

	/** How many blocks the buffer holds. */
	readonly blockCount: number;

	/** How many edges the buffer holds. */
	readonly edgeCount: number;

	/** How many writes the buffer holds. */
	readonly writeCount: number;

	/** How many entries the node-block index holds. */
	readonly nodeBlockCount: number;

	/** Word index at which the graph records begin. */
	readonly #graphsBase: number;

	/** Word index at which the block records begin. */
	readonly #blocksBase: number;

	/** Word index at which the edge records begin. */
	readonly #edgesBase: number;

	/** Word index at which the predecessor section begins. */
	readonly #predsBase: number;

	/** Word index at which the write records begin. */
	readonly #writesBase: number;

	/** Word index at which the list pool begins. */
	readonly #poolBase: number;

	/** Word index at which the node-block index begins. */
	readonly #nodeBlockBase: number;

	/**
	 * Creates a reader over a flow buffer.
	 * @param buffer The buffer returned by `createGraph()`.
	 * @throws {TypeError} When the buffer is not a jskit flow buffer.
	 */
	constructor(buffer: ArrayBufferLike) {
		const words = new Uint32Array(buffer);

		if (
			words.length < 2 ||
			words[FLOW_H_MAGIC] !== FLOW_BUFFER_MAGIC ||
			words[FLOW_H_VERSION] !== FLOW_BUFFER_VERSION
		) {
			throw new TypeError("Not a jskit flow buffer.");
		}

		this.words = words;
		this.graphCount = words[FLOW_H_GRAPH_COUNT];
		this.blockCount = words[FLOW_H_BLOCK_COUNT];
		this.edgeCount = words[FLOW_H_EDGE_COUNT];
		this.writeCount = words[FLOW_H_WRITE_COUNT];
		this.#graphsBase = words[FLOW_H_GRAPHS_BASE];
		this.#blocksBase = words[FLOW_H_BLOCKS_BASE];
		this.#edgesBase = words[FLOW_H_EDGES_BASE];
		this.#predsBase = words[FLOW_H_PREDS_BASE];
		this.#writesBase = words[FLOW_H_WRITES_BASE];
		this.#poolBase = words[FLOW_H_POOL_BASE];
		this.#nodeBlockBase = words[FLOW_H_NODE_BLOCK_BASE];
		this.nodeBlockCount = words[FLOW_H_NODE_BLOCK_COUNT];
	}

	//-------------------------------------------------------------------------
	// Records
	//-------------------------------------------------------------------------

	/**
	 * Reads one word of a graph record.
	 * @param graph The graph ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	graphField(graph: number, field: number): number {
		return this.words[this.#graphsBase + graph * GRAPH_WORDS + field];
	}

	/**
	 * Reads one word of a block record.
	 * @param block The block ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	blockField(block: number, field: number): number {
		return this.words[this.#blocksBase + block * BLOCK_WORDS + field];
	}

	/**
	 * Reads one word of an edge record.
	 * @param edge The edge ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	edgeField(edge: number, field: number): number {
		return this.words[this.#edgesBase + edge * EDGE_WORDS + field];
	}

	/**
	 * Reads one word of a write record.
	 * @param write The write ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	writeField(write: number, field: number): number {
		return this.words[this.#writesBase + write * WRITE_WORDS + field];
	}

	/**
	 * Reads one entry of the predecessor section: the ID of an edge whose
	 * target is the block whose `B_PRED_FIRST` range covers the index.
	 * @param index The position within the predecessor section.
	 * @returns The edge ID.
	 */
	predecessorEdge(index: number): number {
		return this.words[this.#predsBase + index];
	}

	//-------------------------------------------------------------------------
	// Lists
	//-------------------------------------------------------------------------

	/**
	 * How many items a pool list holds.
	 * @param handle The list handle.
	 * @returns The item count, or `0` for the empty list.
	 */
	listCount(handle: number): number {
		return handle === 0 ? 0 : this.words[this.#poolBase + handle];
	}

	/**
	 * Reads one item of a pool list.
	 * @param handle The list handle.
	 * @param index The zero-based position within the list.
	 * @returns The stored word.
	 */
	listItem(handle: number, index: number): number {
		return this.words[this.#poolBase + handle + 1 + index];
	}

	/**
	 * Reads a whole pool list.
	 * @param handle The list handle.
	 * @returns The items, or an empty array for the empty list.
	 */
	listItems(handle: number): number[] {
		const count = this.listCount(handle);
		const items = new Array<number>(count);
		const base = this.#poolBase + handle + 1;

		for (let i = 0; i < count; i++) {
			items[i] = this.words[base + i];
		}

		return items;
	}

	//-------------------------------------------------------------------------
	// The node-block index
	//-------------------------------------------------------------------------

	/**
	 * Reads one word of a node-block index entry.
	 *
	 * Entries are sorted by node handle, which is what `blockOfNode()`
	 * binary-searches. Reading them in order is the other direction of the
	 * same index — every node a block holds, without a query per node —
	 * and is how `toGraphTree()` fills a block's `nodes`.
	 * @param entry The entry index, below `nodeBlockCount`.
	 * @param field The word offset within the entry.
	 * @returns The stored value.
	 */
	nodeBlockField(entry: number, field: number): number {
		return this.words[
			this.#nodeBlockBase + entry * NODE_BLOCK_WORDS + field
		];
	}

	/**
	 * The block a node executes in.
	 * @param handle The node's handle.
	 * @returns The block ID, or `-1` when the walk never visited the node —
	 *      a type annotation, or scaffolding that does not execute.
	 */
	blockOfNode(handle: number): number {
		const words = this.words;
		const base = this.#nodeBlockBase;
		let low = 0;
		let high = this.nodeBlockCount;

		while (low < high) {
			const mid = (low + high) >>> 1;

			if (words[base + mid * NODE_BLOCK_WORDS + NB_NODE] < handle) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		return low < this.nodeBlockCount &&
			words[base + low * NODE_BLOCK_WORDS + NB_NODE] === handle
			? this.nodeBlockField(low, NB_BLOCK)
			: -1;
	}

	/**
	 * Whether control can reach a node from its graph's entry.
	 * @param handle The node's handle.
	 * @returns `true` when the node's block is reachable; `false` when it is
	 *      not, or when the walk never visited the node.
	 */
	isReachable(handle: number): boolean {
		const block = this.blockOfNode(handle);

		return (
			block >= 0 && (this.blockField(block, B_FLAGS) & BF_REACHABLE) !== 0
		);
	}
}
