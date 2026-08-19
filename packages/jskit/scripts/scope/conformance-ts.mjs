/**
 * @fileoverview Differential test of the scope analyzer against
 * `@typescript-eslint/scope-manager`.
 *
 * Both entry points are checked: `analyze()` over the binary buffers the
 * parser produces, and `analyzeTree()` over the very tree
 * `@typescript-eslint/parser` handed the reference analyzer.
 *
 * The reference analyzer is configured with `lib: []` and no JSX pragma, so
 * that the comparison is about the program being analyzed rather than about
 * the thousand-odd names TypeScript's standard library would otherwise inject
 * into the global scope. Those two options are the only place the defaults
 * differ; the scope analyzer can reproduce either behavior on request.
 */

import { analyze as analyzeReference } from "@typescript-eslint/scope-manager";
import { parse as parseReference } from "@typescript-eslint/parser";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	analyze,
	analyzeTree,
	parse,
	toScopeManager,
} from "../../dist/jskit.js";
import {
	firstDifference,
	jsxClosingNameKeys,
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
};

/**
 * The same fields, plus the adjustment the binary path needs.
 *
 * the parser records `espree`'s notion of how far a `Program` reaches,
 * and derives `@typescript-eslint/parser`'s from it when decoding. Reading the
 * buffer directly means making the same adjustment here.
 */
const BINARY_FLAGS = { ...FLAGS, tsProgramExtent: true };

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

const results = {
	binary: { ok: 0, mismatch: 0, threw: 0 },
	tree: { ok: 0, mismatch: 0, threw: 0 },
};
const seen = new Set();

/**
 * Compares one analysis against the reference and records the outcome.
 * @param label Which entry point produced it.
 * @param file The file being analyzed.
 * @param expected The reference implementation's structure.
 * @param produce Builds the structure to check.
 * @returns Nothing.
 */
function check(label, file, expected, produce) {
	const tally = results[label];
	let actual;

	try {
		actual = produce();
	} catch (error) {
		tally.threw++;

		const key = `T${label}${error.message.slice(0, 80)}`;

		if (!seen.has(key)) {
			seen.add(key);
			console.log(
				`THROW [${label}] ${file}: ${error.stack
					.split("\n")
					.slice(0, 3)
					.join("\n")}`,
			);
		}

		return;
	}

	const difference = firstDifference(expected, actual);

	if (difference === null) {
		tally.ok++;
		return;
	}

	tally.mismatch++;

	const key = `D${label}${difference.slice(0, 120)}`;

	if (!seen.has(key)) {
		seen.add(key);
		console.log(`DIFF [${label}] ${file}\n   ${difference}`);
	}
}

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

	/*
	 * `const` is the one name the reference analyzer injects even with
	 * `lib: []`, so that `x as const` resolves. Supplying it here is what the
	 * `globals` option is for, and it keeps the comparison about the program.
	 */
	const options = {
		sourceType: "module",
		dialect: "ts",
		jsx,
		globals: ["const"],
	};
	/*
	 * The reference analyzer references the name in `</Foo>` as well as the
	 * one in `<Foo>`; `eslint-scope` references only the opening one, and this
	 * analyzer follows `eslint-scope`. `docs/deviations.md` records it.
	 */
	const flags = { ...FLAGS, dropReferences: jsxClosingNameKeys(tree) };
	const binaryFlags = {
		...BINARY_FLAGS,
		dropReferences: flags.dropReferences,
	};
	let expected;

	try {
		expected = serializeReference(
			analyzeReference(tree, {
				sourceType: "module",
				lib: [],
				jsxPragma: null,
			}),
			flags,
		);
	} catch {
		continue;
	}

	check("binary", file, expected, () => {
		const parsed = parse(code, { sourceType: "module" });

		return serializeBinary(
			toScopeManager(analyze(parsed, options), parsed),
			binaryFlags,
		);
	});
	check("tree", file, expected, () =>
		serializeReference(
			toScopeManager(analyzeTree(tree, options), tree),
			flags,
		),
	);
}

for (const [label, tally] of Object.entries(results)) {
	console.log(
		`${label.padEnd(6)} files=${files.length} ok=${tally.ok} ` +
			`mismatch=${tally.mismatch} threw=${tally.threw}`,
	);
}
