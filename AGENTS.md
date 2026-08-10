# JSParse

A fast, ESLint-compatible parser for the latest JavaScript, TypeScript, and JSX
syntax. TypeScript source, bundled with `esbuild`, tested with `vitest`.

## Code Conventions

When writing JavaScript or TypeScript code, follows the conventions in [`docs/javascript.md`](./docs/javascript.md).

Two things that are easy to miss when matching the surrounding code:

- Source files import each other with `.js` extensions even though they are
  `.ts`. That is required, not a mistake.
- The existing classes use TypeScript's `private` modifier rather than `#`
  fields. New code should follow the style guide, but do not churn existing
  files to match.

## Architecture

The architecture of the parser is in [`docs/architecture.md`](./docs/architecture.md).

Read it before changing the tokenizer, the parser, or either binary format. It
documents the record layouts field by field, the invariants that break subtly
when violated, and a checklist for adding a node kind.

## Commands

```bash
npm test           # vitest, ~240 tests
npm run typecheck  # tsc --noEmit
npm run lint       # builds first, then lints this repo with its own parser
npm run build      # esbuild bundle + .d.ts files
npm run conformance   # differential test against espree and typescript-eslint
npm run bench      # performance comparison
```

**`eslint.config.js` imports `./dist/jsparse.js`,** so linting requires a
build. `npm run lint` does that for you; a bare `npx eslint .` will use a stale
bundle, or fail outright if `dist/` is missing.

The conformance scripts import `dist/` too, and the benchmark prefers it,
falling back to `src/` only under a TypeScript-aware loader. Plain `node`
cannot execute the sources directly, because of those `.js` import specifiers.
Build first.

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

## Conformance is the real test suite

`npm test` is the fast check. The differential corpus is what actually proves
correctness: it parses every `.js`/`.jsx` and `.ts`/`.tsx` file in
`node_modules` and compares the full AST against the reference parser.

```
files=1416 ok=1416 mismatch=0 threw=0   # AST vs espree
ok=1416 bad=0                           # tokens and comments vs espree
files=1137 ok=1137 mismatch=0 threw=0   # AST vs @typescript-eslint/parser
```

**Run it after any change to the parser, tokenizer, or decoder.** Zero
mismatches is the standard; anything else is a regression. Individual scripts
take a directory and a file cap, which is useful while iterating:

```bash
node scripts/conformance-js.mjs node_modules 200
node scripts/conformance-ts.mjs ../some-project/src 500
```

`node_modules` contains no `.jsx` or `.tsx` files, so JSX has no real-world
corpus — it is covered only by `tests/fixtures/jsx.json` and `tsx.json`, which
are checked against both reference parsers. Pointing a conformance script at a
React codebase is the way to close that gap.

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

## Benchmarking

The numbers move a lot with machine temperature, and `jsparse` is more
sensitive to it than the allocation-heavy reference parsers, so a hot machine
does not just add noise — it changes the ratio.

- Each suite already runs in its own child process, so a heap left behind by
  loading TypeScript cannot skew the next one.
- Compare ratios within a single suite, not absolute numbers across runs.
- Run one suite alone when comparing two things:
  `node benchmarks/benchmark.js --suite=eslint`.
- For a before/after on a code change, build both versions and alternate them
  **in one process**. Sequential runs on this machine drift far enough to
  invert a real result.
- The TypeScript 7 row self-reports as skipped. That is expected:
  `@typescript-eslint/parser` does not accept TypeScript 7 yet.

## Notes

- This directory is not a git repository, so there is no history to consult and
  no way to diff against a previous state. Save a copy before a large
  refactor.
- ESLint's `no-undef` and `no-unused-vars` are turned off for `**/*.ts` in
  `eslint.config.js`. They only understand values, so on TypeScript they report
  every type name as undefined. This is the same thing `typescript-eslint`
  does; do not try to "fix" the parser to satisfy them.
