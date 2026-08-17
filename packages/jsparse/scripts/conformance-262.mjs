/**
 * @fileoverview Expectation test of `parse()` and `validate()` against test262.
 *
 * The other conformance scripts are differential: they compare this parser's
 * output against another implementation's. This one is not, because test262
 * carries its own answer. Every file states in its frontmatter whether it is
 * valid ECMAScript, and a `negative` block with `phase: parse` says the file
 * must be rejected before a line of it runs. That makes it the only corpus
 * here that tests the *rejecting* half of the parser: `node_modules` holds no
 * syntax errors, so nothing else ever checks that an error is reported at all.
 *
 * "Rejected" means either shape, since the phase split puts the two on
 * opposite sides of it: `parse()` throwing, or `validate()` returning a
 * problem. Which one is not asserted. The bug is a file with an early error
 * that is accepted in silence.
 *
 * test262 is not vendored, so point the script at a checkout:
 *
 *     git clone --depth 1 https://github.com/tc39/test262
 *     node scripts/conformance-262.mjs <path-to-test262>
 *
 * Two failures are possible and they are not equally bad. **Overzealous** is a
 * valid program this parser rejects, which breaks working code and should
 * always be zero. **Missed** is an invalid program it accepts, of which there
 * are still thousands: the early errors listed in `262-exclusions.mjs` are not
 * implemented yet. Both are graded against `262-baseline.json`, per directory,
 * so a new failure is visible even where the count was never zero.
 *
 *     --update    rewrite the baseline from this run
 *     --verbose   print every failing file, not one per distinct message
 *     --features  print failure counts by the feature each file declares
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse, validate } from "../dist/jsparse.js";
import {
	KNOWN_OVERZEALOUS,
	UNSUPPORTED_FEATURES,
} from "./262-exclusions.mjs";

/** Where the per-directory failure counts are kept. */
const BASELINE = new URL("./262-baseline.json", import.meta.url);

/** How many distinct problems to print before giving up. */
const MAX_REPORTED = 30;

/** How many path segments a baseline key keeps. */
const BASELINE_DEPTH = 4;

/** The `"use strict"` prologue test262 prepends for the strict run. */
const STRICT_PROLOGUE = '"use strict";\n';

/**
 * Collects every test file under a directory.
 *
 * `staging/` holds tests that have not been reviewed into the suite proper and
 * are excluded from it; a `_FIXTURE` file is a module body imported by another
 * test rather than a test itself.
 * @param dir The directory to walk.
 * @param out Where to collect the paths.
 * @returns The collected paths.
 */
function walk(dir, out = []) {
	let entries;

	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}

	for (const entry of entries) {
		const full = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (entry.name !== "staging") {
				walk(full, out);
			}
		} else if (
			entry.name.endsWith(".js") &&
			!entry.name.includes("_FIXTURE")
		) {
			out.push(full);
		}
	}

	return out;
}

/**
 * Reads the parts of a test's YAML frontmatter this script acts on.
 *
 * The block is a small, mostly machine-generated subset of YAML — flow
 * sequences for `flags` and `features`, and a two-key mapping for `negative` —
 * so it is read directly rather than with a parser.
 * @param code The file's full text.
 * @returns The frontmatter's meaning, or `null` when there is no frontmatter.
 */
function frontmatter(code) {
	const open = code.indexOf("/*---");

	if (open === -1) {
		return null;
	}

	const close = code.indexOf("---*/", open);

	if (close === -1) {
		return null;
	}

	const block = code.slice(open + 5, close);
	const list = name => {
		const match = new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]`, "mu").exec(
			block,
		);

		return match === null
			? []
			: match[1]
					.split(",")
					.map(item => item.trim())
					.filter(Boolean);
	};

	const negative = /^negative:/mu.test(block)
		? {
				phase: /^\s+phase:\s*(\S+)/mu.exec(block)?.[1] ?? "",
				type: /^\s+type:\s*(\S+)/mu.exec(block)?.[1] ?? "",
			}
		: null;

	return { flags: list("flags"), features: list("features"), negative };
}

/**
 * Decides how a test must be run, per its `flags` attribute.
 *
 * A test with none of the mode flags is run twice, sloppy and strict, and the
 * strict run is the sloppy source with a `"use strict"` prologue prepended.
 * That is the only way this corpus reaches the strict-mode early errors at
 * all, since almost none of the files write the directive themselves.
 * @param flags The test's `flags` attribute.
 * @returns One entry per run, each naming a source type and a prologue.
 */
function runsFor(flags) {
	if (flags.includes("module")) {
		return [{ sourceType: "module", prologue: "", label: "module" }];
	}

	if (flags.includes("raw") || flags.includes("noStrict")) {
		return [{ sourceType: "script", prologue: "", label: "sloppy" }];
	}

	const strict = {
		sourceType: "script",
		prologue: STRICT_PROLOGUE,
		label: "strict",
	};

	if (flags.includes("onlyStrict")) {
		return [strict];
	}

	return [{ sourceType: "script", prologue: "", label: "sloppy" }, strict];
}

/**
 * Runs one file through both phases and reports whether it was rejected.
 * @param code The source text, prologue included.
 * @param sourceType How the program should be interpreted.
 * @returns Why it was rejected, or `null` when it was accepted.
 */
function rejection(code, sourceType) {
	let result;

	try {
		result = parse(code);
	} catch (error) {
		return `parse: ${error.message}`;
	}

	const problems = validate(result, { sourceType, dialect: "js" });

	return problems.length === 0 ? null : `validate: ${problems[0].message}`;
}

/**
 * Reduces a test's path to the directory its failures are counted under.
 * @param name The path relative to the checkout, with `/` separators.
 * @returns The first few segments of its directory.
 */
function area(name) {
	return dirname(name).split("/").slice(0, BASELINE_DEPTH).join("/");
}

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith("--")));
const positional = args.filter(arg => !arg.startsWith("--"));
const root = positional[0] ?? "../../test262";
const cap = Number(positional[1] ?? Infinity);
const files = walk(join(root, "test")).sort().slice(0, cap);

const counts = { valid: 0, invalid: 0, skipped: 0, missed: 0, overzealous: 0 };
const problems = [];
const byFeature = new Map();
const observed = {};

for (const file of files) {
	const code = readFileSync(file, "utf8");
	const meta = frontmatter(code);

	if (meta === null) {
		counts.skipped++;
		continue;
	}

	if (meta.features.some(feature => UNSUPPORTED_FEATURES.has(feature))) {
		counts.skipped++;
		continue;
	}

	/*
	 * A `resolution` phase error is a module-linking error — an import naming
	 * an export the other file does not have — which needs the whole module
	 * graph and so is nothing either phase here can see. A `runtime` one is by
	 * definition not a syntax error, so the file must parse.
	 */
	if (meta.negative?.phase === "resolution") {
		counts.skipped++;
		continue;
	}

	const mustReject =
		meta.negative !== null &&
		meta.negative.phase === "parse" &&
		meta.negative.type === "SyntaxError";
	const name = relative(root, file).split(sep).join("/");

	for (const run of runsFor(meta.flags)) {
		const why = rejection(run.prologue + code, run.sourceType);

		if (mustReject ? why !== null : why === null) {
			counts[mustReject ? "invalid" : "valid"]++;
			continue;
		}

		const kind = mustReject ? "missed" : "overzealous";

		counts[kind]++;
		observed[area(name)] = (observed[area(name)] ?? 0) + 1;
		problems.push([name, run.label, kind, why ?? "accepted"]);

		for (const feature of meta.features.length > 0
			? meta.features
			: ["(none)"]) {
			byFeature.set(feature, (byFeature.get(feature) ?? 0) + 1);
		}

		break;
	}
}

console.log(
	`files=${files.length} valid=${counts.valid} invalid=${counts.invalid} ` +
		`skipped=${counts.skipped} missed=${counts.missed} ` +
		`overzealous=${counts.overzealous}`,
);

if (flags.has("--update")) {
	const sorted = Object.fromEntries(
		Object.entries(observed).sort((a, b) => a[0].localeCompare(b[0])),
	);

	writeFileSync(BASELINE, `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(
		`wrote ${Object.keys(sorted).length} directories to 262-baseline.json`,
	);
}

if (flags.has("--features")) {
	for (const [feature, count] of [...byFeature].sort((a, b) => b[1] - a[1])) {
		console.log(`${String(count).padStart(6)}  ${feature}`);
	}
}

const seen = new Set();

for (const [file, label, kind, message] of problems) {
	const key = flags.has("--verbose")
		? file + label
		: kind + message.slice(0, 90);

	if (seen.has(key)) {
		continue;
	}

	seen.add(key);
	console.log(`${kind.toUpperCase()} ${file} [${label}]\n     ${message}`);

	if (!flags.has("--verbose") && seen.size >= MAX_REPORTED) {
		break;
	}
}

/*
 * The grade. A directory whose count went up has a new failure even if it was
 * never at zero, and one whose count went down has a fix that the baseline
 * should record — both are worth stopping for, so both are reported and only
 * the first fails the run.
 */
const expected = JSON.parse(readFileSync(BASELINE, "utf8"));
const worse = [];
const better = [];

for (const key of new Set([
	...Object.keys(expected),
	...Object.keys(observed),
])) {
	const was = expected[key] ?? 0;
	const now = observed[key] ?? 0;

	if (now > was) {
		worse.push(`  ${key}: ${was} -> ${now}`);
	} else if (now < was) {
		better.push(`  ${key}: ${was} -> ${now}`);
	}
}

if (cap !== Infinity) {
	console.log("baseline not graded: the run was capped");

	process.exit();
}

/*
 * Valid programs the parser rejects are graded on their own, because the whole
 * count is small enough to name and is the one that has to reach zero.
 */
if (counts.overzealous > KNOWN_OVERZEALOUS) {
	console.log(
		`REGRESSED: ${counts.overzealous} valid programs rejected, was ` +
			`${KNOWN_OVERZEALOUS}. Every one is a working program this parser ` +
			`will not read.`,
	);
	process.exitCode = 1;
} else if (counts.overzealous < KNOWN_OVERZEALOUS) {
	console.log(
		`${KNOWN_OVERZEALOUS - counts.overzealous} fewer valid programs ` +
			`rejected. Update KNOWN_OVERZEALOUS in 262-exclusions.mjs.`,
	);
}

if (worse.length === 0 && better.length === 0) {
	console.log("baseline unchanged");
} else {
	if (better.length > 0) {
		console.log(`fixed since the baseline:\n${better.join("\n")}`);
	}

	if (worse.length > 0) {
		console.log(`REGRESSED since the baseline:\n${worse.join("\n")}`);
	}

	console.log("re-run with --update once the change is understood");
	process.exitCode = worse.length > 0 ? 1 : 0;
}
