/**
 * @fileoverview Differential test of `eslintParser` against ESLint's own rule
 * test suite.
 *
 * The other scripts here compare one output against one reference: a tree
 * against `espree`'s, a scope graph against `eslint-scope`'s. This one asks
 * the question those cannot — whether *rules* behave the same — by running
 * ESLint's suite with `eslintParser` in place of `espree`, and with
 * `parseForESLint()` supplying the scope graph in place of `eslint-scope`.
 * Every failure is a program where a rule sees something different from what
 * ESLint's authors saw.
 *
 * The suite is not vendored, so point the script at a checkout of the same
 * version this repository depends on:
 *
 *     git clone --depth 1 --branch v10.8.1 https://github.com/eslint/eslint
 *     cd eslint && npm install
 *     node scripts/parse/conformance-eslint.mjs <path-to-eslint>
 *
 * Nothing in the checkout is modified. A generated mocha hook replaces the
 * parser on the JavaScript language object before the tests load, which is
 * the same swap `languageOptions.parser` performs for a user.
 *
 * **The dialect is pinned to `"js"`.** ESLint's rule tests have no file names,
 * so `eslintParser`'s extension-based default would read all thirty thousand
 * of them as TypeScript — where a legacy octal literal is an error and several
 * hundred tests use one. Pinning it asks the question the suite is actually
 * for: does a JavaScript file lint the way `espree` makes it lint?
 *
 * Two kinds of failure come out of the run, and only one of them is a defect:
 *
 * - **A difference in what is parsed or resolved.** These are the defects.
 * - **A difference in language version.** `eslintParser` implements the latest
 *   ECMAScript and nothing else, while the suite pins `ecmaVersion` per test
 *   and half a dozen files test ES3 and ES5 semantics — directives that do not
 *   apply, block-scoped functions that hoist. Nothing here can pass those, and
 *   nothing should try.
 *
 * The two are told apart by hand, which is why the grade is a baseline rather
 * than a zero: `eslint-baseline.json` holds a failure count per rule, so a new
 * failure is visible even in a rule that was never clean.
 *
 *     --update    rewrite the baseline from this run
 *     --verbose   print every failing test, not one per distinct message
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the per-rule failure counts are kept. */
const BASELINE = new URL("./eslint-baseline.json", import.meta.url);

/** The bundle the hook loads the parser from. */
const PARSER = fileURLToPath(new URL("../../dist/jskit.js", import.meta.url));

/** How many distinct failures to print before stopping. */
const MAX_REPORTED = 40;

const flags = new Set(process.argv.slice(2).filter(arg => arg.startsWith("-")));
const [target = "../eslint"] = process.argv
	.slice(2)
	.filter(arg => !arg.startsWith("-"));
const checkout = resolve(process.cwd(), target);

for (const required of [
	"lib/languages/js/index.js",
	"tests/lib/rules",
	"node_modules/mocha/bin/mocha.js",
]) {
	if (!existsSync(join(checkout, required))) {
		console.error(
			`${checkout} is not an installed eslint checkout: no ${required}.`,
		);
		process.exit(1);
	}
}

const work = mkdtempSync(join(tmpdir(), "jskit-eslint-"));
const bundle = join(work, "parser.cjs");
const hook = join(work, "hook.cjs");
const results = join(work, "results.json");

/*
 * The suite is CommonJS and the package ships one ES module, so the parser is
 * bundled rather than imported. This is the same bundle `dist/` holds, in the
 * other module format.
 */
await build({
	stdin: {
		contents: `export { eslintParser } from ${JSON.stringify(PARSER)};\n`,
		resolveDir: work,
		sourcefile: "parser.mjs",
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	outfile: bundle,
});

writeFileSync(
	hook,
	`"use strict";

const path = require("node:path");
const { eslintParser } = require(${JSON.stringify(bundle)});
const js = require(path.join(process.cwd(), "lib/languages/js/index.js"));

// See the note about the dialect in conformance-eslint.mjs.
js.defaultLanguageOptions.parser = {
	parse(code, options) {
		return eslintParser.parse(code, { ...options, dialect: "js" });
	},
	parseForESLint(code, options) {
		return eslintParser.parseForESLint(code, { ...options, dialect: "js" });
	},
};
`,
);

const run = spawnSync(
	process.execPath,
	[
		join(checkout, "node_modules/mocha/bin/mocha.js"),
		"tests/lib/rules/*.js",
		"--require",
		hook,
		"--reporter",
		"json",
		"--reporter-option",
		`output=${results}`,
		"--timeout",
		"20000",
	],
	{ cwd: checkout, encoding: "utf8" },
);

if (!existsSync(results)) {
	console.error(run.stderr || run.stdout || "mocha produced no output.");
	process.exit(1);
}

const report = JSON.parse(readFileSync(results, "utf8"));
const observed = {};
const problems = [];

for (const failure of report.failures) {
	const rule = basename(failure.file, ".js");
	const message = (failure.err?.message ?? "").split("\n")[0];

	observed[rule] = (observed[rule] ?? 0) + 1;
	problems.push([rule, failure.fullTitle.replace(/\n/gu, "\\n"), message]);
}

console.log(
	`tests=${report.stats.tests} passed=${report.stats.passes} ` +
		`failed=${report.stats.failures} rules=${Object.keys(observed).length}`,
);

if (flags.has("--update")) {
	const sorted = Object.fromEntries(
		Object.entries(observed).sort((a, b) => a[0].localeCompare(b[0])),
	);

	writeFileSync(BASELINE, `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(`wrote ${Object.keys(sorted).length} rules to eslint-baseline.json`);
}

const seen = new Set();

for (const [rule, title, message] of problems) {
	const key = flags.has("--verbose") ? title : message.slice(0, 90);

	if (seen.has(key)) {
		continue;
	}

	seen.add(key);
	console.log(`${rule}: ${title.slice(0, 100)}\n     ${message.slice(0, 120)}`);

	if (!flags.has("--verbose") && seen.size >= MAX_REPORTED) {
		break;
	}
}

/*
 * The grade, as in the other baselined runs: a rule whose count went up has a
 * new failure even where the count was never zero, and one whose count went
 * down has a fix the baseline should record.
 */
const expectedCounts = JSON.parse(readFileSync(BASELINE, "utf8"));
const worse = [];
const better = [];

for (const rule of new Set([
	...Object.keys(expectedCounts),
	...Object.keys(observed),
])) {
	const was = expectedCounts[rule] ?? 0;
	const now = observed[rule] ?? 0;

	if (now > was) {
		worse.push(`  ${rule}: ${was} -> ${now}`);
	} else if (now < was) {
		better.push(`  ${rule}: ${was} -> ${now}`);
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
