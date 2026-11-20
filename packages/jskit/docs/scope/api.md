# Scope analysis

`analyze()`, `analyzeTree()`, and the three consumers of the buffer they
produce, in full: every option, the shape of the scope graph, and the three
places the two reference analyzers disagree.

The [package README](../../README.md#scope-analysis) has the short version.

## Terms

The buffer, `Scopes`, and `toScopeTree()` use their own names for some of
the things `eslint-scope` names. Each row is one kind of record, or one idea,
and the right-hand column is what `toScopeManager()` turns it into.

| Term                  | Means                                                                                                                                                                                                                                                                                                                                                                                  | `eslint-scope`                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **scope**             | A region of the program with its own bindings: the global scope, a module, a function, a block, a class, and so on.                                                                                                                                                                                                                                                                    | `Scope`                                      |
| **symbol**            | One binding of one name in one scope. A name declared twice in the same scope — `var f; function f() {}` — is one symbol with two definitions. Declarations, configured globals, each non-arrow function's `arguments`, the inner name of a named function or class expression, and implicit globals each create one. References, property names, labels, and unresolved names do not. | `Variable`                                   |
| **definition**        | One declaration of a symbol: the node that declares it and what kind of declaration it is. A symbol has zero or more.                                                                                                                                                                                                                                                                  | `Definition`                                 |
| **reference**         | One use of a name at an identifier, with whether it reads, writes, or both. It points at the symbol it resolved to, or at nothing.                                                                                                                                                                                                                                                     | `Reference`                                  |
| **resolved**          | A reference whose name some enclosing scope binds, or a configured global supplies.                                                                                                                                                                                                                                                                                                    | `reference.resolved`                         |
| **unresolved**        | A reference nothing binds. It passes out through every scope's `through` list to the global scope's, which is what `no-undef` reports.                                                                                                                                                                                                                                                 | `reference.resolved === null`                |
| **through**           | A scope's references that it, and every scope inside it, could not resolve: what it closes over, or, for the global scope, what is unresolved.                                                                                                                                                                                                                                         | `scope.through`                              |
| **configured global** | A name supplied by the `globals` option. It is a symbol in the global scope with no definitions, and stops being one the moment the file declares the name itself.                                                                                                                                                                                                                     | an entry in `globalScope.set` with no `defs` |
| **implicit global**   | A name a sloppy-mode assignment creates on the global object (`x = 1` with no `x` declared). The reference stays unresolved; a symbol for the name goes on the global scope's `implicit` list, never its own variables. Strict code and modules create none.                                                                                                                           | `globalScope.implicit`                       |
| **binding origin**    | Where the symbol a reference resolved to was introduced, as a bitmask: one bit per kind of declaration, or one of the four that have none — configured global, implicit global, unresolved, `arguments`.                                                                                                                                                                               | none                                         |
| **handle**            | A node as the buffer stores it: a byte offset into the parse buffer on the binary path, or a position in a tree walk on the tree path. `0` is no node.                                                                                                                                                                                                                                 | none: nodes are objects                      |
| **`NodeRef`**         | A node named by position instead — `{ type, start, end? }` — so a consumer holding only ESTree nodes can ask about one.                                                                                                                                                                                                                                                                | none                                         |

Scopes, symbols, references, and definitions are each numbered from zero in
their own sequence — the **scope ID**, **symbol ID**, **reference ID**, and
**definition ID** — assigned once, when the buffer is written, and never
renumbered.

## Two ways in

| Entry point     | Reads                                          | Use it when                                                                                                     |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `analyze()`     | the [parser](../parse/api.md)'s binary buffers | The source is yours to parse. Nothing is ever decoded into ESTree objects, which is where the speed comes from. |
| `analyzeTree()` | An ordinary ESTree tree                        | You already have an AST, from `espree`, `@typescript-eslint/parser`, or anything else ESLint-compatible.        |

A tree `toAST()` decoded does not need `analyzeTree()`: run `analyze()` over
its parse result and pass the consumers the tree, as
[below](#from-source-text-back-to-your-tree). `analyzeTree()` is for a tree this
package did not decode, and it has no native implementation.

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

### From source text, back to your tree

The two paths above meet here: parse the text, decode the tree you will work
with, analyze the _parse result_, and hand the consumers the _tree_.

```js
import { analyze, parse, toAST, toScopeManager, validate } from "@eslint/jskit";

const result = parse("const answer = 42; answer;");
const problems = validate(result, { sourceType: "module" });
const program = toAST(result);
const scopes = analyze(result, { sourceType: "module" });
const scopeManager = toScopeManager(scopes, program);

scopeManager.scopes[1].variables[0].identifiers[0]; // the Identifier in program
```

`parse()` and `analyze()` both run in Rust when `@eslint/jskit-native` is
installed, and nothing walks the tree to number it: `toAST()` records every
object it creates under its node index, against the `Program` it returns, and
the consumers resolve the scope buffer's handles through that record. It is
the pipeline the [ESLint parser object](../parse/api.md#using-it-with-eslint)
runs. `Scopes` and `toScopeTree()` accept the `Program` the same way.

The tree has to come from the same parse result the analysis read. One
decoded from another is refused — at the first handle that names no node in
it, since neither buffer names the other.

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

#### Where a binding comes from

`getBindingOrigins(node)` says where the binding an identifier refers to was
introduced, as a bitmask of `BINDING_ORIGIN_*` constants. It costs the
identifier lookup plus one word read: the analysis records each symbol's
kinds of declaration as it writes the buffer.

```js
import {
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_IMPORT_BINDING,
} from "@eslint/jskit";

const origins = scopes.getBindingOrigins(node);

origins === BINDING_ORIGIN_CONFIGURED_GLOBAL; // the same as isGlobalReference(node)
(origins & BINDING_ORIGIN_IMPORT_BINDING) !== 0; // imported, perhaps among others
```

| Origin                                                     | When                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CONFIGURED_GLOBAL`                                        | a configured global, nothing in the file declares                                                                       |
| `IMPLICIT_GLOBAL`                                          | unresolved, but a sloppy-mode assignment in the file creates the name — every reference to it, not only that assignment |
| `UNRESOLVED`                                               | nothing declares or configures the name                                                                                 |
| `ARGUMENTS`                                                | a function's implicit `arguments`                                                                                       |
| `VARIABLE`                                                 | `var`, `let`, `const`, `using`, `await using`                                                                           |
| `FUNCTION_NAME`, `CLASS_NAME`                              | a function or class declaration, or the inner name of the expression form                                               |
| `PARAMETER`, `CATCH_CLAUSE`, `IMPORT_BINDING`              | as named                                                                                                                |
| `TYPE`, `TS_ENUM_NAME`, `TS_ENUM_MEMBER`, `TS_MODULE_NAME` | the TypeScript declarations                                                                                             |

The first four are each the whole answer when set. The rest come from
declarations, and a name declared more than once sets one bit per kind:
`var f; function f() {}` is `VARIABLE | FUNCTION_NAME`, because a scope holds
one binding per name, and which declaration supplies the value at run time
depends on execution order, not declaration order. A configured global the
file declares itself — `var Array` in a script — answers with that
declaration, never `CONFIGURED_GLOBAL`. An identifier that is not a reference
answers `0`.

`symbolOrigins(symbol)` and `referenceOrigins(reference)` answer the same
question for a symbol or reference ID already in hand.

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

Scopes nest the way they nest in the program, with each scope's variables
and references inside it. Nothing in the tree points elsewhere by a bare ID:
every cross-link is rendered where it is used, so each one carries a node
that a viewer such as `jskit-inspect` can highlight in the source.

| Field                 | Holds                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `variable.references` | the variable's references, in full                                                                                          |
| `scope.through`       | the scope's unresolved references, in full                                                                                  |
| `reference.resolved`  | the variable it resolved to, in full except for that variable's own `references`, which would lead straight back; or `null` |
| `scope.variableScope` | `{ scopeId, type, block }` for the scope `var` declarations land in                                                         |
| `variable.origins`    | `symbolOrigins()`, spelled as names: `["Variable", "FunctionName"]`, `["ConfiguredGlobal"]`                                 |
| `reference.origins`   | `referenceOrigins()`, spelled the same way: `["Parameter"]`, `["Unresolved"]`, `["ImplicitGlobal"]`                         |

So one reference can appear in several places — its scope's `references`,
some scope's `through`, its variable's `references` — rendered identically
each time and numbered with the same `referenceId`. `bindingOriginNames()`
is the function that spells the origins out, for any other bitmask that
needs reading.

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
| `text`            | none       | The program text, for a parse buffer that cannot otherwise reach it. `analyze()` only.        |

`text` is the fallback for a buffer parsed without `{ source: true }` and then
read outside the process that parsed it; the buffer consumers — `Scopes`,
`toScopeManager()`, `toScopeTree()` — take the same option for the same
reason. It never overrides text the buffer can already reach, a text of the
wrong length throws, and `analyzeTree()` has no use for it: tree nodes carry
their own strings. See
[`embedded-source.md`](../parse/embedded-source.md#the-text-option-the-fallback-for-a-buffer-already-shipped).

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
| `reader`                            | The `AstReader` over a parse result; `null` over a `Program`. |
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
