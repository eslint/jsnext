/**
 * @fileoverview Loads the native binding, or exports `null` when it is not
 * available — a machine without the prebuilt binary, or a platform the build
 * has not produced one for. `@eslint/jskit` falls back to its TypeScript
 * implementation when this module exports `null`, so requiring this package
 * never throws.
 */

"use strict";

const { join } = require("node:path");

const CANDIDATES = [
	join(
		__dirname,
		`jskit.${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}.node`,
	),
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
