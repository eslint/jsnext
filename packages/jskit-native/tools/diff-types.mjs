/**
 * @fileoverview Differential test for `inferTypes()`: the Rust type buffer
 * must be byte-identical to the TypeScript one for every file.
 *
 * Usage: node tools/diff-types.mjs <dir-or-file> [limit]
 *        [--source-type=...] [--dialect=js] [--scope-jsx=false]
 *        [--implied-strict] [--global-return] [--ignore-eval]
 *        [--globals=a,b]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { parse, analyze, inferTypes } = await import(
	new URL("../../jskit/dist/jskit.js", import.meta.url)
);

const DUMP = join(here, "..", "target", "release", "jskit-dump");

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith("--"));
const positional = args.filter(a => !a.startsWith("--"));
const root = positional[0] ?? "../../node_modules";
const limit = positional[1] ? Number(positional[1]) : Infinity;

const parseOptions = {};
const scopeOptions = {};

for (const flag of flags) {
	if (flag.startsWith("--source-type=")) {
		parseOptions.sourceType = flag.slice("--source-type=".length);
		scopeOptions.sourceType = parseOptions.sourceType;
	} else if (flag === "--dialect=js") {
		scopeOptions.dialect = "js";
	} else if (flag === "--scope-jsx=false") {
		scopeOptions.jsx = false;
	} else if (flag === "--implied-strict") {
		scopeOptions.impliedStrict = true;
	} else if (flag === "--global-return") {
		scopeOptions.globalReturn = true;
	} else if (flag === "--ignore-eval") {
		scopeOptions.ignoreEval = true;
	} else if (flag.startsWith("--globals=")) {
		scopeOptions.globals = flag
			.slice("--globals=".length)
			.split(",")
			.filter(Boolean);
	}
}

/**
 * Collects every JavaScript and TypeScript file under a directory.
 * @param {string} dir The directory to walk.
 * @param {string[]} out The list being built.
 * @returns {string[]} The list passed in.
 */
function collect(dir, out) {
	let entries;

	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}

	for (const entry of entries) {
		if (out.length >= limit) {
			return out;
		}

		const full = join(dir, entry.name);

		if (entry.isSymbolicLink()) {
			continue;
		}

		if (entry.isDirectory()) {
			collect(full, out);
		} else if (/\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$/.test(entry.name)) {
			out.push(full);
		}
	}

	return out;
}

const SECTION_NAMES = [
	"magic",
	"version",
	"flags",
	"typeCount",
	"memberCount",
	"symbolCount",
	"typesBase",
	"membersBase",
	"poolBase",
	"symbolsBase",
	"symbolTypesBase",
	"symbolTypesCount",
	"declaredTypesBase",
	"nodeTypeBase",
	"nodeTypeCount",
	"stringsBase",
	"stringCount",
	"stringBytes",
	"importsBase",
	"importCount",
];

/**
 * Describes the first difference between two type buffers.
 * @param {Buffer} expected The TypeScript buffer.
 * @param {Buffer} actual The Rust buffer.
 * @returns {string} A human-readable description.
 */
function describeDifference(expected, actual) {
	const ew = new Uint32Array(
		expected.buffer,
		expected.byteOffset,
		expected.byteLength >> 2,
	);
	const aw = new Uint32Array(
		actual.buffer,
		actual.byteOffset,
		actual.byteLength >> 2,
	);

	for (let i = 0; i < 20; i++) {
		if (ew[i] !== aw[i]) {
			return `header.${SECTION_NAMES[i]}: ts=${ew[i]} rust=${aw[i]}`;
		}
	}

	const words = Math.min(ew.length, aw.length);
	const bases = [
		["types", ew[6]],
		["members", ew[7]],
		["pool", ew[8]],
		["symbols", ew[9]],
		["symbolTypes", ew[10]],
		["declaredTypes", ew[12]],
		["nodeTypes", ew[13]],
		["strings", ew[15]],
	].sort((a, b) => a[1] - b[1]);

	for (let i = 20; i < words; i++) {
		if (ew[i] !== aw[i]) {
			let region = "?";

			for (const [name, base] of bases) {
				if (i >= base) {
					region = `${name}+${i - base}`;
				}
			}

			return `${region}: ts=${ew[i]} rust=${aw[i]} (word ${i})`;
		}
	}

	return `length: ts=${expected.byteLength} rust=${actual.byteLength}`;
}

/**
 * Turns the option sets into jskit-dump arguments.
 * @returns {string[]} The command line arguments.
 */
function dumpArguments() {
	const result = [];

	if (parseOptions.sourceType) {
		result.push(`--source-type=${parseOptions.sourceType}`);
	}

	if (scopeOptions.dialect === "js") {
		result.push("--dialect=js");
	}

	if (scopeOptions.jsx === false) {
		result.push("--scope-jsx=false");
	}

	if (scopeOptions.impliedStrict) {
		result.push("--implied-strict");
	}

	if (scopeOptions.globalReturn) {
		result.push("--global-return");
	}

	if (scopeOptions.ignoreEval) {
		result.push("--ignore-eval");
	}

	if (scopeOptions.globals) {
		result.push(`--globals=${scopeOptions.globals.join(",")}`);
	}

	return result;
}

const files = statSync(root).isDirectory() ? collect(root, []) : [root];

let ok = 0;
let mismatch = 0;
let threw = 0;
let shown = 0;

for (const file of files) {
	let text;

	try {
		text = readFileSync(file, "utf8");
	} catch {
		continue;
	}

	let tsBuffer;

	try {
		const parsed = parse(text, parseOptions);

		tsBuffer = Buffer.from(
			inferTypes(parsed, analyze(parsed, scopeOptions)),
		);
	} catch {
		threw++;
		continue;
	}

	let rustBuffer;

	try {
		rustBuffer = execFileSync(DUMP, ["types", file, ...dumpArguments()], {
			maxBuffer: 1 << 28,
		});
	} catch {
		mismatch++;

		if (shown < 25) {
			shown++;
			console.log(`RUST-THREW ${file}`);
		}

		continue;
	}

	if (Buffer.compare(tsBuffer, rustBuffer) === 0) {
		ok++;
	} else {
		mismatch++;

		if (shown < 25) {
			shown++;
			console.log(
				`MISMATCH ${file}: ${describeDifference(tsBuffer, rustBuffer)}`,
			);
		}
	}
}

console.log(
	`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`,
);
process.exitCode = mismatch === 0 ? 0 : 1;
