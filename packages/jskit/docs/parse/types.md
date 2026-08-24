# The ESTree type declarations

`src/ast-types.ts` describes every node `toAST()` can produce: 160 interfaces
over 158 of the parser's 161 node kinds, plus 29 unions and enumerations. It is
the type half of the output contract, and `toAST()` and `eslintParser.parse()`
both return `Program` from it.

The file is hand-written. Nothing at runtime reads it, which means nothing
would notice it drifting from the decoder, so two scripts hold it in place.
Both run under `npm run test:conformance`; see
[`../../scripts/README.md`](../../scripts/README.md) for how they divide the work.

## Why not a published type package

`@types/estree` and `@typescript-eslint/types` both describe an AST close to
this one. Neither can be used, for reasons worth recording so the question does
not get reopened from scratch.

**Coverage is the smaller problem.** Of the 161 kinds, `@types/estree` has 72
of the 74 plain JavaScript ones — it lacks `AccessorProperty` and `Decorator` —
and `@types/estree-jsx` matches all 15 JSX kinds exactly. Neither has any of
the 72 TypeScript kinds. `TSESTree` covers all three groups, so on names alone
it would win.

**The shapes are the real problem.** Three properties of this parser's output
have no expression in either package:

- Every node carries `start` and `end`. `@types/estree` has neither, and
  `TSESTree` requires `range` and `loc`, which `toAST()` deliberately omits.
- A property `@typescript-eslint/parser` leaves `undefined` is `null` here.
  `TSESTree` spells those `X | undefined`, so it is wrong in exactly the places
  this parser diverges on purpose.
- Under `dialect: "js"` the TypeScript-only properties are omitted entirely.
  Neither package has a notion of a dialect that drops properties.

**Two mechanisms could bridge that, and both were tried and rejected.**

A recursive mapped type that adds `start` and `end` to every node compiles, and
is still unusable. It reaches into objects that are not nodes — `lit.regex.start`
and `loc.start.start` both typecheck — and mangles `RegExp` itself into a shape
with no call signatures. Remapped nodes stop being assignable to `ESTree.Node`,
so interop with anything typed against estree breaks. And a one-character typo
produces a twenty-line wall of structural types:

```
error TS2339: Property 'nope' does not exist on type '({ type: "ExpressionStatement";
  expression: ({ type: "Literal"; value?: ({ exec: {} & { start: number; end: number; };
  test: {} & { start: number; ...
```

A `declare module "estree"` augmentation adding the two properties to
`BaseNodeWithoutComments` is technically flawless — it reaches every node and
every deep union, pollutes nothing, and stays assignable. It fails because it
is global. Any code anywhere in a consumer's dependency tree that constructs an
ESTree node stops compiling:

```
error TS2739: Type '{ type: "EmptyStatement"; }' is missing the following
  properties from type 'EmptyStatement': start, end
```

That is not hypothetical: it is what `@types/estree-jsx` does to its own
consumers, injecting JSX into everyone's `Expression` union whether they parse
JSX or not.

So the shapes here are declared rather than derived. The JavaScript and JSX
ones were transcribed from `@types/estree` and `@types/estree-jsx`
(DefinitelyTyped, MIT — hence the attribution in the file header) and corrected
against what the decoder emits; the TypeScript ones were written against
`TSESTree` as a reference. Note that `TSESTree` is not generated from a grammar
either — its `ast-spec.d.ts` carries a banner saying it was copied from an
internal, unpublished `ast-spec` package of hand-written per-node files.

## The decisions

### The output matrix is flattened into optionality

The output is not one shape. It varies three ways:

|                            | `start`/`end` | `range`/`loc` | TypeScript-only properties  |
| -------------------------- | ------------- | ------------- | --------------------------- |
| `toAST()`, `dialect: "js"` | yes           | no            | **omitted entirely**        |
| `toAST()`, `dialect: "ts"` | yes           | no            | present, `null` when absent |
| `eslintParser.parse()`     | yes           | yes           | per dialect                 |

An earlier plan modeled this with generic parameters on the base node. Don't:
every mechanism for varying a type across a whole tree is a transformation, and
transformations are what produce the error wall above. Instead `NodeBase`
requires `start` and `end`, marks `range` and `loc` optional, and every
TypeScript-only property is optional. One set of interfaces, slightly weaker
than the truth for ESLint-parser consumers, who narrow or assert to get
`range`. That is what `@types/estree` already does, and the alternative is 322
interfaces.

### A property pinned to one value is written as that value

`expression: false`, `id: null`, `body: null`, `exportKind?: "value"`,
`selfClosing?: false`. These are not decoration: `conformance-types.mjs` reads
any type that is a fixed set of literals and checks every instance in the
corpus against it. Writing `boolean` where the decoder only ever writes `false`
gives up a check that costs nothing.

### `Literal` is three interfaces

`SimpleLiteral`, `RegExpLiteral`, and `BigIntLiteral` all pin `type: "Literal"`.
One interface would make `regex` and `bigint` optional and lose the connection
between `regex` being present and `value` being a `RegExp`. Both scripts
special-case a `type` with several variants: an instance missing a property may
belong to a sibling, so only the union of names can be checked, not
requiredness.

### JavaScript-only properties exist too

`JSXOpeningFragment.attributes` and `.selfClosing` are the mirror image of the
TypeScript-only properties: `espree` reports both on every opening fragment,
`@typescript-eslint/parser` reports neither, so they appear under `dialect:
"js"` only. This is why `conformance-types.mjs` only reports a property as
wrongly optional when it is present on every instance in _both_ dialects. A
per-dialect rule is wrong in both directions.

### TypeScript-only properties on TypeScript-only nodes are optional anyway

`TSDeclareFunction.declare` and the `typeParameters?` on the signature nodes are
declared optional even though those nodes exist only under `dialect: "ts"`,
where the properties are always present. This is a known imprecision, kept
because `derive-shapes.mjs` reasons about the decoder schema, where they are
marked `ts(...)` like any other dialect-dependent property. Optional is weaker
than the truth but never wrong. Tightening it means teaching the comparison
which kinds are TypeScript-only.

### Three kinds have no interface

`TSAbstractKeyword`, `TSDeclareKeyword`, and `TSExportKeyword` have kind numbers
and names in `node-kinds.ts`, but nothing in `src/` references them — the
parser never emits one. There is no shape to describe, so they are absent. That
is why 158 kinds are declared out of 161.

## How it fits together

The decoder builds each node as an object literal whose value expressions no
discriminated union can describe: TypeScript cannot narrow on a runtime `kind`
integer and then permit member-specific property types. So the generated
decoders work in `EsNode` — a plain `Record<string, unknown>` — and the shape
is asserted once, at the return of `buildAst()` in `api.ts`. That single
`as unknown as Program` is the entire cost of the arrangement, and the two
scripts are what make it honest.

```
to-ast-shapes.mjs  ──generates──▶  to-ast-decode.ts  ──▶  EsNode  ──one cast──▶  Program
    │                                                       │
    │                                                       └── conformance-types.mjs reads the output
    └───────────────────────────────────────────────────────── derive-shapes.mjs reads this schema
```

`export type * from "./ast-types.js"` in `index.ts` puts all 160 on the public
surface. Because the module contains nothing but types, it erases completely —
the minified bundle is unchanged at 129.8kb.

## What is not checked

**Which node types belong in a slot.** `child("test", "A")` says a child goes there,
not which children, so no amount of reading the decoder yields a union. Of the
285 property specs across the decoder schema, 174 (61%) are node or
list slots in exactly this position. Another 93 (33%) carry an exact type in
the expression — a flag test, a pinned literal, a name table, a known helper —
and the remaining 18 need a human.

Deriving the unions from the corpus instead does not work, and the failure is
quiet rather than loud: observed unions are always subsets. Over 2,648 files,
`BlockStatement.body` never once holds a `StaticBlock` or a `WithStatement`,
and `CallExpression.arguments` never holds a `ClassExpression`,
`YieldExpression`, or `ImportExpression`. All are legal. A type built from
observation would reject valid trees, which is worse than no type at all.

So the unions — `Statement`, `Expression`, `TSType`, `TypeElement`, and the
rest — are written by hand and are the part of this file with no machine
backstop. Corpus slot data is still the right _evidence_ when writing one; it
just has to be widened by hand afterwards. The one bug the corpus did catch
this way was `MethodDefinition.value`, which is `FunctionExpression |
TSEmptyBodyFunctionExpression` because an overload signature has no body.

## Known gap in the scope analyzer

`EsTreeNode` in `src/scope/estree-ast.ts` is declared with an index
signature, which makes the official types **not assignable to it**:

```
error TS2345: Argument of type 'Program' is not assignable to parameter of type
  'EsTreeNode'. Index signature for type 'string' is missing in type 'Program'.
```

Both `TSESTree.Program` and `estree`'s `Program` fail, so anyone calling
`analyzeTree()` with output from `espree` or `@typescript-eslint/parser` — the
use that entry point exists for — has to cast. The fix is to split the public
parameter type, which needs no index signature, from the internal one, which
does.

Note that the input and output types want opposite things and should not be
unified. `toAST()`'s output should be exact and require `start` and `end`;
`analyzeTree()`'s input must accept foreign trees that have `range` and `loc`
and no `start`/`end` at all.

## Changing this file

Adding a node kind is covered by the checklist in
[`architecture.md`](./architecture.md); the `ast-types.ts` entry is the step
easiest to skip, because nothing at runtime needs it.

`node scripts/derive-shapes.mjs --list` prints the property names, optionality,
and value kind for any kind the decoder fills but the file does not declare —
the scaffold for a new entry, leaving only the unions to write. After changing
anything here, run:

```bash
npm run test:conformance --workspace=@eslint/jskit
```

`problems=0 unseen=0` and `differ=0` are the standard. `unseen` and `kinds not
exercised` are advisory: they mean the corpus never reached something, not that
it is wrong.
