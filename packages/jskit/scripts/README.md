# `@eslint/jskit` scripts

One build script, two generators, and twelve checks, split into `parse/`,
`scope/`, and `types/` the same way the source is. The checks are the real
test suite: `npm test` runs a few thousand hand-written cases, while these run
every `.js`, `.jsx`, `.ts`, and `.tsx` file in `node_modules` through the
analyses and compare the result against a reference — the implementation each
analysis replaces, or, for the type analysis, the TypeScript checker's verdict
on each claim.

Everything here imports `../../dist/jskit.js`, so **the bundle must be built
first**. `npm run test:conformance` does that for you; a bare `node scripts/…` uses
whatever `dist/` currently holds, or fails outright if it is missing.

The control flow analysis has no scripts here, because it has no reference
implementation to diff against; `tests/flow/` is its contract.

```bash
npm run build                        # scripts/build.js
npm run test:conformance             # every check in the first table, in order
npm run test:conformance:parse       # just the parser third of that table
npm run test:conformance:scope       # just the scope third
npm run test:conformance:types       # just the type-analysis check
npm run test:conformance:ecmascript  # the test262 run, which needs a checkout
npm run test:conformance:typescript  # TypeScript's own suite, which needs a checkout
npm run test:conformance:eslint      # ESLint's rule tests, which need a checkout
```

The three that need a checkout are named for the corpus they read, not for the
script that reads it: `ecmascript` is test262, `typescript` is
`microsoft/TypeScript`'s `tests/cases`, and `eslint` is ESLint's own rule
tests.

## What each script checks

| Script                              | Compares                           | Against                             |
| ----------------------------------- | ---------------------------------- | ----------------------------------- |
| `build.js`                          | —                                  | bundles `src/index.ts` with esbuild |
| `parse/conformance-js.mjs`          | the JavaScript AST                 | `espree`                            |
| `parse/conformance-tokens.mjs`      | tokens and comments                | `espree`                            |
| `parse/conformance-ts.mjs`          | the TypeScript AST                 | `@typescript-eslint/parser`         |
| `parse/conformance-types.mjs`       | `src/parse/ast-types.ts`           | what the decoder emits              |
| `parse/derive-shapes.mjs`           | `src/parse/ast-types.ts`           | what the decoder's schema says      |
| `parse/conformance-262.mjs`         | accepted or rejected               | what test262 says                   |
| `parse/conformance-ts-negative.mjs` | accepted or rejected               | `@typescript-eslint/parser`         |
| `parse/conformance-eslint.mjs`      | how _rules_ behave                 | ESLint's own rule test suite        |
| `scope/conformance-js.mjs`          | the scope graph, both entry points | `eslint-scope`                      |
| `scope/conformance-ts.mjs`          | the scope graph, both entry points | `@typescript-eslint/scope-manager`  |
| `types/conformance-ts.mjs`          | the type analysis' claims          | `ts.TypeChecker`                    |

Zero mismatches is the standard. Anything else is a regression.

The two scope checks run each file twice, once through `analyze()` over the
binary buffers and once through `analyzeTree()` over the very tree the
reference analyzer was handed, and both go _through the buffer_: the result is
serialized, rehydrated with `toScopeManager()`, and diffed against the
reference, so a field the format dropped or reordered cannot pass.
`scope/serialize.mjs` is the shared reduction both of them — and the
integration tests in `tests/scope/` — compare with.

`types/conformance-ts.mjs` is differential in a different direction: the type
analysis replaces no existing implementation, so there is no buffer to diff,
but its _claims_ are checkable. Every positive answer `Types` gives —
`isTypeOf()`, `isNullish()`, `isArray()`, `isTuple()`, `isAwaitable()` — is a
statement about runtime behavior, so the script asks `ts.TypeChecker` about
the same span and grades the claim. The comparison is one-directional by
design: the analysis is conservative and silence is always allowed, so only a
positive claim the checker contradicts counts as a disagreement. Each file
gets a program of its own, since one shared program would let the checker see
cross-file declaration merging the single-file analysis never promises to
know about, and claims the checker cannot judge — `any`, type parameters,
multiply-declared symbols — are counted as `skipped` rather than graded.

```
files=… claims=… agree=… disagree=0 skipped=… unmatched=… threw=0
```

`disagree` and `threw` are its two zeros: a disagreement is an unsound claim,
and `threw` is a file the checker parses cleanly that the parser rejects.

`parse/generate-to-ast.mjs` produces source rather than checking it: it turns
the schema in `parse/to-ast-shapes.mjs` into `src/parse/to-ast-decode.ts`,
one monomorphic decoder per node kind and output variant, and the result is
committed. `npm run build:to-ast` runs it and formats what it wrote. The
schema is the file to edit — the header comment in it explains the operation
vocabulary — and `derive-shapes.mjs` is what holds it to `ast-types.ts`.

`parse/generate-unicode-properties.mjs` is the other generator.
`src/parse/unicode-properties.ts` holds
every name `\p{…}` may use, and those names are a fact about the Unicode
Character Database rather than a decision, so they are derived from test262's
`property-escapes/generated/` directory — the same corpus the parser is graded
against — and the result is committed. Rerun it when test262 moves to a new
Unicode version.

```bash
node scripts/parse/generate-unicode-properties.mjs ../../test262
```

```
files=… ok=… mismatch=0 threw=0                       # parse/conformance-js
ok=… bad=0                                            # parse/conformance-tokens
files=… ok=… mismatch=0 threw=0                       # parse/conformance-ts
files=… threw=0 kinds=… exercised=… problems=0        # parse/conformance-types
derived=… declared=… identical=… differ=0             # parse/derive-shapes
binary files=… ok=… mismatch=0 threw=0                # scope/conformance-js
tree   files=… ok=… mismatch=0 threw=0
files=… claims=… agree=… disagree=0 skipped=… …       # types/conformance-ts
```

## Two scripts test the rejecting half

The other ten are **differential**: they run a program through two
implementations and compare what comes back, which means they can only ever
check a program both implementations accept. Nothing in them tests that an
error is _reported_, and nothing could — `node_modules` is working code, so it
contains no syntax errors at all.

test262 is not differential. Every file carries its own verdict in its
frontmatter, and a `negative` block with `phase: parse` says the file must be
rejected before a line of it runs. That is the only corpus here that exercises
the rejecting half of the parser.

It reads a checkout rather than a vendored copy, because the suite is around
52,000 files:

```bash
git clone --depth 1 https://github.com/tc39/test262
npm run test:conformance:ecmascript -- ./test262
```

`/test262` at the repository root is the default path and is gitignored, so a
clone there needs no argument.

`parse/conformance-ts-negative.mjs` does the same job for TypeScript, and it
has to be differential because there is no TypeScript corpus that states its own
verdict. It pairs with `parse/conformance-ts.mjs` rather than replacing it: that
script compares trees, so it skips every file the reference parser throws on,
which is exactly the set this one is interested in.

```bash
git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/microsoft/TypeScript
cd TypeScript && git sparse-checkout set tests/cases
npm run test:conformance:typescript -- ./TypeScript
```

Read its two counts differently. **missed** is a program the reference rejects
and this parser accepts, and every one is a TypeScript grammar rule that is not
implemented yet — that is the count to drive to zero. **overzealous** is the
reverse, and most of them are _correct_: `@typescript-eslint/parser` enforces a
small subset of the grammar rules `tsc` does and almost no ECMAScript early
errors at all, so `continue` outside a loop passes through it untouched. Read a
new one before fixing it.

Its baseline is keyed by **rule** rather than by directory, unlike test262's.
test262's directories mirror the sections of the specification, so a directory
names a rule there; TypeScript's `tests/cases/compiler` is one flat directory of
several thousand files and names nothing.

Every count is a count of files. A test with neither a `module` nor a
strictness flag has to hold up read both ways, so it is run twice, but it is
still one test and counts once.

`invalid` carries the split of **which phase** did the rejecting. That is the
number to watch when working on early errors: `parse()` catches what cannot be
tokenized or shaped into a tree, and everything else has to come from
`validate()`, so a split that stays lopsided means the early-error work is not
landing where it belongs.

Two counts come out of it and they are not equally bad:

- **overzealous** — a valid program the parser rejects. This breaks working
  code. It is zero, and `KNOWN_OVERZEALOUS` in `parse/262-exclusions.mjs`
  fails the run if it climbs.
- **missed** — an invalid program the parser accepts. Also zero: every early
  error this corpus tests is implemented.

Both are graded against `parse/262-baseline.json` as well, which holds a failure
count per directory. It is an empty object now, so any directory that starts
failing is one that was passing. Re-run with `--update` once the change is
understood, and commit the result along with it.

`parse/262-exclusions.mjs` is the prose half of the same story: the proposals
whose tests are skipped outright because the syntax is not implemented at all,
and why the phase split falls where it does.

```
files=52095 valid=47149 invalid=4410 (parse=1317 validate=3093) skipped=536 missed=0 overzealous=0
baseline unchanged
```

Its flags: `--update` rewrites the baseline, `--verbose` prints every failing
file rather than one per distinct message, and `--features` prints the failure
counts grouped by the feature each file declares, which is how a whole
unimplemented proposal is told apart from a scattering of real defects.

## One script tests the rules on top

Everything above compares an output: a tree against `espree`'s, a scope graph
against `eslint-scope`'s. `parse/conformance-eslint.mjs` asks the question none
of them can — whether a _rule_ behaves the same — by running ESLint's own rule
tests with `eslintParser` in place of `espree`, and with `parseForESLint()`
supplying the scope graph in place of `eslint-scope`. Around 33,000 assertions
over 293 rules, and every failure is a program where a rule sees something
other than what ESLint's authors saw.

It needs a checkout of the same ESLint version this repository depends on, with
its own dependencies installed, and it modifies nothing in it: a generated
mocha hook swaps the parser on the language object before the tests load.

```bash
git clone --depth 1 --branch v10.8.1 https://github.com/eslint/eslint
cd eslint && npm install
cd ../packages/jskit
npm run test:conformance:eslint -- ../../eslint
```

```
tests=33720 passed=33702 failed=18 rules=5
baseline unchanged
```

Read the failures in two piles. A **defect** is a program parsed or resolved
differently; the first run of this script found six, and all six are fixed. The
rest are **language versions**: the suite pins `ecmaVersion` per test and five
files test ES3 and ES5 semantics, which a parser that implements the latest
ECMAScript and nothing else cannot reproduce and should not try to. Telling the
two apart is a reading job, which is why the grade is
`parse/eslint-baseline.json` — a failure count per rule — rather than a zero,
and why a new entry in it is a defect until read and shown otherwise.

The run pins the dialect to `"js"`. ESLint's rule tests have no file names, so
`eslintParser`'s extension-based default would read all of them as TypeScript,
where a legacy octal literal is an error and several hundred tests use one.

## How they divide the work

The first three check the **output contracts** — that the tree, and the tokens
under it, match the parser being replaced. They split three ways because the
contracts differ:

- `parse/conformance-js.mjs` drops `tokens` and `comments` before comparing,
  since comparing them inside the tree reports one shifted token as thousands
  of differences. `parse/conformance-tokens.mjs` picks them up and compares
  them as ordered lists, so a shift is reported where it starts.
- `parse/conformance-ts.mjs` is the same idea against a different reference,
  plus the
  reconciliations that reference requires: a property it leaves `undefined` is
  `null` here, and its `range` is `start` and `end` here.

The next two check the **type declarations** in `src/parse/ast-types.ts`,
which
nothing at runtime depends on and which therefore nothing else would catch
drifting. They approach it from opposite ends, and both are needed:

- `parse/conformance-types.mjs` reads the decoder's **output**. It finds
  properties emitted but not declared, declared but never emitted, declared
  required but sometimes absent, and values outside what a declared type
  admits — including a `null` where the declaration has none. Its weakness is
  coverage: a property no file in the corpus produces is a property it cannot
  judge, which is why it reports `unseen` separately from `problems`.
- `parse/derive-shapes.mjs` reads the decoder's **schema** —
  `parse/to-ast-shapes.mjs`, the file `src/parse/to-ast-decode.ts` is
  generated from — so every property of every kind is compared, in both
  directions. Coverage is not a question for it, so it catches the node kind
  nothing in `node_modules` happens to use.

Neither can check which node types belong in a slot. `child("test", "A")` says a
child goes there, not which children, and observing the corpus only ever yields
a subset — over the full corpus, `BlockStatement.body` never once holds a
`StaticBlock` or a `WithStatement`, both of which are perfectly legal. The
unions in `ast-types.ts` are therefore written by hand and checked by neither.

## Corpus, fixtures, and inline snippets

`node_modules` is a large corpus of real code, but it is real code: it contains
no `with` statement, no decorator, no `accessor` field, no import attribute,
and not one `.jsx` or `.tsx` file. The type checks close that gap in two steps
before touching the corpus at all — first every snippet in
`tests/parse/fixtures/*.json`, then a short inline list in
`parse/conformance-types.mjs` for what cannot live in a shared fixture. `with`
is the reason that list exists: the espree conformance test parses every
fixture as a module, where `with` is a syntax error.

The AST and token checks do not do this, because their references cannot help
there either — they are differential tests, and a fixture only proves something
if two implementations disagree about it. Those cases live in
`tests/parse/*.test.ts`.

`node_modules/@eslint/jskit` is a workspace symlink, so the corpus includes
this repository's own source. That is deliberate: it is the only TypeScript
within reach that uses recent syntax heavily, and it means `ast-types.ts` is
parsed by the parser it describes.

## Arguments

Each check takes a directory and a file cap, which is what makes iterating on a
failure bearable. Paths resolve against the working directory, so run them from
the package:

```bash
cd packages/jskit
node scripts/parse/conformance-js.mjs ../../node_modules 200
node scripts/parse/conformance-ts.mjs ../some-project/src 500
node scripts/parse/conformance-types.mjs ../../node_modules 5000
node scripts/scope/conformance-js.mjs ../some-react-app/src 500
node scripts/types/conformance-ts.mjs ../../node_modules 300
```

Pointing one at a React codebase is the way to cover JSX with something wider
than the fixtures.

`parse/derive-shapes.mjs` takes no directory, since it reads the schema rather
than a corpus. It accepts one flag:

```bash
node scripts/parse/derive-shapes.mjs --list   # shapes with no declaration yet
```

That prints each underived node type with its property names, optionality, and
value kind — the scaffold for a new entry in `ast-types.ts`. It prints nothing
now, because every kind the decoder fills is declared.

## Adding a node kind

The checklist lives in
[`../docs/parse/architecture.md`](../docs/parse/architecture.md). The step
easiest to forget is the `ast-types.ts` interface, precisely because nothing at
runtime needs it — which is what the two type checks are for. A node kind also
needs an entry in `src/scope/slot-names.ts`, or the tree path silently stops
descending into it.
