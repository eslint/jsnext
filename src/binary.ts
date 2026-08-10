/**
 * @fileoverview Binary buffer layouts shared by the parser and its consumers.
 *
 * Both buffers begin with a header that records a magic number, a format
 * version, and the size of one record. Readers must honor the recorded record
 * size rather than assuming a constant, which is what makes it possible to add
 * fields in a later version without breaking existing consumers.
 */

import { NODE_BYTES } from "./node-kinds.js";

//-----------------------------------------------------------------------------
// Token Buffer
//-----------------------------------------------------------------------------

/** Magic number identifying a token buffer: "JTOK" in little-endian ASCII. */
export const TOKEN_MAGIC = 0x4b4f544a;

/** Format version of the token buffer. */
export const TOKEN_VERSION = 1;

/** Size of the token buffer header in bytes. */
export const TOKEN_HEADER_BYTES = 16;

/** Size of one token record in bytes. */
export const TOKEN_BYTES = 16;

/*
 * Token header word offsets, in 32-bit words from the start of the buffer.
 */
export const TOKEN_HEADER_MAGIC = 0;
export const TOKEN_HEADER_VERSION = 1;
export const TOKEN_HEADER_COUNT = 2;
export const TOKEN_HEADER_RECORD_BYTES = 3;

/*
 * Token record word offsets, relative to the start of the record. The kind and
 * flags share a word and are read through a `Uint16Array` view.
 */
export const TOKEN_START = 0;
export const TOKEN_END = 1;
export const TOKEN_KIND_FLAGS = 2;
export const TOKEN_EXTRA = 3;

/** A line terminator appeared between this token and the previous one. */
export const TF_NEWLINE_BEFORE = 1 << 0;

/** The token's text contains at least one backslash escape sequence. */
export const TF_HAS_ESCAPE = 1 << 1;

/** The token contains an escape that is invalid outside a tagged template. */
export const TF_INVALID_ESCAPE = 1 << 2;

/** The token uses legacy octal syntax, which is banned in strict mode. */
export const TF_LEGACY_OCTAL = 1 << 3;

//-----------------------------------------------------------------------------
// AST Buffer
//-----------------------------------------------------------------------------

/** Magic number identifying an AST buffer: "JAST" in little-endian ASCII. */
export const AST_MAGIC = 0x5453414a;

/** Format version of the AST buffer. */
export const AST_VERSION = 1;

/** Size of the AST buffer header in bytes. */
export const AST_HEADER_BYTES = 48;

/*
 * AST header word offsets, in 32-bit words from the start of the buffer.
 */
export const AST_HEADER_MAGIC = 0;
export const AST_HEADER_VERSION = 1;
export const AST_HEADER_NODE_COUNT = 2;
export const AST_HEADER_NODE_BYTES = 3;
export const AST_HEADER_NODES_OFFSET = 4;
export const AST_HEADER_LIST_OFFSET = 5;
export const AST_HEADER_LIST_COUNT = 6;
export const AST_HEADER_SOURCE_OFFSET = 7;
export const AST_HEADER_SOURCE_LENGTH = 8;
export const AST_HEADER_ROOT = 9;
export const AST_HEADER_FLAGS = 10;
export const AST_HEADER_RESERVED = 11;

//-----------------------------------------------------------------------------
// Growable Word Buffer
//-----------------------------------------------------------------------------

/**
 * A growable array of 32-bit words.
 *
 * The parser writes millions of words during a large parse, so growth is
 * amortized by doubling and every write goes directly to the typed array
 * without any intermediate object.
 */
export class WordBuffer {
	/** The backing storage; replaced whenever the buffer grows. */
	words: Uint32Array;

	/** Number of words written so far. */
	length = 0;

	/**
	 * Creates a new buffer.
	 * @param initialWords The number of words to preallocate.
	 */
	constructor(initialWords: number) {
		this.words = new Uint32Array(initialWords);
	}

	/**
	 * Ensures that at least `count` more words can be written without growing.
	 * @param count The number of additional words needed.
	 * @returns The index at which the caller may begin writing.
	 */
	reserve(count: number): number {
		const needed = this.length + count;

		if (needed > this.words.length) {
			let capacity = this.words.length * 2;

			while (capacity < needed) {
				capacity *= 2;
			}

			const grown = new Uint32Array(capacity);

			grown.set(this.words);
			this.words = grown;
		}

		const start = this.length;

		this.length = needed;

		return start;
	}

	/**
	 * Appends a single word.
	 * @param value The word to append.
	 * @returns The index the word was written to.
	 */
	push(value: number): number {
		const index = this.reserve(1);

		this.words[index] = value;

		return index;
	}
}

//-----------------------------------------------------------------------------
// Source Text Storage
//-----------------------------------------------------------------------------

/*
 * The AST buffer carries a copy of the source text so that `validate()` and
 * `toAST()` need nothing but the parse result. Decoding that copy back into a
 * JavaScript string costs a full pass, so the string produced during parsing
 * is cached against the buffer it was stored in and reused when the same
 * process converts the AST.
 */
const sourceCache = new WeakMap<ArrayBufferLike, string>();

const UTF16_DECODER = new TextDecoder("utf-16le");

/**
 * Records the source text that was encoded into an AST buffer so that later
 * reads can skip decoding it again.
 * @param buffer The AST buffer holding the encoded text.
 * @param source The original source text.
 * @returns Nothing.
 */
export function cacheSource(buffer: ArrayBufferLike, source: string): void {
	sourceCache.set(buffer, source);
}

/**
 * Retrieves the source text stored inside an AST buffer.
 * @param buffer The AST buffer to read from.
 * @param byteOffset The byte offset of the encoded text.
 * @param length The length of the text in UTF-16 code units.
 * @returns The source text the buffer was produced from.
 */
export function readSource(
	buffer: ArrayBufferLike,
	byteOffset: number,
	length: number,
): string {
	const cached = sourceCache.get(buffer);

	if (cached !== undefined) {
		return cached;
	}

	const decoded = UTF16_DECODER.decode(
		new Uint8Array(buffer, byteOffset, length * 2),
	);

	sourceCache.set(buffer, decoded);

	return decoded;
}

/**
 * Copies source text into a byte view as little-endian UTF-16 code units.
 * @param target The 16-bit view to write into.
 * @param offset The index in the view at which to start writing.
 * @param source The text to copy.
 * @returns Nothing.
 */
export function writeSource(
	target: Uint16Array,
	offset: number,
	source: string,
): void {
	for (let i = 0; i < source.length; i++) {
		target[offset + i] = source.charCodeAt(i);
	}
}

//-----------------------------------------------------------------------------
// Assembly Helpers
//-----------------------------------------------------------------------------

/**
 * Rounds a byte count up to the next multiple of four so that following
 * regions stay word-aligned.
 * @param bytes The byte count to align.
 * @returns The aligned byte count.
 */
export function alignWords(bytes: number): number {
	return (bytes + 3) & ~3;
}

/**
 * Builds the final token `ArrayBuffer` from the words written during scanning.
 * @param records The token records, four words each.
 * @param count The number of tokens written.
 * @returns A standalone buffer containing the header and every token record.
 */
export function buildTokenBuffer(
	records: WordBuffer,
	count: number,
): ArrayBuffer {
	const headerWords = TOKEN_HEADER_BYTES / 4;
	const buffer = new ArrayBuffer(TOKEN_HEADER_BYTES + count * TOKEN_BYTES);
	const view = new Uint32Array(buffer);

	view[TOKEN_HEADER_MAGIC] = TOKEN_MAGIC;
	view[TOKEN_HEADER_VERSION] = TOKEN_VERSION;
	view[TOKEN_HEADER_COUNT] = count;
	view[TOKEN_HEADER_RECORD_BYTES] = TOKEN_BYTES;

	view.set(records.words.subarray(0, count * (TOKEN_BYTES / 4)), headerWords);

	return buffer;
}

/**
 * Builds the final AST `ArrayBuffer` from the node and list regions.
 * @param nodes The node records.
 * @param nodeCount The number of nodes written, including the reserved node 0.
 * @param lists The list region.
 * @param root The index of the root node.
 * @param source The source text to embed.
 * @returns A standalone buffer containing the header, nodes, lists, and text.
 */
export function buildAstBuffer(
	nodes: WordBuffer,
	nodeCount: number,
	lists: WordBuffer,
	root: number,
	source: string,
): ArrayBuffer {
	const nodesBytes = nodeCount * NODE_BYTES;
	const listBytes = lists.length * 4;
	const sourceBytes = alignWords(source.length * 2);

	const nodesOffset = AST_HEADER_BYTES;
	const listOffset = nodesOffset + nodesBytes;
	const sourceOffset = listOffset + listBytes;

	const buffer = new ArrayBuffer(sourceOffset + sourceBytes);
	const view = new Uint32Array(buffer);

	view[AST_HEADER_MAGIC] = AST_MAGIC;
	view[AST_HEADER_VERSION] = AST_VERSION;
	view[AST_HEADER_NODE_COUNT] = nodeCount;
	view[AST_HEADER_NODE_BYTES] = NODE_BYTES;
	view[AST_HEADER_NODES_OFFSET] = nodesOffset;
	view[AST_HEADER_LIST_OFFSET] = listOffset;
	view[AST_HEADER_LIST_COUNT] = lists.length;
	view[AST_HEADER_SOURCE_OFFSET] = sourceOffset;
	view[AST_HEADER_SOURCE_LENGTH] = source.length;
	view[AST_HEADER_ROOT] = root;

	view.set(
		nodes.words.subarray(0, nodesBytes / 4),
		nodesOffset / 4,
	);
	view.set(lists.words.subarray(0, lists.length), listOffset / 4);

	writeSource(
		new Uint16Array(buffer, sourceOffset, source.length),
		0,
		source,
	);

	cacheSource(buffer, source);

	return buffer;
}
