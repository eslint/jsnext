# jsparse

A fast, ESLint-compatible toolchain for the latest JavaScript, TypeScript, and
JSX syntax.

This repository is an npm workspace holding two packages that share one binary
representation of a program:

| Package | What it does |
| ------- | ------------ |
| [`packages/jsparse`](./packages/jsparse) (`@eslint/jsparse`) | Parses source text into a binary AST and token stream, validates it, and materializes an ESTree AST on request. Drops into `languageOptions.parser`. |
| [`packages/jsscope`](./packages/jsscope) (`@eslint/jsscope`) | Finds the scopes in a program and resolves every identifier, reproducing `eslint-scope` and `@typescript-eslint/scope-manager`. |

The reason they are one repository is the buffer between them. `jsparse` hands
back two `ArrayBuffer`s rather than an object tree, and `jsscope` can run its
whole analysis against those buffers without ever materializing a node. Parsing
and scope analysis together run about **2.9× faster than `espree` +
`eslint-scope`** and **20× faster than the `@typescript-eslint` pair**.

```js
import { parse, toAST } from "@eslint/jsparse";
import { analyze } from "@eslint/jsscope";

const result = parse(`const answer: number = 42; answer;`);

// Scope analysis reads the binary buffers directly.
const scopeManager = analyze(result, { sourceType: "module", dialect: "ts" });

scopeManager.scopes[1].variables[0].references.length; // 2

// An ESTree AST is built only if something asks for one.
const { ast, errors } = toAST(result, { sourceType: "module", dialect: "ts" });
```

`jsscope` also works on an AST it did not produce, for compatibility with the
parsers already in use. Same walk, same results, no binary format involved:

```js
import * as espree from "espree";
import { analyzeTree } from "@eslint/jsscope";

const tree = espree.parse(code, { ecmaVersion: "latest", range: true });
const scopeManager = analyzeTree(tree, { dialect: "js" });
```

The two entry points are tree-shakeable, so a consumer who imports one does not
ship the other.

Each package has its own README and its own technical specification:

- [`packages/jsparse/README.md`](./packages/jsparse/README.md) ·
  [architecture](./packages/jsparse/docs/architecture.md)
- [`packages/jsscope/README.md`](./packages/jsscope/README.md) ·
  [architecture](./packages/jsscope/docs/architecture.md)

## Development

```bash
npm install

npm test           # every package's unit tests
npm run typecheck  # tsc --noEmit everywhere
npm run build      # esbuild bundles + .d.ts files
npm run lint       # builds first, then lints this repo with its own parser
npm run conformance   # differential tests against every reference implementation
npm run bench      # performance comparisons
```

Every script delegates to the workspaces, so any of them can be run for one
package with `npm run <script> --workspace=jsparse`.

`eslint.config.js` lints this repository with `jsparse` itself, which is why
`npm run lint` builds first.

## Conformance is the real test suite

`npm test` is the fast check. What actually proves correctness is the
differential corpus: every JavaScript and TypeScript file in `node_modules` is
run through both packages and compared against the implementations they
replace.

```
files=1431 ok=1431 mismatch=0 threw=0   # jsparse AST vs espree
ok=1431 bad=0                           # jsparse tokens and comments vs espree
files=1219 ok=1219 mismatch=0 threw=0   # jsparse AST vs @typescript-eslint/parser

binary files=1431 ok=1431 mismatch=0 threw=0   # jsscope vs eslint-scope
tree   files=1431 ok=1431 mismatch=0 threw=0
binary files=1219 ok=1219 mismatch=0 threw=0   # jsscope vs @typescript-eslint/scope-manager
tree   files=1219 ok=1219 mismatch=0 threw=0
```

`jsscope` is checked twice per file, once through each entry point.

Zero mismatches is the standard; anything else is a regression.

## License

Apache-2.0
