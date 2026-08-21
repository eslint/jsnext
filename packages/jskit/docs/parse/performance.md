# Parser performance

How the parser compares to the parsers it aims to replace, and how to read the
benchmark without being misled by a warm machine.

`npm run test:performance` measures the parser against `espree`, `acorn`,
`meriyah`, `@babel/parser`, `@babel/eslint-parser`, and
`@typescript-eslint/parser` backed by two different TypeScript versions.

The contenders sit in **two tiers, and a result is only comparable inside its
own tier**. The AST tier is the smallest job that still yields a syntax tree;
the ESLint tier is the job ESLint actually asks for — a tree plus tokens plus
comments, every one of them carrying `range` and `loc`. Never quote a number
from one against a number from the other.

Every contender is measured alone, in a process of its own, because loading two
copies of TypeScript leaves a large heap behind and the resulting garbage
collection pressure lands hardest on whichever parser allocates most — which is
not a property of the parsers worth measuring.

On ~196 KiB generated modules (Node 24, Linux x64). Absolute figures depend on
how warm the machine is and can move a lot; the ratios within a suite are what
to read. The `jskit` rows are measured with the `jsx` option stated, the way a
consumer that knows its file type would call them.

## Syntax tree only

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 70.2  | 1.02x    |
| `jskit` — `parse()`                        | 68.8  | 1.00x    |
| `jskit` — `parse()` + `validate()`         | 42.8  | 0.62x    |
| `jskit` — `parse()` + `toAST()`            | 31.8  | 0.46x    |
| `@babel/parser`                            | 26.4  | 0.38x    |
| `acorn`                                    | 26.4  | 0.38x    |
| `espree`                                   | 21.2  | 0.31x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.5   | 0.04x    |

TypeScript (`espree`, `acorn`, and `meriyah` have nothing to say about it):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit` — `parse()`                        | 68.2  | 1.00x    |
| `jskit` — `parse()` + `validate()`         | 45.6  | 0.67x    |
| `@babel/parser`                            | 22.8  | 0.33x    |
| `jskit` — `parse()` + `toAST()`            | 21.9  | 0.32x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.1   | 0.03x    |

JSX (`acorn` has no JSX of its own, so it appears with `acorn-jsx`):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit` — `parse()`                        | 71.2  | 1.00x    |
| `meriyah`                                  | 47.2  | 0.66x    |
| `jskit` — `parse()` + `validate()`         | 42.6  | 0.60x    |
| `acorn` + `acorn-jsx`                      | 28.7  | 0.40x    |
| `jskit` — `parse()` + `toAST()`            | 28.1  | 0.39x    |
| `@babel/parser`                            | 22.4  | 0.31x    |
| `espree`                                   | 19.1  | 0.27x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.3   | 0.03x    |

The JSX rows assume the caller passes `jsx: true` to `parse()`. Without it the
parser accepts the union of the `.ts` and `.tsx` readings by speculating at
every `<` in expression position, which costs about fifteen percent on this
fixture — and used to cost half the parse before exceptions left the
speculation path. JSX is where the binary representation pays best: an element
is many small nodes, and none of them is allocated.

`@babel/parser` returns Babel's own AST rather than ESTree, so its row is
ahead of where a consumer of an ESTree tree would land — that conversion cost
shows up on `@babel/eslint-parser` in the next table instead.

## The job ESLint actually asks for

Every node, token, and comment also carries `range` and `loc`.

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 19.5  | 1.20x    |
| `jskit` — `eslintParser.parse()`           | 16.2  | 1.00x    |
| `espree`                                   | 11.1  | 0.69x    |
| `@babel/eslint-parser`                     | 4.1   | 0.25x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.4   | 0.15x    |

TypeScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit` — `eslintParser.parse()`           | 16.2  | 1.00x    |
| `@babel/eslint-parser`                     | 3.6   | 0.22x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.0   | 0.12x    |

JSX:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 16.6  | 1.14x    |
| `jskit` — `eslintParser.parse()`           | 14.6  | 1.00x    |
| `espree`                                   | 9.0   | 0.62x    |
| `@babel/eslint-parser`                     | 3.1   | 0.21x    |
| `@typescript-eslint/parser` + TypeScript 5 | 1.9   | 0.13x    |

Locations are not free for anyone: the ESTree shape wants a fresh
`{ line, column }` pair for each end of every node and token, and building
roughly 400,000 small objects is the largest single cost in this tier for
every contender. Finding which line an offset falls on is the cheap half —
`LineIndex` remembers the line it matched last, and source-order traversal
hits it nearly every time. Allocation is the expensive half, and no parser
avoids it while producing the shape ESLint expects.

## Reading the `meriyah` rows

`meriyah` is the fastest contender in the ESLint tier and ties `parse()` in
the JavaScript AST tier; `parse()` leads it by half again on JSX. Four things
belong beside its numbers before they are quoted anywhere.

**It is configured to do the same early-error work as everyone else, and that
matters.** Meriyah reports most early errors inline as it parses — a `with` in
strict mode, `break` outside a loop, a getter with a parameter, an octal
literal in strict code — but the ones that need a binding table sit behind its
`lexical` option: `let x; let x;`, `var x; let x;`, a duplicate parameter in
strict code, a duplicate export, a private name no class declares. `acorn` and
`espree` reject all five and offer no way to turn that off, so the benchmark
turns `lexical` on. It is not a rounding error — measured on its own it is
roughly a tenth of meriyah's throughput, and leaving it off is what earlier
versions of this table did when they showed meriyah about a quarter ahead on
JavaScript instead of level.

**It parses JavaScript and JSX only.** There is no TypeScript row for it, and a
toolchain that has to handle `.ts` still needs a second parser.

**Its AST-tier row emits no tokens, and `parse()` cannot do that.** This is the
one place the two rows are genuinely doing different jobs, and the tier's rule
allows it: nothing here is asked for tokens _except where a parser has no way
to leave them out_, which is why the `parse()` row is annotated. The token
buffer costs `parse()` about a tenth of its throughput. Asking meriyah for the
same thing costs it far more, because a token there is an object on the heap
rather than four words in a typed array — see the like-for-like table below.

**It produces an ordinary object tree**, which is the thing the binary
representation exists to avoid. `parse()` alone is the row to compare it
against for tokenizer and grammar work; `toAST()` is where the cost of
materializing objects lands, and that is the gap the rest of the toolkit is
designed to make optional.

### Like for like

The tier tables answer "how fast is each parser at the job it is built to do".
They do not answer "how fast are these two at the same job", because no tier
definition makes `parse()` stop emitting tokens or makes meriyah start. Two
measurements do, both on the JavaScript fixture, each contender in its own
process, and interleaved so machine drift falls on both sides equally:

| Same job                                 | Result                                |
| ---------------------------------------- | ------------------------------------- |
| tree + tokens (`meriyah` with `onToken`) | `parse()` ~2x faster                  |
| tree + tokens + every early error        | `parse()` + `validate()` ~1.2x faster |

So the AST-tier standings are a statement about defaults, not about ceilings.
Meriyah is genuinely fast — level with `parse()` while producing a full object
tree, which is a real achievement — but the moment it is asked to record what
it scanned, the binary token buffer pulls ahead.

## What this is worth in a real lint run

Smaller than it looks. Parsing is roughly 15% of the time ESLint spends on a
file; scope analysis and rules are the rest. Everything downstream of parsing
costs the same on either parser's AST — traversal plus every recommended rule
measures 96.0 ms on `espree`'s tree and 96.2 ms on ours, and scope analysis is
likewise within noise — so a parse win carries through undiluted but only in
proportion to its share.

The TypeScript 7 row is measured the same way as the others, by redirecting
module resolution for `"typescript"` and reloading the parser.
`@typescript-eslint/parser` does not yet accept TypeScript 7, so that row
currently reports itself as skipped with the reason.

## Running it

Benchmark a file of your own with:

```bash
npm run test:performance -- path/to/file.ts
```

Or run one suite on its own, which is the most reliable way to compare two
numbers:

```bash
node benchmarks/parse/benchmark.js --suite=js
```

`npm run build:performance-chart` runs the same benchmark, writes
`benchmarks/parse/results.json`, and renders `benchmarks/parse/results.svg`
from it — a self-contained, theme-aware chart meant to be shared. The chart
draws the two tiers as separate panels for the reason above, and orders the
rows by hand rather than by rank, so that two charts of different runs can be
laid over each other.
