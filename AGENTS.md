# jsparse

An npm workspace holding a fast, ESLint-compatible toolchain for the latest
JavaScript, TypeScript, and JSX syntax. TypeScript source, bundled with
`esbuild`, tested with `vitest`.

| Package | What it does |
| ------- | ------------ |
| `packages/jsparse` | Parser. Source text in, binary AST and token buffers out, ESTree on request. |
| `packages/jsscope` | Scope analyzer. Runs on `jsparse`'s binary buffers, reproduces `eslint-scope` and `@typescript-eslint/scope-manager`. |

`jsscope` depends on `jsparse`, so **`jsparse` must be built before anything in
`jsscope` runs**. Its own scripts take care of that; a bare `npx vitest` inside
`packages/jsscope` will use a stale `dist/` or fail outright.

## Code Conventions

When writing JavaScript or TypeScript code, follow the conventions in
[`docs/javascript.md`](./docs/javascript.md).

Two things that are easy to miss when matching the surrounding code:

- Source files import each other with `.js` extensions even though they are
  `.ts`. That is required, not a mistake.
- The existing classes in `packages/jsparse` use TypeScript's `private`
  modifier rather than `#` fields. New code should follow the style guide, but
  do not churn existing files to match.

## Architecture

Each package has its own technical specification, and both are worth reading
before changing anything in them:

- [`packages/jsparse/docs/architecture.md`](./packages/jsparse/docs/architecture.md)
  documents the tokenizer, the parser, and both binary formats field by field,
  the invariants that break subtly when violated, and a checklist for adding a
  node kind.
- [`packages/jsscope/docs/architecture.md`](./packages/jsscope/docs/architecture.md)
  documents the walk, resolution, and the rule for reconciling the two scope
  analyzers it reproduces.

## Commands

Run from the repository root; every one delegates to the workspaces, and any of
them takes `--workspace=jsparse` or `--workspace=jsscope` to narrow it.

```bash
npm test           # vitest, ~460 tests
npm run typecheck  # tsc --noEmit
npm run lint       # builds first, then lints this repo with its own parser
npm run build      # esbuild bundles + .d.ts files
npm run conformance   # differential tests against every reference implementation
npm run bench      # performance comparisons
```

**`eslint.config.js` imports `./packages/jsparse/dist/jsparse.js`,** so linting
requires a build. `npm run lint` does that for you; a bare `npx eslint .` will
use a stale bundle, or fail outright if `dist/` is missing.

The conformance scripts and benchmarks import `dist/` too. Plain `node` cannot
execute the sources directly, because of those `.js` import specifiers. Build
first.

## The rule that decides where code goes

Parsing is split into three phases, and the dividing line is **whether the
answer depends on context the text alone does not supply**.

- `parse()` throws only when the text cannot be tokenized, or the tokens cannot
  be shaped into a tree. It accepts the union of everything JavaScript and
  TypeScript allow.
- `validate()` reports everything that is merely *not allowed here*: strict
  mode violations, redeclarations, `return` outside a function, TypeScript
  syntax under `dialect: "js"`, a mismatched JSX closing tag.

So `sourceType` and `dialect` are options of phase 2, never phase 1. When
adding a new diagnostic, decide which side of that line it falls on first. A
check that needs to know the source type or dialect belongs in `validate.ts`,
even if a reference parser throws for it.

`jsscope` sits alongside phases 2 and 3 rather than after them: it reads the
same buffers `parse()` produced and needs neither the validation problems nor
the ESTree tree.

## Conformance is the real test suite

`npm test` is the fast check. The differential corpus is what actually proves
correctness: it runs every `.js`/`.jsx` and `.ts`/`.tsx` file in `node_modules`
through both packages and compares the result against the implementation each
one replaces.

```
files=1424 ok=1424 mismatch=0 threw=0   # jsparse AST vs espree
ok=1424 bad=0                           # jsparse tokens and comments vs espree
files=1185 ok=1185 mismatch=0 threw=0   # jsparse AST vs @typescript-eslint/parser
files=1424 ok=1424 mismatch=0 threw=0   # jsscope vs eslint-scope
files=1185 ok=1185 mismatch=0 threw=0   # jsscope vs @typescript-eslint/scope-manager
```

**Run it after any change to a parser, tokenizer, decoder, or the scope walk.**
Zero mismatches is the standard; anything else is a regression. Individual
scripts take a directory and a file cap, which is useful while iterating:

```bash
node packages/jsparse/scripts/conformance-js.mjs ../../node_modules 200
node packages/jsscope/scripts/conformance-ts.mjs ../some-project/src 500
```

Note that `node_modules/jsparse` and `node_modules/jsscope` are workspace
symlinks, so the corpus includes this repository's own source. That is
deliberate: it is the only TypeScript in reach that uses recent syntax
heavily.

`node_modules` contains no `.jsx` or `.tsx` files, so JSX has no real-world
corpus — it is covered only by the `jsx.json` and `tsx.json` fixtures in each
package, which are checked against both reference implementations. Pointing a
conformance script at a React codebase is the way to close that gap.

## Output contracts

These are verified by the corpus and by tests, so breaking one shows up
immediately, but knowing them up front saves a debugging cycle:

- JavaScript output must match `espree` with `ecmaVersion: "latest"` exactly.
- TypeScript output must match `@typescript-eslint/parser` exactly, except that
  properties it leaves `undefined` are `null` here.
- **`toAST()` nodes carry `start` and `end` but never `range` or `loc`.** Only
  the ESLint parser object adds those, because ESLint refuses an AST without
  them. There is a test pinning this.
- In `dialect: "js"` mode the TypeScript-only properties are omitted entirely,
  not set to `null`.
- `jsscope` reproduces `eslint-scope` for JavaScript and JSX and
  `@typescript-eslint/scope-manager` for TypeScript. **Where the two disagree,
  `eslint-scope` wins.** The three disagreements that survive as options —
  `jsxPragma`, `jsxFragmentName`, and the TypeScript standard library — all
  default to the `eslint-scope` answer.

## Benchmarking

The numbers move a lot with machine temperature, and both packages are more
sensitive to it than the allocation-heavy reference implementations, so a hot
machine does not just add noise — it changes the ratio.

- Each suite already runs in its own child process, so a heap left behind by
  loading TypeScript cannot skew the next one.
- Compare ratios within a single suite, not absolute numbers across runs.
- Run one suite alone when comparing two things:
  `node benchmarks/benchmark.js --suite=eslint`.
- For a before/after on a code change, build both versions and alternate them
  **in one process**. Sequential runs on this machine drift far enough to
  invert a real result.
- The TypeScript 7 row in the parser benchmark self-reports as skipped. That is
  expected: `@typescript-eslint/parser` does not accept TypeScript 7 yet.

## Notes

- ESLint's `no-undef` and `no-unused-vars` are turned off for `**/*.ts` in
  `eslint.config.js`. They only understand values, so on TypeScript they report
  every type name as undefined. This is the same thing `typescript-eslint`
  does; do not try to "fix" the parser to satisfy them.
