/**
 * @fileoverview The binary parse buffer layout, shared by the parser and its
 * consumers.
 *
 * A parse produces exactly one `ArrayBuffer`. It opens with a header that
 * records a magic number, a format version, the size of one node record and of
 * one token record, and the byte offset of every region that follows. Readers
 * must honor the recorded sizes and offsets rather than assuming constants,
 * which is what makes it possible to grow a record — or the header itself — in
 * a later version without breaking existing consumers.
 */

import { NODE_BYTES } from "./node-kinds.js";

//-----------------------------------------------------------------------------
// Parse Buffer Header
//-----------------------------------------------------------------------------

/** Magic number identifying a parse buffer: "JSPB" in little-endian ASCII. */
export const PARSE_MAGIC = 0x4250534a;

/** Format version of the parse buffer. */
export const PARSE_VERSION = 1;

/** Size of the parse buffer header in bytes. */
export const PARSE_HEADER_BYTES = 64;

/*
 * Header word offsets, in 32-bit words from the start of the buffer. Every
 * region is located by a recorded byte offset, so the header may grow in a
 * later version without moving anything an existing reader knows how to find.
 */
export const PARSE_HEADER_MAGIC = 0;
export const PARSE_HEADER_VERSION = 1;
export const PARSE_HEADER_FLAGS = 2;
export const PARSE_HEADER_ROOT = 3;
export const PARSE_HEADER_NODE_COUNT = 4;
export const PARSE_HEADER_NODE_BYTES = 5;
export const PARSE_HEADER_NODES_OFFSET = 6;
export const PARSE_HEADER_LIST_COUNT = 7;
export const PARSE_HEADER_LIST_OFFSET = 8;
export const PARSE_HEADER_TOKEN_COUNT = 9;
export const PARSE_HEADER_TOKEN_BYTES = 10;
export const PARSE_HEADER_TOKENS_OFFSET = 11;
export const PARSE_HEADER_LINE_COUNT = 12;
export const PARSE_HEADER_LINES_OFFSET = 13;
export const PARSE_HEADER_SOURCE_LENGTH = 14;
export const PARSE_HEADER_SOURCE_OFFSET = 15;

/**
 * `PARSE_HEADER_FLAGS` bit: the buffer carries its own copy of the source text.
 *
 * When it is clear, the source region has zero length and the text can only be
 * recovered in the process that parsed it, from the cache below. See
 * [`docs/embedded-source.md`](../docs/embedded-source.md).
 */
export const PARSE_FLAG_SOURCE_EMBEDDED = 1;

/**
 * Views a parse buffer as words after checking that it is one.
 * @param buffer The buffer to read.
 * @returns The whole buffer, viewed as 32-bit words.
 * @throws {TypeError} When the buffer is not a jsparse parse buffer.
 */
export function parseHeader(buffer: ArrayBufferLike): Uint32Array {
	const words = new Uint32Array(buffer);

	if (words[PARSE_HEADER_MAGIC] !== PARSE_MAGIC) {
		throw new TypeError("Not a jsparse parse buffer");
	}

	return words;
}

//-----------------------------------------------------------------------------
// Token Records
//-----------------------------------------------------------------------------

/** Size of one token record in bytes. */
export const TOKEN_BYTES = 16;

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
 * The parse buffer can carry a copy of the source text so that `validate()`
 * and `toAST()` need nothing but the parse result. Decoding that copy back
 * into a JavaScript string costs a full pass, so the string produced during
 * parsing is cached against the buffer it was stored in and reused when the
 * same process reads it.
 */
/**
 * Where a buffer's source text is parked for the process that produced it.
 *
 * This is a property of the buffer under a registry symbol rather than a
 * `WeakMap`, because a `WeakMap` reaches only as far as one instance of this
 * module and `@eslint/jsscope` bundles its own copy of it. A buffer parsed
 * through `@eslint/jsparse` would miss a `WeakMap` living inside
 * `@eslint/jsscope` and look exactly like a buffer that arrived from another
 * process — which, with `embedSource` off, means an unreadable one.
 * `Symbol.for()` is shared across every copy of the module in the realm, so
 * the cache is as wide as the heap.
 *
 * An own property is also the right lifetime and the right boundary: it dies
 * with the buffer, and it is carried by neither `slice()`,
 * `structuredClone()`, nor a `postMessage` transfer — exactly the crossings
 * after which the text really is gone.
 */
const SOURCE_KEY = Symbol.for("@eslint/jsparse.source");

/** The buffer as something that may be carrying its source text. */
type SourceCarrier = { [SOURCE_KEY]?: string };

const UTF16_DECODER = new TextDecoder("utf-16le");

/**
 * Records the source text that was encoded into a parse buffer so that later
 * reads can skip decoding it again.
 * @param buffer The parse buffer holding the encoded text.
 * @param source The original source text.
 * @returns Nothing.
 */
export function cacheSource(buffer: ArrayBufferLike, source: string): void {
	Object.defineProperty(buffer, SOURCE_KEY, {
		value: source,
		configurable: true,
	});
}

/**
 * Retrieves the source text stored inside a parse buffer.
 * @param buffer The parse buffer to read from.
 * @param byteOffset The byte offset of the encoded text.
 * @param length The length of the text in UTF-16 code units.
 * @returns The source text the buffer was produced from.
 */
export function readSource(
	buffer: ArrayBufferLike,
	byteOffset: number,
	length: number,
): string {
	const cached = (buffer as SourceCarrier)[SOURCE_KEY];

	if (cached !== undefined) {
		return cached;
	}

	/*
	 * The cache reaches exactly as far as the heap that parsed. A miss on a
	 * buffer with no embedded text means the text is simply gone — which is
	 * only reachable by transferring or persisting a buffer parsed without
	 * `embedSource`. Decoding the empty region would hand back a run of NUL
	 * characters and let every name silently come back wrong, so this is the
	 * one place that has to be loud.
	 */
	if (
		(new Uint32Array(buffer, PARSE_HEADER_FLAGS * 4, 1)[0] &
			PARSE_FLAG_SOURCE_EMBEDDED) ===
		0
	) {
		throw new TypeError(
			"This parse buffer carries no source text, and none is cached for it in this process. Re-parse with `{ embedSource: true }` before transferring or persisting a buffer whose text will be read elsewhere.",
		);
	}

	const decoded = UTF16_DECODER.decode(
		new Uint8Array(buffer, byteOffset, length * 2),
	);

	cacheSource(buffer, decoded);

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
// Assembly
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
 * Everything a parse produced, before it is laid out in one buffer.
 *
 * A parse assembles its buffer exactly once, so the intermediate object costs
 * nothing measurable and keeps ten same-typed arguments from being passed
 * positionally.
 */
export interface ParseBufferInput {
	/** The node records. */
	nodes: WordBuffer;

	/** The number of nodes written, including the reserved node 0. */
	nodeCount: number;

	/** The list region. */
	lists: WordBuffer;

	/** The index of the root node. */
	root: number;

	/** The token records, four words each. */
	tokens: WordBuffer;

	/** The number of tokens written. */
	tokenCount: number;

	/** The offset at which each line begins. */
	lineStarts: Uint32Array;

	/** The number of valid entries in `lineStarts`. */
	lineCount: number;

	/** The source text the program was parsed from. */
	source: string;

	/** Whether to copy the source text into the buffer. */
	embedSource: boolean;
}

/**
 * Builds the single `ArrayBuffer` a parse returns.
 * @param input Everything the parse produced.
 * @returns A standalone buffer holding the header, nodes, lists, tokens, line
 *      offsets, and — when asked for — the source text.
 */
export function buildParseBuffer(input: ParseBufferInput): ArrayBuffer {
	const { source, embedSource } = input;
	const nodesBytes = input.nodeCount * NODE_BYTES;
	const listBytes = input.lists.length * 4;
	const tokenBytes = input.tokenCount * TOKEN_BYTES;
	const lineBytes = input.lineCount * 4;
	const sourceBytes = embedSource ? alignWords(source.length * 2) : 0;

	const nodesOffset = PARSE_HEADER_BYTES;
	const listOffset = nodesOffset + nodesBytes;
	const tokensOffset = listOffset + listBytes;
	const linesOffset = tokensOffset + tokenBytes;
	const sourceOffset = linesOffset + lineBytes;

	const buffer = new ArrayBuffer(sourceOffset + sourceBytes);
	const view = new Uint32Array(buffer);

	view[PARSE_HEADER_MAGIC] = PARSE_MAGIC;
	view[PARSE_HEADER_VERSION] = PARSE_VERSION;
	view[PARSE_HEADER_FLAGS] = embedSource ? PARSE_FLAG_SOURCE_EMBEDDED : 0;
	view[PARSE_HEADER_ROOT] = input.root;
	view[PARSE_HEADER_NODE_COUNT] = input.nodeCount;
	view[PARSE_HEADER_NODE_BYTES] = NODE_BYTES;
	view[PARSE_HEADER_NODES_OFFSET] = nodesOffset;
	view[PARSE_HEADER_LIST_COUNT] = input.lists.length;
	view[PARSE_HEADER_LIST_OFFSET] = listOffset;
	view[PARSE_HEADER_TOKEN_COUNT] = input.tokenCount;
	view[PARSE_HEADER_TOKEN_BYTES] = TOKEN_BYTES;
	view[PARSE_HEADER_TOKENS_OFFSET] = tokensOffset;
	view[PARSE_HEADER_LINE_COUNT] = input.lineCount;
	view[PARSE_HEADER_LINES_OFFSET] = linesOffset;

	/*
	 * The length is recorded either way: it describes the program, not the
	 * region, and a consumer can still learn how long the source was. The
	 * flag is what says whether the characters are actually here.
	 */
	view[PARSE_HEADER_SOURCE_LENGTH] = source.length;
	view[PARSE_HEADER_SOURCE_OFFSET] = sourceOffset;

	view.set(input.nodes.words.subarray(0, nodesBytes / 4), nodesOffset / 4);
	view.set(input.lists.words.subarray(0, input.lists.length), listOffset / 4);
	view.set(
		input.tokens.words.subarray(0, tokenBytes / 4),
		tokensOffset / 4,
	);
	view.set(input.lineStarts.subarray(0, input.lineCount), linesOffset / 4);

	if (embedSource) {
		writeSource(
			new Uint16Array(buffer, sourceOffset, source.length),
			0,
			source,
		);
	}

	/*
	 * Cached whether or not the text was embedded: this is what lets a
	 * consumer in the parsing process read names off a buffer that carries no
	 * text of its own, which is the whole point of `embedSource` defaulting
	 * to `false`.
	 */
	cacheSource(buffer, source);

	return buffer;
}

/**
 * Reads the line offset table out of a parse buffer.
 *
 * The result is a view onto the buffer rather than a copy, so it costs nothing
 * to ask for and stays valid as long as the buffer does.
 * @param buffer The buffer returned by `parse()`.
 * @returns The offset at which each line of the source begins.
 * @throws {TypeError} When the buffer is not a jsparse parse buffer.
 */
export function readLineStarts(buffer: ArrayBufferLike): Uint32Array {
	const words = parseHeader(buffer);

	return new Uint32Array(
		buffer,
		words[PARSE_HEADER_LINES_OFFSET],
		words[PARSE_HEADER_LINE_COUNT],
	);
}
