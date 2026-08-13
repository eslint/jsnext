# Requirements for jseval

## Goal

Create a utility that evaluates the binary AST format from `jsparse` in two ways:

1. Scope analysis
2. Code path analysis

## Description

This utility is meant to efficiently evaluate JavaScript/TypeScript code in such a way as to provide additional insights into how the code is structured and functions. 

### Scope analysis

Capture scope and symbol information. We ultimately want the same data that is captured in `jsscope`, but represented in a compact, binary format. References to the AST should use byte offsets in the `ArrayBuffer` containing the binary AST.

Ensure all bindings have unique, immutable symbol IDs.

### Control flow graph

ESLint already has a code path analysis system, however, it is buggy and unreliable, and should not be used as the basis for this approach. 

To support future type narrowing, basic blocks must record two things clearly:

* Assignments / Variable Writes (updates the type environment).
* Branch Conditions on edges (refines the type environment).

This information must be stored in a compact binary format. It may make references to the scope/symbol information through byte offsets into the `ArrayBuffer` holding the scope information and the `ArrayBuffer` holding the binary AST.

## Public API

- A `parse()` function that accepts a string of JavaScript or TypeScript code to parse. It returns three values:
  1. `ast` - an `ArrayBuffer` with a binary-encoded AST structure.
  2. `tokens` - an `ArrayBuffer` with a binary-encoded list of tokens.
  3. `lineStarts` - a typed array where each element is the start offset of each line in the text.
- A `validate()` function that accepts the return value of `parse()` and an options object. It should return an array of errors (that include message and start offset for each error). The options object contains:
  - `sourceType` - `"script"`, `"module"` (default), `"commonjs"`.
  - `dialect`: - `"js"` or `"ts"` (default). Determines whether TypeScript is allowed.
- A `toAST()` function that accepts the return value of `parse()` and the same options object as `validate()`, and returns an object with `ast` (the ESTree-style AST) and `errors` (the errors returned from `validate()`). This function does both validation and AST creation.

## Requirements

- All data must be stored in a binary format in an `ArrayBuffer`.

- Syntax errors (invalid token, invalid sequence of tokens) must throw an error immediately inside `parse()`. The error must include the line and column number.
- Separate the parsing phase from the validation phase. Parsing strictly produces and evaluates tokens, other checks (i.e., variable hoisting, variable redeclaration, tokens that are invalid in a given context) are considered non-fatal and happen during the validation phase only.
- When parsing JavaScript code, it should return the same AST structure as the `espree` npm package.
- When parsing TypeScript code, it should return the same AST structure as the `@typescript-eslint/parser` package with the exception that `undefined` property values are instead represented as `null`.
- Both AST nodes and tokens must also store their `start` (0-based) and `end` (the index after the last character of the node/token) offsets in the source code. They must not contain `range` or `loc`.
- Both AST and tokens design must be open to extension in the future to accommodate new AST nodes and token types.
- Comments should be included in the `tokens` `ArrayBuffer` returned from the `parse()`.
- Must pass the same tests as `espree` for JavaScript code with `ecmaVersion: "latest"`.
- Code must be well-commented so humans can follow the logic.

## Benchmark

To ensure this approach is fast, we need a benchmark that tests full parsing (creation of AST via `toAST()`) against:

- `espree`
- `acorn`
- `@typescript-eslint/parser` with TypeScript 6 dependency
- `@typescript-eslint/parser` with TypeScript 7 dependency

## Tooling/Stack

- Write code in TypeScript
- Use `vitest` for tests
- Use `esbuild` for bundling

## Non-goals

* **Type checking** - this is left up to the TypeScript compiler. We don't need to validate that a type has particular properties, for example. 
