/**
 * @fileoverview Allocation and mutation of binary AST node records.
 *
 * The parser never creates JavaScript objects for nodes. It allocates a fixed
 * slice of a growable word buffer and writes integers into it. Child lists are
 * gathered on a shared scratch stack and flushed into a separate list region
 * once their length is known, which keeps list building free of intermediate
 * arrays.
 */

import { WordBuffer } from "./binary.js";
import {
	EMPTY_LIST,
	NODE_A,
	NODE_END,
	NODE_FLAGS,
	NODE_KIND,
	NODE_START,
	NODE_WORDS,
} from "./node-kinds.js";

/**
 * Writes node records and child lists into growable word buffers.
 */
export class NodeWriter {
	/** Node records, `NODE_WORDS` words each. */
	readonly nodes: WordBuffer;

	/** Child index lists, each preceded by its length. */
	readonly lists: WordBuffer;

	/** Number of allocated nodes, including the reserved node at index 0. */
	count = 1;

	/** Stack used to gather list elements before they are flushed. */
	private scratch: Uint32Array;

	/** Number of entries currently on the scratch stack. */
	private scratchLength = 0;

	/**
	 * Creates a writer sized for a source text of the given length.
	 * @param sourceLength The length of the source text being parsed.
	 */
	constructor(sourceLength: number) {
		/*
		 * Sized so that ordinary code fits without growing: growth doubles
		 * the buffer and copies everything written so far, and on a 200 KiB
		 * file those copies are a visible slice of the parse. Real code runs
		 * about one node per four and a half characters, so an eighth was
		 * always one doubling short; a quarter covers even JSX, the densest
		 * of the fixtures, with a little room.
		 */
		this.nodes = new WordBuffer(
			Math.max(NODE_WORDS * 64, (sourceLength >> 2) * NODE_WORDS),
		);
		this.lists = new WordBuffer(Math.max(256, sourceLength >> 3));
		this.scratch = new Uint32Array(1024);

		// Reserve node 0 as the "no node" sentinel.
		this.nodes.reserve(NODE_WORDS);

		// Reserve list handle 0 as the empty list.
		this.lists.push(0);
	}

	/**
	 * Allocates a node record.
	 * @param kind The node kind.
	 * @param start The start offset of the node.
	 * @returns The index of the new node.
	 */
	alloc(kind: number, start: number): number {
		const index = this.count++;
		const base = this.nodes.reserve(NODE_WORDS);
		const words = this.nodes.words;

		words[base + NODE_START] = start;
		words[base + NODE_KIND] = kind;

		return index;
	}

	/**
	 * Reads one word of a node record.
	 * @param index The node index.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	get(index: number, field: number): number {
		return this.nodes.words[index * NODE_WORDS + field];
	}

	/**
	 * Writes one word of a node record.
	 * @param index The node index.
	 * @param field The word offset within the record.
	 * @param value The value to store.
	 * @returns Nothing.
	 */
	set(index: number, field: number, value: number): void {
		this.nodes.words[index * NODE_WORDS + field] = value;
	}

	/**
	 * Adds bits to a node's flags word.
	 * @param index The node index.
	 * @param bits The bits to set.
	 * @returns Nothing.
	 */
	addFlags(index: number, bits: number): void {
		this.nodes.words[index * NODE_WORDS + NODE_FLAGS] |= bits;
	}

	/**
	 * Records the end offset of a node.
	 * @param index The node index.
	 * @param end The offset just past the node's last character.
	 * @returns The node index, so calls can be chained into a return.
	 */
	finish(index: number, end: number): number {
		this.nodes.words[index * NODE_WORDS + NODE_END] = end;

		return index;
	}

	/**
	 * Abandons an already-allocated node, leaving an inert record behind.
	 *
	 * Its index cannot be reclaimed — later nodes already have theirs — so the
	 * record is zeroed instead, which is what `rewind()` does to a speculative
	 * parse and for the same reason: a record that is no longer part of the
	 * tree must not be read back as though it were. Kind `0` is the "no node"
	 * kind, so every generic pass skips it, and above all a node whose children
	 * were handed to another node stops claiming them in the parent table.
	 * @param index The node index to abandon.
	 * @returns Nothing.
	 */
	discard(index: number): void {
		const base = index * NODE_WORDS;

		this.nodes.words.fill(0, base, base + NODE_WORDS);
	}

	/**
	 * Changes the kind of an already-allocated node, which is how expressions
	 * are reinterpreted as binding patterns.
	 * @param index The node index.
	 * @param kind The new node kind.
	 * @returns Nothing.
	 */
	retype(index: number, kind: number): void {
		this.nodes.words[index * NODE_WORDS + NODE_KIND] = kind;
	}

	//-------------------------------------------------------------------------
	// List Building
	//-------------------------------------------------------------------------

	/**
	 * Marks the start of a new list on the scratch stack.
	 * @returns A mark to pass to `endList()`.
	 */
	startList(): number {
		return this.scratchLength;
	}

	/**
	 * Appends an element to the list currently being built.
	 * @param nodeIndex The node index to append, or `0` for an array hole.
	 * @returns Nothing.
	 */
	pushList(nodeIndex: number): void {
		if (this.scratchLength === this.scratch.length) {
			const grown = new Uint32Array(this.scratch.length * 2);

			grown.set(this.scratch);
			this.scratch = grown;
		}

		this.scratch[this.scratchLength++] = nodeIndex;
	}

	/**
	 * Number of elements pushed since a mark.
	 * @param mark The mark returned by `startList()`.
	 * @returns The number of elements gathered so far.
	 */
	listSize(mark: number): number {
		return this.scratchLength - mark;
	}

	/**
	 * Reads an element of the list currently being built.
	 * @param mark The mark returned by `startList()`.
	 * @param offset The zero-based position within the list.
	 * @returns The node index at that position.
	 */
	listAt(mark: number, offset: number): number {
		return this.scratch[mark + offset];
	}

	/**
	 * Flushes the gathered elements into the list region.
	 * @param mark The mark returned by `startList()`.
	 * @returns A handle that can be stored in a node slot.
	 */
	endList(mark: number): number {
		const size = this.scratchLength - mark;

		if (size === 0) {
			return EMPTY_LIST;
		}

		const handle = this.lists.reserve(size + 1);
		const words = this.lists.words;

		words[handle] = size;

		for (let i = 0; i < size; i++) {
			words[handle + 1 + i] = this.scratch[mark + i];
		}

		this.scratchLength = mark;

		return handle;
	}

	/**
	 * Splits a run of interleaved elements into two lists.
	 *
	 * Template literals alternate between quasis and expressions, so both
	 * lists are gathered into a single scratch run and separated here rather
	 * than by nesting two runs, which the stack discipline does not allow.
	 * @param mark The mark returned by `startList()`.
	 * @returns The handles for the even-indexed and odd-indexed elements.
	 */
	endInterleavedLists(mark: number): [number, number] {
		const total = this.scratchLength - mark;
		const evenSize = (total + 1) >> 1;
		const oddSize = total >> 1;

		const evenHandle = this.reserveList(evenSize);
		const oddHandle = this.reserveList(oddSize);
		const words = this.lists.words;

		for (let i = 0; i < total; i++) {
			const value = this.scratch[mark + i];

			if ((i & 1) === 0) {
				words[evenHandle + 1 + (i >> 1)] = value;
			} else {
				words[oddHandle + 1 + (i >> 1)] = value;
			}
		}

		this.scratchLength = mark;

		return [evenHandle, oddHandle];
	}

	/**
	 * Allocates room for a list of a known size.
	 * @param size The number of elements the list will hold.
	 * @returns The handle of the list, or `EMPTY_LIST` when empty.
	 */
	private reserveList(size: number): number {
		if (size === 0) {
			return EMPTY_LIST;
		}

		const handle = this.lists.reserve(size + 1);

		this.lists.words[handle] = size;

		return handle;
	}

	/**
	 * Creates a one-element list without going through the scratch stack.
	 * @param nodeIndex The single element of the list.
	 * @returns A handle that can be stored in a node slot.
	 */
	singletonList(nodeIndex: number): number {
		const handle = this.lists.reserve(2);

		this.lists.words[handle] = 1;
		this.lists.words[handle + 1] = nodeIndex;

		return handle;
	}

	//-------------------------------------------------------------------------
	// Speculative Parsing Support
	//-------------------------------------------------------------------------

	/**
	 * Captures the writer's position so a speculative parse can be undone.
	 * @returns A snapshot for `rewind()`.
	 */
	mark(): [number, number, number] {
		return [this.count, this.lists.length, this.scratchLength];
	}

	/**
	 * Discards every node and list written since a mark.
	 * @param snapshot The snapshot returned by `mark()`.
	 * @returns Nothing.
	 */
	rewind(snapshot: [number, number, number]): void {
		const [count, listLength, scratchLength] = snapshot;
		const wordLength = count * NODE_WORDS;

		/*
		 * Node slots default to zero, so the abandoned region has to be
		 * cleared before its indexes are handed out again.
		 */
		this.nodes.words.fill(0, wordLength, this.nodes.length);
		this.nodes.length = wordLength;
		this.count = count;
		this.lists.length = listLength;
		this.scratchLength = scratchLength;
	}
}

/** Re-exported for convenience so callers need only one import. */
export { NODE_A };
