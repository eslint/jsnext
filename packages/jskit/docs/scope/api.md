# Scope analysis

`analyze()`, `analyzeTree()`, and the three consumers of the buffer they
produce, in full: every option, the shape of the scope graph, and the three
places the two reference analyzers disagree.

The [package README](../../README.md#scope-analysis) has the short version.

## Two ways in

| Entry point     | Reads                                          | Use it when                                                                                                     |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `analyze()`     | the [parser](../parse/api.md)'s binary buffers | The source is yours to parse. Nothing is ever decoded into ESTree objects, which is where the speed comes from. |
| `analyzeTree()` | An ordinary ESTree tree                        | You already have an AST, from `espree`, `@typescript-eslint/parser`, or anything else ESLint-compatible.        |

Both run the same walk and return the same thing: one `ArrayBuffer` in a
compact binary scope format, where every binding has a stable symbol ID and
every node reference is an integer handle into the program that was analyzed.
Three consumers read that buffer, each shaped for a different job:

| Consumer           | Returns                               | Use it when                                                                               |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `toScopeManager()` | The escope-compatible object graph    | You have code written against `eslint-scope`, including `@eslint-community/eslint-utils`. |
| `new Scopes()`     | Point queries straight off the buffer | You want one answer — _is this the global `Symbol`?_ — without building the graph.        |
| `toScopeTree()`    | A plain JSON-serializable tree        | You are debugging, diffing, or writing golden files.                                      |

## Usage

### From an existing AST

```js
import * as espree from "espree";
import { analyzeTree, toScopeManager } from "@eslint/jskit";

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

Every consumer takes the buffer _and the program it was produced from_ — the
same `tree` here — and hands back the tree's own node objects, so they compare
by identity with the nodes you already hold.

### From source text

```js
import { parse, analyze, toScopeManager } from "@eslint/jskit";

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
import { parse, analyze, Scopes } from "@eslint/jskit";

const result = parse("console.log(missing);");
const scopes = new Scopes(analyze(result, { globals: ["console"] }), result);

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

// How often a binding is read and written, without walking that list:
scopes.getSymbolReadCount(symbol); // 0 means nothing ever reads it
scopes.getSymbolWriteCount(symbol); // more than 1 settles prefer-const

// getVariableByName(): a name as the scope it is written in resolves it:
scopes.getSymbolByName(scope, "Symbol"); // symbol ID, or null
scopes.getOwnSymbolByName(scope, "Symbol"); // that scope's own binding only

// The eslintUsed protocol lives beside the immutable buffer:
scopes.markSymbolAsUsed(symbol);
scopes.isSymbolUsed(symbol); // true
```

A query that takes a node takes it either as the representation the buffer
was analyzed over — an index on the binary path, the tree's own object on the
tree path — or as a **`NodeRef`**, a `{ type, start, end? }` position. The
latter is what lets a consumer holding only decoded ESTree nodes ask about a
node it has no buffer index for: an ESLint rule receives nodes, not buffers,
and every ESTree node already answers to that shape.

```js
const result = parse("console.log(missing);", { tokens: true });
const scopes = new Scopes(analyze(result, { globals: ["console"] }), result);
const ast = toAST(result);
const node = ast.body[0].expression.callee.object; // the `console` Identifier

scopes.isGlobalReference(node); // true — matched by node.type and node.start
scopes.isGlobalReference({ type: "Identifier", start: 0 }); // the same match
```

Resolution indexes only the nodes the buffer stores something about — the
nodes that opened scopes, the declaring nodes, and the referenced
identifiers — so a position naming any other node answers the way a node with
nothing recorded does: `getScope()` is `null`, `getDeclaredSymbols()` is
empty, `isGlobalReference()` is `false`. `type` is what tells apart the nodes
that share a start, the way `function f() {}` and the `Program` both begin at
offset zero; `end` narrows the match further when it is given.

A read-write such as `x += 1` counts as both a read and a write, so the two
counts do not sum to `getReferences(symbol).length`.

Scopes, symbols, and references are all stable integer IDs, assigned when the
buffer is written and never renumbered. A `Variable` rehydrated by
`toScopeManager()` carries its ID as `variable.symbolId`, and passing the
`Scopes` view to `toScopeManager(scopes, result, { scopes })` makes
`variable.eslintUsed` read and write that view's usage marks.

### A JSON view for debugging

```js
import { toScopeTree } from "@eslint/jskit";

const tree = toScopeTree(scopes, result);

JSON.stringify(tree, null, 2); // fully self-contained; nodes are {type, start, end}
```

### Options

Both entry points take the same options. Every one has a default.

| Option            | Default    | Meaning                                                                                       |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `sourceType`      | `"module"` | `"script"`, `"module"`, or `"commonjs"`.                                                      |
| `dialect`         | `"ts"`     | `"js"` or `"ts"`. See [the disagreements](#where-the-two-reference-implementations-disagree). |
| `jsx`             | `true`     | Whether a JSX identifier counts as a reference.                                               |
| `impliedStrict`   | `false`    | Apply strict mode without a directive.                                                        |
| `globalReturn`    | `false`    | Wrap the program in a function scope. Implied by `"commonjs"`.                                |
| `ignoreEval`      | `false`    | Do not let a direct `eval` make scopes dynamic.                                               |
| `globals`         | `null`     | Names to declare in the global scope.                                                         |
| `jsxPragma`       | `null`     | Name a JSX element compiles a call to, referenced once per file.                              |
| `jsxFragmentName` | `null`     | Name a JSX fragment compiles a call to.                                                       |

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

| Member                              | Description                                                   |
| ----------------------------------- | ------------------------------------------------------------- |
| `scopes`                            | Every scope, in the order they were created.                  |
| `globalScope`                       | The outermost scope.                                          |
| `ast`                               | How the analysis read the program.                            |
| `reader`                            | The `AstReader`, for `analyze()`; `null` for `analyzeTree()`. |
| `acquire(node, inner?)`             | The scope a node opened.                                      |
| `acquireAll(node)`                  | Every scope a node opened.                                    |
| `release(node, inner?)`             | The scope enclosing the one a node opened.                    |
| `getDeclaredVariables(node)`        | The variables a node declares.                                |
| `addGlobals(names)`                 | Declare globals and resolve what waited for them.             |
| `nodeType(node)`, `nodeRange(node)` | Read a node without caring which representation it is.        |

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
`references` (every occurrence that resolved to it). `readCount` and
`writeCount` summarize that list, so a rule that only needs to know whether a
binding is ever read, or written more than once, does not scan it; a
read-write counts in both. `isTypeVariable` and
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
npm run test:conformance
```

```
binary files=… ok=… mismatch=0 threw=0   # vs eslint-scope
tree   files=… ok=… mismatch=0 threw=0
binary files=… ok=… mismatch=0 threw=0   # vs @typescript-eslint/scope-manager
tree   files=… ok=… mismatch=0 threw=0
```

Both entry points are compared _through the buffer_: the corpus serializes,
rehydrates with `toScopeManager()`, and diffs the result against the
reference, so a field the format dropped or reordered cannot pass.

`node_modules` contains no `.jsx` or `.tsx` files, so JSX is covered by
`tests/scope/fixtures/jsx.json` and `tsx.json` instead, which are checked
against both reference analyzers the same way. Pointing a conformance script at
a React codebase closes that gap:

```bash
node scripts/scope/conformance-js.mjs ../some-react-app/src 500
node scripts/scope/conformance-ts.mjs ../some-react-app/src 500
```

## Bundle size

Importing one entry point does not ship the other, and neither ships the rest
of the toolkit. Minified, bundled with `esbuild`:

| Imports       | Size     |
| ------------- | -------- |
| `analyze`     | 51.2 KiB |
| `analyzeTree` | 52.3 KiB |
| both          | 57.0 KiB |

A tree-only bundle contains neither the binary reader nor the parser; a
binary-only bundle contains neither the tree adapter nor the slot-name table it
needs; neither contains the control flow analysis.
`tests/scope/tree-shaking.test.ts` bundles each entry point and checks exactly
that, so the property cannot quietly break.

## Where the analysis is specified

[`architecture.md`](./architecture.md) documents the walk, resolution, and the
rule for reconciling the two analyzers this one reproduces.
