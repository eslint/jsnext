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
 * Zero, and it must stay there: every one of these is working code the parser
 * will not read. It reached zero when `parse()` gained a `sourceType` option —
 * Annex B's HTML-like comments and `await` as an ordinary name are both things
 * only a script has, and no tree can stand for both readings, so the two
 * families that used to sit here could not be fixed downstream of the parser.
 */
export const KNOWN_OVERZEALOUS = 0;

/*
 * The families of early error that are not implemented, largest first. This is
 * the list to read before deciding what to implement next.
 *
 * Nearly all of it belongs to `validate()` rather than to `parse()`, and the
 * reason is the phase rule: `parse()` already built a tree for every one of
 * these files, so by definition the tokens *could* be shaped into one and the
 * complaint is a static-semantics rule about the tree. The exceptions are the
 * lexical family and the two grammar ones — `import(...spread)`, `a ?? b || c`
 * — where no tree should have been built at all, and those are the parser's.
 *
 * The run reports which phase catches what it does catch, so the balance is
 * visible: today it is 1,002 from `parse()` against 1,591 from `validate()`.
 *
 * Counts are approximate: a test usually violates one rule but the families
 * overlap at the edges, and the authority on the totals is
 * `262-baseline.json`. They are here to say what implementing one would be
 * worth, not to be summed.
 *
 * - **`yield` and `await` as identifiers** (~300, `validate()`). Which of the two is a
 *   keyword depends on the enclosing function, and neither may be a binding
 *   name where it is. `validate()` tracks strict mode and function depth but
 *   not generator or async context. `await` in a module is the sharp edge:
 *   `parse()` settles it wherever `await` is an operator, so what is left is
 *   the places it is not — `function f() { await.x; }` and `({ await })` in
 *   module code, where the word is reserved but is only checked when it is
 *   *bound*, never when it is merely referenced.
 * - **`import()` call shape** (~45, `parse()`). No argument, three arguments, a rest
 *   argument, `new import(x)`, an escape in the `import` keyword.
 * - **Lexical grammar** (~170, `parse()`). A numeric separator in a
 *   position that does not admit one, a legacy octal escape in a template, a
 *   keyword written with a unicode escape, a line terminator where automatic
 *   semicolon insertion does not reach.
 * - **Declaration and redeclaration** (~110, `validate()`). `let let`, a lexical
 *   declaration as the body of an `if`, a function declaration where only a
 *   statement is allowed, `const` without an initializer in a `for-in` head.
 * - **Statement placement** (~105, mostly `validate()`). `break` and `continue` with no enclosing
 *   iteration or label, a duplicate label, `return` in module code.
 * - **`for` statement heads** (~70, mostly `validate()`). `for (let x = 1 of y)`, an initializer on
 *   a `for-in` head outside sloppy Annex B, `let` as the target of a `for-of`.
 * - **`eval` and `arguments` in strict code** (~80, `validate()`). Neither may be a binding
 *   name or an assignment target under strict mode.
 * - **Expression-level grammar** (~20, `parse()`). `a ?? b || c` without parentheses,
 *   `-a ** b`, `this++`, `delete x` in strict mode, `#x in obj` outside a
 *   class body, an update expression on an optional chain.
 * - **`new.target`, `import.meta`, and `super`** (~30, `validate()`). Each is legal only
 *   inside a particular kind of body.
 */
