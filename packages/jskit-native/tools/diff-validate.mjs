/**
 * @fileoverview Differential test for `validate()`: the Rust validator must
 * report the same problems, in the same order, with the same messages and
 * positions, as the TypeScript one for every file.
 *
 * Usage: node tools/diff-validate.mjs <dir-or-file> [limit]
 *
 * Every file that parses is validated by both implementations under every
 * option set that applies to it — both dialects, JSX where the extension
 * says so, `declaration` for a `.d.ts` — and the located problem lists are
 * compared. A file that does not parse is skipped: rejecting it was the
 * parser's call, and the parse differential covers that.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { parse, validate, setNative } = await import(
	new URL("../../jskit/dist/jskit-node.js", import.meta.url)
);
const binding = (await import("../index.js")).default;

if (binding === null) {
	console.error(
		"The native binding is not built; run `npm run build` first.",
	);
	process.exit(1);
}

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith("--"));
const root = positional[0] ?? "../../node_modules";
const limit = positional[1] ? Number(positional[1]) : Infinity;

/**
 * Collects every JavaScript and TypeScript file under a directory.
 * @param {string} dir The directory to walk.
 * @param {string[]} out Where to collect the paths.
 * @returns {string[]} The collected paths.
 */
function walk(dir, out = []) {
	let entries;

	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}

	for (const name of entries) {
		if (name === "staging" || name === "intl402") {
			continue;
		}

		const full = join(dir, name);
		let stats;

		try {
			stats = statSync(full);
		} catch {
			continue;
		}

		if (stats.isDirectory()) {
			walk(full, out);
		} else if (
			/\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/u.test(name) &&
			!name.endsWith(".min.js") &&
			stats.size < 400_000
		) {
			out.push(full);
		}

		if (out.length >= limit) {
			return out;
		}
	}

	return out;
}

/**
 * Runs one implementation's `validate()` over a buffer.
 * @param {ArrayBuffer} buffer The parse buffer.
 * @param {object} options The validation options.
 * @param {object|null} native The binding to register, or `null` for TS.
 * @returns {string} The problem list, serialized for comparison.
 */
function run(buffer, options, native) {
	setNative(native);

	try {
		return JSON.stringify(validate(buffer, options));
	} catch (error) {
		return `THREW ${error.message}`;
	} finally {
		setNative(binding);
	}
}

const stats = statSync(root);
const files = stats.isDirectory() ? walk(root) : [root];
let checked = 0;
let variants = 0;
let skipped = 0;
let mismatches = 0;

for (const file of files) {
	const code = readFileSync(file, "utf8");
	let buffer = null;
	let sourceType = "module";

	setNative(binding);

	for (const attempt of ["module", "script"]) {
		try {
			buffer = parse(code, { sourceType: attempt });
			sourceType = attempt;
			break;
		} catch {
			// Try the other goal, or skip the file.
		}
	}

	if (buffer === null) {
		skipped++;
		continue;
	}

	const jsx = /\.[jt]sx$/u.test(file);
	const declaration = /\.d\.[cm]?ts$/u.test(file);
	const optionSets = [
		{ sourceType, dialect: "ts", jsx, declaration },
		{ sourceType, dialect: "js", jsx, declaration },
	];

	if (sourceType === "script") {
		optionSets.push({
			sourceType: "commonjs",
			dialect: "ts",
			jsx,
			declaration,
		});
	}

	checked++;

	for (const options of optionSets) {
		variants++;

		const typescript = run(buffer, options, null);
		const rust = run(buffer, options, binding);

		if (typescript !== rust) {
			mismatches++;
			console.log(`MISMATCH ${file} ${JSON.stringify(options)}`);
			console.log(`  ts:   ${typescript.slice(0, 300)}`);
			console.log(`  rust: ${rust.slice(0, 300)}`);

			if (mismatches >= 20) {
				console.log("(stopping after 20 mismatches)");
				process.exit(1);
			}
		}
	}
}

console.log(
	`files=${checked} variants=${variants} skipped=${skipped} mismatch=${mismatches}`,
);
process.exit(mismatches === 0 ? 0 : 1);
