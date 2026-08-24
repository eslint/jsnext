/**
 * @fileoverview Parity tests: the native binding must produce byte-identical
 * buffers to the TypeScript implementation, through the public entry point.
 *
 * When the binding has not been built — no Rust toolchain on this machine —
 * the suite reports itself skipped rather than failing, the same way the
 * build script skips. The differential corpus runs in
 * `tools/diff-parse.mjs`, `tools/diff-analyze.mjs`, and
 * `tools/diff-graph.mjs` are the exhaustive version of what this checks.
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const binding = require("./index.js");

if (binding === null) {
	test(
		"native binding",
		{ skip: "binding not built on this machine" },
		() => {},
	);
} else {
	const jskit = await import("@eslint/jskit");

	/**
	 * The source files the parity checks run over.
	 * @returns The path and text of each sample.
	 */
	function samples() {
		const here = fileURLToPath(new URL(".", import.meta.url));
		const files = [
			"../jskit/src/parse/parser-expressions.ts",
			"../jskit/src/scope/referencer.ts",
			"../jskit/src/flow/flow-walker.ts",
		];

		return files.map(file => ({
			file,
			text: readFileSync(new URL(file, `file://${here}`), "utf8"),
		}));
	}

	/**
	 * Runs a producer under the native binding and again under the
	 * TypeScript implementation, and asserts the buffers are identical.
	 * @param produce Builds the buffer through the public API.
	 * @returns Nothing.
	 */
	function assertParity(produce) {
		const nativeBuffer = Buffer.from(produce());

		jskit.setNative(null);

		try {
			const tsBuffer = Buffer.from(produce());

			assert.strictEqual(Buffer.compare(nativeBuffer, tsBuffer), 0);
		} finally {
			jskit.setNative(binding);
		}
	}

	for (const { file, text } of samples()) {
		test(`parse parity: ${file}`, () => {
			assertParity(() =>
				jskit.parse(text, { tokens: true, parents: true }),
			);
		});

		test(`analyze parity: ${file}`, () => {
			const parsed = jskit.parse(text);

			assertParity(() => jskit.analyze(parsed, { globals: ["window"] }));
		});

		test(`createGraph parity: ${file}`, () => {
			const parsed = jskit.parse(text);
			const scope = jskit.analyze(parsed);

			assertParity(() => jskit.createGraph(parsed, scope));
		});
	}

	test("parse errors carry ParseError fields", () => {
		assert.throws(
			() => jskit.parse("const ="),
			error =>
				error.name === "ParseError" &&
				error.index === 6 &&
				error.lineNumber === 1 &&
				error.column === 7,
		);
	});
}
