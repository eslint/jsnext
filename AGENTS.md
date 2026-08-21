# jskit

An npm workspace holding a fast, ESLint-compatible toolchain for the latest
JavaScript, TypeScript, and JSX syntax. TypeScript source, bundled with
`esbuild`, tested with `vitest`.

| Package                  | Name                    | What it does                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/jskit`         | `@eslint/jskit`         | The toolkit: parser, scope analyzer, and control flow analyzer, in one package with one entry point.                                                                                                                                                                             |
| `packages/jskit-inspect` | `@eslint/jskit-inspect` | Web app (Astro + React) that runs all three in the browser: code in a left-hand editor, AST/scope/flow trees in tabs on the right, with the flow tab offering a Mermaid diagram of one chosen execution unit. Its `dev`/`build`/`typecheck` scripts build `@eslint/jskit` first. |

**The three analyses are directories, not packages.** `parse`, `scope`, and
`flow` split the source, the tests, the documentation, the scripts, and the
benchmarks alike:

```
packages/jskit/
  src/index.ts        the public surface: export * from all three
  src/parse/          tokenizer, parser, validator, ESTree decoder
  src/scope/          the scope walk and the binary scope format
  src/flow/           the control flow walk and the binary flow format
  tests/{parse,scope,flow}/       integration tests, *.test.ts
  docs/{parse,scope,flow}/        api.md, architecture.md, requirements.md
  scripts/{parse,scope}/          the differential conformance runs
  benchmarks/{parse,scope}/       the performance comparisons
```

Everything ships from `src/index.ts` as one bundle, `dist/jskit.js`. Within
`src/`, `scope/` imports `../parse/index.js` and `flow/` imports both — always
through the sub-index, never a module inside another directory. The package is
`sideEffects: false`, so importing one analysis still leaves the others behind;
`tests/scope/tree-shaking.test.ts` proves it against the built bundle.

**The two buffer formats describe their headers with the same field names**, so
the scope one is prefixed `SCOPE_H_*`/`SCOPE_HEADER_WORDS` and the flow one
`FLOW_H_*`/`FLOW_HEADER_WORDS`. They are the only names the three surfaces
would otherwise collide on, and `export *` would silently drop a collision
rather than report it — so if you add a constant to one format, check the other
two for the name first. `npm run typecheck` catches what slips through.

`flow`'s `createGraph()` reads the two binary buffers directly and returns
a binary control flow graph; `toGraphTree()` is its JSON debugging view and
`FlowBufferReader` its point-query reader. It stores byte offsets into both
input buffers, which is why it accepts scope buffers only from `analyze()`,
never `analyzeTree()`, and why `scope/scope-buffer.ts`'s layout constants are
exported. The format is specified in
[`packages/jskit/docs/flow/architecture.md`](./packages/jskit/docs/flow/architecture.md),
along with the four places it deliberately trades precision for simplicity.
It has no differential conformance suite — there is no reference
implementation to diff against — so its integration tests in
`packages/jskit/tests/flow/` are the contract.

`scope` has **two entry points over one walk**: `analyze()` reads the binary
buffers and `analyzeTree()` reads an ordinary ESTree tree. Neither is a
separate implementation — the walk goes through the `AstAccess` interface and
each representation supplies an adapter. Both return an `ArrayBuffer` in the
binary scope format; the escope-compatible object graph comes back through
`toScopeManager(buffer, program)`, point queries through `Scopes`, and a JSON
debugging view through `toScopeTree()`. The format is specified in
[`packages/jskit/docs/scope/architecture.md`](./packages/jskit/docs/scope/architecture.md).
A change to the walk's decisions belongs
in `referencer.ts`, a change to binding/resolution semantics in
`scope-builder.ts`, and either lands on both representations; a change to how
a node is _read_ belongs in `binary-ast.ts` or `estree-ast.ts` and must be
made in both, answering the same question the same way.

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
- The existing classes in `src/parse/` use TypeScript's `private`
  modifier rather than `#` fields. New code should follow the style guide, but
  do not churn existing files to match.

## Performance

This project is meant to be highly-performant. When writing code, follow the guidelines in [`performance.md`](./docs/performance.md).

## Architecture

Each analysis has an `api.md` describing what a consumer sees and an
`architecture.md` specifying how it works. All are worth reading before
changing anything in them:

- [`packages/jskit/docs/parse/architecture.md`](./packages/jskit/docs/parse/architecture.md)
  documents the tokenizer, the parser, and both binary formats field by field,
  the invariants that break subtly when violated, and a checklist for adding a
  node kind.
- [`packages/jskit/docs/parse/embedded-source.md`](./packages/jskit/docs/parse/embedded-source.md)
  explains `parse()`'s `embedSource` option — why a parse buffer can carry a copy
  of the program text, why it does not by default, and the loud failure that
  makes the default safe.
- [`packages/jskit/docs/parse/types.md`](./packages/jskit/docs/parse/types.md) documents
  `src/parse/ast-types.ts` — the hand-written ESTree declarations `toAST()`
  returns. **Read it before reaching for `@types/estree` or `@typescript-eslint/types`:**
  both were evaluated and rejected for reasons that are not obvious, and the
  file records what is machine-checked, what is not, and why.
- [`packages/jskit/docs/scope/architecture.md`](./packages/jskit/docs/scope/architecture.md)
  documents the walk, resolution, and the rule for reconciling the two scope
  analyzers it reproduces.
- [`docs/deviations.md`](./docs/deviations.md) lists every place the output is
  deliberately not what a reference implementation produces, and why. Anything
  not in it is a bug.

[`packages/jskit/scripts/README.md`](./packages/jskit/scripts/README.md)
covers the ten scripts behind `npm run conformance` and how they divide the
work.

Task-specific procedures live in [`.agents/skills/`](./.agents/skills), which
`.claude/skills` symlinks to. Adding an AST node kind is one of them —
[`.agents/skills/add-node-type/`](./.agents/skills/add-node-type/SKILL.md) has
the seven registration sites and a driver that checks all of them and then runs
the node through the parser and the scope analyzer.

## Commands

Run from the repository root; every one delegates to the workspaces, and any of
them takes `--workspace=@eslint/jskit` to narrow it.

```bash
npm test           # vitest, ~3500 tests
npm run test:coverage # the same run, with a coverage report and its gate
npm run test:affected -- <area>...  # only the tests those areas can break
npm run typecheck  # tsc --noEmit
npm run lint       # builds first, then lints this repo with its own parser
npm run lint:fix   # the same, applying what is fixable
npm run fmt        # prettier --write .
npm run fmt:check  # prettier --check ., which is what CI runs
npm run build      # esbuild bundles + .d.ts files
npm run conformance   # differential tests against every reference implementation
npm run bench      # performance comparisons
```

**`eslint.config.js` imports `./packages/jskit/dist/jskit.js`,** so linting
requires a build. `npm run lint` does that for you; a bare `npx eslint .` will
use a stale bundle, or fail outright if `dist/` is missing.

The conformance scripts and benchmarks import `dist/` too. Plain `node` cannot
execute the sources directly, because of those `.js` import specifiers. Build
first.

## Formatting, hooks, and CI

**`prettier` owns formatting and `eslint` owns everything else.** The style is
the one `docs/javascript.md` describes — tabs at width 4, double quotes — so
turning the formatter on did not restyle the codebase out from under anyone.
JSON is indented with two spaces instead, because npm rewrites `package.json`
that way on every install and any other setting guarantees a diff.

`yorkie` installs a `pre-commit` hook that runs `lint-staged`, which runs
`eslint --fix` and then `prettier --write` over the staged files. Two things
follow from that:

- **The hook needs `dist/` to exist**, since `eslint.config.js` lints this
  repository with its own parser. The root `prepare` script builds the toolkit
  on every `npm install`, so a fresh clone is ready; if you have deleted
  `dist/` by hand, `npm run build` before committing.
- **`yorkie` only installs the hook if its install script is allowed to run.**
  npm gates that behind the `allowScripts` block in the root `package.json`.
  Bumping `yorkie` means updating the version pinned there, or the hook
  silently stops being installed.

`.npmrc` sets `legacy-peer-deps=true`. `@babel/eslint-parser` — a contender in
the parser benchmark, and nothing else — still declares a peer range that stops
at ESLint 9, and without this both `npm install` and `npm ci` fail outright.

### The CI run only tests what the change can reach

The work is split in two, and the split is the thing to understand before
changing either half.

`.github/workflows/ci.yml` decides **which areas a diff touched**, declaratively,
with a set of path filters. `packages/jskit/scripts/test-affected.mjs` decides
**what that implies**, by expanding those areas into the cascade the stack
forces: `scope/` reads what `parse/` produced and `flow/` reads what both
produced, so blast radius runs downstream and never up. The cascade is a fact
about the source layout rather than about CI, which is why it is not in the
workflow.

| Changed         | Tests run   | Conformance                                                 |
| --------------- | ----------- | ----------------------------------------------------------- |
| `src/parse/`    | all three   | parse and scope                                             |
| `src/scope/`    | scope, flow | scope                                                       |
| `src/flow/`     | flow        | none — there is no reference implementation to diff against |
| anything shared | all three   | parse and scope                                             |
| prose only      | none        | none                                                        |

**"Anything shared" is a default rather than a list.** The `all` filter is
written as `**` followed by an exclusion per area, and the action runs with
`predicate-quantifier: some-with-excludes`, so a file matches it when some
pattern includes it and none excludes it. Read plainly, `all` means "everything
not already accounted for" — the lockfile, `src/index.ts`, `vitest.config.ts`,
the tsconfigs, the build and conformance scripts, and the workflow itself all
land there, and so does a file in a directory nobody has thought of yet. That
last part is the point: **a new subdirectory of `src/` runs the whole suite
rather than silently running nothing.** Only Markdown, `docs/`, the agent
directories, and the web app are excluded from it, and each of those is listed
explicitly.

Adding an area means adding its filter, adding its exclusion from `all`, and
adding it to `DOWNSTREAM` in `test-affected.mjs`. Miss the exclusion and the
new area merely runs everything; miss the filter and it runs everything too.
Both failures are safe in the direction that matters.

`dorny/paths-filter` is pinned by commit SHA, not by tag. A tag can be moved to
point at different code; this repository lints itself with its own parser and
publishes to npm from CI, so an action that can change under it is not worth
the convenience.

**The coverage gate is applied to the areas that ran**, not to all of `src/`,
because a partial run cannot be held to a number the full suite earns. That
works because each area clears the same 95% on its own, so narrowing the
measurement narrows what is checked without lowering the bar. Adding an area
that does not clear it on its own would break this, and the fix is tests rather
than a lower threshold.

`ci_success` is the check to require in branch protection. Requiring the gated
jobs directly would block every merge where one of them correctly skipped.

### Releases

`release-please` watches `main`, keeps a release pull request open, and turns
its merge into a tag and an npm publish. The version lives in
`.release-please-manifest.json`; `release-please-config.json` lists the one
public package, since `@eslint/jskit-inspect` is private and is not released.
There is no JSR configuration and none is wanted.

Publishing goes through npm trusted publishing, which authenticates with the
workflow's OIDC token, so no npm secret is stored. The one secret the workflow
does look for is `WORKFLOW_PUSH_BOT_TOKEN`, and it falls back to the built-in
`GITHUB_TOKEN` — with the fallback the release pull request will not run CI,
because pushes made with the built-in token deliberately do not trigger
workflows.

## The rule that decides where code goes

Parsing is split into three phases, and the dividing line is **whether the
answer depends on context the text alone does not supply**.

- `parse()` throws only when the text cannot be tokenized, or the tokens cannot
  be shaped into a tree. It accepts the union of everything JavaScript and
  TypeScript allow.
- `validate()` reports everything that is merely _not allowed here_: strict
  mode violations, redeclarations, `return` outside a function, TypeScript
  syntax under `dialect: "js"`, JSX without `jsx: true`, a mismatched JSX
  closing tag.

So `dialect`, `jsx`, and `declaration` are options of phase 2, never phase 1.
When adding a new diagnostic, decide which side of that line it falls on first.
A check that needs to know the dialect, whether JSX is enabled, or whether the
file is a `.d.ts`, belongs in `validate.ts`, even if a reference parser throws
for it.

**`sourceType` is the exception, and it is the only one.** It is an option of
_both_ phases, because it is the only thing that makes two readings of the same
text both valid and different:

|           | script              | module         |
| --------- | ------------------- | -------------- |
| `await.x` | a member expression | a syntax error |
| `a <!--b` | `a`, then a comment | `a < !(--b)`   |

No single tree stands for both, so phase 1 has to choose, and it cannot choose
without being told. `dialect`, `jsx`, and `declaration` never pose that
question — TypeScript syntax, JSX, and `export const x: number;` either parse
or do not, and where they parse, every setting agrees on the tree. That is the
test for whether something belongs in `ParseOptions`: **not** "does it need
outside context" — everything here does — but "would two answers both be
valid?"

`declaration` is the newest of the three and the clearest case of context the
text cannot supply: a declaration file is one by its _name_, which is why
TypeScript decides it that way too, and why the ESLint parser object reads it
off the path along with `dialect` and `jsx`.

`parse()` records the source type in the buffer, so `validate()` and `toAST()`
read it back rather than being told again. Naming the opposite side of the
module line throws, since the tree was built the other way; narrowing `script`
to `commonjs` is allowed, because those two parse identically and differ only
in what phase 2 permits.

Scope analysis sits alongside phases 2 and 3 rather than after them: it reads
the same buffers `parse()` produced and needs neither the validation problems
nor the ESTree tree. Control flow analysis then reads the parse and scope
buffers together.

## Two kinds of test, told apart by their extension

`npm test` runs both kinds in one pass. Which one you are writing decides where
the file goes and what it is allowed to import.

| Kind        | Name        | Lives                                                  | Imports                                                |
| ----------- | ----------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Unit        | `*.spec.ts` | `src/{parse,scope,flow}/`, beside the module it covers | that one module                                        |
| Integration | `*.test.ts` | `tests/{parse,scope,flow}/`                            | `../../src/index.js`, the package's public entry point |

A **unit test** pins down one module's own behavior: the classification tables
in `chars.ts`, the escape decoding in `values.ts`, the buffer layouts in
`binary.ts`, what `resolveOptions()` fills in. It imports the module under test
directly, so `entities.spec.ts` sits next to `entities.ts` and imports
`./entities.js`. Reach for one when a function has edge cases that are tedious
to provoke through a whole parse.

An **integration test** goes through `parse()`, `toAST()`, `validate()`,
`analyze()`, or `createGraph()` and checks what a consumer would see. It
imports `../../src/index.js` and nothing deeper, which is also what keeps the
merged barrel honest — a name missing from it fails a test. The conformance
suites are integration tests, and so is anything that needs a real AST.

Two mechanical consequences of putting unit tests inside `src/`:

- `tsconfig.build.json` excludes `src/**/*.spec.ts`, so no `.spec.d.ts` lands
  in `dist/`. `tsconfig.json` does _not_ exclude them, which is what
  typechecks them.
- `vitest.config.ts` lists both globs. A `.spec.ts` file under `tests/`, or a
  `.test.ts` file under `src/`, is simply never run.

Setup a unit test wants to share with another one goes in a
`*.spec-helpers.ts` beside them — `tsconfig.build.json` and the coverage
config both exclude that suffix, so it is neither shipped nor measured.
`src/scope/fake-ast.spec-helpers.ts` is the one that exists: an `AstAccess`
over a table of literal nodes, which is what lets `Scope`, `ScopeManager`, and
`PatternVisitor` be tested without a program to parse.

### The coverage gate

`npm run test:coverage` runs the same suite under v8 coverage and fails below
**95%** of statements, branches, functions, and lines. The thresholds are
global rather than per-file, so a module that is genuinely hard to reach is
carried by the rest; raise them when the real number moves up, and never lower
them to make a run pass.

Two things about reading the report:

- **A declaration-only module reports 0%, not 100%.** It compiles to nothing,
  so v8 has no statements to attribute, and `include` puts it in the report
  anyway. `src/parse/ast-types.ts` is excluded for that reason. Anything else
  added to that exclusion has to be types all the way down — one `const` makes
  it real code again.
- **The last few percent are not unit-testable, and that is the point.** What
  is left uncovered lives in `validate.ts`, `referencer.ts`, and the three
  parser files: paths reached only by feeding the whole pipeline a particular
  program. The way to close one of those is a fixture in
  `tests/parse/fixtures/` or a case in `tests/{parse,scope,flow}/`, not a
  `.spec.ts` reaching into a private method.

## Conformance is the real test suite

`npm test` is the fast check. The differential corpus is what actually proves
correctness: it runs every `.js`/`.jsx` and `.ts`/`.tsx` file in `node_modules`
through the parser and the scope analyzer and compares the result against the
implementation each one replaces.

```
files=… ok=… mismatch=0 threw=0   # AST vs espree
ok=… bad=0                        # tokens and comments vs espree
files=… ok=… mismatch=0 threw=0   # AST vs @typescript-eslint/parser

problems=0 unseen=0               # ast-types.ts vs the decoder's output
identical=… differ=0              # ast-types.ts vs the fill() switch

binary files=… ok=… mismatch=0 threw=0   # scopes vs eslint-scope
tree   files=… ok=… mismatch=0 threw=0
binary files=… ok=… mismatch=0 threw=0   # scopes vs @typescript-eslint/scope-manager
tree   files=… ok=… mismatch=0 threw=0
```

The file counts move with whatever `node_modules` currently holds; `mismatch`
and `threw` are the numbers that matter. Scope analysis is checked twice per
file, once through each entry point. The tree
run is the more direct of the two: `analyzeTree()` is handed the very tree
object the reference analyzer was given, so a difference can only be a
difference between the analyzers.

**Run it after any change to a parser, tokenizer, decoder, or the scope walk.**
Zero mismatches is the standard; anything else is a regression. Individual
scripts take a directory and a file cap, which is useful while iterating:

### What the differential corpus cannot prove

It can only compare two implementations on a program **both** accept, and
`node_modules` is working code, so nothing in it is a syntax error. That leaves
the other half of the parser's job — rejecting what is not JavaScript —
untested by every script above.

Two scripts cover it, one per dialect.

`npm run conformance:262 --workspace=@eslint/jskit` is the JavaScript half.
test262 states its own verdict in each file's frontmatter, so a `negative`
block with `phase: parse` is an assertion that the file must be rejected, by
`parse()` throwing or by `validate()` reporting — the split decides which, and
the test asserts neither.

```bash
git clone --depth 1 https://github.com/tc39/test262
npm run conformance:262 --workspace=@eslint/jskit
```

```
files=52095 valid=47149 invalid=4410 (parse=1317 validate=3093) skipped=536 missed=0 overzealous=0
baseline unchanged
```

Both counts are zero and both have to stay there. **overzealous** is a valid
program the parser rejects, which breaks working code. **missed** is an invalid
program it accepts; every early error the corpus tests is now implemented, on
whichever side of the phase line it falls — 1,317 of them from `parse()` and
3,093 from `validate()`.

`npm run conformance:ts --workspace=@eslint/jskit` is the TypeScript half.
There is no TypeScript corpus that states its own verdict, so this one is
differential after all — against `@typescript-eslint/parser`, over TypeScript's
own test suite, which is mostly negative tests. It pairs with
`scripts/parse/conformance-ts.mjs` rather than replacing it: that script
compares trees, so it skips every file the reference parser throws on, which is
exactly the set this one is about.

```bash
git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/microsoft/TypeScript
cd TypeScript && git sparse-checkout set tests/cases
npm run conformance:ts --workspace=@eslint/jskit -- ./TypeScript
```

```
files=19205 agreed=12565 rejected=778 (parse=590 validate=188) skipped=5372 missed=40 overzealous=450
baseline unchanged
```

**Read its two counts differently from test262's.** **missed** is a rule that
is not implemented yet, and is the count to drive down. **overzealous** is
mostly this parser being _right_: `@typescript-eslint/parser` enforces a small
subset of the grammar rules `tsc` does and almost no ECMAScript early errors at
all, so `continue` outside a loop and `with` in strict mode pass through it
untouched. Read a new one before fixing it.

Its baseline is keyed by **rule** rather than by directory, which is where it
departs from test262's. test262's directories mirror sections of the
specification, so a directory names a rule there; TypeScript's
`tests/cases/compiler` is one flat directory of several thousand files and
names nothing.

Both test262 counts are graded against `scripts/parse/262-baseline.json`, a
failure count per directory. It is now an empty object, so any directory that
starts failing is one that was passing. Re-run with `--update` when a change
moves a count, and commit the baseline with it.
[`scripts/parse/262-exclusions.mjs`](./packages/jskit/scripts/parse/262-exclusions.mjs)
holds what is left out of the run entirely: two proposals whose syntax is not
implemented at all.

`tests/parse/test262.test.ts` is the part that runs without a checkout: a
hundred-odd negative tests reduced to a line each, plus the valid programs that
this corpus caught the parser rejecting.

### What no comparison of outputs can prove

Every run above compares an output — a tree, a token list, a scope graph. None
of them says whether a _rule_ behaves the same, which is the only thing a user
of `eslintParser` actually sees.

`npm run conformance:eslint --workspace=@eslint/jskit -- <path-to-eslint>` is
that check: ESLint's own rule tests, some 33,000 assertions over 293 rules, run
with `eslintParser` in place of `espree` and `parseForESLint()`'s scope graph in
place of `eslint-scope`'s. It needs a checkout of the ESLint version this
repository depends on, with its dependencies installed, and it modifies nothing
in it — a generated mocha hook swaps the parser before the tests load.

```bash
git clone --depth 1 --branch v10.8.1 https://github.com/eslint/eslint
cd eslint && npm install
npm run conformance:eslint --workspace=@eslint/jskit -- ../eslint
```

```
tests=33720 passed=33702 failed=18 rules=5
baseline unchanged
```

**Its failures come in two kinds and only one is a defect.** A defect is a
program parsed or resolved differently, and the run's first pass found six of
them; all six are fixed, and each is a commit with the rule from the
specification in its message. What is left is the other kind — language
versions. The suite pins `ecmaVersion` per test, and five files test ES3 and
ES5 semantics that a latest-only parser cannot reproduce and should not try
to: directives that do not apply before ES5, a `"use strict"` a function with
default parameters could carry before ES2016, block-scoped functions that hoist
under ES5 scoping.

Telling the two apart is a reading job, which is why this one is graded against
`scripts/parse/eslint-baseline.json` — a failure count per rule — rather than
against zero. **A new entry there is a defect until read and shown to be a
version difference.**

The directory is resolved against the working directory, so run these from
`packages/jskit`:

```bash
node scripts/parse/conformance-js.mjs ../../node_modules 200
node scripts/scope/conformance-ts.mjs ../some-project/src 500
```

Note that `node_modules/@eslint/jskit` is a workspace symlink, so the corpus
includes this repository's own source. That is deliberate: it is the only
TypeScript in reach that uses recent syntax heavily.

`node_modules` contains no `.jsx` or `.tsx` files, so JSX has no real-world
corpus — it is covered only by the `jsx.json` and `tsx.json` fixtures under
`tests/parse/` and `tests/scope/`, which are checked against both reference
implementations. Pointing a
conformance script at a React codebase is the way to close that gap.

The fixture files in `packages/jskit/tests/parse/fixtures/` are the other half
of that story: a list of source strings, each parsed and compared against the
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
cd packages/jskit
node scripts/parse/conformance-ts.mjs <path>/tests/cases/conformance 20000
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
- Those three facts are also the contract `src/parse/ast-types.ts` encodes,
  which is why `start` and `end` are required there while `range`, `loc`, and
  every TypeScript-only property are optional. See
  [`docs/parse/types.md`](./packages/jskit/docs/parse/types.md) before changing
  any of them.
- The scope analyzer reproduces `eslint-scope` for JavaScript and JSX and
  `@typescript-eslint/scope-manager` for TypeScript. **Where the two disagree,
  `eslint-scope` wins.** The three disagreements that survive as options —
  `jsxPragma`, `jsxFragmentName`, and the TypeScript standard library — all
  default to the `eslint-scope` answer. Those and the three that are not
  configurable are written up in
  [`docs/deviations.md`](./docs/deviations.md). One of them — the name a JSX
  closing tag repeats — shows up in the corpus, so the
  `@typescript-eslint/scope-manager` runs drop it from both sides through
  `jsxClosingNameKeys()` in `scripts/scope/serialize.mjs` before comparing.
- The scope analyzer's two entry points must produce the same graph for the
  same program, and `null` is the only spelling of "no node" above the accessor
  layer, whichever representation is underneath.

## Benchmarking

The numbers move a lot with machine temperature, and both the parser and the
scope analyzer are more sensitive to it than the allocation-heavy reference
implementations, so a hot machine does not just add noise — it changes the
ratio.

The parser benchmark spends its running time defending against exactly that,
which is why it takes minutes rather than seconds:

- **Every contender is measured alone, in a process of its own.** Parsers that
  share a heap do not share it evenly. Loading TypeScript and Babel into the
  process is by itself enough to halve the throughput of whichever parser
  allocates most, and measuring contenders one after another in a single
  process additionally hands whoever runs first the cleanest heap. Both effects
  are large enough to reorder a table.
- Each contender is then sampled several times per process, the whole list is
  measured over several passes, and the reported figure is the **median** of
  every sample, so a slow stretch is shared out instead of landing on one row.
- The `±` column is how far those samples disagreed. A large one means the
  machine was busy, not that the parser is inconsistent — check what else is
  running before reading anything into a result carrying `±40%`.
- Its contenders sit in **two tiers, and a result is only comparable inside its
  own tier**: `AST only` is the smallest job that still yields a tree, and the
  ESLint tier is a tree plus tokens plus comments with `range` and `loc` on all
  of them. Never quote a number from one against a number from the other.
- Compare ratios within a single suite, not absolute numbers across runs.
- Run one suite alone when comparing two things:
  `node benchmarks/parse/benchmark.js --suite=ts`.
- The TypeScript 7 row in the parser benchmark self-reports as skipped. That is
  expected: `@typescript-eslint/parser` does not accept TypeScript 7 yet.

`npm run bench:chart --workspace=@eslint/jskit` runs the parser benchmark,
writes `benchmarks/parse/results.json`, and renders
`benchmarks/parse/results.svg` from it — a self-contained, theme-aware chart
meant to be shared. `benchmarks/parse/chart.js` draws the two tiers as separate
panels for the reason above, and orders the rows by hand rather than by rank so
that two charts of different runs can be laid over each other.

The scope analyzer's benchmark is unrelated and still measures its contenders in
one process.

## Notes

- ESLint's `no-undef` and `no-unused-vars` are turned off for `**/*.ts` in
  `eslint.config.js`. They only understand values, so on TypeScript they report
  every type name as undefined. This is the same thing `typescript-eslint`
  does; do not try to "fix" the parser to satisfy them.
