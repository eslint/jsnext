---
name: add-node-type
description: Add a new AST node type (JavaScript, JSX, or TypeScript) to @eslint/jskit. Use when adding, registering, or implementing a node kind, ESTree node, or syntax the parser does not yet support, or when a node parses but something downstream ignores it. Covers node-kinds, slots, the parser, the decoder, ast-types, and the scope analyzer's slot names, and verifies the result with a driver script.
---

# Adding a node type

A node kind has to be registered in **seven places across two directories**.
Six of them fail loudly. One does not: miss the scope analyzer's slot-names
entry and the binary walk keeps working while the tree walk silently stops
descending into the node.

`check-node-kind.mjs` checks all seven at once and then proves the node works
by running it through the parser and the scope analyzer. Use it after every step; it is faster than
the corpus and it tells you which site you missed.

All paths below are relative to the repository root. Nothing here works until
you have built, because every script and check imports `dist/`:

```bash
npm run build
```

## The driver

```bash
# Which sites are still missing?
node .agents/skills/add-node-type/check-node-kind.mjs TSNamespaceExportDeclaration

# Full check: registration, round trip, and a diff against the reference parser.
node .agents/skills/add-node-type/check-node-kind.mjs TSExportAssignment --code 'export = jQuery;'

# For syntax that is only legal outside a module.
node .agents/skills/add-node-type/check-node-kind.mjs WithStatement --code 'with (o) { x; }' --script
```

Exit status is 0 when everything passes. With `--code` it also parses the
sample, decodes it, validates it in both dialects, runs **both** scope entry
points and compares the graphs, and diffs the node against `espree` or
`@typescript-eslint/parser`. A `TS`-prefixed name is treated as TypeScript.

Output on a complete node:

```
## Registration sites

  ok    kind constant      packages/jskit/src/parse/node-kinds.ts
  ok    kind name          packages/jskit/src/parse/node-kinds.ts
  ok    slot layout        packages/jskit/src/parse/slots.ts
  ok    parser emits it    packages/jskit/src/parse/parser.ts
  ok    decoder case       packages/jskit/src/parse/to-ast.ts
  ok    type declaration   packages/jskit/src/parse/ast-types.ts
  ok    scope slot names   packages/jskit/src/scope/slot-names.ts

## Round trip

  ok    parse
  ok    decode: 1 node(s), keys type, start, end, expression
        children: expression
  ok    validate (ts): no problems
  ok    validate (js): rejected
  ok    scope: both entry points produce the same graph

## Against the reference parser

  ok    node matches the reference parser exactly
```

`--` means the site is only needed when the node has children or properties.
The driver upgrades those to `FAIL` once it has decoded a node and can see
that it does.

## The seven sites

Work in this order. Rebuild (`npm run build`) before re-running the driver —
every check reads `dist/`, not `src/`.

**1. `packages/jskit/src/parse/node-kinds.ts`** — append the constant in the right
partition (JavaScript, JSX, or TypeScript at or above `TS_FIRST = 100`), raise
`NODE_KIND_COUNT`, and add the name:

```ts
export const N_TSNamespaceExportDeclaration = 172;

/** One past the largest defined node kind. */
export const NODE_KIND_COUNT = 173;
```
```ts
	names[N_TSNamespaceExportDeclaration] =
		"TSNamespaceExportDeclaration";
```

Putting a TypeScript node below `TS_FIRST` is a silent bug: `validate.ts`
rejects TypeScript syntax under `dialect: "js"` with a single
`kind >= TS_FIRST` test, so a misnumbered node is accepted in JavaScript. The
driver checks this — see `validate (js): rejected`.

**2. `packages/jskit/src/parse/slots.ts`** — add the kind to a `define()` whose
layout matches. `N` is a child node, `L` a list, `D` plain data. Join an
existing group rather than adding a new call when the layout is the same:

```ts
define(
	[
		N_ReturnStatement,
		/* … */
		N_TSNamespaceExportDeclaration,
	],
	[N],
);
```

This one entry feeds three things: generic walks, and both of the tables
`define()` fills. Describe a child as `D` and validation stops descending into
it *and* its children come back from `reader.parent()` with no parent at all.

**3. The parser** — `parser.ts` for statements and declarations,
`parser-expressions.ts`, `parser-types.ts`, or `parser-jsx.ts` otherwise.
Allocate, fill slots, finish:

```ts
if (this.at(T_as) && this.nextIs(T_namespace)) {
	const node = this.writer.alloc(N_TSNamespaceExportDeclaration, start);

	this.next();
	this.next();
	this.writer.set(node, NODE_A, this.parseIdentifierName());
	this.semicolon();

	return this.writer.finish(node, this.lastEnd);
}
```

Order matters when a prefix is shared. `export as namespace X` has to be tested
before the `export *` branch, because both start by looking at what follows
`export`.

**4. `packages/jskit/src/parse/to-ast.ts`** — a `case` in `fill()` for JavaScript
and JSX, or in `fillTypeNode()` for TypeScript. Skip this only for a node with
no properties at all, such as a keyword type:

```ts
			case N_TSNamespaceExportDeclaration:
				node.id = this.node(a);
				return;
```

Use `this.addOptional(node, "name", slot)` for a property `dialect: "js"` must
omit, and `this.addListIfPresent(...)` for a list. A plain assignment inside
`if (this.typescript)` is the other way to make a property TypeScript-only.

**5. `packages/jskit/src/parse/ast-types.ts`** — the interface. Get the scaffold
from the generator rather than writing it blind:

```bash
node packages/jskit/scripts/parse/derive-shapes.mjs --list
```

It prints every kind the decoder fills that `ast-types.ts` does not declare, so
it prints nothing until you have done steps 1–4 and rebuilt. After adding the
node above it printed:

```
TSNamespaceExportDeclaration
	id: node
```

It gives you names, optionality, and whether each value is a node, a list, a
boolean, or a pinned literal. What it cannot give you is which node types are
allowed in each slot — that union is yours to write. Then add the node to any
union it belongs to (`Statement`, `Expression`, `TSType`, `TSDeclaration`, …).

**6. `packages/jskit/src/scope/slot-names.ts`** — what each child slot is *called*
in an ESTree tree. This is the one that fails silently:

```ts
	define([N_TSNamespaceExportDeclaration], ["id"]);
```

**7. `packages/jskit/tests/parse/fixtures/`** — a snippet in `javascript.json`,
`jsx.json`, `typescript.json`, or `tsx.json`. This is what actually compares
your node against the reference parser, and the fixtures are also read by
`conformance-types.mjs`, so a node no corpus file uses gets covered here.

Every fixture is parsed as a **module**. A snippet that is only legal in a
script cannot go in one — put it in the inline list in
`packages/jskit/scripts/parse/conformance-types.mjs` instead.

## Then run the corpus

The driver checks one sample. These check ~2,650 real files, and are the
standard the repo holds to:

```bash
npm run conformance --workspace=@eslint/jskit
```

```
files=1433 ok=1433 mismatch=0 threw=0
ok=1433 bad=0
files=1221 ok=1221 mismatch=0 threw=0
files=2886 threw=0 kinds=158 exercised=158 problems=0 unseen=0
derived=144 declared=158 identical=158 differ=0 undeclared=0
```

Then `npm test`, `npm run typecheck`, and `npm run lint`. Also run
`npm run conformance --workspace=@eslint/jskit` when the node has children;
it takes a few minutes and is the only check that proves both scope entry
points agree across the whole corpus.

## Gotchas

- **`derive-shapes.mjs` reports the missing type declaration; the corpus
  cannot.** After adding a node with no `ast-types.ts` entry, the corpus check
  said `problems=0` while `derive-shapes` said `undeclared=1`. Nothing in
  `node_modules` used the new syntax, so the output-based check had nothing to
  look at. Read `undeclared`, not just `problems`.
- **A missing `slot-names.ts` entry changes nothing you can see by hand.** The
  parse is right, the tree is right, and both scope analyses return a graph.
  The difference is one entry deep: `through: ["Identifier@20-26"]` on the
  binary side against `through: []` on the tree side. Only the driver's graph
  comparison or the scope corpus run finds it.
- **The two scope entry points do not represent nodes the same way.** The
  binary walk works in numeric node indices, the tree walk in objects, so
  `reference.identifier.name` is `undefined` on the binary side. The driver
  uses `packages/jskit/scripts/scope/serialize.mjs` — the project's own
  serializer — rather than comparing the graphs directly. Do the same if you
  write your own probe.
- **Removing a kind from a `define()` without removing its import breaks the
  build, and the error is nearly invisible.** `npm run build` prints
  `npm error command sh -c node scripts/build.js && tsc -p tsconfig.build.json`
  and nothing else useful. It is an unused-import error from `tsc`. Worse, the
  stale `dist/` stays in place, so every check afterwards silently tests the
  old bundle. Check that the build actually printed its `⚡ Done` line.
- **Not every kind is allocated with `alloc(N_Foo)`.** The keyword types go
  through `parseKeywordType(N_Foo)`, so grep for the bare constant.
- **A node with no properties needs no `slots.ts`, `to-ast.ts`, or
  `slot-names.ts` entry.** The keyword types (`TSStringKeyword` and friends)
  have only a constant, a name, a parser call, and an interface. They fall
  through `fillTypeNode()`'s `default:` and come out with just `type`, `start`,
  and `end`.
- **Three kinds are reserved but never emitted** — `TSAbstractKeyword`,
  `TSDeclareKeyword`, `TSExportKeyword`. They have constants and names and
  nothing else, deliberately. Do not "fix" them.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `FAIL parser emits it` but you wrote the branch | The parser file was not rebuilt, or the constant is only in the import list. |
| `FAIL validate (js): accepted, but a TS kind must be rejected` | The kind number is below `TS_FIRST`. Renumber it. |
| `FAIL scope entry points disagree` | Missing or wrong `slot-names.ts` entry — the names must match the ESTree property names exactly. |
| `FAIL node differs` against the reference | Property names, order-independent, or an extra/missing property. The driver prints both. |
| `derive-shapes` says `differ=1 … optionality` | The interface marks a property optional that the decoder always writes, or the reverse. Anything behind a condition other than `kind === N_Foo` is optional. |
| `conformance-types` says `kinds not exercised: X` | Nothing parsed a sample containing it. Add a fixture. |
| The driver's numbers look stale | You did not rebuild. Every check reads `dist/`. |

## Where this lives

The skill and its driver live in `.agents/skills/add-node-type/`, and
`.claude/skills` is a relative symlink to `.agents/skills`. That mirrors how
`CLAUDE.md` in this repo is a one-line import of `AGENTS.md`: the tool-neutral
copy is the real one, and the Claude-specific path points at it. Adding a skill
under `.agents/skills/` makes it visible to Claude Code with no second step —
do not copy files into `.claude/`.

## Background

- [`packages/jskit/docs/parse/architecture.md`](../../../packages/jskit/docs/parse/architecture.md)
  — the binary formats and the invariants.
- [`packages/jskit/docs/parse/types.md`](../../../packages/jskit/docs/parse/types.md)
  — why `ast-types.ts` is hand-written and what is machine-checked.
- [`packages/jskit/scripts/README.md`](../../../packages/jskit/scripts/README.md)
  — what each conformance script covers.
