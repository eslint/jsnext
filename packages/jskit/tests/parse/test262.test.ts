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
import { parse, validate } from "../../src/index.js";

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
		result = parse(code, { sourceType });
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

	// `await` is an ordinary name in a script, so anything may follow it.
	["var await = 1; await instanceof Object;", "script"],
	["await = 1;", "script"],
	["await.x;", "script"],
	["await(x);", "script"],
	["await[0];", "script"],
	["await`t`;", "script"],
	["await ? a : b;", "script"],
	["x = await => await;", "script"],
	["import('m', await(x));", "script"],

	// Annex B's HTML-like comments, which a script has and a module does not.
	["<!-- opens a comment\nvar a;", "script"],
	["var a;\n--> closes one\nvar b;", "script"],
	["a <!--b\nc;", "script"],
	["-->", "script"],

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

	/*
	 * Sloppy code lets a plain function repeat a *simple* parameter, and a
	 * generator or an async function is still a plain function for this. Only
	 * a method, an arrow, strict code, or a non-simple list bans it — so these
	 * are the shapes one character away from the errors above.
	 */
	["function f(a, a) {}", "script"],
	["function* g(a, a) {}", "script"],
	["async function h(a, a) {}", "script"],
	["({ m: function (a, a) {} });", "script"],
	["({ m(a) { function g(b, b) {} } });", "script"],
	["function f(a) { 'use strict'; }", "script"],
	["function f(a, b,) {}", "script"],
	["f(...a,);", "script"],
	["({ get x() {} });", "script"],
	["({ set x(a) {} });", "script"],
	["class C { set x([a, b]) {} }", "script"],

	/*
	 * A private name resolves against every enclosing class, and against its
	 * own class wherever in the body it is written — a method may use a field
	 * declared after it.
	 */
	["class C { #x; m() { return this.#x; } }", "script"],
	["class C { m() { return this.#x; } #x; }", "script"],
	["class C { m(o) { return #x in o; } #x; }", "script"],
	["class C { #x; static { C.#x; } }", "script"],
	["class D { #a; m() { class E { n(o) { return o.#a; } } } }", "script"],
	["class C extends (class { #y; }) { #x; m() { return this.#x; } }", "script"],

	// One getter/setter pair may share a name, on either side of `static`.
	["class C { get #x(){} set #x(v){} }", "script"],
	["class C { static get #x(){} static set #x(v){} }", "script"],

	/*
	 * A name written with escapes is the name it spells, so this declares and
	 * uses `#℘` twice over rather than two different fields.
	 */
	["class C { #\\u2118; m() { return this.#℘; } }", "script"],

	/*
	 * Valid assignment targets, including the shapes closest to the invalid
	 * ones: a rest element that *is* last, a default that is not on a rest
	 * element, and a member expression anywhere a name may go.
	 */
	["[a, b] = c;", "script"],
	["[a = 1, ...b] = c;", "script"],
	["[...a.b] = c;", "script"],
	["({ a, b: c.d, ...e } = f);", "script"],
	["({ a: { b: [c] } } = d);", "script"],
	["[, , a] = b;", "script"],
	["for ([a, b] of c);", "script"],
	["for (a.b in c);", "script"],
	["(a) = b;", "script"],
	["a.b++;", "script"],

	/*
	 * A call as an assignment target is a runtime error in sloppy code, not an
	 * early one — the spec keeps it legal for web compatibility, and only
	 * strict code makes it a `SyntaxError`.
	 */
	["f() = 1;", "script"],
	["f()++;", "script"],
	["for (f() of x);", "script"],

	// A bare `yield` whose next token can only continue an expression.
	["function* g() { s = `1${yield}3${4}5`; }", "script"],

	// A numeric separator between two digits, in every literal that takes one.
	["1_0 + 0x1_2 + 0b1_1 + 0o1_7 + 1_0.2_5e1_0 + 1_0n;", "script"],

	/*
	 * A reserved word may not be spelled with an escape, but `yield` and
	 * `await` are carved out of that rule — they are reserved by where they
	 * appear rather than outright, so an escaped one is still just a name
	 * where a plain one would be. Nor are the contextual words reserved at
	 * all, and an `IdentifierName` may be any word however it is written.
	 */
	["var \\u0079ield = 1;", "script"],
	["var \\u0061wait = 1;", "script"],
	["var \\u006cet = 1;", "script"],
	["var \\u0073tatic = 1;", "script"],
	["var \\u0061sync = 1;", "script"],
	["var \\u006ff = 1;", "script"],
	["o.\\u0073uper;", "script"],
	["({ \\u0073uper: 1 });", "script"],
	["({ \\u0063lass() {} });", "script"],
	["class C { \\u0073uper() {} }", "script"],
	["let { \\u0073uper: x } = o;", "script"],
	["import { \\u0073uper as x } from \"m\";", "module"],
	["var x; export { x as \\u0073uper };", "module"],

	/*
	 * `super.x` needs a home object, which every method has — an accessor, a
	 * generator, an async method, an object literal method — and so does a
	 * field initializer and a static block. `super()` needs a constructor to
	 * be in, and a heritage clause to call.
	 */
	["class C extends D { constructor() { super(); } }", "script"],
	["class C extends D { constructor() { { super(); } } }", "script"],
	["class C extends D { m() { super.x; } }", "script"],
	["class C { m() { super.x; } }", "script"],
	["class C { m() { super[x]; } }", "script"],
	["class C { m(a = super.x) {} }", "script"],
	["class C { x = super.y; }", "script"],
	["class C { static x = super.y; }", "script"],
	["class C { static { super.x; } }", "script"],
	["({ m() { super.x; } });", "script"],
	["({ get x() { super.y; } });", "script"],

	/*
	 * An arrow has no home object of its own, so it borrows the one around it
	 * — which is the whole reason `() => super()` works in a constructor.
	 */
	["class C extends D { constructor() { () => super(); } }", "script"],
	["class C { m() { () => super.x; } }", "script"],

	// A method nested inside a method brings its own, in either direction.
	["({ m() { class D { n() { super.x; } } } });", "script"],
	["class C { m() { ({ n() { super.x; } }); } }", "script"],

	/*
	 * `yield` and `await` are reserved by *position*, so sloppy code outside a
	 * generator or an async function may still use either as a name. Each of
	 * these is one word away from an error in the fixture file.
	 */
	["var yield; yield: ;", "script"],
	["var await;", "script"],
	["function g() { var yield; }", "script"],

	/*
	 * A plain function resets both, and so does the *body* of an arrow —
	 * though not its parameters, which are read in the enclosing context.
	 */
	["function* g() { function h() { var yield; } }", "script"],
	["function* g() { function h(yield) {} }", "script"],
	["function* g() { function f(x = yield) {} }", "script"],
	["function* g() { var h = () => { var yield; }; }", "script"],
	["async function f() { function h() { var await; } }", "script"],
	["async function f() { var g = () => { var await; }; }", "script"],
	["class C { static { function f() { var await; } } }", "script"],

	// A default may hold a suspension that belongs to a function of its own.
	["function f(x = async () => await 1) {}", "script"],

	/*
	 * A declaration's own name is read outside the function, so it is not yet
	 * in the generator when it is read. An expression's name is read inside.
	 */
	["function* yield() {}", "script"],
	["async function await() {}", "script"],

	/*
	 * Neither word is ever reserved as an `IdentifierName`, which is what a
	 * property name and a member access both are, in any context at all.
	 */
	["function* g() { o.yield; ({ yield: 1 }); }", "script"],
	["async function f() { o.await; ({ await: 1 }); ({ await() {} }); }", "script"],
	["o.await; o.yield;", "module"],
	["({ await: 1, yield: 2 });", "module"],
	["class C { await() {} yield() {} }", "module"],
	["import { await as x } from 'm';", "module"],

	/*
	 * What Annex B keeps legal in a pattern without `u`: a brace that opens no
	 * quantifier, an unmatched `]`, a digit escape past the group count, and a
	 * range whose end is a character class. Each is an error the moment the
	 * flag is added, so these are the shapes one character away from the
	 * errors in the fixture file.
	 */
	["/a{/;", "script"],
	["/]/;", "script"],
	["/\\8/;", "script"],
	["/[\\d-a]/;", "script"],
	["/\\c1/;", "script"],

	/*
	 * With no group name anywhere, `\k` is the letter `k` — one named group
	 * elsewhere in the same pattern is what turns it into a reference.
	 */
	["/\\k<n>/;", "script"],
	["/(?<n>a)\\k<n>/;", "script"],

	// A reference may name a group that appears later, or a different branch.
	["/\\1(a)/;", "script"],
	["/(?<n>a)|(?<n>b)/;", "script"],

	// The pieces of the pattern grammar that needed tables or a second reading.
	["/\\p{Script=Greek}/u;", "script"],
	["/\\p{RGI_Emoji}/v;", "script"],
	["/[[a]--[b]]/v;", "script"],
	["/[\\q{a|bc}]/v;", "script"],
	["/(?i-m:a)/;", "script"],

	/*
	 * Neither `eval` nor `arguments` is a reserved word. Sloppy code binds
	 * both freely, and the strictest code there is still reads both: what
	 * strict mode bans is putting a value into one.
	 */
	["var eval;", "script"],
	["eval = 1;", "script"],
	["function eval() {}", "script"],
	["function f(arguments) {}", "script"],
	["'use strict'; eval(1);", "script"],
	["'use strict'; arguments[0];", "script"],
	["'use strict'; ({ eval: 1 });", "script"],
	["'use strict'; o.eval = 1;", "script"],
	["'use strict'; eval: 1;", "script"],
	["var x; export { x as eval };", "module"],
	["var x; export { x as arguments };", "module"],

	/*
	 * A class field initializer bans `arguments` only as far as the next
	 * function that has one of its own, which is every kind but an arrow.
	 */
	["class C { m() { return arguments; } }", "script"],
	["class C { m(a = arguments) {} }", "script"],
	["class C { [arguments] = 1; }", "script"],
	["class C { x = function () { return arguments; }; }", "script"],
	["class C { x = { m() { return arguments; } }; }", "script"],
	["class C { x = { arguments: 1 }; }", "script"],
	["class C { x = o.arguments; }", "script"],
	["class C { x = () => { function g() { return arguments; } }; }", "script"],
	["class C { static { function f() { return arguments; } } }", "script"],

	/*
	 * A rest element must be last, and the shapes one character away from
	 * that are all ordinary. A trailing comma is fine after anything else,
	 * an elision may come *before* a rest, and an array literal keeps taking
	 * both — `[...a,]` is only a mistake once it is read as a pattern.
	 */
	["var [...a] = x;", "script"],
	["var [a, ...b] = x;", "script"],
	["var [, ...a] = x;", "script"],
	["var [...[a]] = x;", "script"],
	["var [...{a}] = x;", "script"],
	["var {...a} = x;", "script"],
	["var {a, ...b} = x;", "script"],
	["var [a,] = x;", "script"],
	["var {a,} = x;", "script"],
	["function f([a, ...b]) {}", "script"],
	["function f([...a] = []) {}", "script"],
	["var x = [...a,];", "script"],
	["var y = {...a,};", "script"],
	["f(...a,);", "script"],

	// An assignment pattern's rest may target a member access; a binding's may not.
	["({...a.b} = x);", "script"],
	["[...a.b] = x;", "script"],

	/*
	 * Annex B lets a plain function declaration be the body of an `if` or of
	 * a label in sloppy code, and `var` is the one declaration that is also a
	 * statement anywhere.
	 */
	["if (0) function f() {}", "script"],
	["if (0) {} else function f() {}", "script"],
	["if (0) function f() {} else function g() {}", "script"],
	["l: function f() {}", "script"],
	["l: m: function f() {}", "script"],
	["switch (0) { case 1: function f() {} }", "script"],
	["switch (0) { case 1: let x = 1; }", "script"],
	["if (0) var x = 1;", "script"],
	["l: var x = 1;", "script"],

	/*
	 * A single-statement position takes no declaration, so `let` written
	 * there is an ordinary identifier and a newline after it ends the
	 * statement. `let [` is the exception, being the one spelling an
	 * expression statement may not begin with.
	 */
	["if (false) let // ASI\n{}", "script"],
	["if (0) let\nx = 1;", "script"],
	["L: let\nx = 1;", "script"],
	["for (;;) let\nx = 1;", "script"],
	["while (0) let\nx = 1;", "script"],

	/*
	 * `constructor` and `prototype` are spoken for only where the class can
	 * see the name, so a computed key escapes both rules, a static method may
	 * be called `constructor`, and a private `#prototype` is a different name
	 * altogether.
	 */
	["class C { static ['prototype']() {} }", "script"],
	["class C { prototype() {} }", "script"],
	["class C { prototype; }", "script"],
	["class C { static #prototype; }", "script"],
	["class C { static constructor() {} }", "script"],
	["class C { static *constructor() {} }", "script"],
	["class C { static get constructor() {} }", "script"],
	["class C { ['constructor']() {} }", "script"],
	["class C { *['constructor']() {} }", "script"],
	["class C { ['constructor'] = 1; }", "script"],
	["class C { constructor() {} static constructor() {} }", "script"],
	["class C { constructor() {} ['constructor']() {} }", "script"],
	["class C { constructor() { class D { constructor() {} } } }", "script"],

	/*
	 * `new` takes a `MemberExpression`. Parentheses give the import call back
	 * its own expression, and `import.meta` is a member access to begin with.
	 */
	["new (import(''));", "module"],
	["new import.meta.Foo();", "module"],
	["import('');", "module"],

	/*
	 * Annex B keeps the `for-in` head the web already had, and the three ways
	 * out of the `async` lookahead are all lexical: parentheses, an escape,
	 * and the `for await` production the restriction was never put on.
	 */
	["for (var a = 0 in {});", "script"],
	["for ((async) of []);", "script"],
	["for (async in {});", "script"],
	["for (async.x of []);", "script"],
	["for (\\u0061sync of [7]);", "script"],
	["async function f() { for await (async of [7]); }", "script"],
	["for (var a = 0, b = 1; ;);", "script"],
	["for (let x = 1, y = 2; ;);", "script"],

	// `let` is only banned as the name a *lexical* declaration binds.
	["var let = 1;", "script"],
	["for (var let in {});", "script"],
	["function let() {}", "script"],
	["function f(let) {}", "script"],
	["try {} catch (let) {}", "script"],
	["label: let;", "script"],
	["let = 1;", "script"],

	/*
	 * A `break` needs a loop or a `switch`, a `continue` needs a loop, and a
	 * label chain is all on whatever the chain ends at.
	 */
	["while (0) break;", "script"],
	["while (0) continue;", "script"],
	["switch (0) { case 1: break; }", "script"],
	["L: while (0) break L;", "script"],
	["L: while (0) continue L;", "script"],
	["L: { break L; }", "script"],
	["a: b: while (0) continue a;", "script"],
	["a: while(0); a: while(0);", "script"],
	["L: while (0) { M: while (0) { continue L; break M; } }", "script"],
	["L: switch (0) { default: break L; }", "script"],
	["for (;;) { switch (0) { default: continue; } }", "script"],
	["class C { static { L: while (0) break L; } }", "script"],

	/*
	 * Annex B forgives a plain function declaration written twice in one
	 * sloppy block, and forgives nothing else about it.
	 */
	["{ function f() {} function f() {} }", "script"],
	["switch (0) { case 1: function f() {} default: function f() {} }", "script"],
	["function g() { function* f() {} function* f() {} }", "script"],
	["{ function* f() {} } { function* f() {} }", "script"],

	/*
	 * A tag receives the raw text along with the cooked value, so an escape
	 * that has no cooked value is only a problem without one.
	 */
	['tag`\\u1`;', "script"],
	['tag`\\01`;', "script"],
	['tag`a${1}\\xZ`;', "script"],
	['tag`a`.b`\\u1`;', "script"],
	['"\\u{0000000041}";', "script"],
	['"\\u{10FFFF}";', "script"],

	// An escape may still name any character the identifier could have held.
	["var \\u0061;", "script"],
	["var \\u{0000000061};", "script"],
	["var a\\u200D;", "script"],
	["var a\\u200C;", "script"],
	["class C { #\\u0061; }", "script"],

	// A `using` takes every place that closes a scope, and no other.
	["{ using a = 1; }", "script"],
	["for (using a of []) ;", "script"],
	["for (using a = 1;;) ;", "script"],
	["function f() { using a = 1; }", "script"],
	["class C { static { using a = 1; } }", "script"],
	["using a = 1;", "module"],

	// The three positions a private name may take.
	["class C { #x = 1; static #y() {} get #z() {} }", "script"],
	["class C { #x; m() { return this.#x; } }", "script"],
	["class C { #x; m() { return #x in this; } }", "script"],
	["class C { #x; m() { return this?.#x; } }", "script"],

	// The parenthesis is the whole of the difference.
	["({} = 1);", "script"],
	["[] = 1;", "script"],
	["({a: {b}} = x);", "script"],
	["(a) = 1;", "script"],
	["a.b &&= 1;", "script"],

	// Only the spelling that sets the prototype counts as setting it.
	["({__proto__: 1});", "script"],
	["({__proto__: 1, ['__proto__']: 2});", "script"],
	["({__proto__() {}, __proto__: 1});", "script"],
	["({__proto__, __proto__: 1});", "script"],
	["({a = 1} = x);", "script"],

	// Every name a module exports, exported once.
	["var x; export { x }; export default 1;", "module"],
	["export * from 'm'; export * from 'n';", "module"],
	["export const q = 1; export { q as w };", "module"],
	["{ var v; } export { v };", "module"],
	["export { '\ud83c\udf19' } from 'm';", "module"],
	["import x from 'm' with { a: '1', b: '2' };", "module"],

	// A prologue ends at the first statement that is not a directive.
	['function f() { 01; "use strict"; }', "script"],
	['"\\1";', "script"],
	['"\\8";', "script"],
	['"\\0";', "script"],
	['"use strict"; "\\0";', "script"],

	// A separator may sit anywhere but against a leading zero.
	["1_0;", "script"],
	["0x1_0;", "script"],
	["0b1_0;", "script"],
	["0o1_0;", "script"],
	["0.1_1;", "script"],
	["1_0e1_0;", "script"],

	// Parentheses settle both of the readings the grammar refuses to guess.
	["(-a) ** b;", "script"],
	["a ** -b;", "script"],
	["a-- ** b;", "script"],
	["a ** b ** c;", "script"],
	["(a ?? b) || c;", "script"],
	["a ?? (b || c);", "script"],
	["a ?? b ?? c;", "script"],
	["a && b || c;", "script"],

	// Every body `new.target` has one of, and the boundary a static block is.
	["function f() { new.target; }", "script"],
	["class C { m() { new.target; } }", "script"],
	["function f() { () => new.target; }", "script"],
	["class C { static { new.target; } }", "script"],
	["class C { p = new.target; }", "script"],
	["import.meta;", "module"],
	["class C { static { async function g() { await 0; } } }", "script"],
	["class C { static { () => { return 1; } } }", "script"],

	// A line terminator only matters where the grammar says it does.
	["function* g() { yield\n1; }", "script"],
	["({ get\nx() {} });", "script"],
	["({ set\nx(v) {} });", "script"],
	["({ *\ng() {} });", "script"],
	["class C { async\nx() {} }", "script"],

	// A tag the chain is applied to, rather than the other way round.
	["f`h`?.a;", "script"],
	["`h`?.[0];", "script"],
	["(a?.fn)`h`;", "script"],
	["(a?.b)`h`.c;", "script"],
	["delete x;", "script"],
	["delete x.y;", "module"],
	["class C extends (async () => {}) {}", "script"],
	["class C extends Mix(A, B) {}", "script"],
	["switch (q) { case 1: ; default: ; case 2: ; }", "script"],
	["var that = 1, t = 2;", "script"],
];

describe("test262 positive tests", () => {
	for (const [code, sourceType] of valid) {
		it(`accepts ${JSON.stringify(code)} as a ${sourceType}`, () => {
			expect(rejection(code, sourceType)).toBeNull();
		});
	}
});
