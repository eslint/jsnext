/**
 * @fileoverview Renders the coverage run's JSON summary as a Markdown table
 * for the GitHub Actions job summary.
 *
 * The `json-summary` reporter is already configured in `vitest.config.ts`, so
 * this reads what the run wrote rather than measuring anything itself. It is
 * called with `if: always()` so that a run failing its gate still explains
 * which metric fell short, which means a missing file is an ordinary outcome
 * here and not an error.
 */

import { readFileSync } from "node:fs";

const SUMMARY_PATH = "packages/jskit/coverage/coverage-summary.json";

/**
 * The gate in `vitest.config.ts`. Duplicated rather than imported because that
 * file is TypeScript and this script runs under bare `node`; the pass/fail
 * decision is vitest's either way, so a drift here mislabels a row and nothing
 * more.
 * @type {number}
 */
const THRESHOLD = 95;

let summary;

try {
	summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
} catch {
	console.log("### Coverage\n");
	console.log(
		`No coverage summary was written to \`${SUMMARY_PATH}\`. The run most likely failed before the reporter ran.`,
	);
	process.exit(0);
}

const total = summary.total;

console.log("### Coverage\n");
console.log("| Metric | Covered | Total | Percent | Threshold |");
console.log("| ------ | ------: | ----: | ------: | --------: |");

for (const metric of ["statements", "branches", "functions", "lines"]) {
	const { covered, total: count, pct } = total[metric];
	const mark = pct >= THRESHOLD ? "✅" : "❌";
	const name = metric[0].toUpperCase() + metric.slice(1);

	console.log(
		`| ${name} | ${covered} | ${count} | ${mark} ${pct}% | ${THRESHOLD}% |`,
	);
}

console.log(
	"\nOnly the analyses this change can affect are measured; see `packages/jskit/scripts/test-affected.mjs`.",
);
