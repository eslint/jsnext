/**
 * @fileoverview What other directories of this package may import from
 * `parse/` but the package itself does not export.
 *
 * `index.ts` is the public surface, and `src/index.ts` re-exports all of it
 * with `export *`, so anything named there is public whether or not it was
 * meant to be. A name another directory needs but no consumer should see
 * goes here instead, and the rule that directories reach each other only
 * through a sub-index still holds: this is the other one.
 */

/*
 * The node table `toAST()` records against every tree it decodes. `scope/`
 * reads it to resolve a scope buffer `analyze()` wrote to the tree's own
 * objects; a consumer reaches the same thing by passing the `Program` to
 * `toScopeManager()`, `Scopes`, or `toScopeTree()`.
 */
export { decodedNodes, type DecodedNodes } from "./to-ast.js";
