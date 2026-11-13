/**
 * @fileoverview Builds the native binding when a Rust toolchain is present.
 *
 * The toolkit works without this package — `@eslint/jskit` falls back to its
 * TypeScript implementation — so a machine without `cargo` skips the build
 * with a note rather than failing `npm run build` for the whole repository.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });

if (cargo.error || cargo.status !== 0) {
	console.log(
		"[jskit-native] cargo not found; skipping the native build. " +
			"@eslint/jskit will use its TypeScript implementation.",
	);
	process.exit(0);
}

// The npm target this binary is for, and the Rust triple that produces it.
// The two usually describe the machine the build runs on, but not always:
// 32-bit Node on 64-bit Windows wants an `i686` binary from an `x86_64`
// toolchain, which is how the release workflow builds `win32-ia32`. Cargo
// is asked for the triple explicitly only when it differs from the
// toolchain's host, so an ordinary build keeps its usual output directory.
const platformTarget = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
const RUST_TRIPLES = {
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-x64": "x86_64-apple-darwin",
	"linux-arm-gnu": "armv7-unknown-linux-gnueabihf",
	"linux-arm64-gnu": "aarch64-unknown-linux-gnu",
	"linux-x64-gnu": "x86_64-unknown-linux-gnu",
	"win32-ia32": "i686-pc-windows-msvc",
	"win32-x64": "x86_64-pc-windows-msvc",
};
const host = /^host: (.+)$/mu.exec(
	execFileSync("rustc", ["-vV"], { encoding: "utf8" }),
)?.[1];
const triple = RUST_TRIPLES[platformTarget];
const crossTriple = triple !== undefined && triple !== host ? triple : null;

execFileSync(
	"cargo",
	[
		"build",
		"--release",
		"-p",
		"jskit-napi",
		...(crossTriple === null ? [] : ["--target", crossTriple]),
	],
	{ cwd: here, stdio: "inherit" },
);

const prefix = process.platform === "win32" ? "" : "lib";
const extension =
	process.platform === "darwin"
		? "dylib"
		: process.platform === "win32"
			? "dll"
			: "so";
const built = join(
	here,
	"target",
	...(crossTriple === null ? [] : [crossTriple]),
	"release",
	`${prefix}jskit_napi.${extension}`,
);
// The binary lands inside its platform package, which is where index.js and
// the release workflow expect it. `mkdirSync` covers a platform no package
// is checked in for — index.js still finds the binary by path there.
const targetDir = join(here, "npm", platformTarget);
const target = join(targetDir, `jskit.${platformTarget}.node`);

mkdirSync(targetDir, { recursive: true });
copyFileSync(built, target);
console.log(`[jskit-native] built ${target}`);
