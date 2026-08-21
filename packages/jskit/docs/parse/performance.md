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
to read.

## Syntax tree only

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 85.2  | 1.60x    |
| `jskit` — `parse()`                        | 53.2  | 1.00x    |
| `jskit` — `parse()` + `validate()`         | 32.8  | 0.62x    |
| `acorn`                                    | 28.0  | 0.53x    |
| `@babel/parser`                            | 27.8  | 0.52x    |
| `jskit` — `parse()` + `toAST()`            | 24.9  | 0.47x    |
| `espree`                                   | 20.4  | 0.38x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.7   | 0.05x    |

TypeScript (`espree`, `acorn`, and `meriyah` have nothing to say about it):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit` — `parse()`                        | 57.6  | 1.00x    |
| `jskit` — `parse()` + `validate()`         | 37.6  | 0.65x    |
| `@babel/parser`                            | 23.2  | 0.40x    |
| `jskit` — `parse()` + `toAST()`            | 22.6  | 0.39x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.2   | 0.04x    |

JSX (`acorn` has no JSX of its own, so it appears with `acorn-jsx`):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 72.5  | 2.57x    |
| `acorn` + `acorn-jsx`                      | 31.8  | 1.13x    |
| `jskit` — `parse()`                        | 28.2  | 1.00x    |
| `@babel/parser`                            | 26.5  | 0.94x    |
| `espree`                                   | 22.2  | 0.79x    |
| `jskit` — `parse()` + `validate()`         | 22.1  | 0.78x    |
| `jskit` — `parse()` + `toAST()`            | 16.8  | 0.60x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.5   | 0.09x    |

JSX is the slowest of the three dialects here because a `<` in expression
position is parsed speculatively, and because the fixture is dense in small
nodes.

`@babel/parser` returns Babel's own AST rather than ESTree, so its row is
ahead of where a consumer of an ESTree tree would land — that conversion cost
shows up on `@babel/eslint-parser` in the next table instead.

## The job ESLint actually asks for

Every node, token, and comment also carries `range` and `loc`.

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 22.5  | 1.54x    |
| `jskit` — `eslintParser.parse()`           | 14.6  | 1.00x    |
| `espree`                                   | 11.5  | 0.79x    |
| `@babel/eslint-parser`                     | 4.2   | 0.29x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.5   | 0.17x    |

TypeScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit` — `eslintParser.parse()`           | 16.2  | 1.00x    |
| `@babel/eslint-parser`                     | 3.7   | 0.23x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.2   | 0.14x    |

JSX:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `meriyah`                                  | 19.2  | 1.68x    |
| `jskit` — `eslintParser.parse()`           | 11.4  | 1.00x    |
| `espree`                                   | 10.1  | 0.89x    |
| `@babel/eslint-parser`                     | 3.7   | 0.32x    |
| `@typescript-eslint/parser` + TypeScript 5 | 2.4   | 0.21x    |

Locations are not free for anyone: the ESTree shape wants a fresh
`{ line, column }` pair for each end of every node and token, and building
roughly 400,000 small objects costs this parser about half of what `parse()`
alone achieves and `espree` about two fifths. Finding which line an offset
falls on is the cheap half — `LineIndex` remembers the line it matched last,
and source-order traversal hits it nearly every time. Allocation is the
expensive half, and no parser avoids it while producing the shape ESLint
expects.

## Reading the `meriyah` rows

`meriyah` is the fastest contender in both tiers on both dialects it supports,
and by a wide margin. Three things belong beside that number before it is
quoted anywhere:

- **It parses JavaScript and JSX only.** There is no TypeScript row for it, and
  a toolchain that has to handle `.ts` still needs a second parser.
- **It is measured doing slightly less.** `raw` on literals and `start`/`end`
  on nodes are off by default and are switched on here, because every other
  contender produces them whether or not they are wanted. What cannot be
  switched on is the text of a token: its tokens carry the type and both
  positions but no `value`, which is part of the ESLint-tier job the other
  rows are doing. Its trees also omit a few properties `acorn` always writes —
  `expression: false` on a function expression, `id: null` on an arrow — so
  they are about half a percent smaller.
- **It produces an ordinary object tree**, which is the thing the binary
  representation exists to avoid. `parse()` alone is the row to compare it
  against for tokenizer and grammar work; `toAST()` is where the cost of
  materializing objects lands, and that is the gap the rest of the toolkit is
  designed to make optional.

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
