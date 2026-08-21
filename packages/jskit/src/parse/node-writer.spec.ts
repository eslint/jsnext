/**
 * @fileoverview Unit tests for binary AST node allocation.
 *
 * The parser drives this over real programs, so what is left here is the
 * bookkeeping the grammar reaches only occasionally: a scratch stack that has
 * to grow, a speculative parse that is rewound, and the interleaved list a
 * template literal needs.
 */

import { describe, expect, it } from "vitest";
import {
	EMPTY_LIST,
	NODE_A,
	NODE_B,
	NODE_END,
	NODE_FLAGS,
	NODE_KIND,
	NODE_START,
	NODE_WORDS,
	N_Identifier,
	N_Literal,
} from "./node-kinds.js";
import { NodeWriter } from "./node-writer.js";

/**
 * Reads a list back out of the list region.
 * @param writer The writer that wrote it.
 * @param handle The list handle.
 * @returns The elements.
 */
function readList(writer: NodeWriter, handle: number): number[] {
	if (handle === EMPTY_LIST) {
		return [];
	}

	const words = writer.lists.words;

	return [...words.slice(handle + 1, handle + 1 + words[handle])];
}

describe("NodeWriter", () => {
	describe("nodes", () => {
		it("reserves index 0 as the `no node` sentinel", () => {
			expect(new NodeWriter(0).count).toBe(1);
		});

		it("allocates a record and hands back consecutive indexes", () => {
			const writer = new NodeWriter(64);
			const first = writer.alloc(N_Identifier, 3);
			const second = writer.alloc(N_Literal, 7);

			expect([first, second]).toEqual([1, 2]);
			expect(writer.get(first, NODE_KIND)).toBe(N_Identifier);
			expect(writer.get(first, NODE_START)).toBe(3);
			expect(writer.get(second, NODE_START)).toBe(7);
		});

		it("reads back every word it wrote", () => {
			const writer = new NodeWriter(64);
			const node = writer.alloc(N_Identifier, 0);

			writer.set(node, NODE_A, 42);

			expect(writer.get(node, NODE_A)).toBe(42);
		});

		it("adds flag bits without clearing the ones already there", () => {
			const writer = new NodeWriter(64);
			const node = writer.alloc(N_Identifier, 0);

			writer.addFlags(node, 0b0001);
			writer.addFlags(node, 0b0100);

			expect(writer.get(node, NODE_FLAGS)).toBe(0b0101);
		});

		it("returns the node from `finish()` so a call can be a return", () => {
			const writer = new NodeWriter(64);
			const node = writer.alloc(N_Identifier, 3);

			expect(writer.finish(node, 9)).toBe(node);
			expect(writer.get(node, NODE_END)).toBe(9);
		});

		it("changes a node's kind in place", () => {
			const writer = new NodeWriter(64);
			const node = writer.alloc(N_Identifier, 0);

			writer.retype(node, N_Literal);

			expect(writer.get(node, NODE_KIND)).toBe(N_Literal);
		});

		it("zeroes an abandoned record so nothing reads it back", () => {
			const writer = new NodeWriter(64);
			const node = writer.alloc(N_Identifier, 3);

			writer.set(node, NODE_A, 42);
			writer.finish(node, 9);
			writer.discard(node);

			for (let field = 0; field < NODE_WORDS; field++) {
				expect(writer.get(node, field)).toBe(0);
			}
		});

		it("grows its node buffer past the size it started with", () => {
			const writer = new NodeWriter(0);

			for (let i = 0; i < 200; i++) {
				writer.alloc(N_Identifier, i);
			}

			expect(writer.count).toBe(201);
			expect(writer.get(200, NODE_START)).toBe(199);
		});
	});

	describe("lists", () => {
		it("gathers elements and flushes them into the list region", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();

			writer.pushList(1);
			writer.pushList(0);
			writer.pushList(3);

			expect(writer.listSize(mark)).toBe(3);
			expect(writer.listAt(mark, 0)).toBe(1);
			expect(writer.listAt(mark, 1)).toBe(0);
			expect(writer.listAt(mark, 2)).toBe(3);

			const handle = writer.endList(mark);

			expect(readList(writer, handle)).toEqual([1, 0, 3]);
			expect(writer.listSize(mark)).toBe(0);
		});

		it("returns the empty handle for a list with nothing in it", () => {
			const writer = new NodeWriter(64);

			expect(writer.endList(writer.startList())).toBe(EMPTY_LIST);
		});

		it("nests one list inside another", () => {
			const writer = new NodeWriter(64);
			const outer = writer.startList();

			writer.pushList(1);

			const inner = writer.startList();

			writer.pushList(2);
			writer.pushList(3);

			const innerHandle = writer.endList(inner);

			writer.pushList(4);

			expect(readList(writer, innerHandle)).toEqual([2, 3]);
			expect(readList(writer, writer.endList(outer))).toEqual([1, 4]);
		});

		it("grows its scratch stack past the size it started with", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();
			const size = 3000;

			for (let i = 0; i < size; i++) {
				writer.pushList(i + 1);
			}

			expect(writer.listSize(mark)).toBe(size);
			expect(writer.listAt(mark, size - 1)).toBe(size);
			expect(readList(writer, writer.endList(mark))).toHaveLength(size);
		});

		it("makes a one-element list without touching the scratch stack", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();

			writer.pushList(1);

			const handle = writer.singletonList(9);

			expect(readList(writer, handle)).toEqual([9]);
			expect(writer.listSize(mark)).toBe(1);
		});
	});

	describe("endInterleavedLists()", () => {
		it("splits an alternating run into its even and odd halves", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();

			for (const value of [1, 2, 3, 4, 5]) {
				writer.pushList(value);
			}

			const [even, odd] = writer.endInterleavedLists(mark);

			expect(readList(writer, even)).toEqual([1, 3, 5]);
			expect(readList(writer, odd)).toEqual([2, 4]);
			expect(writer.listSize(mark)).toBe(0);
		});

		it("splits an even-length run", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();

			for (const value of [1, 2, 3, 4]) {
				writer.pushList(value);
			}

			const [even, odd] = writer.endInterleavedLists(mark);

			expect(readList(writer, even)).toEqual([1, 3]);
			expect(readList(writer, odd)).toEqual([2, 4]);
		});

		it("returns the empty handle for the half that has no elements", () => {
			const writer = new NodeWriter(64);
			const mark = writer.startList();

			writer.pushList(1);

			const [even, odd] = writer.endInterleavedLists(mark);

			expect(readList(writer, even)).toEqual([1]);
			expect(odd).toBe(EMPTY_LIST);
		});

		it("returns two empty handles for a run with nothing in it", () => {
			const writer = new NodeWriter(64);

			expect(writer.endInterleavedLists(writer.startList())).toEqual([
				EMPTY_LIST,
				EMPTY_LIST,
			]);
		});
	});

	describe("speculative parsing", () => {
		it("undoes every node and list written since a mark", () => {
			const writer = new NodeWriter(64);

			writer.alloc(N_Identifier, 0);

			const snapshot = writer.mark();
			const listMark = writer.startList();

			const speculative = writer.alloc(N_Literal, 5);

			writer.set(speculative, NODE_B, 7);
			writer.pushList(speculative);
			writer.endList(listMark);
			writer.pushList(speculative);

			writer.rewind(snapshot);

			expect(writer.count).toBe(2);
			expect(writer.listSize(listMark)).toBe(0);

			// The abandoned indexes are handed out again, and start clean.
			const reused = writer.alloc(N_Identifier, 9);

			expect(reused).toBe(speculative);
			expect(writer.get(reused, NODE_B)).toBe(0);
			expect(writer.get(reused, NODE_START)).toBe(9);
		});

		it("rewinds to a mark taken before anything at all", () => {
			const writer = new NodeWriter(64);
			const snapshot = writer.mark();

			writer.alloc(N_Identifier, 0);
			writer.rewind(snapshot);

			expect(writer.count).toBe(1);
		});
	});
});
