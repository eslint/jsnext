/**
 * @fileoverview Runs the tests an area's change can affect, and nothing else.
 *
 * The three analyses stack: `scope/` reads what `parse/` produced and `flow/`
 * reads what both produced. So the set of tests a change can break is not the
 * area's own tests — it is that area's tests plus every area downstream of it.
 * A change to `parse/` can break all three; a change to `flow/` can break only
 * `flow/`, because nothing reads what it writes.
 *
 * That is the whole content of `DOWNSTREAM` below, and it is the reason this
 * lives in a script rather than in the CI workflow: the cascade is a fact
 * about the source layout, and it belongs next to the source.
 *
 * Usage:
 *
 *     node scripts/test-affected.mjs parse            # everything
 *     node scripts/test-affected.mjs scope            # scope + flow
 *     node scripts/test-affected.mjs flow --coverage  # flow, with its gate
 *     node scripts/test-affected.mjs all --coverage   # the full suite
 *
 * Several areas may be named at once; the union of their cascades is run.
 *
 * With `--coverage`, the gate in `vitest.config.ts` is applied to the areas
 * being run rather than to all of `src/`, since a partial run cannot be held
 * to a number the full suite earns. Every area clears the same 95% on its own,
 * so restricting the measurement narrows what is checked without lowering the
 * bar. Any argument after `--` is passed through to `vitest`.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

//-----------------------------------------------------------------------------
// The cascade
//-----------------------------------------------------------------------------

/**
 * Every area whose tests a change to the key can break, the key included.
 * Listed in dependency order so that the run reads the same way the stack
 * does.
 * @type {Record<string, string[]>}
 */
const DOWNSTREAM = {
	parse: ["parse", "scope", "flow"],
	scope: ["scope", "flow"],
	flow: ["flow"],
};

const AREAS = Object.keys(DOWNSTREAM);

//-----------------------------------------------------------------------------
// Arguments
//-----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const passThroughAt = argv.indexOf("--");
const passThrough = passThroughAt === -1 ? [] : argv.slice(passThroughAt + 1);
const ours = passThroughAt === -1 ? argv : argv.slice(0, passThroughAt);

const coverage = ours.includes("--coverage");
const requested = ours.filter(arg => !arg.startsWith("-"));

if (requested.length === 0) {
	console.error(
		`Usage: node scripts/test-affected.mjs <${AREAS.join("|")}|all> [--coverage] [-- <vitest args>]`,
	);
	process.exit(1);
}

const unknown = requested.filter(
	area => area !== "all" && !(area in DOWNSTREAM),
);

if (unknown.length > 0) {
	console.error(
		`Unknown area(s): ${unknown.join(", ")}. Expected one of: ${AREAS.join(", ")}, all.`,
	);
	process.exit(1);
}

/*
 * `all` is spelled out rather than treated as "no filter" so that the run is
 * described the same way whichever route reached it, and so the coverage
 * include list below stays a plain function of the areas.
 */
const affected = AREAS.filter(area =>
	requested.some(
		request => request === "all" || DOWNSTREAM[request].includes(area),
	),
);

//-----------------------------------------------------------------------------
// The run
//-----------------------------------------------------------------------------

/*
 * Unit tests sit in `src/<area>/` and integration tests in `tests/<area>/`;
 * vitest takes these as filename filters and intersects them with the
 * `include` globs from the config, so no test outside those two shapes can be
 * picked up by mistake.
 */
const filters = affected.flatMap(area => [`src/${area}/`, `tests/${area}/`]);

const coverageArgs = coverage
	? [
			"--coverage",
			...affected.map(area => `--coverage.include=src/${area}/**/*.ts`),
		]
	: [];

const full = affected.length === AREAS.length;

console.log(
	`Running ${full ? "the full suite" : `${affected.join(" + ")} tests`}` +
		` (requested: ${requested.join(", ")})${coverage ? " with coverage" : ""}`,
);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * npm hoists `vitest` to the repository root, so its entry point is not at a
 * path this package can spell. Resolving it through the package's own `bin`
 * field finds it wherever the install put it, and survives the file being
 * renamed.
 */
const require = createRequire(import.meta.url);
const vitestManifest = require.resolve("vitest/package.json");
const vitestBin = resolve(
	dirname(vitestManifest),
	require(vitestManifest).bin.vitest,
);

const result = spawnSync(
	process.execPath,
	[vitestBin, "run", ...filters, ...coverageArgs, ...passThrough],
	{ cwd: packageRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
