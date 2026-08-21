# Scope analyzer performance

How the analyzer compares to the analyzers it reproduces, and why the ratio
moves with machine temperature more than the absolute numbers do.

```bash
npm run bench
```

Analysis alone, with the parse hoisted out of the measured region. Every
contender in a row is handed the same work, and `analyzeTree()` and the
reference analyzer are handed the same tree object. The comparison is not
quite like for like — the reference analyzers stop at an object graph, while
both entry points here deliver the finished scope buffer — and it is the
buffer side that wins anyway:

| Suite      | `analyze()` | `analyzeTree()` | Reference                          |
| ---------- | ----------- | --------------- | ---------------------------------- |
| JavaScript | **1.8×**    | 0.2×            | `eslint-scope`                     |
| TypeScript | **2.6×**    | 0.2×            | `@typescript-eslint/scope-manager` |
| JSX        | **1.5×**    | 0.2×            | `eslint-scope`                     |

The speed comes from never materializing the graph: the walk records scopes,
symbols, and references straight into growable word buffers — no object per
scope, per variable, or per reference — and `finish()` compacts those words
into the buffer. `analyzeTree()` runs the same walk but pays for reading
someone else's tree through table-driven property lookups, plus the up-front
enumeration that gives every tree node a stable handle. It is the
compatibility path, priced accordingly.

Parsing and analysis together, which is what a tool actually asks for:

| Suite      | `parse()` + `analyze()` | Reference                 |
| ---------- | ----------------------- | ------------------------- |
| JavaScript | **2.5×**                | `espree` + `eslint-scope` |
| TypeScript | **14×**                 | `@typescript-eslint/*`    |

Numbers move a lot with machine temperature, and not evenly: this analyzer
allocates far less than the reference analyzers, so a throttled machine slows
it down proportionally more and _deflates its ratio_. The TypeScript row reads
about 3.9× on a cool machine and about 2.5× on a hot one, with its own
throughput halved in the second case. Take the best of several runs, and
compare ratios within a run rather than absolute numbers across runs.

The scope benchmark measures its contenders in one process, unlike the parser
benchmark. Run it with:

```bash
node benchmarks/scope/benchmark.js
```
