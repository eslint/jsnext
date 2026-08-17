/**
 * @fileoverview Unit tests for the binary parse buffer layout and its assembly.
 */

import { describe, expect, it } from "vitest";
import {
	PARSE_FLAG_PARENTS,
	PARSE_FLAG_SOURCE_EMBEDDED,
	PARSE_HEADER_BYTES,
	PARSE_HEADER_FLAGS,
	PARSE_HEADER_LINES_OFFSET,
	PARSE_HEADER_LINE_COUNT,
	PARSE_HEADER_LIST_COUNT,
	PARSE_HEADER_LIST_OFFSET,
	PARSE_HEADER_MAGIC,
	PARSE_HEADER_NODE_BYTES,
	PARSE_HEADER_NODE_COUNT,
	PARSE_HEADER_NODES_OFFSET,
	PARSE_HEADER_PARENTS_OFFSET,
	PARSE_HEADER_ROOT,
	PARSE_HEADER_SOURCE_LENGTH,
	PARSE_HEADER_SOURCE_OFFSET,
	PARSE_HEADER_TOKENS_OFFSET,
	PARSE_HEADER_TOKEN_BYTES,
	PARSE_HEADER_TOKEN_COUNT,
	PARSE_HEADER_VERSION,
	PARSE_MAGIC,
	PARSE_VERSION,
	TOKEN_BYTES,
	WordBuffer,
	alignWords,
	buildParseBuffer,
	fillParentTable,
	parseHeader,
	readLineStarts,
	readParents,
	readSource,
	writeSource,
} from "./binary.js";
import {
	NODE_A,
	NODE_BYTES,
	NODE_KIND,
	NODE_WORDS,
	N_ArrayExpression,
	N_BinaryExpression,
	N_Identifier,
	N_Program,
} from "./node-kinds.js";

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

/** What `build()` may be told to put in a buffer; everything is optional. */
interface BuildOptions {
	/** How many node records to claim, node 0 included. */
	nodeCount?: number;

	/** The words of the list region. */
	listValues?: number[];

	/** The words of the token region, four per token. */
	tokenValues?: number[];

	/** The offsets at which each line begins. */
	lineStarts?: number[];

	/** The source text. */
	source?: string;

	/** Whether to copy the text into the buffer. */
	embedSource?: boolean;

	/** Whether to derive the parent table. */
	parents?: boolean;
}

/**
 * Assembles a parse buffer from raw region contents.
 * @param options What each region should hold.
 * @returns The assembled buffer.
 */
function build(options: BuildOptions = {}): ArrayBuffer {
	const {
		nodeCount = 2,
		listValues = [],
		tokenValues = [],
		lineStarts = [0],
		source = "a;",
		embedSource = true,
		parents = true,
	} = options;
	const nodes = new WordBuffer(64);

	nodes.reserve((nodeCount * NODE_BYTES) / 4);

	const lists = new WordBuffer(16);

	for (const value of listValues) {
		lists.push(value);
	}

	const tokens = new WordBuffer(16);

	for (const value of tokenValues) {
		tokens.push(value);
	}

	return buildParseBuffer({
		nodes,
		nodeCount,
		lists,
		root: 1,
		tokens,
		tokenCount: tokenValues.length / (TOKEN_BYTES / 4),
		lineStarts: new Uint32Array(lineStarts),
		lineCount: lineStarts.length,
		source,
		embedSource,
		parents,
	});
}

describe("buildParseBuffer()", () => {
	it("writes a header identifying the buffer", () => {
		const view = new Uint32Array(build());

		expect(view[PARSE_HEADER_MAGIC]).toBe(PARSE_MAGIC);
		expect(view[PARSE_HEADER_VERSION]).toBe(PARSE_VERSION);
		expect(view[PARSE_HEADER_NODE_COUNT]).toBe(2);
		expect(view[PARSE_HEADER_NODE_BYTES]).toBe(NODE_BYTES);
		expect(view[PARSE_HEADER_TOKEN_BYTES]).toBe(TOKEN_BYTES);
		expect(view[PARSE_HEADER_ROOT]).toBe(1);
	});

	it("lays the regions out one after another", () => {
		const view = new Uint32Array(
			build({
				listValues: [7, 8, 9],
				tokenValues: [1, 2, 3, 4, 5, 6, 7, 8],
				lineStarts: [0, 5],
			}),
		);
		const nodesOffset = view[PARSE_HEADER_NODES_OFFSET];
		const parentsOffset = view[PARSE_HEADER_PARENTS_OFFSET];
		const listOffset = view[PARSE_HEADER_LIST_OFFSET];
		const tokensOffset = view[PARSE_HEADER_TOKENS_OFFSET];
		const linesOffset = view[PARSE_HEADER_LINES_OFFSET];
		const sourceOffset = view[PARSE_HEADER_SOURCE_OFFSET];

		expect(nodesOffset).toBe(PARSE_HEADER_BYTES);
		expect(parentsOffset).toBe(nodesOffset + 2 * NODE_BYTES);
		expect(listOffset).toBe(parentsOffset + 2 * 4);
		expect(tokensOffset).toBe(listOffset + 3 * 4);
		expect(linesOffset).toBe(tokensOffset + 2 * TOKEN_BYTES);
		expect(sourceOffset).toBe(linesOffset + 2 * 4);

		expect(view[PARSE_HEADER_LIST_COUNT]).toBe(3);
		expect(view[PARSE_HEADER_TOKEN_COUNT]).toBe(2);
		expect(view[PARSE_HEADER_LINE_COUNT]).toBe(2);
		expect(view[PARSE_HEADER_SOURCE_LENGTH]).toBe(2);
	});

	it("writes the list region where the header says it is", () => {
		const buffer = build({ listValues: [7, 8, 9] });
		const view = new Uint32Array(buffer);

		expect(
			Array.from(
				new Uint32Array(buffer, view[PARSE_HEADER_LIST_OFFSET], 3),
			),
		).toEqual([7, 8, 9]);
	});

	it("writes the token region where the header says it is", () => {
		const buffer = build({ tokenValues: [1, 2, 3, 4, 5, 6, 7, 8] });
		const view = new Uint32Array(buffer);

		expect(
			Array.from(
				new Uint32Array(buffer, view[PARSE_HEADER_TOKENS_OFFSET], 8),
			),
		).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("copies only the token words the count covers", () => {
		const tokens = new WordBuffer(16);

		for (let i = 1; i <= 8; i++) {
			tokens.push(i);
		}

		const buffer = buildParseBuffer({
			nodes: new WordBuffer(64),
			nodeCount: 0,
			lists: new WordBuffer(1),
			root: 0,
			tokens,
			tokenCount: 1,
			lineStarts: new Uint32Array([0]),
			lineCount: 1,
			source: "",
			embedSource: false,
			parents: false,
		});

		expect(buffer.byteLength).toBe(PARSE_HEADER_BYTES + TOKEN_BYTES + 4);
		expect(Array.from(new Uint32Array(buffer, PARSE_HEADER_BYTES, 4))).toEqual(
			[1, 2, 3, 4],
		);
	});

	it("keeps every region word-aligned even for odd-length text", () => {
		expect(build({ source: "abc" }).byteLength % 4).toBe(0);
	});

	it("embeds the source text so a fresh reader can recover it", () => {
		const source = "const a = 1;";
		// A copy is not in the cache, so the text has to be decoded.
		const buffer = build({ source }).slice(0);
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[PARSE_HEADER_SOURCE_OFFSET],
				view[PARSE_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("embeds text outside the ASCII range", () => {
		const source = "const é = \"日\";";
		const buffer = build({ source }).slice(0);
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[PARSE_HEADER_SOURCE_OFFSET],
				view[PARSE_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("caches the source text against the buffer it built", () => {
		const source = "const a = 1;";
		const buffer = build({ source });
		const view = new Uint32Array(buffer);

		expect(
			readSource(
				buffer,
				view[PARSE_HEADER_SOURCE_OFFSET],
				view[PARSE_HEADER_SOURCE_LENGTH],
			),
		).toBe(source);
	});

	it("handles empty source text", () => {
		const buffer = build({ nodeCount: 1, source: "" });
		const view = new Uint32Array(buffer);

		expect(view[PARSE_HEADER_SOURCE_LENGTH]).toBe(0);
		expect(
			readSource(buffer.slice(0), view[PARSE_HEADER_SOURCE_OFFSET], 0),
		).toBe("");
	});

	describe("without embedSource", () => {
		it("records the flag and leaves the region empty", () => {
			const source = "const a = 1;";
			const embedded = new Uint32Array(build({ source }));
			const bare = new Uint32Array(
				build({ source, embedSource: false }),
			);

			expect(embedded[PARSE_HEADER_FLAGS] & PARSE_FLAG_SOURCE_EMBEDDED).toBe(
				PARSE_FLAG_SOURCE_EMBEDDED,
			);
			expect(bare[PARSE_HEADER_FLAGS] & PARSE_FLAG_SOURCE_EMBEDDED).toBe(0);

			// The length still describes the program; only the bytes are gone.
			expect(bare[PARSE_HEADER_SOURCE_LENGTH]).toBe(source.length);
			expect(bare.byteLength).toBeLessThan(embedded.byteLength);
			expect(bare[PARSE_HEADER_SOURCE_OFFSET]).toBe(bare.byteLength);
		});

		it("still serves the text in the process that built it", () => {
			const source = "const a = 1;";
			const buffer = build({ source, embedSource: false });
			const view = new Uint32Array(buffer);

			expect(
				readSource(
					buffer,
					view[PARSE_HEADER_SOURCE_OFFSET],
					view[PARSE_HEADER_SOURCE_LENGTH],
				),
			).toBe(source);
		});

		it("refuses loudly rather than decoding an absent region", () => {
			const source = "const a = 1;";
			const buffer = build({ source, embedSource: false });
			const view = new Uint32Array(buffer);

			/*
			 * A copy is a different object, so the cache misses — which is
			 * exactly what a transferred or persisted buffer looks like.
			 */
			expect(() =>
				readSource(
					buffer.slice(0),
					view[PARSE_HEADER_SOURCE_OFFSET],
					view[PARSE_HEADER_SOURCE_LENGTH],
				),
			).toThrow(/carries no source text/u);
		});
	});
});

describe("parseHeader()", () => {
	it("returns a word view over a parse buffer", () => {
		const buffer = build();

		expect(parseHeader(buffer)[PARSE_HEADER_MAGIC]).toBe(PARSE_MAGIC);
	});

	it("refuses a buffer that is not one", () => {
		expect(() => parseHeader(new ArrayBuffer(64))).toThrow(
			/Not a jsparse parse buffer/u,
		);
	});
});

describe("readLineStarts()", () => {
	it("views the line offsets stored in the buffer", () => {
		const starts = readLineStarts(build({ lineStarts: [0, 12, 30] }));

		expect(Array.from(starts)).toEqual([0, 12, 30]);
	});

	it("views the buffer rather than copying it", () => {
		const buffer = build({ lineStarts: [0, 12] });

		expect(readLineStarts(buffer).buffer).toBe(buffer);
	});

	it("refuses a buffer that is not a parse buffer", () => {
		expect(() => readLineStarts(new ArrayBuffer(64))).toThrow(
			/Not a jsparse parse buffer/u,
		);
	});
});

/**
 * Builds a node region from records written as a kind followed by its slots.
 * @param records One record per node, node 1 first.
 * @returns The node region, with the zeroed sentinel record at index 0.
 */
function nodeRegion(records: number[][]): Uint32Array {
	const nodes = new Uint32Array((records.length + 1) * NODE_WORDS);

	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		const base = (i + 1) * NODE_WORDS;

		nodes[base + NODE_KIND] = record[0];

		for (let slot = 1; slot < record.length; slot++) {
			nodes[base + NODE_A + slot - 1] = record[slot];
		}
	}

	return nodes;
}

describe("fillParentTable()", () => {
	it("points each child at the node that holds it", () => {
		// `a + b`, whose operands sit in slots A and B.
		const nodes = nodeRegion([
			[N_BinaryExpression, 2, 3],
			[N_Identifier],
			[N_Identifier],
		]);

		expect(
			Array.from(
				fillParentTable(
					new Uint32Array(4),
					nodes,
					4,
					new Uint32Array([0]),
				),
			),
		).toEqual([0, 0, 1, 1]);
	});

	it("leaves the root and the sentinel without a parent", () => {
		const nodes = nodeRegion([[N_BinaryExpression, 2, 3]]);
		const parents = fillParentTable(
			new Uint32Array(4),
			nodes,
			4,
			new Uint32Array([0]),
		);

		expect(parents[0]).toBe(0);
		expect(parents[1]).toBe(0);
	});

	it("walks the elements of a list slot", () => {
		// Handle 1 holds three elements, the middle one an array hole.
		const nodes = nodeRegion([
			[N_ArrayExpression, 1],
			[N_Identifier],
			[N_Identifier],
		]);
		const lists = new Uint32Array([0, 3, 2, 0, 3]);

		expect(
			Array.from(fillParentTable(new Uint32Array(4), nodes, 4, lists)),
		).toEqual([0, 0, 1, 1]);
	});

	it("ignores an empty list slot", () => {
		const nodes = nodeRegion([[N_ArrayExpression, 0]]);

		expect(
			Array.from(
				fillParentTable(
					new Uint32Array(2),
					nodes,
					2,
					new Uint32Array([0]),
				),
			),
		).toEqual([0, 0]);
	});

	it("ignores a data slot holding a number that looks like a node", () => {
		/*
		 * Slot A of an `Identifier` is the offset at which its name ends, so it
		 * routinely holds a small number that is also a valid node index.
		 */
		const nodes = nodeRegion([
			[N_Program, 1],
			[N_Identifier, 3],
			[N_Identifier],
		]);
		const lists = new Uint32Array([0, 1, 2]);

		expect(
			Array.from(fillParentTable(new Uint32Array(4), nodes, 4, lists)),
		).toEqual([0, 0, 1, 0]);
	});

	it("reads the slots of a node from its own kind", () => {
		// Slot B of an `Identifier` is its type annotation, a child node.
		const nodes = nodeRegion([
			[N_Identifier, 3, 2],
			[N_Identifier],
		]);

		expect(
			Array.from(
				fillParentTable(
					new Uint32Array(3),
					nodes,
					3,
					new Uint32Array([0]),
				),
			),
		).toEqual([0, 0, 1]);
	});
});

describe("readParents()", () => {
	it("has one entry per node", () => {
		expect(readParents(build({ nodeCount: 3 }))).toHaveLength(3);
	});

	it("views the buffer rather than copying it", () => {
		const buffer = build();

		expect(readParents(buffer).buffer).toBe(buffer);
	});

	it("refuses a buffer that is not a parse buffer", () => {
		expect(() => readParents(new ArrayBuffer(64))).toThrow(
			/Not a jsparse parse buffer/u,
		);
	});

	it("refuses a buffer built without a parent table", () => {
		expect(() => readParents(build({ parents: false }))).toThrow(
			/carries no parent table/u,
		);
	});
});

describe("the parent region", () => {
	it("is recorded in the header flags when it is there", () => {
		const view = new Uint32Array(build({ parents: true }));

		expect(view[PARSE_HEADER_FLAGS] & PARSE_FLAG_PARENTS).toBe(
			PARSE_FLAG_PARENTS,
		);
	});

	it("takes no space at all when it is not asked for", () => {
		const withTable = new Uint32Array(build({ nodeCount: 8 }));
		const without = new Uint32Array(
			build({ nodeCount: 8, parents: false }),
		);

		expect(without[PARSE_HEADER_FLAGS] & PARSE_FLAG_PARENTS).toBe(0);

		// The region is empty, so the list region starts where it starts.
		expect(without[PARSE_HEADER_LIST_OFFSET]).toBe(
			without[PARSE_HEADER_PARENTS_OFFSET],
		);
		expect(
			withTable[PARSE_HEADER_LIST_OFFSET] -
				without[PARSE_HEADER_LIST_OFFSET],
		).toBe(8 * 4);
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
