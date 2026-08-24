/**
 * @fileoverview Differential test: the Rust parse buffer must be
 * byte-identical to the TypeScript one for every file both accept, and both
 * implementations must agree on which files they reject.
 *
 * Usage: node tools/diff-parse.mjs <dir-or-file> [limit] [--tokens]
 *        [--parents] [--source] [--jsx=true|false] [--source-type=...]
 *        [--all-options]
 *
 * `--all-options` runs every file under four option sets (default, tokens,
 * parents, tokens+parents+source) instead of one.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { parse } = await import(
	new URL("../../jskit/dist/jskit.js", import.meta.url)
);

const DUMP = join(here, "..", "target", "release", "jskit-dump");

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith("--"));
const positional = args.filter(a => !a.startsWith("--"));
const root = positional[0] ?? "../../node_modules";
const limit = positional[1] ? Number(positional[1]) : Infinity;
const allOptions = flags.includes("--all-options");

const tsOptions = {
	tokens: flags.includes("--tokens"),
	parents: flags.includes("--parents"),
	source: flags.includes("--source"),
};

for (const flag of flags) {
	if (flag.startsWith("--jsx=")) {
		tsOptions.jsx = flag === "--jsx=true";
	}

	if (flag.startsWith("--source-type=")) {
		tsOptions.sourceType = flag.slice("--source-type=".length);
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

/**
 * Turns an option set into jskit-dump arguments.
 * @param {object} options The TypeScript-side parse options.
 * @returns {string[]} The equivalent command line arguments.
 */
function dumpArguments(options) {
	const result = [];

	if (options.tokens) {
		result.push("--tokens");
	}

	if (options.parents) {
		result.push("--parents");
	}

	if (options.source) {
		result.push("--source");
	}

	if (options.jsx !== undefined) {
		result.push(`--jsx=${options.jsx}`);
	}

	if (options.sourceType) {
		result.push(`--source-type=${options.sourceType}`);
	}

	return result;
}

const HEADER_NAMES = [
	"magic",
	"version",
	"flags",
	"root",
	"nodeCount",
	"nodeBytes",
	"nodesOffset",
	"listCount",
	"listOffset",
	"tokenCount",
	"tokenBytes",
	"tokensOffset",
	"lineCount",
	"linesOffset",
	"sourceLength",
	"sourceOffset",
	"parentsOffset",
];

/**
 * Describes the first difference between two parse buffers.
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

	for (let i = 0; i < 17; i++) {
		if (ew[i] !== aw[i]) {
			return `header.${HEADER_NAMES[i]}: ts=${ew[i]} rust=${aw[i]}`;
		}
	}

	const words = Math.min(ew.length, aw.length);

	for (let i = 17; i < words; i++) {
		if (ew[i] !== aw[i]) {
			const byte = i * 4;
			let region = "?";
			let detail = "";

			const nodesOffset = ew[6],
				listOffset = ew[8],
				tokensOffset = ew[11];
			const linesOffset = ew[13],
				sourceOffset = ew[15],
				parentsOffset = ew[16];

			if (byte >= nodesOffset && byte < parentsOffset) {
				const node = Math.floor((byte - nodesOffset) / 48);
				const word = ((byte - nodesOffset) % 48) / 4;
				const field = [
					"start",
					"end",
					"kind",
					"flags",
					"A",
					"B",
					"C",
					"D",
					"E",
					"F",
					"G",
					"H",
				][word];

				region = "nodes";
				detail = ` node=${node} field=${field}`;
			} else if (byte >= parentsOffset && byte < listOffset) {
				region = "parents";
				detail = ` node=${(byte - parentsOffset) / 4}`;
			} else if (byte >= listOffset && byte < tokensOffset) {
				region = "lists";
				detail = ` word=${(byte - listOffset) / 4}`;
			} else if (byte >= tokensOffset && byte < linesOffset) {
				const token = Math.floor((byte - tokensOffset) / 16);
				const word = ((byte - tokensOffset) % 16) / 4;

				region = "tokens";
				detail = ` token=${token} word=${["start", "end", "kindFlags", "extra"][word]}`;
			} else if (byte >= linesOffset && byte < sourceOffset) {
				region = "lines";
				detail = ` line=${(byte - linesOffset) / 4}`;
			} else if (byte >= sourceOffset) {
				region = "source";
			}

			return `${region}${detail}: ts=0x${ew[i].toString(16)} rust=0x${aw[i].toString(16)} (word ${i})`;
		}
	}

	return `length: ts=${expected.byteLength} rust=${actual.byteLength}`;
}

const files = statSync(root).isDirectory() ? collect(root, []) : [root];
const optionSets = allOptions
	? [
			{ ...tsOptions },
			{ ...tsOptions, tokens: true },
			{ ...tsOptions, parents: true },
			{ ...tsOptions, tokens: true, parents: true, source: true },
		]
	: [tsOptions];

let ok = 0;
let mismatch = 0;
let throwAgree = 0;
let throwDisagree = 0;
let shown = 0;

for (const file of files) {
	let text;

	try {
		text = readFileSync(file, "utf8");
	} catch {
		continue;
	}

	for (const options of optionSets) {
		let tsBuffer = null;
		let tsError = null;

		try {
			tsBuffer = Buffer.from(parse(text, options));
		} catch (error) {
			tsError = error;
		}

		let rustBuffer = null;
		let rustError = null;

		try {
			rustBuffer = execFileSync(
				DUMP,
				["parse", file, ...dumpArguments(options)],
				{
					maxBuffer: 1 << 28,
				},
			);
		} catch (error) {
			rustError = error;
		}

		if (tsError !== null || rustError !== null) {
			if (tsError !== null && rustError !== null) {
				throwAgree++;
			} else {
				throwDisagree++;

				if (shown < 25) {
					shown++;
					console.log(
						`THROW-DISAGREE ${file}: ts=${tsError ? tsError.message : "ok"} rust=${rustError ? (rustError.stderr?.toString().trim() ?? "error") : "ok"}`,
					);
				}
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
}

console.log(
	`files=${files.length} ok=${ok} mismatch=${mismatch} threw-agree=${throwAgree} threw-disagree=${throwDisagree}`,
);
process.exitCode = mismatch === 0 && throwDisagree === 0 ? 0 : 1;
