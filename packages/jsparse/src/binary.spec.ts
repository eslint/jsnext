/**
 * @fileoverview Unit tests for the binary buffer layouts and their assembly.
 */

import { describe, expect, it } from "vitest";
import {
	AST_HEADER_BYTES,
	AST_HEADER_LIST_COUNT,
	AST_HEADER_LIST_OFFSET,
	AST_HEADER_MAGIC,
	AST_HEADER_NODE_BYTES,
	AST_HEADER_NODE_COUNT,
	AST_HEADER_NODES_OFFSET,
	AST_HEADER_ROOT,
	AST_HEADER_SOURCE_LENGTH,
	AST_HEADER_SOURCE_OFFSET,
	AST_HEADER_VERSION,
	AST_MAGIC,
	AST_VERSION,
	TOKEN_BYTES,
	TOKEN_HEADER_BYTES,
	TOKEN_HEADER_COUNT,
	TOKEN_HEADER_MAGIC,
	TOKEN_HEADER_RECORD_BYTES,
	TOKEN_HEADER_VERSION,
	TOKEN_MAGIC,
	TOKEN_VERSION,
	WordBuffer,
	alignWords,
	buildAstBuffer,
	buildTokenBuffer,
	readSource,
	writeSource,
} from "./binary.js";
import { NODE_BYTES } from "./node-kinds.js";

describe("WordBuffer", () => {
	it("starts empty at the requested capacity", () => {
		const buffer = new WordBuffer(8);

		expect(buffer.length).toBe(0);
		expect(buffer.words).toHaveLength(8);
	});

	it("returns the index a pushed word landed at", () => {
		const buffer = new WordBuffer(4);

		expect(buffer.push(10)).toBe(0);
		expect(buffer.push(20)).toBe(1);
		expect(buffer.words[0]).toBe(10);
		expect(buffer.words[1]).toBe(20);
		expect(buffer.length).toBe(2);
	});

	it("returns the index a reservation begins at", () => {
		const buffer = new WordBuffer(8);

		buffer.push(1);

		expect(buffer.reserve(3)).toBe(1);
		expect(buffer.length).toBe(4);
	});

	it("grows by doubling when a reservation does not fit", () => {
		const buffer = new WordBuffer(2);

		buffer.push(1);
		buffer.push(2);
		buffer.push(3);

		expect(buffer.words.length).toBe(4);
		expect(buffer.length).toBe(3);
	});

	it("grows past a doubling when one is not enough", () => {
		const buffer = new WordBuffer(2);

		buffer.reserve(9);

		expect(buffer.words.length).toBeGreaterThanOrEqual(9);
		expect(buffer.length).toBe(9);
	});

	it("keeps what was already written when it grows", () => {
		const buffer = new WordBuffer(2);

		for (let i = 0; i < 100; i++) {
			buffer.push(i);
		}

		expect(Array.from(buffer.words.subarray(0, 100))).toEqual(
			Array.from({ length: 100 }, (_, i) => i),
		);
	});

	it("stores a word as an unsigned 32-bit value", () => {
		const buffer = new WordBuffer(1);

		buffer.push(0xffffffff);

		expect(buffer.words[0]).toBe(0xffffffff);
	});
});

describe("alignWords()", () => {
	it("leaves a byte count that is already aligned alone", () => {
		expect(alignWords(0)).toBe(0);
		expect(alignWords(4)).toBe(4);
		expect(alignWords(16)).toBe(16);
	});

	it("rounds up to the next multiple of four", () => {
		expect(alignWords(1)).toBe(4);
		expect(alignWords(2)).toBe(4);
		expect(alignWords(3)).toBe(4);
		expect(alignWords(5)).toBe(8);
	});
});

describe("buildTokenBuffer()", () => {
	/**
	 * Assembles a buffer from whole token records.
	 * @param records The word values to write, four per token.
	 * @returns The assembled buffer.
	 */
	function build(records: number[]): ArrayBuffer {
		const words = new WordBuffer(16);

		for (const value of records) {
			words.push(value);
		}

		return buildTokenBuffer(words, records.length / (TOKEN_BYTES / 4));
	}

	it("writes a header identifying the buffer", () => {
		const view = new Uint32Array(build([1, 2, 3, 4]));

		expect(view[TOKEN_HEADER_MAGIC]).toBe(TOKEN_MAGIC);
		expect(view[TOKEN_HEADER_VERSION]).toBe(TOKEN_VERSION);
		expect(view[TOKEN_HEADER_COUNT]).toBe(1);
		expect(view[TOKEN_HEADER_RECORD_BYTES]).toBe(TOKEN_BYTES);
	});

	it("sizes the buffer to the header plus every record", () => {
		expect(build([1, 2, 3, 4, 5, 6, 7, 8]).byteLength).toBe(
			TOKEN_HEADER_BYTES + 2 * TOKEN_BYTES,
		);
	});

	it("writes the records after the header", () => {
		const view = new Uint32Array(build([1, 2, 3, 4, 5, 6, 7, 8]));

		expect(Array.from(view.subarray(TOKEN_HEADER_BYTES / 4))).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
	});

	it("writes a header-only buffer when there are no tokens", () => {
		const buffer = build([]);

		expect(buffer.byteLength).toBe(TOKEN_HEADER_BYTES);
		expect(new Uint32Array(buffer)[TOKEN_HEADER_COUNT]).toBe(0);
	});

	it("copies only the words the count covers", () => {
		const words = new WordBuffer(16);

		for (let i = 1; i <= 8; i++) {
			words.push(i);
		}

		const view = new Uint32Array(buildTokenBuffer(words, 1));

		expect(view.length).toBe((TOKEN_HEADER_BYTES + TOKEN_BYTES) / 4);
		expect(Array.from(view.subarray(TOKEN_HEADER_BYTES / 4))).toEqual([
			1, 2, 3, 4,
		]);
	});
});

describe("buildAstBuffer()", () => {
	/**
	 * Assembles an AST buffer from node words, list words, and source text.
	 * @param nodeCount How many node records to claim, node 0 included.
	 * @param listValues The words of the list region.
	 * @param source The source text to embed.
	 * @returns The assembled buffer.
	 */
	function build(
		nodeCount: number,
		listValues: number[],
		source: string,
	): ArrayBuffer {
		const nodes = new WordBuffer(64);

		nodes.reserve((nodeCount * NODE_BYTES) / 4);

		const lists = new WordBuffer(16);

		for (const value of listValues) {
			lists.push(value);
		}

		return buildAstBuffer(nodes, nodeCount, lists, 1, source);
	}

	it("writes a header identifying the buffer", () => {
		const view = new Uint32Array(build(2, [], "a;"));

		expect(view[AST_HEADER_MAGIC]).toBe(AST_MAGIC);
		expect(view[AST_HEADER_VERSION]).toBe(AST_VERSION);
		expect(view[AST_HEADER_NODE_COUNT]).toBe(2);
		expect(view[AST_HEADER_NODE_BYTES]).toBe(NODE_BYTES);
		expect(view[AST_HEADER_ROOT]).toBe(1);
	});

	it("lays the regions out one after another", () => {
		const view = new Uint32Array(build(2, [7, 8, 9], "a;"));
		const nodesOffset = view[AST_HEADER_NODES_OFFSET];
		const listOffset = view[AST_HEADER_LIST_OFFSET];
		const sourceOffset = view[AST_HEADER_SOURCE_OFFSET];

		expect(nodesOffset).toBe(AST_HEADER_BYTES);
		expect(listOffset).toBe(nodesOffset + 2 * NODE_BYTES);
		expect(sourceOffset).toBe(listOffset + 3 * 4);
		expect(view[AST_HEADER_LIST_COUNT]).toBe(3);
		expect(view[AST_HEADER_SOURCE_LENGTH]).toBe(2);
	});

	it("writes the list region where the header says it is", () => {
		const buffer = build(2, [7, 8, 9], "a;");
		const view = new Uint32Array(buffer);
		const listOffset = view[AST_HEADER_LIST_OFFSET];

		expect(
			Array.from(new Uint32Array(buffer, listOffset, 3)),
		).toEqual([7, 8, 9]);
	});

	it("keeps every region word-aligned even for odd-length text", () => {
		const buffer = build(2, [], "abc");

		expect(buffer.byteLength % 4).toBe(0);
	});

	it("embeds the source text so a fresh reader can recover it", () => {
		const source = "const a = 1;";
		// A copy is not in the cache, so the text has to be decoded.
		const buffer = build(2, [], source).slice(0);
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[AST_HEADER_SOURCE_OFFSET],
				view[AST_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("embeds text outside the ASCII range", () => {
		const source = "const é = \"日\";";
		const buffer = build(2, [], source).slice(0);
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[AST_HEADER_SOURCE_OFFSET],
				view[AST_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("caches the source text against the buffer it built", () => {
		const source = "const a = 1;";
		const buffer = build(2, [], source);
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[AST_HEADER_SOURCE_OFFSET],
				view[AST_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("handles empty source text", () => {
		const buffer = build(1, [], "");
		const view = new Uint32Array(buffer);

		expect(view[AST_HEADER_SOURCE_LENGTH]).toBe(0);
		expect(
			readSource(buffer.slice(0), view[AST_HEADER_SOURCE_OFFSET], 0),
		).toBe("");
	});
});

describe("writeSource()", () => {
	it("copies text as UTF-16 code units", () => {
		const target = new Uint16Array(3);

		writeSource(target, 0, "abc");

		expect(Array.from(target)).toEqual([0x61, 0x62, 0x63]);
	});

	it("writes at the requested offset", () => {
		const target = new Uint16Array(4);

		writeSource(target, 1, "ab");

		expect(Array.from(target)).toEqual([0, 0x61, 0x62, 0]);
	});

	it("copies a surrogate pair as two units", () => {
		const target = new Uint16Array(2);

		writeSource(target, 0, "\u{1f600}");

		expect(Array.from(target)).toEqual([0xd83d, 0xde00]);
	});
});
