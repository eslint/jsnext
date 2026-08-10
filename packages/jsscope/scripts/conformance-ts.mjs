/**
 * @fileoverview Differential test of `jsscope` against
 * `@typescript-eslint/scope-manager`.
 *
 * The reference analyzer is configured with `lib: []` and no JSX pragma, so
 * that the comparison is about the program being analyzed rather than about
 * the thousand-odd names TypeScript's standard library would otherwise inject
 * into the global scope. Those two options are the only place the defaults
 * differ; `jsscope` can reproduce either behavior on request.
 */

import { analyze as analyzeReference } from "@typescript-eslint/scope-manager";
import { parse as parseReference } from "@typescript-eslint/parser";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsparse";
import { analyze } from "../dist/jsscope.js";
import {
	firstDifference,
	serializeBinary,
	serializeReference,
} from "./serialize.mjs";

/**
 * The fields both implementations fill in. The reference analyzer records
 * neither a definition's position within its declaration nor whether a write
 * is partial, so neither is compared.
 */
const FLAGS = {
	index: false,
	partial: false,
	typeRefs: true,
	dropLibVariables: true,
	tsProgramExtent: true,
};

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
	const jsx = /\.tsx$/u.test(file);
	let tree;

	try {
		tree = parseReference(code, {
			sourceType: "module",
			range: true,
			loc: false,
			jsx,
		});
	} catch {
		continue;
	}

	let expected;
	let actual;

	try {
		expected = serializeReference(
			analyzeReference(tree, {
				sourceType: "module",
				lib: [],
				jsxPragma: null,
			}),
			FLAGS,
		);
		actual = serializeBinary(
			analyze(parse(code), {
				sourceType: "module",
				dialect: "ts",
				jsx,
			}),
			FLAGS,
		);
	} catch (error) {
		threw++;

		const key = `T${error.message.slice(0, 80)}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(
				`THROW ${file}: ${error.stack.split("\n").slice(0, 3).join("\n")}`,
			);
		}

		continue;
	}

	const difference = firstDifference(expected, actual);

	if (difference === null) {
		ok++;
	} else {
		mismatch++;

		const key = `D${difference.slice(0, 120)}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(`DIFF ${file}\n   ${difference}`);
		}
	}
}

console.log(`files=${files.length} ok=${ok} mismatch=${mismatch} threw=${threw}`);
