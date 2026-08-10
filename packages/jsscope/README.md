# jsscope

A fast, ESLint-compatible scope analyzer for JavaScript, TypeScript, and JSX,
built on the [`jsparse`](../jsparse) binary AST.

`jsscope` answers the question every lint rule about variables has to ask:
*which declaration does this identifier refer to?* It reproduces
[`eslint-scope`](https://github.com/eslint/eslint-scope) for JavaScript and JSX
and [`@typescript-eslint/scope-manager`](https://typescript-eslint.io) for
TypeScript, down to the scope types, the definition types, and the order the
references appear in.

The difference is what it reads. Both reference analyzers walk an ESTree tree,
which means something has to allocate one object per node first. `jsscope`
walks the binary buffers `jsparse.parse()` produces and never materializes the
tree at all — scope analysis alone runs about **1.4× faster than
`eslint-scope`** and **4× faster than `@typescript-eslint/scope-manager`**, and
parsing plus analysis together runs **2.9×** and **20×** faster than the same
job done with the reference parser in front.

## Install

```bash
npm install jsscope jsparse
```

## Usage

```js
import { parse } from "jsparse";
import { analyze } from "jsscope";

const scopeManager = analyze(parse("const answer = 42; answer;"), {
	sourceType: "module",
	dialect: "ts",
});

scopeManager.scopes.map(scope => scope.type);
// => ["global", "module"]

const moduleScope = scopeManager.scopes[1];
const [variable] = moduleScope.variables;

variable.name; // "answer"
variable.references.length; // 2 — the initializer's write and the later read
variable.references[1].isReadOnly(); // true
```

### Nodes are numbers

Everything the reference implementations spell as an ESTree node — a scope's
`block`, a reference's `identifier`, a definition's `name`, `node`, and
`parent` — is a **node index into the binary AST**, and `0` means "no node".
That is the whole trick: nothing has to exist as an object for the analysis to
run.

Two helpers on the manager turn an index back into something readable, and
`jsparse`'s `AstReader` does the rest:

```js
import { AstReader, NODE_KIND_NAMES } from "jsparse";

const scope = scopeManager.scopes[1];

scopeManager.nodeType(scope.block); // "Program"
scopeManager.nodeRange(scope.block); // [0, 26]

const reader = scopeManager.reader; // the AstReader the analysis used

reader.text(variable.identifiers[0]); // "answer"
```

### `analyze(result, options)`

`result` is the value `jsparse`'s `parse()` returned. Every option has a
default, and every default is noted below.

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `sourceType` | `"module"` | `"script"`, `"module"`, or `"commonjs"`. |
| `dialect` | `"ts"` | `"js"` or `"ts"`. See [dialect](#dialect). |
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
const scopeManager = analyze(parse("console.log(x);"), {
	globals: ["console"],
});

scopeManager.globalScope.set.get("console").references.length; // 1
scopeManager.globalScope.through.map(reference => reference.name); // ["x"]
```

`scopeManager.addGlobals(names)` does the same thing after the fact.

## The scope graph

### `ScopeManager`

| Member | Description |
| ------ | ----------- |
| `scopes` | Every scope, in the order they were created. |
| `globalScope` | The outermost scope. |
| `reader` | The `AstReader` the analysis ran over. |
| `acquire(node, inner?)` | The scope a node opened. |
| `acquireAll(node)` | Every scope a node opened. |
| `release(node, inner?)` | The scope enclosing the one a node opened. |
| `getDeclaredVariables(node)` | The variables a node declares. |
| `addGlobals(names)` | Declare globals and resolve what waited for them. |
| `nodeType(node)`, `nodeRange(node)` | Read a node index without a reader. |

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
and `parent` are node indices; `index` and `kind` place a `Variable` definition
within its declaration; `rest` marks a rest parameter.

## Where the two reference implementations disagree

`eslint-scope` wins. There are three places it comes up:

- **A JSX factory reference.** `@typescript-eslint/scope-manager` references
  `React` once per file, by default, on the theory that JSX compiles to a call.
  `eslint-scope` does not, so neither does this by default. Set `jsxPragma` and
  `jsxFragmentName` to get the other behavior.
- **The standard library.** The TypeScript analyzer seeds the global scope with
  every name in whichever `lib` is configured. Nothing is seeded here; pass
  `globals` for the same effect and better control.
- **`export { a }`.** Under `dialect: "ts"` this names both a value and a type,
  which is what TypeScript needs. Under `"js"` it is an ordinary read, which is
  what `eslint-scope` reports.

Beyond those three, the output is identical to whichever implementation covers
the syntax — see below.

## Verified against the reference analyzers

`npm test` is the fast check. What actually proves correctness is the
differential corpus: every `.js`/`.jsx` and `.ts`/`.tsx` file in `node_modules`
is analyzed twice and the two scope graphs are compared in full — every scope,
its type, strictness and extent; every variable, its definitions and its
resolved references; every reference, its mode and what it resolved to; and
every unresolved reference passing through.

```bash
npm run conformance
```

```
files=1424 ok=1424 mismatch=0 threw=0   # vs eslint-scope
files=1185 ok=1185 mismatch=0 threw=0   # vs @typescript-eslint/scope-manager
```

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

Analysis alone, with the parse hoisted out of the measured region — this is the
comparison of the analyzers themselves:

| Suite | jsscope | reference | |
| ----- | ------- | --------- | --- |
| JavaScript | 21.2 MB/s | 14.8 MB/s (`eslint-scope`) | 1.4× |
| TypeScript | 36.1 MB/s | 8.4 MB/s (`@typescript-eslint/scope-manager`) | 4.3× |
| JSX | 35.6 MB/s | 21.3 MB/s (`eslint-scope`) | 1.7× |

Parsing and analysis together, which is what a tool actually asks for:

| Suite | jsparse + jsscope | reference | |
| ----- | ----------------- | --------- | --- |
| JavaScript | 10.2 MB/s | 3.6 MB/s (`espree` + `eslint-scope`) | 2.9× |
| TypeScript | 10.6 MB/s | 0.5 MB/s (`@typescript-eslint/*`) | 20× |

Numbers move a lot with machine temperature, and `jsscope` is more sensitive to
it than the allocation-heavy reference analyzers, so compare ratios within a
single run rather than absolute numbers across runs.

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
