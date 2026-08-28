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

execFileSync("cargo", ["build", "--release", "-p", "jskit-napi"], {
	cwd: here,
	stdio: "inherit",
});

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
	"release",
	`${prefix}jskit_napi.${extension}`,
);
// The binary lands inside its platform package, which is where index.js and
// the release workflow expect it. `mkdirSync` covers a platform no package
// is checked in for — index.js still finds the binary by path there.
const platformTarget = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
const targetDir = join(here, "npm", platformTarget);
const target = join(targetDir, `jskit.${platformTarget}.node`);

mkdirSync(targetDir, { recursive: true });
copyFileSync(built, target);
console.log(`[jskit-native] built ${target}`);
