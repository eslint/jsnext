/**
 * @fileoverview Loads the native binding, or exports `null` when it is not
 * available — a machine whose platform package was not installed, or a
 * platform the build has not produced a binary for. `@eslint/jskit` falls
 * back to its TypeScript implementation when this module exports `null`, so
 * requiring this package never throws.
 *
 * The binaries ship one npm package per platform, the way esbuild's do: each
 * platform package carries one binary and declares the `os`, `cpu`, and
 * (on Linux) `libc` it is for, the published form of this package lists all
 * of them as `optionalDependencies` (stamped in at publish time by the
 * release workflow), and npm installs only the one that matches the machine.
 * The second candidate is the path `build.mjs` copies a locally built binary
 * to, which is how a checkout of this repository — where the platform
 * packages are never installed — loads its own build.
 */

"use strict";

const { join } = require("node:path");

const target = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;

const CANDIDATES = [
	`@eslint/jskit-native-${target}`,
	join(__dirname, "npm", target, `jskit.${target}.node`),
];

let binding = null;

for (const candidate of CANDIDATES) {
	try {
		binding = require(candidate);
		break;
	} catch {
		// Try the next candidate; export null when none loads.
	}
}

module.exports = binding;
