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
 * visible: today it is 1,236 from `parse()` against 2,990 from `validate()`.
 *
 * Counts are approximate: a test usually violates one rule but the families
 * overlap at the edges, and the authority on the totals is
 * `262-baseline.json`. They are here to say what implementing one would be
 * worth, not to be summed.
 *
 * - **Lexical grammar** (~36, `parse()`). A numeric separator in a position that
 *   does not admit one, an escape standing in for the `#` of a private name,
 *   the `!` of a hashbang, or the `.` of `new.target`, and a character the
 *   grammar does not treat as whitespace written where whitespace is needed.
 * - **Legacy octal escapes** (~12, `validate()`). `"\1"` and `"\8"` in code
 *   that is strict — including a directive prologue whose own `"use strict"`
 *   comes after them.
 * - **Private names outside a class** (~43, mixed). A `#x` read in an object
 *   literal's method, a private field read out of a destructuring pattern,
 *   `#x in obj` where no class body encloses it.
 * - **Expression-level grammar** (~37, mixed). `a ?? b || c` without
 *   parentheses, `-a ** b`, `delete x` in strict mode, an update expression
 *   on an optional chain, and assignment to something that cannot be
 *   assigned to — `this`, `true`, an arrow function, a parenthesized object
 *   literal.
 * - **`using` declarations** (~22, mixed). Where one may stand and what it may
 *   bind: not a destructuring pattern, not a `for-in` head, not a `switch`
 *   case, not the top level of a script.
 * - **Module code** (~17, `validate()`). A name exported twice over, an export
 *   that names nothing the module declares, and a module specifier holding an
 *   unpaired surrogate.
 * - **ASI restrictions** (~11, `parse()`). A line terminator where the grammar
 *   forbids one: between `yield` and its `*`, between `async` and the `(` of
 *   a method's parameters, before the `=>` of an arrow function.
 * - **`new.target`, `import.meta`, and static blocks** (~6, `validate()`). Each
 *   is legal only inside a particular kind of body, and a class static block
 *   is the body that admits the fewest of them.
 */
