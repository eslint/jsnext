/**
 * @fileoverview Bundles the control flow analyzer with esbuild.
 *
 * `jsparse` and `jsscope` are bundled in rather than left external, for the
 * same reason `jsscope` bundles `jsparse`: the analyzer reads both binary
 * formats through many small constants, and collapsing them into one scope is
 * worth more than the duplication costs. Nothing is shared by identity across
 * the boundary — `createGraph()` builds its own readers over the caller's
 * buffers — so separate copies cannot disagree.
 */

import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

const shared = {
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "neutral",
	target: "es2022",
	format: "esm",
	sourcemap: true,
	logLevel: "info",
};

await build({
	...shared,
	outfile: "dist/jsflow.js",
});

await build({
	...shared,
	outfile: "dist/jsflow.min.js",
	minify: true,
	sourcemap: false,
});
