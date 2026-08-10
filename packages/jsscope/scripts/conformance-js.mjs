/**
 * @fileoverview Differential test of `jsscope` against `eslint-scope`.
 *
 * Every JavaScript file in a directory tree is parsed twice — by `espree` for
 * `eslint-scope` and by `jsparse` for `jsscope` — and the two scope graphs are
 * reduced to the same comparable form and checked against each other. A file
 * that `espree` cannot parse is skipped, since there is nothing to compare to.
 */

import { analyze as analyzeReference } from "eslint-scope";
import * as espree from "espree";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsparse";
import { analyze } from "../dist/jsscope.js";
import {
	firstDifference,
	serializeBinary,
	serializeReference,
} from "./serialize.mjs";

/** The fields both implementations fill in. */
const FLAGS = { index: true, partial: true, typeRefs: false };

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

	for (const sourceType of ["module", "script"]) {
		let tree;

		try {
			tree = espree.parse(code, {
				ecmaVersion: "latest",
				sourceType,
				range: true,
				ecmaFeatures: { jsx: true },
			});
		} catch {
			continue;
		}

		let expected;
		let actual;

		try {
			expected = serializeReference(
				analyzeReference(tree, {
					ecmaVersion: 2025,
					sourceType,
					jsx: true,
				}),
				FLAGS,
			);
			actual = serializeBinary(
				analyze(parse(code), {
					sourceType,
					dialect: "js",
					jsx: true,
				}),
				FLAGS,
			);
		} catch (error) {
			threw++;

			const key = `T${error.message.slice(0, 80)}`;

			if (!seen.has(key)) {
				seen.add(key);
				console.log(`THROW ${file} [${sourceType}]: ${error.stack.split("\n").slice(0, 3).join("\n")}`);
			}

			break;
		}

		const difference = firstDifference(expected, actual);

		if (difference === null) {
			ok++;
		} else {
			mismatch++;

			const key = `D${difference.slice(0, 120)}`;

			if (!seen.has(key)) {
				seen.add(key);
				console.log(`DIFF ${file} [${sourceType}]\n   ${difference}`);
			}
		}

		break;
	}
}

console.log(`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`);
