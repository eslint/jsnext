/**
 * @fileoverview Decoding of the binary AST into ESTree objects.
 *
 * This is the only place where JavaScript objects are created for nodes, and
 * it runs on demand. Tools that only need to look at a handful of nodes can
 * read the binary buffers directly and skip this cost entirely.
 *
 * The kind-by-kind decoders live in `to-ast-decode.ts`, which is generated
 * from `scripts/parse/to-ast-shapes.mjs` — one function per node kind and
 * variant, so that every kind builds its node as a single object literal.
 * What lives here is the machinery those functions share: the state of the
 * decode in progress, the dispatch through the active table, and the helpers
 * that turn raw text into values. The two files import each other, which is
 * safe because neither touches the other at module load; the cycle is the
 * price of keeping the generated file free of hand-written code.
 *
 * The decode state is module-level rather than an object passed around — the
 * same shape `oxc-parser`'s generated deserializers use — so the generated
 * functions close over plain variables instead of reading fields off a
 * receiver. `decodeTree()` sets it, runs, and clears it; nothing here is
 * reentrant, and nothing needs to be.
 */

import { NODE_KIND } from "./node-kinds.js";
import type { AstReader } from "./reader.js";
import type { LineIndex, SourceLocation } from "./locations.js";
import { decodeEscapes } from "./values.js";
import {
	KEYWORD_FIRST,
	KEYWORD_NAMES,
	PUNCTUATOR_NAMES,
	PUNCT_FIRST,
} from "./token-kinds.js";
import {
	DECODE_JS,
	DECODE_JS_LOC,
	DECODE_TS,
	DECODE_TS_LOC,
	type Decoder,
} from "./to-ast-decode.js";

/** A decoded ESTree node. */
export type EsNode = Record<string, unknown>;

/** The empty state the module rests in between decodes. */
const NO_WORDS = /* @__PURE__ */ new Uint32Array(0);

/** The whole parse buffer, viewed as 32-bit words. */
export let words: Uint32Array = NO_WORDS;

/** Word index at which the node region begins. */
export let nodesBase = 0;

/** Number of words in one node record. */
export let nodeWords = 0;

/** Word index at which the list region begins. */
let listsBase = 0;

/** The source text the buffer was parsed from. */
export let source = "";

/** Where to look up positions, for the variants that carry `range`/`loc`. */
let lines: LineIndex | null = null;

/** The decoder table of the variant being produced. */
let decoders: readonly Decoder[] = DECODE_TS;

/**
 * Converts a node and everything below it.
 * @param index The node index, or `0` for no node.
 * @returns The ESTree node, or `null` when there is no node.
 */
export function node(index: number): EsNode | null {
	if (index === 0) {
		return null;
	}

	const pos = nodesBase + index * nodeWords;

	return decoders[words[pos + NODE_KIND]](pos);
}

/**
 * Converts every element of a list.
 * @param handle The list handle, or `0` for the empty list.
 * @returns An array of nodes, with `null` for array holes.
 */
export function list(handle: number): (EsNode | null)[] {
	if (handle === 0) {
		return [];
	}

	const base = listsBase + handle;
	const size = words[base];
	const result = new Array<EsNode | null>(size);

	for (let i = 0; i < size; i++) {
		result[i] = node(words[base + 1 + i]);
	}

	return result;
}

/**
 * The operator spelling for a stored token kind.
 * @param tokenKind The token kind that was recorded on the node.
 * @returns The operator's source spelling.
 */
export function operator(tokenKind: number): string {
	if (tokenKind >= KEYWORD_FIRST) {
		return KEYWORD_NAMES[tokenKind - KEYWORD_FIRST];
	}

	return PUNCTUATOR_NAMES[tokenKind - PUNCT_FIRST];
}

/**
 * Decodes the name of an identifier, resolving unicode escapes.
 * @param start The node's start offset.
 * @param end The node's end offset.
 * @param nameEnd The offset the name ends at, or `0` when it runs to `end`.
 * @returns The identifier's name.
 */
export function identifierName(
	start: number,
	end: number,
	nameEnd: number,
): string {
	const raw = source.slice(start, nameEnd === 0 ? end : nameEnd);

	return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
}

/**
 * The directive a directive prologue's expression states, unquoted.
 * @param index The `Literal` node index.
 * @returns The text between the quotes, exactly as written.
 */
export function directiveOf(index: number): string {
	const pos = nodesBase + index * nodeWords;

	return source.slice(words[pos] + 1, words[pos + 1] - 1);
}

/**
 * Converts a mapped type modifier slot into its ESTree form.
 * @param value The stored modifier value.
 * @returns `null` when absent, `true` for a bare modifier, or the sign that
 *      was written.
 */
export function mappedModifier(value: number): boolean | string | null {
	switch (value) {
		case 1:
			return true;

		case 2:
			return "+";

		case 3:
			return "-";

		default:
			return null;
	}
}

/**
 * Looks up the location of an extent, for the variants that carry `loc`.
 * @param start The 0-based offset where the extent begins.
 * @param end The 0-based offset where the extent ends.
 * @returns The positions of both offsets.
 */
export function locOf(start: number, end: number): SourceLocation {
	return (lines as LineIndex).location(start, end);
}

/**
 * Converts a binary AST into ESTree objects.
 * @param reader The reader over the AST buffer.
 * @param typescript Whether to emit TypeScript-only node properties.
 * @param lineIndex Where to look up positions, or `null` to leave `range`
 *      and `loc` off the nodes entirely. Only the ESLint adapter asks for
 *      them, because ESLint requires both.
 * @returns The decoded root node.
 */
export function decodeTree(
	reader: AstReader,
	typescript: boolean,
	lineIndex: LineIndex | null,
): EsNode {
	words = reader.words;
	nodesBase = reader.nodesBase;
	nodeWords = reader.nodeWords;
	listsBase = reader.listsBase;
	source = reader.source;
	lines = lineIndex;
	decoders =
		lineIndex === null
			? typescript
				? DECODE_TS
				: DECODE_JS
			: typescript
				? DECODE_TS_LOC
				: DECODE_JS_LOC;

	const program = node(reader.root) as EsNode;

	// Drop the references so the buffer and text can be collected.
	words = NO_WORDS;
	source = "";
	lines = null;

	return program;
}
