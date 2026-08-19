/**
 * @fileoverview Bundles the toolkit with esbuild.
 *
 * The three analyses are written as a set of small modules that reference each
 * other's constants heavily — the scope analyzer reads the parse buffer
 * through several hundred of the parser's constants, and the flow analyzer
 * reads both formats the same way. Bundling lets those constants collapse into
 * the same scope, which matters more here than it would for ordinary
 * application code.
 *
 * Everything ships as one entry point. Nothing is shared by identity across
 * the internal boundaries — each analysis builds its own readers over the
 * caller's buffers — and the package sets `sideEffects: false`, so a consumer
 * who imports only `analyzeTree()` still leaves the parser behind.
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
	outfile: "dist/jskit.js",
});

await build({
	...shared,
	outfile: "dist/jskit.min.js",
	minify: true,
	sourcemap: false,
});
