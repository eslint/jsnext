# Control flow analysis

`createGraph()` and the two ways to read what it produces.

The [package README](../../README.md#control-flow) has the short version.

`createGraph()` produces a basic-block control flow graph for every execution
unit in a program — the program, each function, each class field initializer,
each static block — as one compact `ArrayBuffer`. Blocks record the variable
writes they perform, in execution order and tied to the scope analysis; edges
record the branch condition that was taken. Those two facts are what a future
type-narrowing pass consumes, and the rest of the format is shaped by what
ESLint rules actually ask of code path analysis: reachability, execution-unit
enumeration, and every-path/some-path exit questions are all direct lookups.

## Usage

```js
import {
	parse,
	analyze,
	createGraph,
	toGraphTree,
	FlowBufferReader,
} from "@eslint/jskit";

const parsed = parse(sourceText);
const scope = analyze(parsed);
const flow = createGraph(parsed, scope);

// Point queries, straight off the buffer.
const reader = new FlowBufferReader(flow);
reader.isReachable(nodeHandle); // can control get here?
reader.blockOfNode(nodeHandle); // which basic block runs this node?

// A self-contained, JSON-serializable view for debugging.
console.log(JSON.stringify(toGraphTree(flow, parsed, scope), null, 2));
```

The scope buffer must come from `analyze()` over the same parse result. Both
buffers name nodes by the same byte offsets — that is also how the flow buffer
ties a write to its scope reference — so a buffer from `analyzeTree()` is
refused, with a `TypeError` that says so.

## API

- **`createGraph(ast, scope, options?)`** — builds the graph; returns an
  `ArrayBuffer` in the binary flow format. Its one option is `text`, the
  program the parse buffer cannot otherwise reach — the fallback for a buffer
  parsed without `{ source: true }` and then read outside the process that
  parsed it. The walk reads text only to match a `break` or `continue`
  against its label, so a program without labels analyzes either way;
  supplying the text makes the result independent of what the program
  happens to contain. See
  [`embedded-source.md`](../parse/embedded-source.md#the-text-option-the-fallback-for-a-buffer-already-shipped).
- **`toGraphTree(flow, ast, scope)`** — renders that buffer as a plain object
  tree with no references to anything outside itself. Each block carries the
  `nodes` it holds along with the writes it performs, so a block that runs
  code but assigns nothing is still legible.
- **`FlowBufferReader`** — the low-level reader every consumer goes through:
  record fields, lists, `blockOfNode()`, `isReachable()`.
- **`nodeHandle()` / `nodeAtHandle()`** — the arithmetic between node indices
  and the byte-offset handles stored in the buffer.
- The layout constants of the format itself (`flow-buffer.ts`) are exported for
  tools that read the buffer directly. They carry a `FLOW_` prefix where the
  scope format describes the same thing with a `SCOPE_` one — the two header
  blocks are the only names the two formats would otherwise share.

## Verified by its integration tests

Unlike the parser and the scope analyzer, this analysis has no differential
conformance suite, because there is no reference implementation to diff
against. The integration tests in [`../../tests/flow/`](../../tests/flow/) are
the contract.

## Where the format is specified

[`architecture.md`](./architecture.md) documents the flow format field by
field, the walk that fills it, and the four places it deliberately trades
precision for simplicity.
