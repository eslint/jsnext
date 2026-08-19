# Parser performance

How the parser compares to the parsers it aims to replace, and how to read the
benchmark without being misled by a warm machine.

`npm run bench` measures full AST creation — source text in, complete ESTree
out — against `espree`, `acorn`, and `@typescript-eslint/parser` backed by two
different TypeScript versions.

Each suite runs in its own child process, because loading two copies of
TypeScript leaves a large heap behind and the resulting garbage collection
pressure lands hardest on whichever parser allocates most — which is not a
property of the parsers worth measuring.

On ~196 KiB generated modules (Node 24, Linux x64). Absolute figures depend on
how warm the machine is and can move a lot; the ratios within a suite are what
to read.

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit`                                    | 37.6  | 1.00x    |
| `acorn`                                    | 35.9  | 0.95x    |
| `espree`                                   | 21.5  | 0.57x    |
| `@typescript-eslint/parser` + TypeScript 6 | 3.2   | 0.09x    |

TypeScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit`                                    | 35.6  | 1.00x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.5   | 0.07x    |

JSX (`acorn` has no JSX support of its own, so it does not appear):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jskit`                                    | 21.4  | 1.00x    |
| `espree`                                   | 11.0  | 0.51x    |
| `@typescript-eslint/parser` + TypeScript 6 | 3.2   | 0.15x    |

JSX is the slowest of the three because a `<` in expression position is parsed
speculatively, and because the fixture is dense in small nodes.

The job ESLint actually asks for, where every node, token, and comment also
carries `range` and `loc`. Both contenders are configured to produce all of it,
and their output on this fixture is identical:

| Parser                     | ops/s | Relative |
| -------------------------- | ----- | -------- |
| `jskit` (`eslintParser`)   | 26.0  | 1.00x    |
| `espree`                   | 16.8  | 0.65x    |

Measured in the same session as the JavaScript table above, so the two are
directly comparable. Locations are not free for either parser: the ESTree shape
wants a fresh `{ line, column }` pair for each end of every node and token, and
building roughly 400,000 small objects costs this parser about a third of its
parse time (37.6 down to 26.0) and `espree` about a fifth (21.0 down to 16.8).
Finding which line an offset falls on is the cheap half — `LineIndex` remembers
the line it matched last, and source-order traversal hits it nearly every time.
Allocation is the expensive half, and neither parser can avoid it while
producing the shape ESLint expects.

**What this is worth in a real lint run is smaller than it looks.** Parsing is
roughly 15% of the time ESLint spends on a file; scope analysis and rules are
the rest. Everything downstream of parsing costs the same on either parser's
AST — traversal plus every recommended rule measures 96.0 ms on `espree`'s tree
and 96.2 ms on ours, and scope analysis is likewise within noise — so the parse
win carries through undiluted but only in proportion to its share.

The TypeScript 7 row is measured the same way, by redirecting module resolution
for `"typescript"` and reloading the parser. `@typescript-eslint/parser` does
not yet accept TypeScript 7, so that row currently reports itself as skipped
with the reason.

Note that the first three tables compare `parse()` **plus** `toAST()`. Skipping
`toAST()` is much faster still, which is the point of the binary
representation.

Benchmark a file of your own with:

```bash
npm run bench -- path/to/file.ts
```

Or run one suite on its own, which is the most reliable way to compare two
numbers:

```bash
node benchmarks/parse/benchmark.js --suite=eslint
```


`npm run bench:chart` runs the same benchmark, writes
`benchmarks/parse/results.json`, and renders `benchmarks/parse/results.svg`
from it — a self-contained, theme-aware chart meant to be shared. The chart
draws the two tiers as separate panels for the reason above, and orders the
rows by hand rather than by rank, so that two charts of different runs can be
laid over each other.
