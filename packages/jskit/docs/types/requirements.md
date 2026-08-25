# Requirements for type analysis

## Goal

To be able to look up what kind of value any expression, variable, or object
property holds, at any point in the AST, without running a type checker.

## Description

Type-aware lint rules spend most of their type-checker budget on one cheap
question — "what kind of thing is this, in one word?" — and the checker they
ask today costs a whole compiler. This analysis answers the classification
question from the program text alone: annotations, initializers, literals, and
declarations, combined by simple syntax-directed rules. It is not a type
checker. It reports nothing, rejects nothing, and infers only what a single
file states outright; where the answer would need checking, it stays silent
rather than guessing.

## Type information

Do not reimplement TypeScript. Record, for the nodes and symbols the text
explains, a type built from TypeScript's own vocabulary: a flags bitfield
aligned with `ts.TypeFlags`, a shape word for the object kinds, union
constituents, members for object properties, and a symbol carrying the type's
name and its origin — the file, the package, or the TypeScript standard
library it came from, the same three-way split `typescript-eslint` uses to
let a rule name a type by where it was declared.

The result must be a binary buffer in the repository's established format
family: little-endian 32-bit words, a `TYPES_H_*` header, node references as
byte-offset handles into the parse buffer, produced identically by the
TypeScript and Rust implementations. The design must leave room for the other
questions type-aware rules ask — structural membership, union decomposition,
flow-sensitive nullability, `any` propagation — and for a future store of
types imported from other files, without a format break.

## Public API

- `inferTypes(parsed, scope, options)` - produces the type buffer from the
  parse and scope buffers.
- `Types` - a class accepting the relevant buffers, with point queries that
  take a node or a `NodeRef`: `isNullish()`, `isTypeOf()`, `isAwaitable()`,
  and the rest of the classification family.
- `TypesBufferReader` - direct queries against the words.
- `toTypeTree()` - a JSON view for debugging.
