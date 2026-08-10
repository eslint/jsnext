/**
 * @fileoverview Compares full-AST parsing against the parsers jsparse aims to
 * replace.
 *
 * Every contender is measured doing the same job: source text in, a complete
 * ESTree-shaped AST out. For jsparse that means `parse()` followed by
 * `toAST()`, because producing only the binary buffers would not be a fair
 * comparison.
 *
 * The two `@typescript-eslint/parser` entries differ only in which TypeScript
 * version backs them. They are selected by redirecting module resolution for
 * `"typescript"` and reloading the parser, so each measurement really does run
 * against the version it names.
 *
 * One suite measures the job ESLint actually asks a parser to do, which is a
 * larger job than the others: every node, token, and comment has to carry
 * `range` and `loc` as well. Both contenders are configured to produce all of
 * it, so the comparison stays like for like.
 *
 * Each suite runs in its own child process. Loading two copies of TypeScript
 * leaves a large heap behind, and the resulting garbage collection pressure
 * lands hardest on whichever parser allocates most, which is not a property
 * of the parsers worth measuring. A fresh process per suite removes it.
 */

import { createRequire } from "node:module";
import { once } from "node:events";
import { readFileSync } from "node:fs";
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
// TypeScript Version Switching
//-----------------------------------------------------------------------------

const originalResolve = Module._resolveFilename;

/**
 * Loads a fresh copy of `@typescript-eslint/parser` bound to a specific
 * TypeScript package.
 * @param packageName The package to resolve `"typescript"` to.
 * @returns The parser's `parse` function, or `null` when the package or the
 *      parser is not installed.
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
// Contenders
//-----------------------------------------------------------------------------

/**
 * Builds the list of parsers to measure for a given dialect.
 * @param dialect One of `"js"`, `"ts"`, `"jsx"`, or `"eslint"`.
 * @returns The contenders, each with a name and a parse function.
 */
async function contenders(dialect) {
	const jsparse = await import("../dist/jsparse.js").catch(
		() => import("../src/index.ts"),
	);

	/*
	 * The ESLint suite is a two-horse race by design. `acorn` produces no
	 * tokens or comments and `@typescript-eslint/parser` is measured in the
	 * suites above, so neither would add anything here.
	 */
	if (dialect === "eslint") {
		const espree = await import("espree");

		return [
			{
				name: "jsparse (eslintParser)",
				run: code =>
					jsparse.eslintParser.parse(code, {
						sourceType: "module",
						filePath: "benchmark.js",
					}),
			},
			{
				name: "espree",
				run: code =>
					espree.parse(code, {
						ecmaVersion: "latest",
						sourceType: "module",
						comment: true,
						tokens: true,
						range: true,
						loc: true,
					}),
			},
		];
	}

	const list = [
		{
			name: "jsparse",
			run: code =>
				jsparse.toAST(jsparse.parse(code), {
					sourceType: "module",
					dialect: dialect === "jsx" ? "js" : dialect,
				}),
		},
	];

	if (dialect === "js" || dialect === "jsx") {
		const espree = await import("espree");

		list.push({
			name: "espree",
			run: code =>
				espree.parse(code, {
					ecmaVersion: "latest",
					sourceType: "module",
					comment: true,
					tokens: true,
					ecmaFeatures: { jsx: dialect === "jsx" },
				}),
		});

		// `acorn` has no JSX support of its own, so it only runs on plain JS.
		if (dialect === "js") {
			const acorn = await import("acorn");

			list.push({
				name: "acorn",
				run: code =>
					acorn.parse(code, {
						ecmaVersion: "latest",
						sourceType: "module",
					}),
			});
		}
	}

	for (const [label, packageName] of [
		["typescript 6", "typescript-6"],
		["typescript 7", "typescript-7"],
	]) {
		const loaded = loadTypeScriptEslint(packageName);

		if (loaded === null) {
			console.log(
				`  (skipping @typescript-eslint/parser + ${label}: not installed; ` +
					`add it with "npm i -D ${packageName}@npm:typescript@${label.slice(-1)}")`,
			);
			continue;
		}

		if (loaded.error !== undefined) {
			console.log(
				`  (skipping @typescript-eslint/parser + ${label}: ${loaded.error})`,
			);
			continue;
		}

		list.push({
			name: `@typescript-eslint/parser + typescript ${loaded.version}`,
			run: code =>
				loaded.parse(code, {
					sourceType: "module",
					range: true,
					loc: true,
					jsx: dialect === "jsx",
				}),
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
 * @param code The source text to parse.
 * @param dialect One of `"js"`, `"ts"`, `"jsx"`, or `"eslint"`.
 * @returns Nothing.
 */
async function runSuite(title, code, dialect) {
	const bytes = Buffer.byteLength(code);

	console.log(`\n${title} (${(bytes / 1024).toFixed(1)} KiB)`);

	const results = [];

	for (const contender of await contenders(dialect)) {
		try {
			contender.run(code);
		} catch (error) {
			console.log(`  ${contender.name}: failed (${error.message})`);
			continue;
		}

		results.push({
			name: contender.name,
			...measure(() => contender.run(code), bytes),
		});
	}

	const fastest = Math.max(...results.map(r => r.opsPerSecond));

	for (const result of results.sort(
		(a, b) => b.opsPerSecond - a.opsPerSecond,
	)) {
		const relative = (result.opsPerSecond / fastest).toFixed(2);

		console.log(
			`  ${result.name.padEnd(48)} ` +
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
	js: {
		title: "JavaScript",
		fixture: () => javascriptFixture(200_000),
	},
	ts: {
		title: "TypeScript",
		fixture: () => typescriptFixture(200_000),
	},
	jsx: {
		title: "JSX",
		fixture: () => jsxFixture(200_000),
	},
	eslint: {
		title: "JavaScript as ESLint asks for it, with range and loc",
		fixture: () => javascriptFixture(200_000),
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

const argument = process.argv[2];

if (argument && argument.startsWith("--suite=")) {
	const dialect = argument.slice("--suite=".length);
	const suite = SUITES[dialect];

	await runSuite(suite.title, suite.fixture(), dialect);
} else if (argument) {
	const code = readFileSync(argument, "utf8");

	await runSuite(argument, code, dialectOf(argument));
} else {
	for (const dialect of Object.keys(SUITES)) {
		const child = spawn(
			process.execPath,
			[fileURLToPath(import.meta.url), `--suite=${dialect}`],
			{ stdio: "inherit" },
		);

		await once(child, "exit");
	}
}
