/**
 * @fileoverview Proof that the two entry points can be taken separately.
 *
 * The whole point of splitting `analyze()` and `analyzeTree()` across separate
 * adapter modules is that a consumer who imports one does not ship the other.
 * That is a property of the built output, not of the source, so it is checked
 * by actually bundling each entry point and looking at what came out.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Where the built bundle lives, as an absolute path a bundler can resolve. */
const DIST = fileURLToPath(new URL("../dist/jsscope.js", import.meta.url));

/**
 * A string that appears only in the slot-name table, which only the tree
 * adapter needs. It is a property name no other part of the analyzer mentions.
 */
const TREE_ONLY_MARKER = "superTypeArguments";

/**
 * Bundles a program that uses one entry point and reports the result.
 * @param names The exports to import and use.
 * @returns The bundled code and its size in bytes.
 */
async function bundle(
	names: string[],
): Promise<{ code: string; bytes: number }> {
	const result = await build({
		stdin: {
			contents: `import { ${names.join(", ")} } from ${JSON.stringify(DIST)};\nexport default [${names.join(", ")}];\n`,
			resolveDir: fileURLToPath(new URL("..", import.meta.url)),
			sourcefile: "entry.js",
		},
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		minify: true,
	});
	const code = result.outputFiles[0].text;

	return { code, bytes: code.length };
}

describe("tree shaking", () => {
	it("drops the tree adapter from a binary-only bundle", async () => {
		const binaryOnly = await bundle(["analyze"]);
		const treeOnly = await bundle(["analyzeTree"]);
		const both = await bundle(["analyze", "analyzeTree"]);

		// The slot-name table goes with the adapter that reads it.
		expect(binaryOnly.code).not.toContain(TREE_ONLY_MARKER);
		expect(treeOnly.code).toContain(TREE_ONLY_MARKER);
		expect(both.code).toContain(TREE_ONLY_MARKER);

		/*
		 * Both entry points share the walk and the scope graph, so neither is
		 * anywhere near half the total. What matters is that taking one costs
		 * strictly less than taking both.
		 */
		expect(binaryOnly.bytes).toBeLessThan(both.bytes);
		expect(treeOnly.bytes).toBeLessThan(both.bytes);
	});

	it("drops the binary reader and the parser from a tree-only bundle", async () => {
		const treeOnly = await bundle(["analyzeTree"]);

		/*
		 * A consumer analyzing someone else's AST needs neither the reader
		 * over the binary format nor the parser that produces it. Each of
		 * these strings appears in exactly one of the two, so their absence is
		 * evidence both were left behind.
		 */
		expect(treeOnly.code).not.toContain("Not a jsparse AST buffer");
		expect(treeOnly.code).not.toContain("Unterminated string literal");
	});

	it("drops nothing either entry point actually needs", async () => {
		const binaryOnly = await bundle(["analyze"]);

		// The reader is what the binary entry point is for.
		expect(binaryOnly.code).toContain("Not a jsparse AST buffer");
	});
});
