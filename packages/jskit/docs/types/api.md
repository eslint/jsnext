# Type analysis

What a program states about its types, readable at any node.

See the [README](../../README.md) for the short version.

`inferTypes()` reads the parser's binary parse buffer and the scope
analyzer's binary scope buffer and returns one `ArrayBuffer` in the binary
type format. It is not a type checker: it reports nothing, rejects nothing,
and records only what the file states outright — annotations, literals,
initializers, signatures, declarations — combined by simple syntax-directed
rules. Where a real answer would need checking, inference across files, or
control-flow narrowing, it records nothing, and every query answers `false`
or "unknown" rather than guessing.

The result is built for the question type-aware lint rules ask most:
classification — "what kind of value is this, in one word?" A type is first
a flags word aligned with `ts.TypeFlags`, and a name carries its **origin** —
declared locally, known from the TypeScript standard library, imported from a
package, or imported from a file — the same three-way provenance
`typescript-eslint`'s `TypeOrValueSpecifier` matches types by.

## Usage

```js
import { parse, analyze, inferTypes, Types, toTypeTree } from "@eslint/jskit";

const code = `
	import { SafePromise } from "@tanstack/query-core";
	let delay: number | null = null;
	async function fetchName(id: number): Promise<string> { /* ... */ }
	const name = await fetchName(1);
`;

const parsed = parse(code);
const scope = analyze(parsed);
const types = inferTypes(parsed, scope);

// Point queries, keyed by a node index or any ESTree node (a `NodeRef`).
const queries = new Types(types, parsed);

queries.isTypeOf(
	{ type: "Identifier", start: code.indexOf("name =") },
	"string",
); // true
queries.mayBeNullish({ type: "Identifier", start: code.lastIndexOf("delay") }); // true
queries.isAwaitable({
	type: "CallExpression",
	start: code.indexOf("fetchName(1"),
}); // true
queries.getTypeOrigin({
	type: "Identifier",
	start: code.indexOf("SafePromise;"),
});
// { kind: "package", specifier: "@tanstack/query-core" }

// A JSON view for debugging and golden files.
console.log(JSON.stringify(toTypeTree(types, parsed, scope), null, 2));
```

The scope buffer must come from `analyze()` over the same parse result. A
buffer from `analyzeTree()` names nodes another way and is refused — the same
requirement `createGraph()` has, for the same reason: the type buffer stores
byte offsets into the parse buffer.

The analysis reads the source text throughout — names, literal values, and
member keys are slices of it — so a parse buffer that cannot reach its text
(one parsed without `{ source: true }` and read outside the process that
parsed it) needs `inferTypes(parsed, scope, { text })`. See
[embedded-source.md](../parse/embedded-source.md).

## API

- **`inferTypes(parsed, scope, options?)`** — produces the type buffer.
  `options.text` supplies the source for a transferred buffer. Throws a
  `TypeError` for a buffer that is not what its parameter claims, a scope
  buffer from `analyzeTree()`, or unreachable source text.

- **`Types`** — the classification queries. The constructor takes the type
  buffer and the parse buffer it was built from. Node-keyed methods accept a
  node index or a `NodeRef` — `{ type, start, end? }`, which every ESTree
  node structurally satisfies, so an ESLint rule can pass its nodes straight
  in. Every predicate is conservative: a node the analysis recorded nothing
  for answers `false`, and `getTypeId()` returning `TYPE_NONE` is how a
  caller tells "no" from "no idea".
    - `getTypeId(node)`, `getSymbolTypeId(symbol)`, `getDeclaredTypeId(symbol)`
    - `isNullish(node)` / `mayBeNullish(node)` — definitely nullish versus
      cannot-rule-it-out (`any` and `unknown` count as "may").
    - `isTypeOf(node, name)` — whether `typeof` definitely produces `name`;
      unions must agree on every constituent, and an intersection answers by
      the constituent that pins the runtime value — a primitive first
      (`string & Brand` is a string), then a callable one, then a plain
      object, and nothing at all when a constituent commits to nothing.
    - `isAwaitable(node)` — a `Promise` or `PromiseLike` from the standard
      library, or a type carrying a `then` member.
    - `isArray(node)`, `isTuple(node)`, `isEnumLike(node)`
    - `getTypeFlags(node)` — the `TYF_*` word; `getTypeName(node)` and
      `getTypeOrigin(node)` — the written name and where it was declared;
      `getPropertyTypeId(node, name)`; `getElementTypeId(node)`;
      `typeToString(node)` — a readable rendering for messages.
    - Every predicate and reader also has a `…ById` form taking a type ID, plus
      `constituentTypeIds(typeId)` for union decomposition.

- **`TypesBufferReader`** — direct queries against the words: counts,
  `(id, field)` record reads, pooled lists, the sorted node-type index, and
  the string table. This and the builder are the only two modules that know
  the layout.

- **`toTypeTree(types, parsed, scope)`** — a plain JSON tree: every type
  with its flags spelled out, every typed symbol by name, every typed node by
  position. For debugging and golden files, not for consumption.

- The layout constants (`TYPES_H_*`, `TY_*`, `TM_*`, `SY_*`, `NT_*`), the
  flag words (`TYF_*`, `TYS_*`, `TMF_*`), the origin codes (`TYO_*`), and the
  pinned intrinsic IDs (`TYPE_*`) are all exported for tools that read the
  buffer another way. The header block carries the `TYPES_` prefix for the
  same reason the scope and flow headers carry theirs: the three formats
  share field names, and `export *` would silently drop a collision.

## Verified by its tests and by the checker

There is no reference implementation for this analysis — that is the point:
it answers without a compiler — so its integration tests in `tests/types/`
are the contract, and the differential tool that holds the TypeScript and
Rust implementations byte-identical
([`packages/jskit-native/tools/diff-types.mjs`](../../../jskit-native/tools/diff-types.mjs))
is what keeps the two producers one format.

Its _claims_ do have a referee:
[`scripts/types/conformance-ts.mjs`](../../scripts/types/conformance-ts.mjs)
runs a corpus through the analysis and holds every positive answer —
`isTypeOf()`, `isNullish()`, `isArray()`, `isTuple()`, `isAwaitable()` — up
against `ts.TypeChecker` on the same span. Silence is always allowed;
`disagree=0` is the standard. `npm run test:conformance:types` runs it.

## Where the format is specified

[`architecture.md`](./architecture.md) documents the walk, the buffer field
by field, what the analysis deliberately does not claim, and the invariants
that break subtly when violated.
