/**
 * @fileoverview Differential test of the TypeScript AST against
 * `@typescript-eslint/parser`.
 *
 * The counterpart to `conformance-js.mjs` for `dialect: "ts"`, with two
 * differences that come from the reference implementation rather than from
 * this one:
 *
 * - Every file is parsed as a module. TypeScript files in the wild are
 *   modules, and the reference parser's script mode differs in ways that have
 *   nothing to do with the syntax being checked.
 * - A property the reference parser leaves `undefined` is `null` here, so
 *   `stable()` folds the two together before comparing. That divergence is
 *   deliberate and documented; everything else is a defect.
 */

import { parse as tsParse } from "@typescript-eslint/parser";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../dist/jsparse.js";

/** How many distinct problems to print before giving up. */
const MAX_REPORTED = 20;

/**
 * Collects every TypeScript file under a directory.
 * @param dir The directory to walk.
 * @param out Where to collect the paths.
 * @param depth How deep the walk already is.
 * @returns The collected paths.
 */
function walk(dir, out = [], depth = 0) {
	if (depth > 7) {
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
		} else if (/\.(ts|mts|cts|tsx)$/u.test(name) && stats.size < 900_000) {
			out.push(full);
		}
	}

	return out;
}

/**
 * Reduces a tree to a form two parsers can be compared in.
 *
 * Beyond sorting keys, this reconciles the three ways the two representations
 * differ without disagreeing: `undefined` becomes `null`, a `range` becomes
 * the `start` and `end` this parser emits, and the fields that exist only to
 * navigate the tree are dropped.
 * @param value The node, list, or leaf value to reduce.
 * @returns The same value in the shared form.
 */
function stable(value) {
	if (value === undefined) {
		return null;
	}

	if (value === null || typeof value !== "object") {
		return typeof value === "bigint" ? `#${value}` : value;
	}

	if (Array.isArray(value)) {
		return value.map(stable);
	}

	if (value instanceof RegExp) {
		return `re:${value.source}/${value.flags}`;
	}

	const flat = {};

	for (const key of Object.keys(value)) {
		if (["tokens", "comments", "loc", "range", "parent"].includes(key)) {
			continue;
		}

		flat[key] = value[key];
	}

	if (Array.isArray(value.range)) {
		flat.start = value.range[0];
		flat.end = value.range[1];
	}

	const out = {};

	for (const key of Object.keys(flat).sort()) {
		out[key] = stable(flat[key]);
	}

	return out;
}

/**
 * Finds the offset at which two serialized trees first disagree.
 * @param expected The reference parser's tree, serialized.
 * @param actual This parser's tree, serialized.
 * @returns The index of the first differing character.
 */
function firstDifference(expected, actual) {
	let i = 0;

	while (i < expected.length && expected[i] === actual[i]) {
		i++;
	}

	return i;
}

const files = walk(process.argv[2] ?? "../../node_modules").slice(
	0,
	Number(process.argv[3] ?? 400),
);

let ok = 0;
let mismatch = 0;
let threw = 0;
const seen = new Set();

for (const file of files) {
	const code = readFileSync(file, "utf8");
	let expected;

	try {
		expected = tsParse(code, {
			sourceType: "module",
			range: true,
			loc: false,
			jsx: /\.tsx$/u.test(file),
		});
	} catch {
		continue;
	}

	let actual;

	try {
		actual = toAST(parse(code), {
			sourceType: "module",
			dialect: "ts",
		}).ast;
	} catch (error) {
		threw++;

		const key = `T${error.message.replace(/\(\d+:\d+\)/u, "")}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(`THROW ${file}: ${error.message}`);
		}

		continue;
	}

	const a = JSON.stringify(stable(expected));
	const b = JSON.stringify(stable(actual));

	if (a === b) {
		ok++;
	} else {
		mismatch++;

		const at = firstDifference(a, b);
		const key = `D${a.slice(Math.max(0, at - 30), at + 40)}`;

		if (!seen.has(key)) {
			seen.add(key);

			const from = Math.max(0, at - 50);

			console.log(
				`DIFF ${file}\n   exp ${a.slice(from, at + 80)}\n` +
					`   got ${b.slice(from, at + 80)}`,
			);
		}
	}

	if (seen.size > MAX_REPORTED) {
		break;
	}
}

console.log(
	`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`,
);
