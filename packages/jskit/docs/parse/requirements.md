# Requirements for jparse

## Goal

Create an ESLint-compatible JavaScript/TypeScript parser that is faster than existing solutions.

## Description

This parser is designed to only support the latest JavaScript/TypeScript syntax and so does not accept options for which versions to support.

## Public API

- A `parse()` function that accepts a string of JavaScript or TypeScript code to parse. It returns a single `ArrayBuffer` containing three regions:
    1. a binary-encoded AST structure, read with `AstReader`.
    2. a binary-encoded list of tokens, read with `TokenReader`.
    3. a table where each element is the start offset of each line in the text, read with `readLineStarts()`.
- A `validate()` function that accepts the return value of `parse()` and an options object. It should return an array of errors (that include message and start offset for each error). The options object contains:
    - `sourceType` - `"script"`, `"module"` (default), `"commonjs"`.
    - `dialect`: - `"js"` or `"ts"` (default). Determines whether TypeScript is allowed.
- A `toAST()` function that accepts the return value of `parse()` and the same options object as `validate()`, and returns an object with `ast` (the ESTree-style AST) and `errors` (the errors returned from `validate()`). This function does both validation and AST creation.

## Requirements

- Syntax errors (invalid token, invalid sequence of tokens) must throw an error immediately inside `parse()`. The error must include the line and column number.
- Separate the parsing phase from the validation phase. Parsing strictly produces and evaluates tokens, other checks (i.e., variable hoisting, variable redeclaration, tokens that are invalid in a given context) are considered non-fatal and happen during the validation phase only.
- When parsing JavaScript code, it should return the same AST structure as the `espree` npm package.
- When parsing TypeScript code, it should return the same AST structure as the `@typescript-eslint/parser` package with the exception that `undefined` property values are instead represented as `null`.
- Both AST nodes and tokens must also store their `start` (0-based) and `end` (the index after the last character of the node/token) offsets in the source code. They must not contain `range` or `loc`.
- Both AST and tokens design must be open to extension in the future to accommodate new AST nodes and token types.
- Comments should be included in the token region of the `ArrayBuffer` returned from `parse()`.
- Must pass the same tests as `espree` for JavaScript code with `ecmaVersion: "latest"`.
- Code must be well-commented so humans can follow the logic.

## Performance Tips

- Use mathematical and binary operations instead of boolean and string operations.
- Avoid string comparisons.
- Avoid creating temporary or intermediate objects.
- Use array buffers and bit masks.

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

# References

- https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-11/
