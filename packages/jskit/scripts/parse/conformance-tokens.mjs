/**
 * @fileoverview Differential test of the token stream against `espree`.
 *
 * `conformance-js.mjs` drops tokens and comments before comparing trees, so
 * this is where they are checked. Both lists are reduced to one string per
 * token and compared in order, which reports a shifted stream at the point it
 * shifts rather than as thousands of differences.
 *
 * A template token is compared without its position: `espree` only fills in
 * the start and end of a merged template token when `range` is requested, so
 * the two disagree there for a reason that is not about tokenizing.
 */

import * as espree from "espree";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, toAST } from "../../dist/jskit.js";

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
 * Reduces a token list to one comparable string per token.
 * @param tokens The tokens or comments to reduce.
 * @returns One string per token, in source order.
 */
function normalize(tokens) {
	return tokens.map(token => {
		const span =
			token.type === "Template" ? "" : `${token.start}|${token.end}`;
		const pattern = token.regex
			? `|${token.regex.pattern}|${token.regex.flags}`
			: "";

		return `${token.type}|${token.value}|${span}${pattern}`;
	});
}

/**
 * Finds the first index at which two token lists disagree.
 * @param expected The reference tokens.
 * @param actual This tokenizer's tokens.
 * @returns The index of the first difference.
 */
function firstDifference(expected, actual) {
	let i = 0;

	while (
		i < Math.min(expected.length, actual.length) &&
		expected[i] === actual[i]
	) {
		i++;
	}

	return i;
}

const files = walk(process.argv[2] ?? "../../node_modules").slice(
	0,
	Number(process.argv[3] ?? 300),
);

let ok = 0;
let bad = 0;
const seen = new Set();

for (const file of files) {
	const code = readFileSync(file, "utf8");
	let expected;

	try {
		expected = espree.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module",
			tokens: true,
			comment: true,
			range: true,
			ecmaFeatures: { jsx: true },
		});
	} catch {
		continue;
	}

	let actual;

	try {
		actual = toAST(parse(code, { sourceType: "module", tokens: true }), {
			sourceType: "module",
			dialect: "js",
		}).ast;
	} catch {
		bad++;
		continue;
	}

	const lists = [
		["tok", normalize(expected.tokens), normalize(actual.tokens)],
		["com", normalize(expected.comments), normalize(actual.comments)],
	];
	let differed = false;

	for (const [label, reference, produced] of lists) {
		const same =
			reference.length === produced.length &&
			reference.every((value, i) => value === produced[i]);

		if (same) {
			continue;
		}

		differed = true;

		const at = firstDifference(reference, produced);
		const key = `${label}:${reference[at]}=>${produced[at]}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(
				`${label} ${file}\n   exp ${reference.slice(at, at + 3)}\n` +
					`   got ${produced.slice(at, at + 3)}`,
			);
		}
	}

	if (differed) {
		bad++;
	} else {
		ok++;
	}
}

console.log(`ok=${ok} bad=${bad}`);
