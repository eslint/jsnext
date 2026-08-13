# @eslint/jsscope

A fast, ESLint-compatible scope analyzer for JavaScript, TypeScript, and JSX.

`jsscope` answers the question every lint rule about variables has to ask:
*which declaration does this identifier refer to?* It reproduces
[`eslint-scope`](https://github.com/eslint/eslint-scope) for JavaScript and JSX
and [`@typescript-eslint/scope-manager`](https://typescript-eslint.io) for
TypeScript, down to the scope types, the definition types, and the order the
references appear in.

There are two ways in, and they share one implementation:

| Entry point | Reads | Use it when |
| ----------- | ----- | ----------- |
| `analyze()` | [`@eslint/jsparse`](../jsparse)'s binary buffers | The source is yours to parse. Nothing is ever decoded into ESTree objects, which is where the speed comes from. |
| `analyzeTree()` | An ordinary ESTree tree | You already have an AST, from `espree`, `@typescript-eslint/parser`, or anything else ESLint-compatible. |

Both run the same walk and return the same thing: one `ArrayBuffer` in a
compact binary scope format, where every binding has a stable symbol ID and
every node reference is an integer handle into the program that was analyzed.
Three consumers read that buffer, each shaped for a different job:

| Consumer | Returns | Use it when |
| -------- | ------- | ----------- |
| `toScopeManager()` | The escope-compatible object graph | You have code written against `eslint-scope`, including `@eslint-community/eslint-utils`. |
| `new Scopes()` | Point queries straight off the buffer | You want one answer — *is this the global `Symbol`?* — without building the graph. |
| `toScopeTree()` | A plain JSON-serializable tree | You are debugging, diffing, or writing golden files. |

The two entry points pull in separate adapters and this package is marked
`sideEffects: false`, so a bundler drops whichever one you do not import. The
buffer consumers accept either representation and therefore import both.

## Install

```bash
npm install @eslint/jsscope
```

`@eslint/jsparse` comes with it, and only `analyze()` needs it.

## Usage

### From an existing AST

```js
import * as espree from "espree";
import { analyzeTree, toScopeManager } from "@eslint/jsscope";

const tree = espree.parse("const answer = 42; answer;", {
	ecmaVersion: "latest",
	sourceType: "module",
	range: true,
});

const scopes = analyzeTree(tree, {
	sourceType: "module",
	dialect: "js",
}); // an ArrayBuffer

const scopeManager = toScopeManager(scopes, tree);
const moduleScope = scopeManager.scopes[1];
const [variable] = moduleScope.variables;

variable.name; // "answer"
variable.references.length; // 2 — the initializer's write and the later read
variable.identifiers[0]; // the very Identifier node espree produced
```

Every consumer takes the buffer *and the program it was produced from* — the
same `tree` here — and hands back the tree's own node objects, so they compare
by identity with the nodes you already hold.

### From source text

```js
import { parse } from "@eslint/jsparse";
import { analyze, toScopeManager } from "@eslint/jsscope";

const result = parse("const answer = 42; answer;");
const scopes = analyze(result, {
	sourceType: "module",
	dialect: "ts",
}); // an ArrayBuffer

const scopeManager = toScopeManager(scopes, result);
```

This is the fast path. Here a node is an **index into the binary buffer** — an
integer — because no tree is ever built. `null` means there is no node.

```js
const scope = scopeManager.scopes[1];

scopeManager.nodeType(scope.block); // "Program"
scopeManager.nodeRange(scope.block); // [0, 26]

// The reader the analysis used, for anything else you need.
scopeManager.reader.text(scope.variables[0].identifiers[0]); // "answer"
```

`nodeType()` and `nodeRange()` work on either representation, so code written
against them runs unchanged on both.

### Querying the buffer directly

`Scopes` answers the questions lint rules most often ask without building the
object graph at all. It is an exploratory API — a way to find out what the
binary format can answer well — so expect it to move.

```js
import { parse } from "@eslint/jsparse";
import { analyze, Scopes } from "@eslint/jsscope";

const result = parse("console.log(missing);");
const scopes = new Scopes(
	analyze(result, { globals: ["console"] }),
	result,
);

// The single most common question rules ask, one call:
scopes.isGlobalReference(node); // SourceCode#isGlobalReference() semantics

// Every use of a global name, resolved and unresolved:
scopes.getGlobalReferences("console"); // reference IDs

// no-undef is one loop:
for (const ref of scopes.getUnresolvedReferences(scopes.globalScope)) {
	scopes.referenceName(ref); // "missing"
	scopes.referenceIdentifier(ref); // the node
}

// Declaration node → bindings, with read/write flags on each reference:
for (const symbol of scopes.getDeclaredSymbols(declarationNode)) {
	for (const ref of scopes.getReferences(symbol)) {
		scopes.referenceIsWrite(ref);
	}
}

// The eslintUsed protocol lives beside the immutable buffer:
scopes.markSymbolAsUsed(symbol);
scopes.isSymbolUsed(symbol); // true
```

Scopes, symbols, and references are all stable integer IDs, assigned when the
buffer is written and never renumbered. A `Variable` rehydrated by
`toScopeManager()` carries its ID as `variable.symbolId`, and passing the
`Scopes` view to `toScopeManager(scopes, result, { scopes })` makes
`variable.eslintUsed` read and write that view's usage marks.

### A JSON view for debugging

```js
import { toScopeTree } from "@eslint/jsscope";

const tree = toScopeTree(scopes, result);

JSON.stringify(tree, null, 2); // fully self-contained; nodes are {type, start, end}
```

### Options

Both entry points take the same options. Every one has a default.

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `sourceType` | `"module"` | `"script"`, `"module"`, or `"commonjs"`. |
| `dialect` | `"ts"` | `"js"` or `"ts"`. See [the disagreements](#where-the-two-reference-implementations-disagree). |
| `jsx` | `true` | Whether a JSX identifier counts as a reference. |
| `impliedStrict` | `false` | Apply strict mode without a directive. |
| `globalReturn` | `false` | Wrap the program in a function scope. Implied by `"commonjs"`. |
| `ignoreEval` | `false` | Do not let a direct `eval` make scopes dynamic. |
| `globals` | `null` | Names to declare in the global scope. |
| `jsxPragma` | `null` | Name a JSX element compiles a call to, referenced once per file. |
| `jsxFragmentName` | `null` | Name a JSX fragment compiles a call to. |

### Supplying globals

A host's built-ins are not in the source, so nothing declares them. Pass them
in and the references that were waiting for them resolve:

```js
const result = parse("console.log(x);");
const scopeManager = toScopeManager(
	analyze(result, { globals: ["console"] }),
	result,
);

scopeManager.globalScope.set.get("console").references.length; // 1
scopeManager.globalScope.through.map(reference => reference.name); // ["x"]
```

`scopeManager.addGlobals(names)` does the same thing after the fact, on the
object graph only — the buffer it was rehydrated from does not change.

## The scope graph

What `toScopeManager()` returns, shaped exactly the way `eslint-scope` shapes
it.

### `ScopeManager`

| Member | Description |
| ------ | ----------- |
| `scopes` | Every scope, in the order they were created. |
| `globalScope` | The outermost scope. |
| `ast` | How the analysis read the program. |
| `reader` | The `AstReader`, for `analyze()`; `null` for `analyzeTree()`. |
| `acquire(node, inner?)` | The scope a node opened. |
| `acquireAll(node)` | Every scope a node opened. |
| `release(node, inner?)` | The scope enclosing the one a node opened. |
| `getDeclaredVariables(node)` | The variables a node declares. |
| `addGlobals(names)` | Declare globals and resolve what waited for them. |
| `nodeType(node)`, `nodeRange(node)` | Read a node without caring which representation it is. |

### `Scope`

`type` is one of `global`, `module`, `function`, `function-expression-name`,
`block`, `switch`, `catch`, `with`, `for`, `class`, `class-field-initializer`,
`class-static-block`, and — in TypeScript — `type`, `functionType`,
`conditionalType`, `mappedType`, `tsEnum`, and `tsModule`. These are the names
the two reference implementations use, inconsistent casing included, because
rules match on them.

Alongside the tree (`upper`, `childScopes`, `variableScope`, `block`) a scope
carries `variables`, `set` (the same variables by name), `references` (every
identifier written directly in it), and `through` (the ones it could not
resolve). `isStrict` says whether strict mode applies. The global scope also
has `implicit`, which holds the names that assignment created without any
declaration.

### `Variable`

`name`, `scope`, `identifiers` (the nodes that declare it), `defs` (how), and
`references` (every occurrence that resolved to it). `isTypeVariable` and
`isValueVariable` report whether the name can be used where a type or a value
is expected, which is how `interface A {}` fails to satisfy `A;`.

### `Reference`

`identifier` (the node), `name`, `from` (the scope), and `resolved` (the
variable, or `null`). `isRead()`, `isWrite()`, `isReadOnly()`, `isWriteOnly()`,
and `isReadWrite()` classify it; `writeExpr`, `init`, and `partial` describe a
write. `isTypeReference` and `isValueReference` say what kind of name it is.

### `Definition`

`type` is one of `Variable`, `Parameter`, `FunctionName`, `ClassName`,
`CatchClause`, `ImportBinding`, `ImplicitGlobalVariable`, and — in TypeScript —
`Type`, `TSEnumName`, `TSEnumMemberName`, and `TSModuleName`. `name`, `node`,
and `parent` are nodes; `index` and `kind` place a `Variable` definition within
its declaration; `rest` marks a rest parameter.

## Where the two reference implementations disagree

`eslint-scope` wins. There are three places it comes up:

- **A JSX factory reference.** `@typescript-eslint/scope-manager` references
  `React` once per file, by default, on the theory that JSX compiles to a call.
  `eslint-scope` does not, so neither does this by default. Set `jsxPragma` and
  `jsxFragmentName` to get the other behavior.
- **The standard library.** The TypeScript analyzer seeds the global scope with
  every name in whichever `lib` is configured, plus `const` so that `x as const`
  resolves. Nothing is seeded here; pass `globals` for the same effect and
  better control.
- **`export { a }`.** Under `dialect: "ts"` this names both a value and a type,
  which is what TypeScript needs. Under `"js"` it is an ordinary read, which is
  what `eslint-scope` reports.

Beyond those three, the output is identical to whichever implementation covers
the syntax — see below.

## Verified against the reference analyzers

`npm test` is the fast check. What actually proves correctness is the
differential corpus: every `.js`/`.jsx` and `.ts`/`.tsx` file in `node_modules`
is analyzed by **both entry points** and compared in full against the reference
— every scope, its type, strictness and extent; every variable, its definitions
and its resolved references; every reference, its mode and what it resolved to;
and every unresolved reference passing through.

The tree path is compared especially directly: `analyzeTree()` is handed the
very same tree object the reference analyzer was given, so any difference is a
difference between the analyzers and nothing else.

```bash
npm run conformance
```

```
binary files=1433 ok=1433 mismatch=0 threw=0   # vs eslint-scope
tree   files=1433 ok=1433 mismatch=0 threw=0
binary files=1255 ok=1255 mismatch=0 threw=0   # vs @typescript-eslint/scope-manager
tree   files=1255 ok=1255 mismatch=0 threw=0
```

Both entry points are compared *through the buffer*: the corpus serializes,
rehydrates with `toScopeManager()`, and diffs the result against the
reference, so a field the format dropped or reordered cannot pass.

`node_modules` contains no `.jsx` or `.tsx` files, so JSX is covered by
`tests/fixtures/jsx.json` and `tsx.json` instead, which are checked against
both reference analyzers the same way. Pointing a conformance script at a React
codebase closes that gap:

```bash
node scripts/conformance-js.mjs ../some-react-app/src 500
node scripts/conformance-ts.mjs ../some-react-app/src 500
```

## Performance

```bash
npm run bench
```

Analysis alone, with the parse hoisted out of the measured region. Every
contender in a row is handed the same work, and `analyzeTree()` and the
reference analyzer are handed the same tree object. The comparison is not
quite like for like — the reference analyzers stop at an object graph, while
both entry points here deliver the finished scope buffer — and it is the
buffer side that wins anyway:

| Suite | `analyze()` | `analyzeTree()` | Reference |
| ----- | ----------- | --------------- | --------- |
| JavaScript | **1.8×** | 0.2× | `eslint-scope` |
| TypeScript | **2.6×** | 0.2× | `@typescript-eslint/scope-manager` |
| JSX | **1.5×** | 0.2× | `eslint-scope` |

The speed comes from never materializing the graph: the walk records scopes,
symbols, and references straight into growable word buffers — no object per
scope, per variable, or per reference — and `finish()` compacts those words
into the buffer. `analyzeTree()` runs the same walk but pays for reading
someone else's tree through table-driven property lookups, plus the up-front
enumeration that gives every tree node a stable handle. It is the
compatibility path, priced accordingly.

Parsing and analysis together, which is what a tool actually asks for:

| Suite | `jsparse` + `analyze()` | Reference |
| ----- | ----------------------- | --------- |
| JavaScript | **2.5×** | `espree` + `eslint-scope` |
| TypeScript | **14×** | `@typescript-eslint/*` |

Numbers move a lot with machine temperature, and not evenly: `jsscope`
allocates far less than the reference analyzers, so a throttled machine slows
it down proportionally more and *deflates its ratio*. The TypeScript row reads
about 3.9× on a cool machine and about 2.5× on a hot one, with `jsscope`'s own
throughput halved in the second case. Take the best of several runs, and
compare ratios within a run rather than absolute numbers across runs.

## Bundle size

Importing one entry point does not ship the other. Minified, bundled with
`esbuild`:

| Imports | Size |
| ------- | ---- |
| `analyze` | 39.7 KiB |
| `analyzeTree` | 40.8 KiB |
| both | 44.6 KiB |

A tree-only bundle contains neither the binary reader nor the parser; a
binary-only bundle contains neither the tree adapter nor the slot-name table it
needs. `tests/tree-shaking.test.ts` bundles each entry point and checks exactly
that, so the property cannot quietly break.

## Development

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # esbuild bundle + .d.ts files
npm run conformance   # differential test against both reference analyzers
npm run bench      # performance comparison
```

The internals are documented in [`docs/architecture.md`](./docs/architecture.md).

## License

Apache-2.0
