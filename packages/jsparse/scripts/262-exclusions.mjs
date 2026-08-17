/**
 * @fileoverview What `conformance-262.mjs` does not hold the parser to, and
 * what it holds it to only loosely.
 *
 * Read this before reading a number out of that script's output. It reports
 * two kinds of failure and they are not equally bad:
 *
 * - **overzealous** — a valid program this parser rejects. This breaks working
 *   code and the standard is zero. Anything above zero is a defect, and the
 *   remaining handful are named below.
 * - **missed** — an invalid program this parser accepts. There are still
 *   thousands, because most of ECMAScript's early errors are not implemented.
 *   They are grouped into families below.
 */

/**
 * Proposals whose tests are skipped entirely, because the syntax is not
 * implemented at all and every test of it would fail for the same reason.
 *
 * A proposal is here by not being implemented, not by being unimportant.
 * Deleting an entry and running the script is how to see what implementing it
 * would take. Nothing else belongs here — a feature that *parses* and merely
 * misses an early error is a gap, not an exclusion, and stays in the count.
 *
 * `explicit-resource-management` is deliberately absent: `using` and `await
 * using` are implemented.
 */
export const UNSUPPORTED_FEATURES = new Set([
	/*
	 * `import source x from "m"` and `import.source(...)`. The declaration
	 * form is not recognized at all.
	 */
	"source-phase-imports",
	"source-phase-imports-module-source",

	/*
	 * `import defer * as ns from "m"`. The `defer` is read as an ordinary
	 * specifier, so the declaration parses into the wrong tree rather than
	 * failing outright, which is worse than not parsing.
	 */
	"import-defer",
]);

/**
 * How many valid programs are still rejected. The run fails if it climbs.
 *
 * These are not excluded — they are counted, and the baseline records which
 * directories they are in. This is the explanation of the number, and it
 * should be shrinking.
 *
 * - **Annex B HTML-like comments** (8 tests). `<!--` opens a comment to the
 *   end of the line and a `-->` that begins a line closes one, in sloppy
 *   script code. Neither is recognized. Adding them runs into the phase split:
 *   `parse()` does not know the source type, and `<!--` is only a comment in a
 *   script, so the tokenizer would have to accept it everywhere and
 *   `validate()` reject it in a module.
 * - **`import(x, await(undefined))` in a script** (1 test). `await` is a
 *   function call here, but `parse()` cannot know that without the source
 *   type, so it reads an `await` expression and `validate()` reports a
 *   top-level `await`. This is inherent to the phase split rather than a bug
 *   in either phase; the same shape is why `await + 1` differs from `espree`
 *   in a script.
 */
export const KNOWN_OVERZEALOUS = 9;

/*
 * The families of early error that are not implemented, largest first. This is
 * the list to read before deciding what to implement next.
 *
 * Counts are approximate: a test usually violates one rule but the families
 * overlap at the edges, and the authority on the totals is
 * `262-baseline.json`. They are here to say what implementing one would be
 * worth, not to be summed.
 *
 * - **Assignment and destructuring targets** (~870). `1 = 2`, `(a + b) = c`,
 *   `[...a, b] = c`, a rest element that is not last, a destructuring pattern
 *   whose target is not simple. `validate()` never asks whether the left side
 *   of an assignment can be assigned to.
 * - **Declared early errors of classes, functions, and parameters** (~870).
 *   Duplicate parameter names where they are banned, a non-simple parameter
 *   list under a `"use strict"` directive, a trailing comma after a rest
 *   parameter, a getter with a parameter, a setter without one, `constructor`
 *   used as a generator or field name, a private name never declared.
 * - **Regular expression pattern grammar** (~360). The pattern between the
 *   slashes is not parsed at all, so nothing in it is ever an error: an
 *   unmatched `)`, a duplicate group name, an invalid property escape, a `v`
 *   flag set operation that is not well formed. This is the one family that
 *   needs a new parser rather than a new check.
 * - **`yield` and `await` as identifiers** (~340). Which of the two is a
 *   keyword depends on the enclosing function, and neither may be a binding
 *   name where it is. `validate()` tracks strict mode and function depth but
 *   not generator or async context.
 * - **`import()` call shape** (~280). No argument, three arguments, a rest
 *   argument, `new import(x)`, an escape in the `import` keyword.
 * - **Literals, escapes, and identifiers** (~170). A numeric separator in a
 *   position that does not admit one, a legacy octal escape in a template, a
 *   keyword written with a unicode escape, a line terminator where automatic
 *   semicolon insertion does not reach.
 * - **Declaration and redeclaration** (~110). `let let`, a lexical
 *   declaration as the body of an `if`, a function declaration where only a
 *   statement is allowed, `const` without an initializer in a `for-in` head.
 * - **Statement placement** (~100). `break` and `continue` with no enclosing
 *   iteration or label, a duplicate label, `return` in module code.
 * - **`for` statement heads** (~70). `for (let x = 1 of y)`, an initializer on
 *   a `for-in` head outside sloppy Annex B, `let` as the target of a `for-of`.
 * - **`eval` and `arguments` in strict code** (~65). Neither may be a binding
 *   name or an assignment target under strict mode.
 * - **Expression-level shapes** (~65). `a ?? b || c` without parentheses,
 *   `-a ** b`, `this++`, `delete x` in strict mode, `#x in obj` outside a
 *   class body, an update expression on an optional chain.
 * - **`new.target`, `import.meta`, and `super`** (~16). Each is legal only
 *   inside a particular kind of body.
 */
