/**
 * @fileoverview Bundles the parser with esbuild.
 *
 * The parser is written as a set of small modules that reference each other's
 * constants heavily. Bundling lets those constants collapse into the same
 * scope, which matters more here than it would for ordinary application code.
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
	outfile: "dist/jsparse.js",
});

await build({
	...shared,
	outfile: "dist/jsparse.min.js",
	minify: true,
	sourcemap: false,
});
