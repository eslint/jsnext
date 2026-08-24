/**
 * @fileoverview Differential test of the JavaScript AST against `espree`.
 *
 * Every JavaScript file in a directory tree is parsed both ways and the two
 * trees are compared field by field. `espree` is the contract for `dialect:
 * "js"`, so any difference is a defect here rather than a disagreement.
 *
 * A file is tried as a module first and as a script only if that fails, since
 * most of the corpus is one or the other and parsing both ways would double
 * the work for nothing. A file `espree` cannot parse either way is skipped:
 * there is nothing to compare against.
 */

import * as espree from "espree";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../../dist/jskit.js";

/** How many distinct problems to print before giving up. */
const MAX_REPORTED = 25;

/**
 * Collects every JavaScript file under a directory.
 * @param dir The directory to walk.
 * @param out Where to collect the paths.
 * @param depth How deep the walk already is.
 * @returns The collected paths.
 */
function walk(dir, out = [], depth = 0) {
	if (depth > 6) {
		return out;
	}

	let entries;

	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}

	for (const name of entries) {
		const full = join(dir, name);
		let stats;

		try {
			stats = statSync(full);
		} catch {
			continue;
		}

		if (stats.isDirectory()) {
			walk(full, out, depth + 1);
		} else if (/\.(js|mjs|cjs|jsx)$/u.test(name) && stats.size < 400_000) {
			out.push(full);
		}
	}

	return out;
}

/**
 * Reduces a tree to a form two parsers can be compared in.
 *
 * Keys are sorted so that property order cannot make identical trees differ,
 * and the token and comment lists are dropped because they are what
 * `conformance-tokens.mjs` checks.
 * @param value The node, list, or leaf value to reduce.
 * @returns The same value with its keys ordered and its unstable parts gone.
 */
function stable(value) {
	if (value === null || typeof value !== "object") {
		return typeof value === "bigint" ? `#${value}` : value;
	}

	if (Array.isArray(value)) {
		return value.map(stable);
	}

	if (value instanceof RegExp) {
		return `re:${value.source}/${value.flags}`;
	}

	const out = {};

	for (const key of Object.keys(value).sort()) {
		if (key === "tokens" || key === "comments") {
			continue;
		}

		// A property with no value compares the same as no property at all.
		if (value[key] === null || value[key] === undefined) {
			continue;
		}

		out[key] = stable(value[key]);
	}

	return out;
}

/**
 * Finds where two serialized trees first disagree.
 * @param expected The reference parser's tree, serialized.
 * @param actual This parser's tree, serialized.
 * @returns A window of each around the first differing character.
 */
function difference(expected, actual) {
	let i = 0;

	while (i < expected.length && expected[i] === actual[i]) {
		i++;
	}

	const from = Math.max(0, i - 50);

	return (
		`exp=${expected.slice(from, i + 70)}\n` +
		`     got=${actual.slice(from, i + 70)}`
	);
}

const files = walk(process.argv[2] ?? "../../node_modules").slice(
	0,
	Number(process.argv[3] ?? 400),
);

let ok = 0;
let mismatch = 0;
let threw = 0;
const problems = [];

for (const file of files) {
	const code = readFileSync(file, "utf8");

	for (const sourceType of ["module", "script"]) {
		let expected;

		try {
			expected = espree.parse(code, {
				ecmaVersion: "latest",
				sourceType,
				ecmaFeatures: { jsx: true },
			});
		} catch {
			continue;
		}

		let actual;

		try {
			actual = toAST(parse(code, { sourceType, tokens: true }), {
				sourceType,
				dialect: "js",
			}).ast;
		} catch (error) {
			threw++;
			problems.push([file, sourceType, "THROW", error.message]);
			break;
		}

		const a = JSON.stringify(stable(expected));
		const b = JSON.stringify(stable(actual));

		if (a === b) {
			ok++;
		} else {
			mismatch++;
			problems.push([file, sourceType, "DIFF", difference(a, b)]);
		}

		break;
	}
}

console.log(
	`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`,
);

const seen = new Set();

for (const [file, sourceType, kind, message] of problems) {
	const key = kind + message.slice(0, 120);

	if (seen.has(key)) {
		continue;
	}

	seen.add(key);
	console.log(`${kind} ${file} [${sourceType}]\n     ${message}`);

	if (seen.size > MAX_REPORTED) {
		break;
	}
}
