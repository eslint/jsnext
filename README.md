# jskit

A fast, ESLint-compatible toolchain for the latest JavaScript, TypeScript, and
JSX syntax.

This repository is an npm workspace holding two packages:

| Package | What it does |
| ------- | ------------ |
| [`packages/jskit`](./packages/jskit) (`@eslint/jskit`) | The toolkit: a parser, a scope analyzer, and a control flow analyzer that share one binary representation of a program. |
| [`packages/jsinspect`](./packages/jsinspect) (`@eslint/jsinspect`) | A web app that runs all three in the browser: code on the left, AST, scopes, and flow graph in tabs on the right. |

The reason the three analyses are one package is the buffer between them.
`parse()` hands back an `ArrayBuffer` rather than an object tree, and both
`analyze()` and `createGraph()` run their whole analysis against those buffers
without ever materializing a node. Parsing and scope analysis together run
about **2.9× faster than `espree` + `eslint-scope`** and **20× faster than the
`@typescript-eslint` pair**.

```js
import { parse, toAST, analyze, createGraph } from "@eslint/jskit";

const result = parse(`const answer: number = 42; answer;`);

// Scope analysis reads the binary buffers directly.
const scope = analyze(result, { sourceType: "module", dialect: "ts" });

// So does control flow analysis, over both buffers.
const flow = createGraph(result, scope);

// An ESTree AST is built only if something asks for one.
const { ast, errors } = toAST(result, { sourceType: "module", dialect: "ts" });
```

Scope analysis also works on an AST it did not produce, for compatibility with
the parsers already in use. Same walk, same results, no binary format involved:

```js
import * as espree from "espree";
import { analyzeTree } from "@eslint/jskit";

const tree = espree.parse(code, { ecmaVersion: "latest", range: true });
const scopes = analyzeTree(tree, { dialect: "js" });
```

The package is `sideEffects: false` and the three analyses reference each other
only through the functions that need them, so a consumer who imports one does
not ship the others.

- [`packages/jskit/README.md`](./packages/jskit/README.md) — the toolkit, all
  three analyses
- [`packages/jskit/docs/`](./packages/jskit/docs) — the detailed documentation,
  split into `parse/`, `scope/`, and `flow/`
- [`docs/deviations.md`](./docs/deviations.md) — every deliberate difference
  from a reference implementation

## Development

```bash
npm install

npm test           # every package's unit and integration tests
npm run typecheck  # tsc --noEmit everywhere
npm run build      # esbuild bundles + .d.ts files
npm run lint       # builds first, then lints this repo with its own parser
npm run conformance   # differential tests against every reference implementation
npm run bench      # performance comparisons
```

Every script delegates to the workspaces, so any of them can be run for one
package with `npm run <script> --workspace=@eslint/jskit`.

`eslint.config.js` lints this repository with the toolkit's own parser, which
is why `npm run lint` builds first.

## Conformance is the real test suite

`npm test` is the fast check. What actually proves correctness is the
differential corpus: every JavaScript and TypeScript file in `node_modules` is
run through the parser and the scope analyzer and compared against the
implementations they replace.

```
files=… ok=… mismatch=0 threw=0   # AST vs espree
ok=… bad=0                        # tokens and comments vs espree
files=… ok=… mismatch=0 threw=0   # AST vs @typescript-eslint/parser

binary files=… ok=… mismatch=0 threw=0   # scopes vs eslint-scope
tree   files=… ok=… mismatch=0 threw=0
binary files=… ok=… mismatch=0 threw=0   # scopes vs @typescript-eslint/scope-manager
tree   files=… ok=… mismatch=0 threw=0
```

Scope analysis is checked twice per file, once through each entry point.
Control flow analysis has no differential suite, because there is no reference
implementation to diff against; its integration tests are the contract.

Zero mismatches is the standard; anything else is a regression.
[`packages/jskit/scripts/README.md`](./packages/jskit/scripts/README.md)
explains what each script covers.

## License

Apache-2.0
