# `@eslint/jsparse` scripts

One build script and six checks. The checks are the real test suite: `npm test`
runs a few hundred hand-written cases, while these run every `.js`, `.jsx`,
`.ts`, and `.tsx` file in `node_modules` — around 2,650 files — through the
parser and compare the result against the implementation it replaces.

Everything here imports `../dist/jsparse.js`, so **the bundle must be built
first**. `npm run conformance` does that for you; a bare `node scripts/…` uses
whatever `dist/` currently holds, or fails outright if it is missing.

```bash
npm run build           # scripts/build.js
npm run conformance     # every check in the first table, in order
npm run conformance:262 # the test262 run, which needs a checkout
```

## What each script checks

| Script | Compares | Against |
| ------ | -------- | ------- |
| `build.js` | — | bundles `src/index.ts` with esbuild |
| `conformance-js.mjs` | the JavaScript AST | `espree` |
| `conformance-tokens.mjs` | tokens and comments | `espree` |
| `conformance-ts.mjs` | the TypeScript AST | `@typescript-eslint/parser` |
| `conformance-types.mjs` | `src/ast-types.ts` | what the decoder emits |
| `derive-shapes.mjs` | `src/ast-types.ts` | what the decoder's source says |
| `conformance-262.mjs` | accepted or rejected | what test262 says |

Zero mismatches is the standard. Anything else is a regression.

```
files=1433 ok=1433 mismatch=0 threw=0                          # conformance-js
ok=1433 bad=0                                                  # conformance-tokens
files=1221 ok=1221 mismatch=0 threw=0                          # conformance-ts
files=2886 threw=0 kinds=158 exercised=158 problems=0 unseen=0 # conformance-types
derived=144 declared=158 identical=158 differ=0 undeclared=0   # derive-shapes
```

## `conformance-262.mjs` is the odd one out

The other five are **differential**: they run a program through two
implementations and compare what comes back, which means they can only ever
check a program both implementations accept. Nothing in them tests that an
error is *reported*, and nothing could — `node_modules` is working code, so it
contains no syntax errors at all.

test262 is not differential. Every file carries its own verdict in its
frontmatter, and a `negative` block with `phase: parse` says the file must be
rejected before a line of it runs. That is the only corpus here that exercises
the rejecting half of the parser.

It reads a checkout rather than a vendored copy, because the suite is around
52,000 files:

```bash
git clone --depth 1 https://github.com/tc39/test262
npm run conformance:262 -- ./test262
```

`/test262` at the repository root is the default path and is gitignored, so a
clone there needs no argument.

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
  code. It is zero, and `KNOWN_OVERZEALOUS` in `262-exclusions.mjs` fails the
  run if it climbs.
- **missed** — an invalid program the parser accepts. Thousands, because most
  of ECMAScript's early errors are not implemented yet.

Only one of them can be graded against zero, so both are also
graded against `262-baseline.json`, which holds a failure count per directory:
a count that went up is a regression even in a directory that was never clean,
and a count that went down is a fix the baseline should record. Re-run with
`--update` once the change is understood, and commit the result along with it.

`262-exclusions.mjs` is the prose half of the same story. It lists the
proposals whose tests are skipped outright because the syntax is not
implemented at all, and groups the missed early errors into families with rough
counts — which is the list to read before deciding what to implement next.

```
files=52095 valid=47149 invalid=2230 (parse=998 validate=1232) skipped=536 missed=2180 overzealous=0
baseline unchanged
```

Its flags: `--update` rewrites the baseline, `--verbose` prints every failing
file rather than one per distinct message, and `--features` prints the failure
counts grouped by the feature each file declares, which is how a whole
unimplemented proposal is told apart from a scattering of real defects.

## How they divide the work

The first three check the **output contracts** — that the tree, and the tokens
under it, match the parser being replaced. They split three ways because the
contracts differ:

- `conformance-js.mjs` drops `tokens` and `comments` before comparing, since
  comparing them inside the tree reports one shifted token as thousands of
  differences. `conformance-tokens.mjs` picks them up and compares them as
  ordered lists, so a shift is reported where it starts.
- `conformance-ts.mjs` is the same idea against a different reference, plus the
  reconciliations that reference requires: a property it leaves `undefined` is
  `null` here, and its `range` is `start` and `end` here.

The last two check the **type declarations** in `src/ast-types.ts`, which
nothing at runtime depends on and which therefore nothing else would catch
drifting. They approach it from opposite ends, and both are needed:

- `conformance-types.mjs` reads the decoder's **output**. It finds properties
  emitted but not declared, declared but never emitted, declared required but
  sometimes absent, and values outside what a declared type admits — including
  a `null` where the declaration has none. Its weakness is coverage: a property
  no file in the corpus produces is a property it cannot judge, which is why it
  reports `unseen` separately from `problems`.
- `derive-shapes.mjs` reads the decoder's **source**, parsing `to-ast.ts` with
  jsparse itself and reading the `fill()` switch directly. Coverage is not a
  question for it, so it catches the node kind nothing in `node_modules`
  happens to use.

Neither can check which node types belong in a slot. `this.node(a)` says a
child goes there, not which children, and observing the corpus only ever yields
a subset — over the full corpus, `BlockStatement.body` never once holds a
`StaticBlock` or a `WithStatement`, both of which are perfectly legal. The
unions in `ast-types.ts` are therefore written by hand and checked by neither.

## Corpus, fixtures, and inline snippets

`node_modules` is a large corpus of real code, but it is real code: it contains
no `with` statement, no decorator, no `accessor` field, no import attribute,
and not one `.jsx` or `.tsx` file. The type checks close that gap in two steps
before touching the corpus at all — first every snippet in
`tests/fixtures/*.json`, then a short inline list in `conformance-types.mjs`
for what cannot live in a shared fixture. `with` is the reason that list
exists: the espree conformance test parses every fixture as a module, where
`with` is a syntax error.

The AST and token checks do not do this, because their references cannot help
there either — they are differential tests, and a fixture only proves something
if two implementations disagree about it. Those cases live in
`tests/*.test.ts`.

Both `node_modules/@eslint/jsparse` and `node_modules/@eslint/jsscope` are
workspace symlinks, so the corpus includes this repository's own source. That
is deliberate: it is the only TypeScript within reach that uses recent syntax
heavily, and it means `ast-types.ts` is parsed by the parser it describes.

## Arguments

Each check takes a directory and a file cap, which is what makes iterating on a
failure bearable. Paths resolve against the working directory, so run them from
the package:

```bash
cd packages/jsparse
node scripts/conformance-js.mjs ../../node_modules 200
node scripts/conformance-ts.mjs ../some-project/src 500
node scripts/conformance-types.mjs ../../node_modules 5000
```

Pointing one at a React codebase is the way to cover JSX with something wider
than the fixtures.

`derive-shapes.mjs` takes no directory, since it reads source rather than a
corpus. It accepts one flag:

```bash
node scripts/derive-shapes.mjs --list   # print shapes with no declaration yet
```

That prints each underived node type with its property names, optionality, and
value kind — the scaffold for a new entry in `ast-types.ts`. It prints nothing
now, because every kind the decoder fills is declared.

## Adding a node kind

The checklist lives in [`../docs/architecture.md`](../docs/architecture.md).
The step easiest to forget is the `ast-types.ts` interface, precisely because
nothing at runtime needs it — which is what the last two scripts are for.
