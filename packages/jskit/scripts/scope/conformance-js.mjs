/**
 * @fileoverview Differential test of the scope analyzer against `eslint-scope`.
 *
 * Every JavaScript file in a directory tree is checked twice over, because
 * there are two ways in:
 *
 * - `analyze()` reads the binary buffers the parser produced from the same
 *   source `espree` was given.
 * - `analyzeTree()` reads `espree`'s own tree — the very object
 *   `eslint-scope` was handed, so the two walk identical input and any
 *   difference is a difference in the analyzers.
 *
 * Both results are reduced to the same comparable form and checked against
 * `eslint-scope`. A file that `espree` cannot parse is skipped, since there is
 * nothing to compare to.
 */

import { analyze as analyzeReference } from "eslint-scope";
import { KEYS } from "eslint-visitor-keys";
import * as espree from "espree";
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
	serializeBinary,
	serializeReference,
} from "./serialize.mjs";

/** The fields both implementations fill in. */
const FLAGS = { index: true, partial: true, typeRefs: false };

/**
 * The visitor keys `eslint-scope` is run with.
 *
 * `eslint-scope` walks through `esrecurse`, which falls back to `estraverse`'s
 * table when it is not told otherwise — and that table is old enough to have
 * `ImportExpression: ["source"]`, so the second argument of
 * `import(specifier, options)` is never visited and the names in it resolve to
 * nothing. ESLint does not run it that way: `Linter` passes
 * `childVisitorKeys: visitorKeys || evk.KEYS`, so the reference is created for
 * every rule that asks. Passing the same table here compares against the
 * `eslint-scope` that actually ships rather than against a configuration
 * nothing uses.
 */
const CHILD_VISITOR_KEYS = KEYS;

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

const results = {
	binary: { ok: 0, mismatch: 0, threw: 0 },
	tree: { ok: 0, mismatch: 0, threw: 0 },
};
const seen = new Set();

/**
 * Compares one analysis against the reference and records the outcome.
 * @param label Which entry point produced it.
 * @param file The file being analyzed.
 * @param sourceType How the program was interpreted.
 * @param expected The reference implementation's structure.
 * @param produce Builds the structure to check.
 * @returns Nothing.
 */
function check(label, file, sourceType, expected, produce) {
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
				`THROW [${label}] ${file} [${sourceType}]: ${error.stack
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
		console.log(`DIFF [${label}] ${file} [${sourceType}]\n   ${difference}`);
	}
}

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

		const options = { sourceType, dialect: "js", jsx: true };
		let expected;

		try {
			expected = serializeReference(
				analyzeReference(tree, {
					ecmaVersion: 2025,
					sourceType,
					jsx: true,
					childVisitorKeys: CHILD_VISITOR_KEYS,
				}),
				FLAGS,
			);
		} catch {
			break;
		}

		check("binary", file, sourceType, expected, () => {
			const parsed = parse(code, { sourceType });

			return serializeBinary(
				toScopeManager(analyze(parsed, options), parsed),
				FLAGS,
			);
		});
		check("tree", file, sourceType, expected, () =>
			serializeReference(
				toScopeManager(analyzeTree(tree, options), tree),
				FLAGS,
			),
		);

		break;
	}
}

for (const [label, tally] of Object.entries(results)) {
	console.log(
		`${label.padEnd(6)} files=${files.length} ok=${tally.ok} ` +
			`mismatch=${tally.mismatch} threw=${tally.threw}`,
	);
}
