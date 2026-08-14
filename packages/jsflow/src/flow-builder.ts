/**
 * @fileoverview The graph in binary form: recording and emission.
 *
 * The walk materializes no objects. A graph, block, edge, or write is a run
 * of words in a growable buffer, and `finish()` compacts them into one
 * `ArrayBuffer` in the flow buffer format.
 *
 * Reachability is computed as edges are added rather than by a fixpoint
 * pass afterward. That is sound because of how the walk orders its work: a
 * block's outgoing edges are only recorded once every edge that could make
 * the block reachable already exists. A loop back edge can never be the edge
 * that first reaches a loop head, because the loop body it comes from is
 * itself only reachable through that head.
 *
 * Graphs are built strictly one at a time — nested functions are queued, not
 * walked inline — which is what makes a graph's blocks contiguous and lets
 * one `first`/`count` pair stand in for a block list.
 */

import {
	BF_LOOP_HEAD,
	BF_REACHABLE,
	BLOCK_WORDS,
	EDGE_WORDS,
	EF_BACK,
	B_FLAGS,
	B_GRAPH,
	B_PRED_COUNT,
	B_PRED_FIRST,
	B_SUCC_COUNT,
	B_SUCC_FIRST,
	B_WRITE_COUNT,
	B_WRITE_FIRST,
	E_COND,
	E_FLAGS,
	E_FROM,
	E_TO,
	FLOW_BUFFER_MAGIC,
	FLOW_BUFFER_VERSION,
	GRAPH_WORDS,
	G_BLOCK_COUNT,
	G_FIRST_BLOCK,
	G_IMPLICIT,
	G_INITIAL,
	G_NODE,
	G_ORIGIN,
	G_RETURNED,
	G_THROWN,
	G_UPPER,
	HEADER_WORDS,
	H_BLOCKS_BASE,
	H_BLOCK_COUNT,
	H_EDGES_BASE,
	H_EDGE_COUNT,
	H_FLAGS,
	H_GRAPHS_BASE,
	H_GRAPH_COUNT,
	H_MAGIC,
	H_NODE_BLOCK_BASE,
	H_NODE_BLOCK_COUNT,
	H_POOL_BASE,
	H_PREDS_BASE,
	H_VERSION,
	H_WRITES_BASE,
	H_WRITE_COUNT,
	WRITE_WORDS,
	W_EXPR,
	W_FLAGS,
	W_REF,
	W_TARGET,
} from "./flow-buffer.js";

/** How many words a write occupies while being built; `block` leads. */
const BUILD_WRITE_WORDS = WRITE_WORDS + 1;

/**
 * A growable run of 32-bit words.
 */
class WordList {
	/** The backing store, replaced as it grows. */
	data: Uint32Array;

	/** How many words are in use. */
	length = 0;

	/**
	 * Creates an empty list.
	 * @param capacity How many words to reserve up front.
	 */
	constructor(capacity: number) {
		this.data = new Uint32Array(capacity);
	}

	/**
	 * Makes room for more words, doubling as needed.
	 * @param extra How many words are about to be appended.
	 * @returns The write position for the first of them.
	 */
	reserve(extra: number): number {
		const start = this.length;
		let capacity = this.data.length;

		if (start + extra > capacity) {
			do {
				capacity *= 2;
			} while (start + extra > capacity);

			const next = new Uint32Array(capacity);

			next.set(this.data);
			this.data = next;
		}

		this.length = start + extra;

		return start;
	}

	/**
	 * Appends one word.
	 * @param value The word to append.
	 * @returns Nothing.
	 */
	push(value: number): void {
		this.data[this.reserve(1)] = value;
	}
}

/**
 * Sorts interleaved `(key, value)` word pairs by key, in place.
 *
 * The pairs arrive in walk order, which is nearly sorted already, so an
 * insertion pass would usually do — but a pathological program can invert
 * long runs, so this is a quicksort with an insertion cutoff and a
 * median-of-three pivot, iterative to keep deep recursion off the stack.
 * @param words The backing store holding the pairs.
 * @param count How many pairs there are, starting at word 0.
 * @returns Nothing.
 */
function sortPairs(words: Uint32Array, count: number): void {
	const stack: number[] = [0, count - 1];

	while (stack.length > 0) {
		const high = stack.pop()!;
		const low = stack.pop()!;

		if (high - low < 16) {
			// Insertion sort for short runs.
			for (let i = low + 1; i <= high; i++) {
				const key = words[i * 2];
				const value = words[i * 2 + 1];
				let j = i - 1;

				while (j >= low && words[j * 2] > key) {
					words[j * 2 + 2] = words[j * 2];
					words[j * 2 + 3] = words[j * 2 + 1];
					j--;
				}

				words[j * 2 + 2] = key;
				words[j * 2 + 3] = value;
			}

			continue;
		}

		// Median-of-three pivot, moved to the middle position.
		const mid = (low + high) >>> 1;
		const a = words[low * 2];
		const b = words[mid * 2];
		const c = words[high * 2];
		let pivot = b;

		if (a > b === a < c) {
			pivot = a;
		} else if (c > a === c < b) {
			pivot = c;
		}

		let i = low;
		let j = high;

		while (i <= j) {
			while (words[i * 2] < pivot) {
				i++;
			}

			while (words[j * 2] > pivot) {
				j--;
			}

			if (i <= j) {
				const key = words[i * 2];
				const value = words[i * 2 + 1];

				words[i * 2] = words[j * 2];
				words[i * 2 + 1] = words[j * 2 + 1];
				words[j * 2] = key;
				words[j * 2 + 1] = value;
				i++;
				j--;
			}
		}

		if (low < j) {
			stack.push(low, j);
		}

		if (i < high) {
			stack.push(i, high);
		}
	}
}

/**
 * Records blocks, edges, writes, and graphs as the walk discovers them, and
 * compacts them into a flow buffer.
 */
export class FlowBuilder {
	/** Per-block words: flags, then owning graph ID. */
	readonly #blocks = new WordList(256);

	/** Edge records in creation order, `EDGE_WORDS` words each. */
	readonly #edges = new WordList(512);

	/** Write records in creation order, block first, then the format words. */
	readonly #writes = new WordList(256);

	/** Graph records, `GRAPH_WORDS` words each. */
	readonly #graphs = new WordList(64);

	/** The list pool: `[count, items...]` runs. Word 0 is a padding word. */
	readonly #pool = new WordList(64);

	/** `(node handle, block ID)` pairs in visit order. */
	readonly #nodeBlocks = new WordList(1024);

	/** The graph currently being built, or `-1` between graphs. */
	#openGraph = -1;

	/**
	 * Creates an empty builder.
	 */
	constructor() {
		// Pool handle 0 must mean "empty list", so word 0 is never a list.
		this.#pool.push(0);
	}

	/** How many blocks exist so far. */
	get blockCount(): number {
		return this.#blocks.length / 2;
	}

	//-------------------------------------------------------------------------
	// Graphs
	//-------------------------------------------------------------------------

	/**
	 * Opens a new graph. Every block created until `endGraph()` belongs to it.
	 * @param origin The origin code.
	 * @param node The handle of the node the graph runs.
	 * @param upper The graph ID of the enclosing graph, or `-1` for none.
	 * @returns The new graph's ID.
	 */
	beginGraph(origin: number, node: number, upper: number): number {
		const id = this.#graphs.length / GRAPH_WORDS;
		const base = this.#graphs.reserve(GRAPH_WORDS);
		const words = this.#graphs.data;

		words[base + G_ORIGIN] = origin;
		words[base + G_NODE] = node;
		words[base + G_UPPER] = upper + 1;
		words[base + G_FIRST_BLOCK] = this.blockCount;
		this.#openGraph = id;

		return id;
	}

	/**
	 * Closes the open graph.
	 * @param initial The entry block's ID.
	 * @param implicit The implicit-exit block's ID.
	 * @param returned The blocks that exit the graph normally.
	 * @param thrown The blocks that exit the graph on an uncaught throw.
	 * @returns Nothing.
	 */
	endGraph(
		initial: number,
		implicit: number,
		returned: number[],
		thrown: number[],
	): void {
		const base = this.#openGraph * GRAPH_WORDS;
		const words = this.#graphs.data;

		words[base + G_INITIAL] = initial;
		words[base + G_BLOCK_COUNT] =
			this.blockCount - words[base + G_FIRST_BLOCK];
		words[base + G_RETURNED] = this.#poolList(returned);
		words[base + G_THROWN] = this.#poolList(thrown);
		words[base + G_IMPLICIT] = implicit + 1;
		this.#openGraph = -1;
	}

	/**
	 * Stores a list in the pool.
	 * @param items The items to store.
	 * @returns The pool handle, `0` for an empty list.
	 */
	#poolList(items: number[]): number {
		if (items.length === 0) {
			return 0;
		}

		const handle = this.#pool.length;
		const base = this.#pool.reserve(items.length + 1);
		const words = this.#pool.data;

		words[base] = items.length;

		for (let i = 0; i < items.length; i++) {
			words[base + 1 + i] = items[i];
		}

		return handle;
	}

	//-------------------------------------------------------------------------
	// Blocks and edges
	//-------------------------------------------------------------------------

	/**
	 * Creates a block in the open graph. It starts unreachable; an edge from
	 * a reachable block, or `seedReachable()` for an entry block, marks it.
	 * @returns The new block's ID.
	 */
	newBlock(): number {
		const id = this.blockCount;
		const base = this.#blocks.reserve(2);

		this.#blocks.data[base] = 0;
		this.#blocks.data[base + 1] = this.#openGraph;

		return id;
	}

	/**
	 * Marks a block reachable without an edge, for graph entry blocks.
	 * @param block The block ID.
	 * @returns Nothing.
	 */
	seedReachable(block: number): void {
		this.#blocks.data[block * 2] |= BF_REACHABLE;
	}

	/**
	 * Adds flags to a block.
	 * @param block The block ID.
	 * @param flags The flag bits to set.
	 * @returns Nothing.
	 */
	addBlockFlags(block: number, flags: number): void {
		this.#blocks.data[block * 2] |= flags;
	}

	/**
	 * Whether control can reach a block, as known so far.
	 * @param block The block ID.
	 * @returns `true` when an edge or seed has reached it.
	 */
	isReachable(block: number): boolean {
		return (this.#blocks.data[block * 2] & BF_REACHABLE) !== 0;
	}

	/**
	 * Records an edge and propagates reachability across it.
	 * @param from The source block ID.
	 * @param to The target block ID.
	 * @param flags The edge kind and flag bits.
	 * @param cond The handle of the condition node, or `0` for none.
	 * @returns Nothing.
	 */
	addEdge(from: number, to: number, flags: number, cond: number): void {
		const base = this.#edges.reserve(EDGE_WORDS);
		const words = this.#edges.data;

		words[base + E_FROM] = from;
		words[base + E_TO] = to;
		words[base + E_FLAGS] = flags;
		words[base + E_COND] = cond;

		const blocks = this.#blocks.data;

		if ((blocks[from * 2] & BF_REACHABLE) !== 0) {
			blocks[to * 2] |= BF_REACHABLE;
		}

		if ((flags & EF_BACK) !== 0) {
			blocks[to * 2] |= BF_LOOP_HEAD;
		}
	}

	//-------------------------------------------------------------------------
	// Writes and membership
	//-------------------------------------------------------------------------

	/**
	 * Records a variable or member write in a block.
	 * @param block The block the write executes in.
	 * @param ref The byte offset of the scope reference record, or `0`.
	 * @param target The handle of the written identifier or member expression.
	 * @param expr The handle of the value written, or `0`.
	 * @param flags The write flag bits.
	 * @returns Nothing.
	 */
	addWrite(
		block: number,
		ref: number,
		target: number,
		expr: number,
		flags: number,
	): void {
		const base = this.#writes.reserve(BUILD_WRITE_WORDS);
		const words = this.#writes.data;

		words[base] = block;
		words[base + 1 + W_REF] = ref;
		words[base + 1 + W_TARGET] = target;
		words[base + 1 + W_EXPR] = expr;
		words[base + 1 + W_FLAGS] = flags;
	}

	/**
	 * Records which block a node executes in.
	 * @param node The node's handle.
	 * @param block The block ID.
	 * @returns Nothing.
	 */
	addNode(node: number, block: number): void {
		const base = this.#nodeBlocks.reserve(2);

		this.#nodeBlocks.data[base] = node;
		this.#nodeBlocks.data[base + 1] = block;
	}

	//-------------------------------------------------------------------------
	// Emission
	//-------------------------------------------------------------------------

	/**
	 * Compacts everything recorded into one flow buffer.
	 * @returns The buffer, in the format `flow-buffer.ts` describes.
	 */
	finish(): ArrayBuffer {
		const graphCount = this.#graphs.length / GRAPH_WORDS;
		const blockCount = this.blockCount;
		const edgeCount = this.#edges.length / EDGE_WORDS;
		const writeCount = this.#writes.length / BUILD_WRITE_WORDS;
		const pairCount = this.#nodeBlocks.length / 2;
		const poolWords = this.#pool.length;

		const graphsBase = HEADER_WORDS;
		const blocksBase = graphsBase + graphCount * GRAPH_WORDS;
		const edgesBase = blocksBase + blockCount * BLOCK_WORDS;
		const predsBase = edgesBase + edgeCount * EDGE_WORDS;
		const writesBase = predsBase + edgeCount;
		const poolBase = writesBase + writeCount * WRITE_WORDS;
		const nodeBlockBase = poolBase + poolWords;
		const totalWords = nodeBlockBase + pairCount * 2;

		const buffer = new ArrayBuffer(totalWords * 4);
		const out = new Uint32Array(buffer);

		out[H_MAGIC] = FLOW_BUFFER_MAGIC;
		out[H_VERSION] = FLOW_BUFFER_VERSION;
		out[H_FLAGS] = 0;
		out[H_GRAPH_COUNT] = graphCount;
		out[H_BLOCK_COUNT] = blockCount;
		out[H_EDGE_COUNT] = edgeCount;
		out[H_WRITE_COUNT] = writeCount;
		out[H_GRAPHS_BASE] = graphsBase;
		out[H_BLOCKS_BASE] = blocksBase;
		out[H_EDGES_BASE] = edgesBase;
		out[H_PREDS_BASE] = predsBase;
		out[H_WRITES_BASE] = writesBase;
		out[H_POOL_BASE] = poolBase;
		out[H_NODE_BLOCK_BASE] = nodeBlockBase;
		out[H_NODE_BLOCK_COUNT] = pairCount;

		out.set(this.#graphs.data.subarray(0, this.#graphs.length), graphsBase);
		out.set(this.#pool.data.subarray(0, poolWords), poolBase);

		// Block flags and owners; the range fields are filled in below.
		const blocks = this.#blocks.data;

		for (let i = 0; i < blockCount; i++) {
			out[blocksBase + i * BLOCK_WORDS + B_FLAGS] = blocks[i * 2];
			out[blocksBase + i * BLOCK_WORDS + B_GRAPH] = blocks[i * 2 + 1];
		}

		this.#emitEdges(out, blocksBase, edgesBase, predsBase, blockCount);
		this.#emitWrites(out, blocksBase, writesBase, blockCount);

		// The node-block index: pairs sorted by handle.
		out.set(
			this.#nodeBlocks.data.subarray(0, pairCount * 2),
			nodeBlockBase,
		);
		sortPairs(out.subarray(nodeBlockBase), pairCount);

		return buffer;
	}

	/**
	 * Emits the edge section grouped by source block and the predecessor
	 * section grouped by target block, filling both range pairs into the
	 * block records. Both groupings are stable, so a block's successors and
	 * predecessors read back in creation order.
	 * @param out The output words.
	 * @param blocksBase Word index of the block records.
	 * @param edgesBase Word index of the edge records.
	 * @param predsBase Word index of the predecessor section.
	 * @param blockCount How many blocks there are.
	 * @returns Nothing.
	 */
	#emitEdges(
		out: Uint32Array,
		blocksBase: number,
		edgesBase: number,
		predsBase: number,
		blockCount: number,
	): void {
		const edges = this.#edges.data;
		const edgeCount = this.#edges.length / EDGE_WORDS;
		const counts = new Uint32Array(blockCount);

		for (let i = 0; i < edgeCount; i++) {
			counts[edges[i * EDGE_WORDS + E_FROM]]++;
		}

		let running = 0;

		for (let b = 0; b < blockCount; b++) {
			out[blocksBase + b * BLOCK_WORDS + B_SUCC_FIRST] = running;
			out[blocksBase + b * BLOCK_WORDS + B_SUCC_COUNT] = counts[b];
			running += counts[b];
			counts[b] = running - counts[b];
		}

		for (let i = 0; i < edgeCount; i++) {
			const slot = counts[edges[i * EDGE_WORDS + E_FROM]]++;
			const base = edgesBase + slot * EDGE_WORDS;

			out[base + E_FROM] = edges[i * EDGE_WORDS + E_FROM];
			out[base + E_TO] = edges[i * EDGE_WORDS + E_TO];
			out[base + E_FLAGS] = edges[i * EDGE_WORDS + E_FLAGS];
			out[base + E_COND] = edges[i * EDGE_WORDS + E_COND];
		}

		// Now group the final edge IDs by target block.
		counts.fill(0);

		for (let i = 0; i < edgeCount; i++) {
			counts[out[edgesBase + i * EDGE_WORDS + E_TO]]++;
		}

		running = 0;

		for (let b = 0; b < blockCount; b++) {
			out[blocksBase + b * BLOCK_WORDS + B_PRED_FIRST] = running;
			out[blocksBase + b * BLOCK_WORDS + B_PRED_COUNT] = counts[b];
			running += counts[b];
			counts[b] = running - counts[b];
		}

		for (let i = 0; i < edgeCount; i++) {
			out[predsBase + counts[out[edgesBase + i * EDGE_WORDS + E_TO]]++] =
				i;
		}
	}

	/**
	 * Emits the write section grouped by block, filling the range pair into
	 * the block records. The grouping is stable, so a block's writes read
	 * back in execution order.
	 * @param out The output words.
	 * @param blocksBase Word index of the block records.
	 * @param writesBase Word index of the write records.
	 * @param blockCount How many blocks there are.
	 * @returns Nothing.
	 */
	#emitWrites(
		out: Uint32Array,
		blocksBase: number,
		writesBase: number,
		blockCount: number,
	): void {
		const writes = this.#writes.data;
		const writeCount = this.#writes.length / BUILD_WRITE_WORDS;
		const counts = new Uint32Array(blockCount);

		for (let i = 0; i < writeCount; i++) {
			counts[writes[i * BUILD_WRITE_WORDS]]++;
		}

		let running = 0;

		for (let b = 0; b < blockCount; b++) {
			out[blocksBase + b * BLOCK_WORDS + B_WRITE_FIRST] = running;
			out[blocksBase + b * BLOCK_WORDS + B_WRITE_COUNT] = counts[b];
			running += counts[b];
			counts[b] = running - counts[b];
		}

		for (let i = 0; i < writeCount; i++) {
			const src = i * BUILD_WRITE_WORDS;
			const slot = counts[writes[src]]++;
			const base = writesBase + slot * WRITE_WORDS;

			out[base + W_REF] = writes[src + 1 + W_REF];
			out[base + W_TARGET] = writes[src + 1 + W_TARGET];
			out[base + W_EXPR] = writes[src + 1 + W_EXPR];
			out[base + W_FLAGS] = writes[src + 1 + W_FLAGS];
		}
	}
}
