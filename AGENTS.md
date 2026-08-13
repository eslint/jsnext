# jsparse

An npm workspace holding a fast, ESLint-compatible toolchain for the latest
JavaScript, TypeScript, and JSX syntax. TypeScript source, bundled with
`esbuild`, tested with `vitest`.

| Package | Name | What it does |
| ------- | ---- | ------------ |
| `packages/jsparse` | `@eslint/jsparse` | Parser. Source text in, binary AST and token buffers out, ESTree on request. |
| `packages/jsscope` | `@eslint/jsscope` | Scope analyzer. Reproduces `eslint-scope` and `@typescript-eslint/scope-manager`. |

`jsscope` depends on `jsparse`, so **`jsparse` must be built before anything in
`jsscope` runs**. Its own scripts take care of that; a bare `npx vitest` inside
`packages/jsscope` will use a stale `dist/` or fail outright.

`jsscope` has **two entry points over one walk**: `analyze()` reads the binary
buffers and `analyzeTree()` reads an ordinary ESTree tree. Neither is a
separate implementation — the walk goes through the `AstAccess` interface and
each representation supplies an adapter. A change to scope semantics belongs in
`referencer.ts` and lands on both; a change to how a node is *read* belongs in
`binary-ast.ts` or `estree-ast.ts` and must be made in both, answering the same
question the same way.

Two consequences worth knowing before you touch it:

- **A new node kind needs an entry in `slot-names.ts`.** Miss it and the binary
  path keeps working while the tree path silently stops descending into that
  node. The conformance run catches it; nothing else will.
- **The entry points are tree-shakeable, and that is tested.** Module-level
  side effects in `slot-names.ts` or `estree-ast.ts` break it, which is why
  both build their tables in a function called as a `/* @__PURE__ */`
  expression.

## Code Conventions

When writing JavaScript or TypeScript code, follow the conventions in
[`docs/javascript.md`](./docs/javascript.md).

Two things that are easy to miss when matching the surrounding code:

- Source files import each other with `.js` extensions even though they are
  `.ts`. That is required, not a mistake.
- The existing classes in `packages/jsparse` use TypeScript's `private`
  modifier rather than `#` fields. New code should follow the style guide, but
  do not churn existing files to match.
  
## Performance

This project is meant to be highly-performant. When writing code, follow the guidelines in [`performance.md`](./docs/performance.md).

## Architecture

Each package has its own technical specification, and all are worth reading
before changing anything in them:

- [`packages/jsparse/docs/architecture.md`](./packages/jsparse/docs/architecture.md)
  documents the tokenizer, the parser, and both binary formats field by field,
  the invariants that break subtly when violated, and a checklist for adding a
  node kind.
- [`packages/jsparse/docs/types.md`](./packages/jsparse/docs/types.md) documents
  `src/ast-types.ts` — the hand-written ESTree declarations `toAST()` returns.
  **Read it before reaching for `@types/estree` or `@typescript-eslint/types`:**
  both were evaluated and rejected for reasons that are not obvious, and the
  file records what is machine-checked, what is not, and why.
- [`packages/jsscope/docs/architecture.md`](./packages/jsscope/docs/architecture.md)
  documents the walk, resolution, and the rule for reconciling the two scope
  analyzers it reproduces.
- [`docs/deviations.md`](./docs/deviations.md) lists every place the output is
  deliberately not what a reference implementation produces, and why. Anything
  not in it is a bug.

[`packages/jsparse/scripts/README.md`](./packages/jsparse/scripts/README.md)
covers the six scripts behind `npm run conformance` and how they divide the
work.

Task-specific procedures live in [`.agents/skills/`](./.agents/skills), which
`.claude/skills` symlinks to. Adding an AST node kind is one of them —
[`.agents/skills/add-node-type/`](./.agents/skills/add-node-type/SKILL.md) has
the seven registration sites and a driver that checks all of them and then runs
the node through both packages.

## Commands

Run from the repository root; every one delegates to the workspaces, and any of
them takes `--workspace=@eslint/jsparse` or `--workspace=@eslint/jsscope` to
narrow it.

```bash
npm test           # vitest, ~1350 tests
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
  syntax under `dialect: "js"`, JSX without `jsx: true`, a mismatched JSX
  closing tag.

So `sourceType`, `dialect`, and `jsx` are options of phase 2, never phase 1.
When adding a new diagnostic, decide which side of that line it falls on first.
A check that needs to know the source type, the dialect, or whether JSX is
enabled belongs in `validate.ts`, even if a reference parser throws for it.

`jsscope` sits alongside phases 2 and 3 rather than after them: it reads the
same buffers `parse()` produced and needs neither the validation problems nor
the ESTree tree.

## Two kinds of test, told apart by their extension

`npm test` runs both kinds in one pass. Which one you are writing decides where
the file goes and what it is allowed to import.

| Kind | Name | Lives | Imports |
| ---- | ---- | ----- | ------- |
| Unit | `*.spec.ts` | `src/`, beside the module it covers | that one module |
| Integration | `*.test.ts` | `tests/` | the package's public entry points |

A **unit test** pins down one module's own behavior: the classification tables
in `chars.ts`, the escape decoding in `values.ts`, the buffer layouts in
`binary.ts`, what `resolveOptions()` fills in. It imports the module under test
directly, so `entities.spec.ts` sits next to `entities.ts` and imports
`./entities.js`. Reach for one when a function has edge cases that are tedious
to provoke through a whole parse.

An **integration test** goes through `parse()`, `toAST()`, `validate()`, or
`analyze()` and checks what a consumer would see. The conformance suites are
integration tests, and so is anything that needs a real AST.

Two mechanical consequences of putting unit tests inside `src/`:

- `tsconfig.build.json` excludes `src/**/*.spec.ts`, so no `.spec.d.ts` lands
  in `dist/`. `tsconfig.json` does *not* exclude them, which is what
  typechecks them.
- `vitest.config.ts` lists both globs. A `.spec.ts` file under `tests/`, or a
  `.test.ts` file under `src/`, is simply never run.

## Conformance is the real test suite

`npm test` is the fast check. The differential corpus is what actually proves
correctness: it runs every `.js`/`.jsx` and `.ts`/`.tsx` file in `node_modules`
through both packages and compares the result against the implementation each
one replaces.

```
files=1433 ok=1433 mismatch=0 threw=0   # jsparse AST vs espree
ok=1433 bad=0                           # jsparse tokens and comments vs espree
files=1232 ok=1232 mismatch=0 threw=0   # jsparse AST vs @typescript-eslint/parser

problems=0 unseen=0                     # ast-types.ts vs the decoder's output
identical=159 differ=0                  # ast-types.ts vs the fill() switch

binary files=1433 ok=1433 mismatch=0 threw=0   # jsscope vs eslint-scope
tree   files=1433 ok=1433 mismatch=0 threw=0
binary files=1232 ok=1232 mismatch=0 threw=0   # jsscope vs @typescript-eslint/scope-manager
tree   files=1232 ok=1232 mismatch=0 threw=0
```

`jsscope` is checked twice per file, once through each entry point. The tree
run is the more direct of the two: `analyzeTree()` is handed the very tree
object the reference analyzer was given, so a difference can only be a
difference between the analyzers.

**Run it after any change to a parser, tokenizer, decoder, or the scope walk.**
Zero mismatches is the standard; anything else is a regression. Individual
scripts take a directory and a file cap, which is useful while iterating:

The directory is resolved against the working directory, so run these from the
package they belong to:

```bash
cd packages/jsparse && node scripts/conformance-js.mjs ../../node_modules 200
cd packages/jsscope && node scripts/conformance-ts.mjs ../some-project/src 500
```

Note that `node_modules/@eslint/jsparse` and `node_modules/@eslint/jsscope` are
workspace symlinks, so the corpus includes this repository's own source. That
is deliberate: it is the only TypeScript in reach that uses recent syntax
heavily.

`node_modules` contains no `.jsx` or `.tsx` files, so JSX has no real-world
corpus — it is covered only by the `jsx.json` and `tsx.json` fixtures in each
package, which are checked against both reference implementations. Pointing a
conformance script at a React codebase is the way to close that gap.

The fixture files in `packages/jsparse/tests/fixtures/` are the other half of
that story: a list of source strings, each parsed and compared against the
reference parser. They exist to reach the syntax the corpus does not, so they
are derived from what `espree` and `@typescript-eslint/parser` test, from the
examples in the TypeScript Handbook, and from TypeScript's own conformance
suite, rather than from what real code happens to contain. The handbook is
worth revisiting when a new language version ships: its examples are chosen to
demonstrate one construct each, which is exactly what a fixture wants to be.

**The highest-yield corpus is TypeScript's own `tests/cases/`**, which
`node_modules` does not contain. It is worth checking out and pointing the
script at whenever the parser changes shape:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/TypeScript
cd TypeScript && git sparse-checkout set tests/cases
cd packages/jsparse && node scripts/conformance-ts.mjs <path>/tests/cases/conformance 20000
```

Two things to know before reading its output. Most of the suite is **negative
tests**, and `@typescript-eslint/parser` recovers from a syntax error where
this parser throws, so a `THROW` line is only a bug when the input is valid —
check the file before chasing one. And the script skips a file entirely when
the reference parser throws, so `files=` is far larger than the number actually
compared. `javascript.json` and `jsx.json` are
checked against `espree`; `typescript.json` and `tsx.json` against
`@typescript-eslint/parser`; `jsx.json` against both. **A candidate belongs
here only if the reference parser accepts it**, since the test asserts the two
agree, and one that both accept but that they disagree about is a bug to fix
rather than a fixture to add.

## Output contracts

These are verified by the corpus and by tests, so breaking one shows up
immediately, but knowing them up front saves a debugging cycle. Every
deliberate departure from a reference implementation is listed in
[`docs/deviations.md`](./docs/deviations.md) with the reason for it. **A
difference that is not in that file is a bug**, so read it before you either
add to it or "fix" an output to match a reference.

- JavaScript output must match `espree` with `ecmaVersion: "latest"` exactly,
  apart from the one entry `docs/deviations.md` records against it.
- TypeScript output must match `@typescript-eslint/parser` exactly, except that
  a property it leaves `undefined` — or omits entirely — is `null` here, and
  that a `Program`'s extent follows `espree` in both dialects rather than
  running to the end of the source.
- **`toAST()` nodes carry `start` and `end` but never `range` or `loc`.** Only
  the ESLint parser object adds those, because ESLint refuses an AST without
  them. There is a test pinning this.
- In `dialect: "js"` mode the TypeScript-only properties are omitted entirely,
  not set to `null`.
- Those three facts are also the contract `src/ast-types.ts` encodes, which is
  why `start` and `end` are required there while `range`, `loc`, and every
  TypeScript-only property are optional. See
  [`docs/types.md`](./packages/jsparse/docs/types.md) before changing any of
  them.
- `jsscope` reproduces `eslint-scope` for JavaScript and JSX and
  `@typescript-eslint/scope-manager` for TypeScript. **Where the two disagree,
  `eslint-scope` wins.** The three disagreements that survive as options —
  `jsxPragma`, `jsxFragmentName`, and the TypeScript standard library — all
  default to the `eslint-scope` answer, and are written up in
  [`docs/deviations.md`](./docs/deviations.md).
- `jsscope`'s two entry points must produce the same graph for the same
  program, and `null` is the only spelling of "no node" above the accessor
  layer, whichever representation is underneath.

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
