/**
 * @fileoverview Compares this parser against the parsers it aims to replace.
 *
 * Contenders are grouped into two tiers, and a result is only comparable
 * within its own tier:
 *
 * - **AST** is the smallest job that still yields a syntax tree. Nothing in
 *   this tier is asked for tokens, comments, `range`, or `loc`, except where a
 *   parser has no way to leave them out.
 * - **ESLint** is the job ESLint actually asks a parser to do: a tree plus a
 *   token list plus a comment list, with every one of them carrying both
 *   `range` and `loc`. It is a substantially larger job than the AST tier, so
 *   the two are measured and reported separately rather than in one ranking.
 *
 * The parser appears three times in the AST tier because its phases are
 * separable, and the gaps between the rows are the point: `parse()` alone
 * produces only the binary buffers, `validate()` adds the context-dependent
 * diagnostics, and `toAST()` materializes an ESTree tree. Only the third row
 * is doing the same job as `espree`, `acorn`, or `@babel/parser`.
 *
 * Fairness notes worth knowing before quoting a number:
 *
 * - `@typescript-eslint/parser` is measured through its `parse()` export with
 *   no `project` or `projectService` option, which is the path that builds a
 *   single `ts.SourceFile` for the one text it was handed. It never starts a
 *   `tsc` program, never reads a `tsconfig.json`, and never touches another
 *   file, so this measures parsing and nothing else. Its output always carries
 *   `range` and `loc`; there is no option to suppress them, which is why its
 *   AST-tier row is annotated.
 * - `@babel/eslint-parser` is measured through its `parse()` export rather
 *   than `parseForESLint()`, because the latter also runs a full scope
 *   analysis. No other contender is asked to do that, and ESLint runs its own
 *   analyzer for the parsers that do not supply one.
 * - `@babel/parser` returns Babel's own AST, not ESTree. The conversion cost
 *   that a consumer of an ESTree tree would pay lands on `@babel/eslint-parser`
 *   instead, so the two Babel rows bracket it.
 *
 * **Every contender is measured alone, in a process of its own.** Parsers that
 * share a heap do not share it evenly: loading TypeScript and Babel into the
 * process is by itself enough to halve the throughput of whichever parser
 * allocates most, and measuring contenders one after another in a single
 * process additionally hands whoever runs first the cleanest heap. Both of
 * those are properties of the benchmark rather than of the parsers, and one
 * process per contender is what removes them. It is also why a run takes a few
 * minutes.
 *
 * What is left is machine drift, which no arrangement removes. Three defenses:
 * each contender is sampled `ROUNDS` times per process, the whole list is
 * measured `PASSES` times over, and the reported figure is the median of every
 * sample. The `±` column is how far the samples disagreed — read a large one
 * as "this machine was busy", not as a measurement.
 *
 * ```bash
 * node benchmarks/benchmark.js                  # every suite
 * node benchmarks/benchmark.js --suite=ts       # one suite
 * node benchmarks/benchmark.js --json=out.json  # every suite, plus a data file
 * node benchmarks/benchmark.js some-file.ts     # one real file
 * ```
 *
 * `benchmarks/chart.js` turns the data file into a shareable SVG.
 */

import { createRequire } from "node:module";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Module from "node:module";
import {
	javascriptFixture,
	jsxFixture,
	typescriptFixture,
} from "./fixtures.js";

const require = createRequire(import.meta.url);

//-----------------------------------------------------------------------------
// Timing
//-----------------------------------------------------------------------------

/**
 * How many passes are made over the contender list.
 *
 * A pass measures every contender once, in its own process, and then the whole
 * list is measured again from the top. This machine drifts far enough over a
 * minute to change a ratio, so a contender measured only once is being handed
 * whatever stretch it happened to land in. Spreading each contender's samples
 * across passes means a slow stretch is shared out instead of landing on one
 * of them.
 */
const PASSES = 3;

/** How many times a contender is measured within one pass. */
const ROUNDS = 5;

/** How long one contender runs within one round, in milliseconds. */
const ROUND_MS = 300;

/** How long each contender runs before any of it counts, in milliseconds. */
const WARMUP_MS = 400;

/**
 * Runs a function until a deadline passes, discarding the result.
 * @param run The function to run.
 * @param milliseconds How long to keep going.
 * @returns Nothing.
 */
function warmUp(run, milliseconds) {
	const end = performance.now() + milliseconds;

	while (performance.now() < end) {
		run();
	}
}

/**
 * Runs a function for roughly the requested time and reports the rate.
 *
 * The rate is against the time that actually elapsed rather than the time
 * asked for, so a contender slow enough to overshoot the slice with a single
 * call is still measured correctly.
 * @param run The function to measure.
 * @param milliseconds How long to keep going.
 * @returns The operations per second.
 */
function timeSlice(run, milliseconds) {
	let operations = 0;
	const start = performance.now();
	let now = start;

	while (now - start < milliseconds) {
		run();
		operations++;
		now = performance.now();
	}

	return operations / ((now - start) / 1000);
}

/**
 * Finds the middle value of a list of numbers.
 * @param values The numbers to reduce. Must not be empty.
 * @returns The median.
 */
function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;

	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

//-----------------------------------------------------------------------------
// Tiers
//-----------------------------------------------------------------------------

/** A syntax tree and nothing more. */
const AST = "ast";

/** A tree, tokens, and comments, all carrying `range` and `loc`. */
const ESLINT = "eslint";

/** How each tier is introduced in the printed output. */
const TIER_TITLES = {
	[AST]: "AST only",
	[ESLINT]: "ESLint job: AST + tokens + comments, with range and loc",
};

//-----------------------------------------------------------------------------
// TypeScript Version Switching
//-----------------------------------------------------------------------------

const originalResolve = Module._resolveFilename;

/**
 * Loads a fresh copy of `@typescript-eslint/parser` bound to a specific
 * TypeScript package.
 * @param packageName The package to resolve `"typescript"` to.
 * @returns The parser's `parse` function and the TypeScript version backing
 *      it, `null` when the package is not installed, or an object carrying
 *      `error` when the two refuse to work together.
 */
function loadTypeScriptEslint(packageName) {
	let resolved;

	try {
		resolved = require.resolve(packageName);
	} catch {
		return null;
	}

	// Drop every cached module that may hold a reference to TypeScript.
	for (const key of Object.keys(require.cache)) {
		if (key.includes("typescript") || key.includes("@typescript-eslint")) {
			delete require.cache[key];
		}
	}

	Module._resolveFilename = function (request, ...rest) {
		if (request === "typescript") {
			return resolved;
		}

		return originalResolve.call(this, request, ...rest);
	};

	try {
		const parser = require("@typescript-eslint/parser");
		const version = require(`${packageName}/package.json`).version;

		// Confirm the pairing actually works before reporting a result.
		parser.parse("const a: number = 1;", { sourceType: "module" });

		return { parse: parser.parse, version };
	} catch (error) {
		return { error: error.message.split("\n")[0] };
	} finally {
		Module._resolveFilename = originalResolve;
	}
}

//-----------------------------------------------------------------------------
// Babel
//-----------------------------------------------------------------------------

/**
 * Builds the `babelOptions` that keep `@babel/eslint-parser` from reading
 * configuration off disk.
 *
 * Every lookup it can do — `babel.config.js`, `.babelrc`, a browserslist file
 * — is turned off, so what is measured is the parse and the ESTree conversion
 * rather than the file system.
 * @param dialect One of `"js"`, `"ts"`, or `"jsx"`.
 * @returns The options to hand to the parser.
 */
function babelEslintOptions(dialect) {
	const filename = dialect === "ts" ? "benchmark.ts" : "benchmark.js";

	return {
		sourceType: "module",
		filePath: filename,
		requireConfigFile: false,
		babelOptions: {
			filename,
			configFile: false,
			babelrc: false,
			browserslistConfigFile: false,
			presets:
				dialect === "ts"
					? [require.resolve("@babel/preset-typescript")]
					: [],
			plugins:
				dialect === "jsx"
					? [require.resolve("@babel/plugin-syntax-jsx")]
					: [],
		},
	};
}

/**
 * Chooses the `@babel/parser` plugins a dialect needs.
 * @param dialect One of `"js"`, `"ts"`, or `"jsx"`.
 * @returns The plugin list.
 */
function babelPlugins(dialect) {
	if (dialect === "ts") {
		return ["typescript"];
	}

	return dialect === "jsx" ? ["jsx"] : [];
}

//-----------------------------------------------------------------------------
// Contenders
//-----------------------------------------------------------------------------

/**
 * Builds the list of parsers to measure for a given dialect.
 * @param dialect One of `"js"`, `"ts"`, or `"jsx"`.
 * @returns The contenders, each with a stable key, a display name, a tier, and
 *      a run function. The key is what a consumer of the data file matches on,
 *      so that a contender whose display name carries a version number stays
 *      identifiable across runs.
 */
async function contenders(dialect) {
	const jskit = await import("../../dist/jskit.js").catch(
		() => import("../../src/index.ts"),
	);

	/*
	 * `dialect: "jsx"` is not a thing the parser is told about. JSX is JavaScript
	 * with an extra syntax flag, so the dialect stays `"js"` and `jsx` is what
	 * turns it on.
	 */
	const jskitOptions = {
		sourceType: "module",
		dialect: dialect === "ts" ? "ts" : "js",
		jsx: dialect === "jsx",
	};

	const list = [
		{
			key: "jskit-parse",
			name: "jskit: parse()",
			note: "binary AST and token buffers, no ESTree",
			tier: AST,
			run: code => jskit.parse(code),
		},
		{
			key: "jskit-validate",
			name: "jskit: parse() + validate()",
			note: "buffers plus every context-dependent diagnostic",
			tier: AST,
			run: code => jskit.validate(jskit.parse(code), jskitOptions),
		},
		{
			key: "jskit-to-ast",
			name: "jskit: parse() + toAST()",
			tier: AST,
			run: code => jskit.toAST(jskit.parse(code), jskitOptions),
		},
		{
			key: "jskit-eslint",
			name: "jskit: eslintParser.parse()",
			tier: ESLINT,
			run: code =>
				jskit.eslintParser.parse(code, {
					sourceType: "module",
					filePath:
						dialect === "ts" ? "benchmark.ts" : "benchmark.js",
					ecmaFeatures: { jsx: dialect === "jsx" },
				}),
		},
	];

	// `espree` and `acorn` have nothing to say about TypeScript.
	if (dialect !== "ts") {
		const espree = await import("espree");
		const ecmaFeatures = { jsx: dialect === "jsx" };

		list.push(
			{
				key: "espree",
				name: "espree",
				tier: AST,
				run: code =>
					espree.parse(code, {
						ecmaVersion: "latest",
						sourceType: "module",
						ecmaFeatures,
					}),
			},
			{
				key: "espree",
				name: "espree",
				tier: ESLINT,
				run: code =>
					espree.parse(code, {
						ecmaVersion: "latest",
						sourceType: "module",
						ecmaFeatures,
						comment: true,
						tokens: true,
						range: true,
						loc: true,
					}),
			},
		);

		/*
		 * `acorn` has no JSX of its own, but `acorn-jsx` is what `espree`
		 * builds on, so the plain-`acorn` baseline is available either way.
		 */
		const acorn = await import("acorn");
		const parser =
			dialect === "jsx"
				? acorn.Parser.extend((await import("acorn-jsx")).default())
				: acorn.Parser;

		list.push({
			key: "acorn",
			name: dialect === "jsx" ? "acorn + acorn-jsx" : "acorn",
			tier: AST,
			run: code =>
				parser.parse(code, {
					ecmaVersion: "latest",
					sourceType: "module",
				}),
		});
	}

	/*
	 * `@typescript-eslint/parser` is measured against every TypeScript version
	 * installed, because which one backs it is the largest single influence on
	 * its speed. Only the default one appears in the ESLint tier; the extra
	 * versions are there to compare against each other, not against everything
	 * else.
	 */
	const base = { sourceType: "module", jsx: dialect === "jsx" };

	for (const [label, packageName, key] of [
		["default", "typescript", "typescript-eslint"],
		["typescript 6", "typescript-6", "typescript-eslint-6"],
		["typescript 7", "typescript-7", "typescript-eslint-7"],
	]) {
		const loaded = loadTypeScriptEslint(packageName);

		/*
		 * These go to stderr, not stdout: in a child process stdout carries
		 * the measurement as JSON and nothing else may be written to it.
		 */
		if (loaded === null) {
			console.error(
				`  (skipping @typescript-eslint/parser + ${label}: not installed; ` +
					`add it with "npm i -D ${packageName}@npm:typescript@${label.slice(-1)}")`,
			);
			continue;
		}

		if (loaded.error !== undefined) {
			console.error(
				`  (skipping @typescript-eslint/parser + ${label}: ${loaded.error})`,
			);
			continue;
		}

		const name = `@typescript-eslint/parser + typescript ${loaded.version}`;

		list.push({
			key,
			name,
			note: "range and loc cannot be turned off",
			tier: AST,
			run: code => loaded.parse(code, base),
		});

		if (packageName === "typescript") {
			list.push({
				key,
				name,
				tier: ESLINT,
				run: code =>
					loaded.parse(code, {
						...base,
						comment: true,
						tokens: true,
						range: true,
						loc: true,
					}),
			});
		}
	}

	const babelParser = require("@babel/parser");
	const plugins = babelPlugins(dialect);

	list.push({
		key: "babel",
		name: "@babel/parser",
		note: "Babel's own AST, not ESTree",
		tier: AST,
		run: code => babelParser.parse(code, { sourceType: "module", plugins }),
	});

	const babelEslint = require("@babel/eslint-parser");
	const babelEslintConfig = babelEslintOptions(dialect);

	list.push({
		key: "babel-eslint",
		name: "@babel/eslint-parser",
		tier: ESLINT,
		run: code => babelEslint.parse(code, babelEslintConfig),
	});

	return list;
}

//-----------------------------------------------------------------------------
// Runner
//-----------------------------------------------------------------------------

/**
 * Identifies one contender within a suite.
 *
 * A key alone is not enough, because `espree` and `@typescript-eslint/parser`
 * each enter both tiers.
 * @param contender The contender to identify.
 * @returns The identifier.
 */
function idOf(contender) {
	return `${contender.tier}:${contender.key}`;
}

/**
 * Measures one contender and writes the result to stdout as JSON.
 *
 * This is what a child process does. It is the whole reason the child exists:
 * a contender measured alongside the others shares a heap with them, and the
 * cost of that heap does not fall evenly — loading TypeScript alone is enough
 * to halve the throughput of whichever parser allocates most, which is a
 * property of the benchmark rather than of the parser. One contender per
 * process is the only arrangement in which nobody is paying for anybody
 * else's garbage.
 * @param dialect The suite's dialect.
 * @param code The source text to parse.
 * @param id The identifier of the contender to measure.
 * @returns Nothing.
 */
async function measureOne(dialect, code, id) {
	const contender = (await contenders(dialect)).find(
		candidate => idOf(candidate) === id,
	);

	if (!contender) {
		process.stdout.write(JSON.stringify({ id, error: "not found" }));
		return;
	}

	const run = () => contender.run(code);
	const record = {
		id,
		key: contender.key,
		name: contender.name,
		note: contender.note ?? null,
		tier: contender.tier,
	};

	try {
		run();
	} catch (error) {
		process.stdout.write(
			JSON.stringify({
				...record,
				error: error.message.split("\n")[0],
			}),
		);
		return;
	}

	warmUp(run, WARMUP_MS);

	const rates = [];

	for (let round = 0; round < ROUNDS; round++) {
		rates.push(timeSlice(run, ROUND_MS));
	}

	process.stdout.write(JSON.stringify({ ...record, rates }));
}

/**
 * Runs one child process and parses the JSON it wrote.
 * @param args The arguments to pass after the script path.
 * @returns The parsed output, or `null` when the child produced none.
 */
async function runChild(args) {
	const child = spawn(
		process.execPath,
		[fileURLToPath(import.meta.url), ...args],

		/*
		 * Only stdout is captured. Anything a parser writes to stderr — and
		 * `@typescript-eslint/parser` writes a paragraph about unsupported
		 * TypeScript versions — passes through to the terminal instead of
		 * corrupting the data.
		 */
		{ stdio: ["ignore", "pipe", "inherit"] },
	);

	const chunks = [];

	child.stdout.on("data", chunk => chunks.push(chunk));

	/*
	 * `close` rather than `exit`: `exit` fires when the process ends, which can
	 * be before its output has been read, and a truncated JSON document would
	 * be indistinguishable from a parser that crashed.
	 */
	await once(child, "close");

	const output = Buffer.concat(chunks).toString("utf8").trim();

	return output ? JSON.parse(output) : null;
}

/**
 * Measures every contender in a suite, each in its own process, and prints a
 * table per tier.
 * @param title A label for the source text.
 * @param code The source text to parse.
 * @param dialect One of `"js"`, `"ts"`, or `"jsx"`.
 * @param sourceArgs The arguments that tell a child which source to read.
 * @returns The measurements, for a caller collecting them into a data file.
 */
async function runSuite(title, code, dialect, sourceArgs) {
	const bytes = Buffer.byteLength(code);

	console.log(`\n${title} (${(bytes / 1024).toFixed(1)} KiB)`);

	const ids = await runChild([...sourceArgs, "--list"]);
	const samples = new Map();
	const records = new Map();

	for (let pass = 0; pass < PASSES; pass++) {
		process.stdout.write(
			`  pass ${pass + 1} of ${PASSES}: ${ids.length} parsers`,
		);

		for (const id of ids) {
			const measured = await runChild([...sourceArgs, `--measure=${id}`]);

			// A dot per contender, so a run that takes minutes looks alive.
			process.stdout.write(".");

			if (!measured) {
				continue;
			}

			records.set(id, measured);

			if (measured.error) {
				continue;
			}

			samples.set(id, (samples.get(id) ?? []).concat(measured.rates));
		}

		process.stdout.write("\n");
	}

	const results = [];

	for (const [id, record] of records) {
		const rates = samples.get(id);

		if (!rates) {
			console.log(`  ${record.name}: failed (${record.error})`);
			continue;
		}

		const opsPerSecond = median(rates);

		results.push({
			key: record.key,
			name: record.name,
			note: record.note,
			tier: record.tier,
			opsPerSecond,
			megabytesPerSecond: (opsPerSecond * bytes) / 1_000_000,
			samples: rates.length,
			slowestSample: Math.min(...rates),
			fastestSample: Math.max(...rates),
		});
	}

	for (const tier of [AST, ESLINT]) {
		const tierResults = results
			.filter(result => result.tier === tier)
			.sort((a, b) => b.opsPerSecond - a.opsPerSecond);

		if (tierResults.length === 0) {
			continue;
		}

		console.log(`\n  ${TIER_TITLES[tier]}`);

		/*
		 * The multiple is against the slowest row rather than the fastest, so
		 * it reads as "this many times faster than the bottom of the table"
		 * and grows with speed.
		 */
		const slowest = tierResults.at(-1).opsPerSecond;

		for (const result of tierResults) {
			const relative = (result.opsPerSecond / slowest).toFixed(2);

			/*
			 * How far the samples disagreed, so a result taken while the
			 * machine was drifting is visible as one rather than being read
			 * as a measurement.
			 */
			const spread =
				(100 * (result.fastestSample - result.slowestSample)) /
				2 /
				result.opsPerSecond;

			console.log(
				`    ${result.name.padEnd(48)} ` +
					`${result.opsPerSecond.toFixed(1).padStart(8)} ops/s  ` +
					`${result.megabytesPerSecond.toFixed(1).padStart(6)} MB/s  ` +
					`${relative.padStart(6)}x  ` +
					`±${spread.toFixed(0).padStart(2)}%` +
					(result.note ? `  — ${result.note}` : ""),
			);
		}
	}

	return { title, dialect, bytes, results };
}

/**
 * Sends the identifiers of a suite's contenders to stdout as JSON.
 *
 * The parent asks a child for this rather than building the list itself,
 * because building it loads TypeScript and Babel, and the parent is going to
 * outlive every measurement it collects.
 * @param dialect The suite's dialect.
 * @returns Nothing.
 */
async function listContenders(dialect) {
	const list = await contenders(dialect);

	process.stdout.write(JSON.stringify(list.map(idOf)));
}

//-----------------------------------------------------------------------------
// Entry Point
//-----------------------------------------------------------------------------

/** How large every generated fixture should be, in bytes. */
const FIXTURE_BYTES = 200_000;

/** Every suite the benchmark knows how to run, in the order they are shown. */
const SUITES = {
	js: {
		title: "JavaScript",
		fixture: () => javascriptFixture(FIXTURE_BYTES),
	},
	ts: {
		title: "TypeScript",
		fixture: () => typescriptFixture(FIXTURE_BYTES),
	},
	jsx: {
		title: "JSX",
		fixture: () => jsxFixture(FIXTURE_BYTES),
	},
};

/**
 * Chooses the dialect to parse a file as.
 * @param filename The name of the file being parsed.
 * @returns The dialect that matches the file's extension.
 */
function dialectOf(filename) {
	if (/\.[cm]?tsx?$/u.test(filename)) {
		return "ts";
	}

	return /\.jsx$/u.test(filename) ? "jsx" : "js";
}

/**
 * Reads a `--name=value` argument out of the command line.
 * @param name The argument's name, without the leading dashes.
 * @returns The value, or `null` when the argument was not given.
 */
function option(name) {
	const prefix = `--${name}=`;
	const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));

	return found === undefined ? null : found.slice(prefix.length);
}

const suiteName = option("suite");
const filePath = option("file");
const jsonPath = option("json");
const measureId = option("measure");
const listing = process.argv.includes("--list");
const [positional] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));

/**
 * Resolves the arguments into a source text and the dialect to read it as.
 * @returns The suite title, the source, the dialect, and the fixture name.
 */
function resolveSource() {
	if (suiteName) {
		const suite = SUITES[suiteName];

		if (!suite) {
			console.error(
				`Unknown suite "${suiteName}". Try one of: ${Object.keys(SUITES).join(", ")}.`,
			);
			process.exit(1);
		}

		return {
			title: suite.title,
			code: suite.fixture(),
			dialect: suiteName,
			sourceArgs: [`--suite=${suiteName}`],
		};
	}

	const path = filePath ?? positional;

	return {
		title: path,
		code: readFileSync(path, "utf8"),
		dialect: dialectOf(path),

		/*
		 * A child reads the file itself rather than being handed its text,
		 * because the text does not fit on a command line.
		 */
		sourceArgs: [`--file=${path}`],
	};
}

if (measureId || listing) {
	// Child mode: stdout carries JSON and nothing else.
	const { code, dialect } = resolveSource();

	if (listing) {
		await listContenders(dialect);
	} else {
		await measureOne(dialect, code, measureId);
	}
} else if (suiteName || positional || filePath) {
	const { title, code, dialect, sourceArgs } = resolveSource();

	const suiteResult = await runSuite(title, code, dialect, sourceArgs);

	if (jsonPath) {
		writeFileSync(jsonPath, JSON.stringify(suiteResult, null, "\t"));
	}
} else {
	const suites = [];

	for (const dialect of Object.keys(SUITES)) {
		const suite = SUITES[dialect];

		suites.push(
			await runSuite(suite.title, suite.fixture(), dialect, [
				`--suite=${dialect}`,
			]),
		);
	}

	if (jsonPath) {
		writeFileSync(
			jsonPath,
			JSON.stringify(
				{
					node: process.version,
					fixtureBytes: FIXTURE_BYTES,
					passes: PASSES,
					rounds: ROUNDS,
					suites,
				},
				null,
				"\t",
			),
		);
		console.log(`\nWrote ${jsonPath}`);
	}
}
