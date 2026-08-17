/**
 * @fileoverview Programs distilled from test262 that must be rejected, and
 * programs from it that must not be.
 *
 * `npm test` has no other coverage of the *rejecting* half of the parser:
 * every other corpus here is real code, which by construction contains no
 * syntax errors, and the differential suites can only compare two trees for a
 * program both implementations accept. These cases come from test262's
 * negative tests — the ones whose frontmatter says `phase: parse` — reduced to
 * a line each.
 *
 * Rejection is asserted, not *how* it is rejected. `parse()` throwing and
 * `validate()` reporting are opposite sides of the phase split, and which side
 * a given error falls on is a decision the split makes, not a contract this
 * file should pin. See
 * [AGENTS.md](../../../AGENTS.md#the-rule-that-decides-where-code-goes).
 *
 * The full suite is far larger than this and lives behind
 * `scripts/conformance-262.mjs`, which needs a test262 checkout. What is here
 * is what runs without one.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, validate } from "../src/index.js";

/** One negative test, reduced to its program and the mode it is read in. */
interface InvalidSample {
	/** The program that must be rejected. */
	code: string;

	/** How the program is meant to be interpreted. */
	sourceType: "script" | "module";
}

const invalid: InvalidSample[] = JSON.parse(
	readFileSync(
		new URL("./fixtures/invalid-javascript.json", import.meta.url),
		"utf8",
	),
);

/**
 * Reports whether a program is rejected by either phase.
 * @param code The program to check.
 * @param sourceType How the program should be interpreted.
 * @returns The complaint, or `null` when the program was accepted.
 */
function rejection(
	code: string,
	sourceType: "script" | "module",
): string | null {
	let result;

	try {
		result = parse(code);
	} catch (error) {
		return `parse: ${(error as Error).message}`;
	}

	const problems = validate(result, { sourceType, dialect: "js" });

	return problems.length === 0 ? null : `validate: ${problems[0].message}`;
}

describe("test262 negative tests", () => {
	for (const { code, sourceType } of invalid) {
		it(`rejects ${JSON.stringify(code)} as a ${sourceType}`, () => {
			expect(rejection(code, sourceType)).not.toBeNull();
		});
	}
});

/*
 * The other half. Each of these was rejected at some point by a defect this
 * corpus found, and each is valid, so a regression here is the worse kind:
 * working code that stops parsing. They are separate from
 * `fixtures/javascript.json` because that file is checked against `espree` as
 * a module, and every case below needs either script mode or syntax `espree`
 * does not have.
 */
const valid: [string, "script" | "module"][] = [
	// A `using` declaration opening a block written on its own line.
	["{\n\tusing x = null;\n}", "script"],
	["{\n\tawait using x = null;\n}", "module"],

	// `using` as an ordinary identifier, which a line break makes it.
	["using\nx = y;", "script"],
	["using[x] = y;", "script"],

	// `await` is a binding name in a script, so it takes any operator after it.
	["var await = 1; await instanceof Object;", "script"],
	["await = 1;", "script"],
	["await.x;", "script"],
	["await ? a : b;", "script"],
	["x = await => await;", "script"],

	// A `/` after a class or function declaration opens a regular expression.
	["class A {} /re/.test(s);", "script"],
	["function f() {} /re/.test(s);", "script"],

	// A `/` after a function *expression* divides.
	["isNaN(function () { return 1; } / {});", "script"],
	["x = function () {} / 2;", "script"],

	/*
	 * A `for` head takes `in` away from its own operators only. Every
	 * bracketing construct inside it gives it back.
	 */
	["for (const [a = b in c] of d) {}", "script"],
	["for (const { a = b in c } of d) {}", "script"],
	["for (a[b in c] of d) {}", "script"],
	["for (f(a in b); false; ) {}", "script"],
	["for (`${a in b}`; false; ) {}", "script"],
	["for ({ [a in b]: c } = d; false; ) {}", "script"],
	["for (p = import('m', 'a' in {}); false; ) {}", "script"],

	// An identifier may start or continue above the basic multilingual plane.
	["var \u{1030f} = 1;", "script"],
	["var \u{1d453} = 1;", "script"],
	["class C { #\u{1d453}; }", "script"],

	// A bare `yield` whose next token can only continue an expression.
	["function* g() { s = `1${yield}3${4}5`; }", "script"],

	// A numeric separator between two digits, in every literal that takes one.
	["1_0 + 0x1_2 + 0b1_1 + 0o1_7 + 1_0.2_5e1_0 + 1_0n;", "script"],
];

describe("test262 positive tests", () => {
	for (const [code, sourceType] of valid) {
		it(`accepts ${JSON.stringify(code)} as a ${sourceType}`, () => {
			expect(rejection(code, sourceType)).toBeNull();
		});
	}
});
