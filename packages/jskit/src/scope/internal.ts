/**
 * @fileoverview What other directories of this package may import from
 * `scope/` but the package itself does not export.
 *
 * `index.ts` is the public surface, and `src/index.ts` re-exports all of it
 * with `export *`, so anything named there is public whether or not it was
 * meant to be. A name another directory needs but no consumer should see
 * goes here instead, and the rule that directories reach each other only
 * through a sub-index still holds: this is the other one.
 *
 * Keep it short. Each entry is a function that only makes sense with state
 * the package does not hand out.
 */

/*
 * The ESLint parser's scope graph: `analyze()`'s buffer resolved through the
 * node table `buildAst()` fills while decoding. No public function returns
 * that table, so no consumer could call this.
 */
export { toDecodedScopeManager } from "./to-scope-manager.js";
