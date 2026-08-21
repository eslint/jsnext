/**
 * @fileoverview Compares scope analysis against the analyzers this one aims to
 * replace.
 *
 * There are two ways to read a comparison like this, and both are here.
 *
 * The `analysis` suites measure scope analysis alone, with the parse hoisted
 * out of the measured region. That is the honest comparison of the analyzers
 * themselves, and it is where working on the binary buffers shows up: no
 * ESTree objects are read, and the walk dispatches on integers. Both entry
 * points appear there, so the cost of the compatibility path is visible
 * next to the reference analyzer it competes with — `analyzeTree()` and the
 * reference analyzer are handed the very same tree.
 *
 * The `full` suites measure parsing and analysis together, which is what a
 * tool actually asks for. Nobody analyzes a program they did not just parse,
 * and the reference analyzers cannot run without a reference parser in front
 * of them.
 *
 * Each suite runs in its own child process. Loading TypeScript leaves a large
 * heap behind, and the garbage collection pressure that follows lands hardest
 * on whichever implementation allocates most, which is not a property of the
 * analyzers worth measuring.
 */

import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	javascriptFixture,
	jsxFixture,
	typescriptFixture,
} from "../parse/fixtures.js";

//-----------------------------------------------------------------------------
// Timing
//-----------------------------------------------------------------------------

/** How long each measured run should last, in milliseconds. */
const RUN_MS = 1500;

/** How long to run before measuring, in milliseconds. */
const WARMUP_MS = 400;

/**
 * Runs a function repeatedly and reports how fast it went.
 * @param run The function to measure.
 * @param bytes The number of source bytes processed per call.
 * @returns The operations per second and throughput in megabytes per second.
 */
function measure(run, bytes) {
	const warmupEnd = performance.now() + WARMUP_MS;

	while (performance.now() < warmupEnd) {
		run();
	}

	let operations = 0;
	const start = performance.now();
	let now = start;

	while (now - start < RUN_MS) {
		run();
		operations++;
		now = performance.now();
	}

	const seconds = (now - start) / 1000;

	return {
		opsPerSecond: operations / seconds,
		megabytesPerSecond: (operations * bytes) / seconds / 1_000_000,
	};
}

//-----------------------------------------------------------------------------
// Contenders
//-----------------------------------------------------------------------------

/**
 * Builds the list of analyzers to measure.
 * @param dialect Either `"js"`, `"jsx"`, or `"ts"`.
 * @param code The source text every contender will be given.
 * @param withParse Whether parsing counts toward the measurement.
 * @returns The contenders, each with a name and a function to measure.
 */
async function contenders(dialect, code, withParse) {
	const jskit = await import("../../dist/jskit.js");
	const list = [];

	const scopeOptions = {
		sourceType: "module",
		dialect: dialect === "ts" ? "ts" : "js",
		jsx: dialect !== "js",
	};

	if (withParse) {
		list.push({
			name: "jskit: parse() + analyze()",
			run: () => jskit.analyze(jskit.parse(code), scopeOptions),
		});
	} else {
		const parsed = jskit.parse(code);

		list.push({
			name: "jskit: analyze()",
			run: () => jskit.analyze(parsed, scopeOptions),
		});
	}

	if (dialect === "ts") {
		const parser = await import("@typescript-eslint/parser");
		const scopeManager = await import("@typescript-eslint/scope-manager");
		const parserOptions = {
			sourceType: "module",
			range: true,
			loc: true,
			jsx: false,
		};

		/*
		 * `lib: []` matches what the conformance script does, and for the same
		 * reason: the default injects a thousand names from TypeScript's
		 * standard library, which measures building a fixed table rather than
		 * analyzing the program.
		 */
		const analyzeOptions = { sourceType: "module", lib: [] };

		if (withParse) {
			list.push({
				name: "@typescript-eslint/parser + scope-manager",
				run: () =>
					scopeManager.analyze(
						parser.parse(code, parserOptions),
						analyzeOptions,
					),
			});
		} else {
			const tree = parser.parse(code, parserOptions);

			list.push({
				name: "jskit: analyzeTree()",
				run: () => jskit.analyzeTree(tree, scopeOptions),
			});
			list.push({
				name: "@typescript-eslint/scope-manager",
				run: () => scopeManager.analyze(tree, analyzeOptions),
			});
		}

		return list;
	}

	const espree = await import("espree");
	const eslintScope = await import("eslint-scope");
	const parserOptions = {
		ecmaVersion: "latest",
		sourceType: "module",
		range: true,
		loc: true,
		ecmaFeatures: { jsx: dialect === "jsx" },
	};
	const analyzeOptions = {
		ecmaVersion: 2025,
		sourceType: "module",
		jsx: dialect === "jsx",
	};

	if (withParse) {
		list.push({
			name: "espree + eslint-scope",
			run: () =>
				eslintScope.analyze(
					espree.parse(code, parserOptions),
					analyzeOptions,
				),
		});
	} else {
		const tree = espree.parse(code, parserOptions);

		list.push({
			name: "jskit: analyzeTree()",
			run: () => jskit.analyzeTree(tree, scopeOptions),
		});
		list.push({
			name: "eslint-scope",
			run: () => eslintScope.analyze(tree, analyzeOptions),
		});
	}

	return list;
}

//-----------------------------------------------------------------------------
// Runner
//-----------------------------------------------------------------------------

/**
 * Measures every contender against one source text and prints a table.
 * @param title A label for the source text.
 * @param code The source text to analyze.
 * @param dialect Either `"js"`, `"jsx"`, or `"ts"`.
 * @param withParse Whether parsing counts toward the measurement.
 * @returns Nothing.
 */
async function runSuite(title, code, dialect, withParse) {
	const bytes = Buffer.byteLength(code);

	console.log(`\n${title} (${(bytes / 1024).toFixed(1)} KiB)`);

	const results = [];

	for (const contender of await contenders(dialect, code, withParse)) {
		try {
			contender.run();
		} catch (error) {
			console.log(`  ${contender.name}: failed (${error.message})`);
			continue;
		}

		results.push({
			name: contender.name,
			...measure(contender.run, bytes),
		});
	}

	const fastest = Math.max(...results.map(result => result.opsPerSecond));

	for (const result of results.sort(
		(a, b) => b.opsPerSecond - a.opsPerSecond,
	)) {
		const relative = (result.opsPerSecond / fastest).toFixed(2);

		console.log(
			`  ${result.name.padEnd(44)} ` +
				`${result.opsPerSecond.toFixed(1).padStart(8)} ops/s  ` +
				`${result.megabytesPerSecond.toFixed(1).padStart(6)} MB/s  ` +
				`${relative}x`,
		);
	}
}

//-----------------------------------------------------------------------------
// Entry Point
//-----------------------------------------------------------------------------

/** Every suite the benchmark knows how to run, in the order they are shown. */
const SUITES = {
	"js-analysis": {
		title: "JavaScript, scope analysis only",
		dialect: "js",
		withParse: false,
		fixture: () => javascriptFixture(200_000),
	},
	"ts-analysis": {
		title: "TypeScript, scope analysis only",
		dialect: "ts",
		withParse: false,
		fixture: () => typescriptFixture(200_000),
	},
	"jsx-analysis": {
		title: "JSX, scope analysis only",
		dialect: "jsx",
		withParse: false,
		fixture: () => jsxFixture(200_000),
	},
	"js-full": {
		title: "JavaScript, parse and analyze",
		dialect: "js",
		withParse: true,
		fixture: () => javascriptFixture(200_000),
	},
	"ts-full": {
		title: "TypeScript, parse and analyze",
		dialect: "ts",
		withParse: true,
		fixture: () => typescriptFixture(200_000),
	},
};

const argument = process.argv[2];

if (argument && argument.startsWith("--suite=")) {
	const name = argument.slice("--suite=".length);
	const suite = SUITES[name];

	if (!suite) {
		console.error(`Unknown suite "${name}".`);
		process.exit(1);
	}

	await runSuite(
		suite.title,
		suite.fixture(),
		suite.dialect,
		suite.withParse,
	);
} else {
	for (const name of Object.keys(SUITES)) {
		const child = spawn(
			process.execPath,
			[fileURLToPath(import.meta.url), `--suite=${name}`],
			{ stdio: "inherit" },
		);

		await once(child, "exit");
	}
}
