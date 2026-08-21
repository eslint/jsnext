# @eslint/jskit

A fast, ESLint-compatible toolkit for the latest JavaScript, TypeScript, and
JSX syntax: a parser, a scope analyzer, and a control flow analyzer that all
speak the same binary representation of a program.

```bash
npm install @eslint/jskit
```

Three analyses ship in one package, in the order a tool uses them:

| Analysis  | Entry points                       | What it produces                                                                                                                      |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Parse** | `parse()`, `validate()`, `toAST()` | One `ArrayBuffer` holding a binary AST, a binary token stream, and every line offset — plus an ESTree tree on request.                |
| **Scope** | `analyze()`, `analyzeTree()`       | One `ArrayBuffer` of scopes, symbols, references, and definitions, reproducing `eslint-scope` and `@typescript-eslint/scope-manager`. |
| **Flow**  | `createGraph()`                    | One `ArrayBuffer` holding a basic-block control flow graph for every execution unit in the program.                                   |

The buffer between them is the reason they are one package. Nothing allocates a
JavaScript object per node until something actually asks for one, so scope
analysis and flow analysis run against the parser's output without ever
materializing a tree.

There are no version options. The latest JavaScript, TypeScript, and JSX syntax
is accepted, always.

## Linting with it

If all you want is to lint, none of the above is needed — `eslintParser` is a
ready-made parser object, and the dialect, JSX, and declaration-file settings
come from the file name:

```js
// eslint.config.js
import { eslintParser } from "@eslint/jskit";

export default [
	{
		files: ["**/*.js", "**/*.ts", "**/*.tsx"],
		languageOptions: { parser: eslintParser },
	},
];
```

ESLint gets the scope graph from it too, through `parseForESLint()`, so scope
analysis understands TypeScript rather than walking past every type annotation
the way `eslint-scope` does.

See [`docs/parse/api.md`](./docs/parse/api.md#using-it-with-eslint) for what it
returns and for the five ways the tree differs from calling `toAST()` yourself,
each because ESLint requires it.

## Parsing

Parsing is split into three phases, and the split is what makes the fast path
fast. `parse()` throws only for text that cannot be tokenized or shaped into a
tree; everything that is merely _not allowed here_ is reported by `validate()`;
`toAST()` materializes ESTree objects for the tools that need them.

```js
import { parse, validate, toAST, AstReader } from "@eslint/jskit";

const result = parse(`const greeting: string = "hello";`);

// Phase 1 output: one ArrayBuffer. Read it directly, if that is all you need.
new AstReader(result).nodeCount;

// Phase 2: the context-dependent checks.
validate(result, { sourceType: "module", dialect: "ts" }); // => []
validate(result, { dialect: "js" }); // => [{ message: "TypeScript syntax ..." }]

// Phase 3: validation plus an ESTree tree.
const { ast, errors } = toAST(result, { sourceType: "module", dialect: "ts" });

ast.body[0].declarations[0].id.typeAnnotation.type; // "TSTypeAnnotation"
```

JavaScript output matches [`espree`](https://github.com/eslint/espree) with
`ecmaVersion: "latest"`, and TypeScript output matches
[`@typescript-eslint/parser`](https://typescript-eslint.io/), except that a
property those parsers leave `undefined` is `null` here.

**More:** [`docs/parse/api.md`](./docs/parse/api.md) covers every option, the
`ParseError` shape, JSX, the ESLint parser object, and reading the binary
buffer directly.

## Scope analysis

Scope analysis answers the question every lint rule about variables has to ask:
_which declaration does this identifier refer to?_ There are two ways in and
they share one implementation — `analyze()` reads the parse buffer, and
`analyzeTree()` reads an ordinary ESTree tree from any ESLint-compatible
parser.

```js
import { parse, analyze, toScopeManager } from "@eslint/jskit";

const result = parse("const answer = 42; answer;");
const scopes = analyze(result, { sourceType: "module" });
const scopeManager = toScopeManager(scopes, result);

scopeManager.scopes[1].variables[0].references.length; // 2
```

Both entry points return the same binary scope buffer, and three consumers read
it: `toScopeManager()` for the escope-compatible object graph, `Scopes` for
point queries straight off the buffer, and `toScopeTree()` for a
JSON-serializable debugging view.

**More:** [`docs/scope/api.md`](./docs/scope/api.md) covers both entry points,
all three consumers, every option, the shape of the scope graph, and the three
places the two reference analyzers disagree.

## Control flow

`createGraph()` builds a basic-block control flow graph for every execution
unit in a program — the program itself, each function, each class field
initializer, each static block. Blocks record the variable writes they perform,
in execution order and tied to the scope analysis; edges record the branch
condition that was taken.

```js
import { parse, analyze, createGraph, FlowBufferReader } from "@eslint/jskit";

const parsed = parse(sourceText);
const scope = analyze(parsed);
const flow = createGraph(parsed, scope);

const reader = new FlowBufferReader(flow);

reader.isReachable(handle); // can control get here?
reader.blockOfNode(handle); // which basic block runs this node?
```

The scope buffer must come from `analyze()` over the same parse result: both
buffers name nodes by the same byte offsets, which is also how a write is tied
to its scope reference, so a buffer from `analyzeTree()` is refused.

**More:** [`docs/flow/api.md`](./docs/flow/api.md).

## Tree shaking

The package is marked `sideEffects: false` and the three analyses reference
each other only through the functions that need them, so a bundler ships what
you import and nothing else. A tree-only scope bundle contains neither the
binary reader nor the parser; a binary-only bundle contains neither the tree
adapter nor the slot-name table it needs.
[`tests/scope/tree-shaking.test.ts`](./tests/scope/tree-shaking.test.ts)
bundles each entry point and checks exactly that, so the property cannot
quietly break.

## Documentation

| Document                                                           | Covers                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/parse/api.md`](./docs/parse/api.md)                         | The three parse phases, their options, errors, JSX, ESLint integration, and reading the buffer.                                 |
| [`docs/parse/performance.md`](./docs/parse/performance.md)         | How the parser compares to `espree`, `acorn`, `meriyah`, Babel, and `@typescript-eslint/parser`, and how to read the benchmark. |
| [`docs/parse/architecture.md`](./docs/parse/architecture.md)       | The tokenizer, the parser, and both binary formats field by field.                                                              |
| [`docs/parse/embedded-source.md`](./docs/parse/embedded-source.md) | The `embedSource` option and why the buffer does not carry the text by default.                                                 |
| [`docs/parse/types.md`](./docs/parse/types.md)                     | The hand-written ESTree declarations `toAST()` returns.                                                                         |
| [`docs/scope/api.md`](./docs/scope/api.md)                         | Both entry points, the three consumers, options, and the scope graph.                                                           |
| [`docs/scope/performance.md`](./docs/scope/performance.md)         | How the analyzer compares to `eslint-scope` and `@typescript-eslint/scope-manager`.                                             |
| [`docs/scope/architecture.md`](./docs/scope/architecture.md)       | The walk, resolution, and the rule for reconciling the two analyzers it reproduces.                                             |
| [`docs/flow/api.md`](./docs/flow/api.md)                           | `createGraph()`, the reader, and the JSON view.                                                                                 |
| [`docs/flow/architecture.md`](./docs/flow/architecture.md)         | The flow format and the four places it trades precision for simplicity.                                                         |
| [`../../docs/deviations.md`](../../docs/deviations.md)             | Every place the output deliberately differs from a reference implementation.                                                    |

Each analysis also has a `requirements.md` beside its architecture document,
recording what it was built to do.

## Development

```bash
npm test                  # vitest: unit tests in src/, integration tests in tests/
npm run test:conformance  # differential tests against every reference implementation
npm run test:performance  # performance comparisons
npm run test:watch        # vitest in watch mode
npm run lint:types        # tsc --noEmit
npm run build             # esbuild bundle + .d.ts files
```

`npm test` is the fast check. What actually proves correctness is the
differential corpus: every JavaScript and TypeScript file in `node_modules` is
run through all three analyses and compared against the implementation each one
replaces. [`scripts/README.md`](./scripts/README.md) explains what each script
covers and how to point one at a corpus of your own.

## License

Apache-2.0
