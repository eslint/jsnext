/**
 * @fileoverview The package's public surface: one entry point onto three
 * analyses that share a representation.
 *
 * Nothing is defined here. Each analysis has its own directory and its own
 * index deciding what that half exports, and this file only puts the three
 * together:
 *
 * - `parse/` turns source text into two binary buffers, then reports what is
 *   merely not allowed here (`validate()`) or decodes an ESTree tree
 *   (`toAST()`) on request.
 * - `scope/` reads a program — either those buffers or an ordinary ESTree
 *   tree — and returns the scope graph as a third binary buffer.
 * - `flow/` reads the parse and scope buffers together and returns the
 *   control flow graph as a fourth.
 *
 * They are exported flat rather than under namespaces because they are one
 * toolkit over one set of formats, and a caller reading a buffer directly
 * needs the layout constants of whichever format it is without knowing which
 * analysis wrote them. The scope and flow formats both describe their header
 * with a `H_*` block, so those two blocks carry `SCOPE_` and `FLOW_` prefixes;
 * every other name is unique on its own.
 *
 * The package sets `sideEffects: false` and the three halves reference each
 * other only through the functions that need them, so importing one analysis
 * does not ship the others. `tests/scope/tree-shaking.test.ts` proves it
 * against the built bundle.
 */

export * from "./parse/index.js";
export * from "./scope/index.js";
export * from "./flow/index.js";
