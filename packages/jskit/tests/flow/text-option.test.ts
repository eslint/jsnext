/**
 * @fileoverview The `text` option on `createGraph()`: analyzing a buffer that
 * was parsed without `{ source: true }` outside the process that parsed it.
 *
 * A transferred buffer is simulated with `slice(0)` — a copy is a different
 * object, so the in-process source cache misses. The walk reads text only to
 * match a `break` or `continue` against its label, so the programs here are
 * labeled on purpose: an unlabeled one would pass with or without the text.
 */

import { describe, expect, it } from "vitest";
import { analyze, createGraph, parse, toGraphTree } from "../../src/index.js";

const CODE =
	"outer: for (const x of xs) { inner: for (const y of ys) { if (x === y) { break outer; } } }";

/**
 * Parses and analyzes in one process, then copies the parse buffer, so
 * `createGraph()` receives the pair the way a worker would — the scope
 * buffer's handles are byte offsets, equally valid in the copy's identical
 * bytes.
 * @returns The foreign parse buffer and its scope buffer.
 */
function transferred(): { parsed: ArrayBuffer; scopes: ArrayBuffer } {
	const parsed = parse(CODE);

	return { scopes: analyze(parsed), parsed: parsed.slice(0) };
}

describe("createGraph({ text })", () => {
	it("analyzes a foreign, text-less buffer", () => {
		const { parsed, scopes } = transferred();
		const flow = createGraph(parsed, scopes, { text: CODE });

		expect(toGraphTree(flow, parsed, scopes).graphs).toHaveLength(1);
	});

	it("throws without the text when the program needs it", () => {
		const { parsed, scopes } = transferred();

		expect(() => createGraph(parsed, scopes)).toThrow(
			/carries no source text/u,
		);
	});

	it("refuses text of the wrong length", () => {
		const { parsed, scopes } = transferred();

		expect(() => createGraph(parsed, scopes, { text: `${CODE} ` })).toThrow(
			/exact source/u,
		);
	});
});
