/**
 * @fileoverview Rebuilds the Rust side of a differential run before it
 * starts.
 *
 * Each tool compares the TypeScript implementation against a compiled
 * binary, and a binary left over from before an edit compares the old code
 * while reporting on the new: a stale `mismatch=0` is indistinguishable
 * from a real one. Cargo rebuilds only what changed, so an up-to-date build
 * costs a fraction of a second.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Runs a build step, exiting with a message when the toolchain is missing.
 * @param {string} command The program to run.
 * @param {string[]} args Its arguments.
 * @returns {void}
 */
function run(command, args) {
	const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });

	if (cargo.error || cargo.status !== 0) {
		console.error(
			"cargo not found; the differential runs need a Rust toolchain.",
		);
		process.exit(1);
	}

	// Cargo's progress goes to stderr, so stdout stays the run's report.
	execFileSync(command, args, {
		cwd: root,
		stdio: ["ignore", 2, "inherit"],
	});
}

/**
 * Builds `jskit-dump`, the binary that writes the Rust implementation's
 * buffers for `diff-parse`, `diff-analyze`, `diff-graph`, and `diff-types`.
 * @returns {string} The binary's path.
 */
export function buildDump() {
	run("cargo", [
		"build",
		"--release",
		"-p",
		"jskit-core",
		"--bin",
		"jskit-dump",
	]);

	return join(
		root,
		"target",
		"release",
		process.platform === "win32" ? "jskit-dump.exe" : "jskit-dump",
	);
}

/**
 * Builds the Node-API binding `diff-validate` loads, the same way
 * `npm run build` does: compiled, then copied to where `index.js` finds it.
 * @returns {void}
 */
export function buildBinding() {
	run(process.execPath, [join(root, "build.mjs")]);
}
