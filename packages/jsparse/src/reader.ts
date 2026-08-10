/**
 * @fileoverview Readers over the binary buffers produced by `parse()`.
 */

import {
	AST_HEADER_LIST_OFFSET,
	AST_HEADER_MAGIC,
	AST_HEADER_NODES_OFFSET,
	AST_HEADER_NODE_BYTES,
	AST_HEADER_NODE_COUNT,
	AST_HEADER_ROOT,
	AST_HEADER_SOURCE_LENGTH,
	AST_HEADER_SOURCE_OFFSET,
	AST_MAGIC,
	TOKEN_HEADER_BYTES,
	TOKEN_HEADER_COUNT,
	TOKEN_HEADER_MAGIC,
	TOKEN_HEADER_RECORD_BYTES,
	TOKEN_MAGIC,
	readSource,
} from "./binary.js";
import {
	NODE_END,
	NODE_FLAGS,
	NODE_KIND,
	NODE_START,
} from "./node-kinds.js";

/**
 * Reads nodes and child lists out of an AST buffer.
 */
export class AstReader {
	/** The whole buffer, viewed as 32-bit words. */
	readonly words: Uint32Array;

	/** Word index at which the node region begins. */
	readonly nodesBase: number;

	/** Word index at which the list region begins. */
	readonly listsBase: number;

	/** Number of words in one node record. */
	readonly nodeWords: number;

	/** Number of nodes in the buffer, including the sentinel at index 0. */
	readonly nodeCount: number;

	/** Index of the root node. */
	readonly root: number;

	/** The source text the AST was produced from. */
	readonly source: string;

	/**
	 * Creates a reader over an AST buffer.
	 * @param buffer The buffer returned by `parse()`.
	 * @throws {TypeError} When the buffer is not an AST buffer.
	 */
	constructor(buffer: ArrayBufferLike) {
		this.words = new Uint32Array(buffer);

		if (this.words[AST_HEADER_MAGIC] !== AST_MAGIC) {
			throw new TypeError("Not a jsparse AST buffer");
		}

		this.nodesBase = this.words[AST_HEADER_NODES_OFFSET] / 4;
		this.listsBase = this.words[AST_HEADER_LIST_OFFSET] / 4;
		this.nodeWords = this.words[AST_HEADER_NODE_BYTES] / 4;
		this.nodeCount = this.words[AST_HEADER_NODE_COUNT];
		this.root = this.words[AST_HEADER_ROOT];
		this.source = readSource(
			buffer,
			this.words[AST_HEADER_SOURCE_OFFSET],
			this.words[AST_HEADER_SOURCE_LENGTH],
		);
	}

	/**
	 * Reads one word of a node record.
	 * @param node The node index.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	field(node: number, field: number): number {
		return this.words[this.nodesBase + node * this.nodeWords + field];
	}

	/**
	 * The kind of a node.
	 * @param node The node index.
	 * @returns The node kind.
	 */
	kind(node: number): number {
		return this.words[this.nodesBase + node * this.nodeWords + NODE_KIND];
	}

	/**
	 * The start offset of a node.
	 * @param node The node index.
	 * @returns The offset of the node's first character.
	 */
	start(node: number): number {
		return this.words[this.nodesBase + node * this.nodeWords + NODE_START];
	}

	/**
	 * The end offset of a node.
	 * @param node The node index.
	 * @returns The offset just past the node's last character.
	 */
	end(node: number): number {
		return this.words[this.nodesBase + node * this.nodeWords + NODE_END];
	}

	/**
	 * The flags of a node.
	 * @param node The node index.
	 * @returns The packed flags word.
	 */
	flags(node: number): number {
		return this.words[this.nodesBase + node * this.nodeWords + NODE_FLAGS];
	}

	/**
	 * The number of elements in a list.
	 * @param handle The list handle.
	 * @returns The element count, or `0` for the empty list.
	 */
	listSize(handle: number): number {
		return handle === 0 ? 0 : this.words[this.listsBase + handle];
	}

	/**
	 * Reads one element of a list.
	 * @param handle The list handle.
	 * @param index The zero-based position within the list.
	 * @returns The node index at that position, or `0` for a hole.
	 */
	listItem(handle: number, index: number): number {
		return this.words[this.listsBase + handle + 1 + index];
	}

	/**
	 * The source text covered by a node.
	 * @param node The node index.
	 * @returns The raw text of the node.
	 */
	text(node: number): string {
		return this.source.slice(this.start(node), this.end(node));
	}
}

/**
 * A decoded token record.
 */
export interface TokenRecord {
	kind: number;
	start: number;
	end: number;
	flags: number;
	extra: number;
}

/**
 * Reads token records out of a token buffer.
 */
export class TokenReader {
	/** The whole buffer, viewed as 32-bit words. */
	readonly words: Uint32Array;

	/** Number of tokens in the buffer. */
	readonly count: number;

	/** Number of words in one token record. */
	readonly recordWords: number;

	/** Word index at which the first record begins. */
	readonly base: number;

	/**
	 * Creates a reader over a token buffer.
	 * @param buffer The buffer returned by `parse()`.
	 * @throws {TypeError} When the buffer is not a token buffer.
	 */
	constructor(buffer: ArrayBufferLike) {
		this.words = new Uint32Array(buffer);

		if (this.words[TOKEN_HEADER_MAGIC] !== TOKEN_MAGIC) {
			throw new TypeError("Not a jsparse token buffer");
		}

		this.count = this.words[TOKEN_HEADER_COUNT];
		this.recordWords = this.words[TOKEN_HEADER_RECORD_BYTES] / 4;
		this.base = TOKEN_HEADER_BYTES / 4;
	}

	/**
	 * The start offset of a token.
	 * @param index The token index.
	 * @returns The offset of the token's first character.
	 */
	start(index: number): number {
		return this.words[this.base + index * this.recordWords];
	}

	/**
	 * The end offset of a token.
	 * @param index The token index.
	 * @returns The offset just past the token's last character.
	 */
	end(index: number): number {
		return this.words[this.base + index * this.recordWords + 1];
	}

	/**
	 * The fine-grained kind of a token.
	 * @param index The token index.
	 * @returns The token kind.
	 */
	kind(index: number): number {
		return this.words[this.base + index * this.recordWords + 2] & 0xffff;
	}

	/**
	 * The flags of a token.
	 * @param index The token index.
	 * @returns The packed token flags.
	 */
	flags(index: number): number {
		return this.words[this.base + index * this.recordWords + 2] >>> 16;
	}

	/**
	 * The auxiliary word of a token.
	 * @param index The token index.
	 * @returns The extra value, whose meaning depends on the kind.
	 */
	extra(index: number): number {
		return this.words[this.base + index * this.recordWords + 3];
	}
}
