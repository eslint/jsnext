/**
 * @fileoverview Differential test of what `parse()` and `validate()` *reject*
 * in TypeScript, against `@typescript-eslint/parser`.
 *
 * `conformance-ts.mjs` compares trees, and to do that it needs two trees, so
 * it skips every file the reference parser throws on. That makes a missing
 * rejection invisible to it: a program this parser accepts and the reference
 * refuses is simply not compared. This script is the other half, and it is to
 * TypeScript what `conformance-262.mjs` is to ECMAScript.
 *
 * The corpus is TypeScript's own test suite, which is mostly negative tests.
 * It is not vendored, so point the script at a checkout:
 *
 *     git clone --depth 1 --filter=blob:none --sparse \
 *         https://github.com/microsoft/TypeScript
 *     cd TypeScript && git sparse-checkout set tests/cases
 *     node scripts/conformance-ts-negative.mjs <path-to-TypeScript>
 *
 * Two things about the corpus decide how a file is read, and getting either
 * wrong buries the signal in noise:
 *
 * - **A test may pack several virtual files into one.** `// @Filename:`
 *   markers split a physical file into a compilation of many, and TypeScript
 *   compiles them as separate files. Read as one text, two of them declaring
 *   the same name look like a redeclaration that neither file contains. Those
 *   tests are skipped; before they were, they accounted for nine out of ten
 *   apparent redeclaration failures.
 * - **The reference parser is never told which side of the module line a file
 *   is on.** Holding this parser to the module reading alone would score
 *   `await` as a name — a script-only spelling — as a defect. A file counts as
 *   rejected only when neither reading accepts it.
 *
 * The two failures are not equally bad, and unlike test262 neither is
 * automatically a defect:
 *
 * - **missed** — the reference rejects and this parser accepts. Every one of
 *   these is a TypeScript grammar rule that is not implemented. This is the
 *   count to drive to zero.
 * - **overzealous** — this parser rejects and the reference accepts. Most of
 *   these are *correct*: `@typescript-eslint/parser` checks a small subset of
 *   the grammar rules `tsc` checks and almost no ECMAScript early errors at
 *   all, so `continue` outside a loop and `with` in strict mode both pass
 *   through it untouched. A new one is worth reading before it is worth
 *   fixing. It is graded for movement, not held to zero.
 *
 * Both are graded against `ts-negative-baseline.json`, per rule, so a new
 * failure is visible even where the count was never zero.
 *
 *     --update    rewrite the baseline from this run
 *     --verbose   print every failing file, not one per distinct message
 */

import { parse as referenceParse } from "@typescript-eslint/parser";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse, validate } from "../../dist/jskit.js";

/** Where the per-rule failure counts are kept. */
const BASELINE = new URL("./ts-negative-baseline.json", import.meta.url);

/** How many distinct problems to print before giving up. */
const MAX_REPORTED = 30;

/** Files past this size are fixtures for the emitter, not grammar tests. */
const MAX_BYTES = 400_000;

/**
 * Reduces a message to the rule behind it.
 *
 * The baseline is keyed by rule rather than by directory, which is where this
 * script departs from `conformance-262.mjs`. test262's directories mirror the
 * sections of the specification, so a directory names a rule there.
 * TypeScript's `tests/cases/compiler` is a single flat directory of several
 * thousand files and names nothing. The message does: keyed this way, a
 * regression report says which rule broke instead of which folder moved.
 * @param message The message a parser produced.
 * @returns The message with its interpolated names removed.
 */
function rule(message) {
	return message
		.replace(/'[^']*'/gu, "'…'")
		.replace(/`[^`]*`/gu, "`…`")
		.replace(/"[^"]*"/gu, '"…"')
		.replace(/\(\d+:\d+\)/gu, "")
		.trim();
}

/**
 * Collects every TypeScript file under a directory.
 * @param dir The directory to walk.
 * @param out Where to collect the paths.
 * @param depth How deep the walk already is.
 * @returns The collected paths.
 */
function walk(dir, out = [], depth = 0) {
	if (depth > 8) {
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
		} else if (/\.(ts|mts|cts|tsx)$/u.test(name) && stats.size < MAX_BYTES) {
			out.push(full);
		}
	}

	return out;
}

/**
 * Runs this parser under one reading of the module line.
 * @param code The source text.
 * @param sourceType Which reading to use.
 * @param options How the file should be interpreted.
 * @returns Why it was rejected, or `null` when it was accepted.
 */
function rejectionAs(code, sourceType, options) {
	let result;

	try {
		result = parse(code, { sourceType, jsx: options.jsx });
	} catch (error) {
		return `parse: ${error.message}`;
	}

	const problems = validate(result, {
		sourceType,
		dialect: "ts",
		jsx: options.jsx,
		declaration: options.declaration,
	});

	return problems.length === 0 ? null : `validate: ${problems[0].message}`;
}

/**
 * Runs this parser under both readings of the module line.
 * @param code The source text.
 * @param options How the file should be interpreted.
 * @returns Why it was rejected, or `null` when either reading accepted it.
 */
function rejection(code, options) {
	const asModule = rejectionAs(code, "module", options);

	if (asModule === null) {
		return null;
	}

	return rejectionAs(code, "script", options) === null ? null : asModule;
}

/**
 * Runs the reference parser.
 * @param code The source text.
 * @param options How the file should be interpreted.
 * @returns Why it was rejected, or `null` when it was accepted.
 */
function referenceRejection(code, options) {
	try {
		referenceParse(code, {
			sourceType: "module",
			jsx: options.jsx,
			loc: false,
			range: false,
			comment: false,
			tokens: false,
		});

		return null;
	} catch (error) {
		return String(error.message).replace(/\s*\(\d+:\d+\)\s*$/u, "");
	}
}

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith("--")));
const positional = args.filter(arg => !arg.startsWith("--"));
const root = positional[0] ?? "../../TypeScript";
const cap = Number(positional[1] ?? Infinity);
const files = walk(join(root, "tests", "cases")).sort().slice(0, cap);

const counts = {
	agreed: 0,
	rejected: 0,
	skipped: 0,
	missed: 0,
	overzealous: 0,
	parse: 0,
	validate: 0,
};
const problems = [];
const observed = {};

for (const file of files) {
	let code;

	try {
		code = readFileSync(file, "utf8");
	} catch {
		counts.skipped++;
		continue;
	}

	if (code.toLowerCase().includes("@filename")) {
		counts.skipped++;
		continue;
	}

	const options = {
		jsx: /\.tsx$/u.test(file),
		declaration: /\.d\.(ts|mts|cts)$/u.test(file),
	};
	const name = relative(root, file).split(sep).join("/");
	const expected = referenceRejection(code, options);
	const actual = rejection(code, options);

	if (expected !== null && actual !== null) {
		counts.rejected++;
		counts[actual.slice(0, actual.indexOf(":"))]++;
		continue;
	}

	if (expected === null && actual === null) {
		counts.agreed++;
		continue;
	}

	const kind = expected === null ? "overzealous" : "missed";
	const message = (kind === "missed" ? expected : actual) ?? "";
	const key = `${kind}: ${rule(message)}`;

	counts[kind]++;
	observed[key] = (observed[key] ?? 0) + 1;
	problems.push([name, kind, message]);
}

console.log(
	`files=${files.length} agreed=${counts.agreed} ` +
		`rejected=${counts.rejected} (parse=${counts.parse} ` +
		`validate=${counts.validate}) skipped=${counts.skipped} ` +
		`missed=${counts.missed} overzealous=${counts.overzealous}`,
);

if (flags.has("--update")) {
	const sorted = Object.fromEntries(
		Object.entries(observed).sort((a, b) => a[0].localeCompare(b[0])),
	);

	writeFileSync(BASELINE, `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(
		`wrote ${Object.keys(sorted).length} rules to ts-negative-baseline.json`,
	);
}

const seen = new Set();

for (const [file, kind, message] of problems) {
	const key = flags.has("--verbose") ? file : kind + message.slice(0, 90);

	if (seen.has(key)) {
		continue;
	}

	seen.add(key);
	console.log(`${kind.toUpperCase()} ${file}\n     ${message}`);

	if (!flags.has("--verbose") && seen.size >= MAX_REPORTED) {
		break;
	}
}

if (cap !== Infinity) {
	console.log("baseline not graded: the run was capped");

	process.exit();
}

/*
 * The grade. A rule whose count went up has a new failure even if it was never
 * at zero, and one whose count went down has a fix the baseline should record —
 * both are worth stopping for, so both are reported and only the first fails
 * the run.
 */
const expectedCounts = JSON.parse(readFileSync(BASELINE, "utf8"));
const worse = [];
const better = [];

for (const key of new Set([
	...Object.keys(expectedCounts),
	...Object.keys(observed),
])) {
	const was = expectedCounts[key] ?? 0;
	const now = observed[key] ?? 0;

	if (now > was) {
		worse.push(`  ${key}: ${was} -> ${now}`);
	} else if (now < was) {
		better.push(`  ${key}: ${was} -> ${now}`);
	}
}

if (worse.length === 0 && better.length === 0) {
	console.log("baseline unchanged");
} else {
	if (better.length > 0) {
		console.log(`fixed since the baseline:\n${better.join("\n")}`);
	}

	if (worse.length > 0) {
		console.log(`REGRESSED since the baseline:\n${worse.join("\n")}`);
		process.exitCode = 1;
	}

	console.log("re-run with --update once the change is understood");
}
