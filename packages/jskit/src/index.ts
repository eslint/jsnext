/**
 * @fileoverview The package's public surface: one entry point onto four
 * analyses that share a representation.
 *
 * Nothing is defined here. Each analysis has its own directory and its own
 * index deciding what that part exports, and this file only puts the four
 * together:
 *
 * - `parse/` turns source text into two binary buffers, then reports what is
 *   merely not allowed here (`validate()`) or decodes an ESTree tree
 *   (`toAST()`) on request.
 * - `scope/` reads a program — either those buffers or an ordinary ESTree
 *   tree — and returns the scope graph as a third binary buffer.
 * - `flow/` reads the parse and scope buffers together and returns the
 *   control flow graph as a fourth.
 * - `types/` reads the parse and scope buffers together and returns what the
 *   program states about its types as a fifth.
 *
 * They are exported flat rather than under namespaces because they are one
 * toolkit over one set of formats, and a caller reading a buffer directly
 * needs the layout constants of whichever format it is without knowing which
 * analysis wrote them. The scope, flow, and type formats all describe their
 * header with a `H_*` block, so those blocks carry `SCOPE_`, `FLOW_`, and
 * `TYPES_` prefixes; every other name is unique on its own.
 *
 * The package sets `sideEffects: false` and the four parts reference each
 * other only through the functions that need them, so importing one analysis
 * does not ship the others. `tests/scope/tree-shaking.test.ts` proves it
 * against the built bundle.
 */

export * from "./parse/index.js";
export * from "./scope/index.js";
export * from "./flow/index.js";
export * from "./types/index.js";

/*
 * The one thing exported from here rather than from a sub-index. The ESLint
 * parser object is not part of any of the four analyses: it hands ESLint a
 * tree from `parse/` and a scope graph from `scope/`, so it sits above both
 * and `parse/index.js` cannot name it without the two directories importing
 * each other.
 */
export { eslintParser } from "./parse/eslint-parser.js";
export type {
	EslintParseResult,
	EslintParserOptions,
} from "./parse/eslint-parser.js";
