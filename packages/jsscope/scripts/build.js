/**
 * @fileoverview Bundles the scope analyzer with esbuild.
 *
 * `jsparse` is bundled in rather than left external. The analyzer reads the
 * binary buffers through several hundred small constants from the parser, and
 * collapsing them into one scope is worth more here than the duplication
 * costs. Nothing is shared by identity across the boundary — `analyze()`
 * builds its own reader over the caller's buffers — so two copies of the
 * parser cannot disagree.
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
	outfile: "dist/jsscope.js",
});

await build({
	...shared,
	outfile: "dist/jsscope.min.js",
	minify: true,
	sourcemap: false,
});
