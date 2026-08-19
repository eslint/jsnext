/**
 * @fileoverview What `conformance-262.mjs` does not hold the parser to, and
 * what it holds it to only loosely.
 *
 * Read this before reading a number out of that script's output. It reports
 * two kinds of failure and they are not equally bad:
 *
 * - **overzealous** — a valid program this parser rejects. This breaks working
 *   code and the standard is zero.
 * - **missed** — an invalid program this parser accepts. This is zero as well,
 *   as of the last of the early-error families landing; `262-baseline.json` is
 *   an empty object because there is no directory left with a failure in it.
 *
 * Both being zero is what makes this file short. What remains in it is the two
 * proposals whose tests are skipped outright, because the syntax is not
 * implemented at all.
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
 * There is no list of unimplemented early errors here any more, because there
 * are none: every invalid program in the corpus is now rejected by one phase
 * or the other. The run reports which phase does it, and the balance is worth
 * knowing before adding a rule — today 1,317 come from `parse()` against 3,093
 * from `validate()`.
 *
 * That split is the phase rule at work rather than an accident. `parse()`
 * rejects what cannot be tokenized or shaped into a tree: a malformed escape,
 * a numeric separator against a leading zero, `-a ** b`, a line terminator
 * where the grammar forbids one. Everything else is a static-semantics rule
 * about a tree that was built successfully, and belongs to `validate()`.
 *
 * A new rule goes on whichever side of that line it falls, and
 * `262-baseline.json` is the guard: it is an empty object, so any directory
 * that starts failing is a directory that was passing.
 */
