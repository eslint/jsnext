# @eslint/jsflow

A fast control flow graph builder for JavaScript and TypeScript, built on
`@eslint/jsparse`'s binary AST and `@eslint/jsscope`'s binary scope format.

`createGraph()` produces a basic-block control flow graph for every
execution unit in a program — the program, each function, each class field
initializer, each static block — as one compact `ArrayBuffer`. Blocks
record the variable writes they perform, in execution order and tied to the
scope analysis; edges record the branch condition that was taken. Those two
facts are what a future type-narrowing pass consumes, and the rest of the
format is shaped by what ESLint rules actually ask of code path analysis:
reachability, execution-unit enumeration, and every-path/some-path exit
questions are all direct lookups.

## Usage

```js
import { parse } from "@eslint/jsparse";
import { analyze } from "@eslint/jsscope";
import { createGraph, toGraphTree, FlowBufferReader } from "@eslint/jsflow";

const parsed = parse(sourceText);
const scope = analyze(parsed);
const flow = createGraph(parsed.ast, scope);

// Point queries, straight off the buffer.
const reader = new FlowBufferReader(flow);
reader.isReachable(nodeHandle);   // can control get here?
reader.blockOfNode(nodeHandle);   // which basic block runs this node?

// A self-contained, JSON-serializable view for debugging.
console.log(JSON.stringify(toGraphTree(flow, parsed.ast, scope), null, 2));
```

The scope buffer must come from `analyze()` over the same parse result.
Both buffers name nodes by the same byte offsets — that is also how the
flow buffer ties a write to its scope reference — so a buffer from
`analyzeTree()` is refused.

## API

- **`createGraph(ast, scope)`** — builds the graph; returns an
  `ArrayBuffer` in the binary flow format.
- **`toGraphTree(flow, ast, scope)`** — renders that buffer as a plain
  object tree with no references to anything outside itself.
- **`FlowBufferReader`** — the low-level reader every consumer goes
  through: record fields, lists, `blockOfNode()`, `isReachable()`.
- **`nodeHandle()` / `nodeAtHandle()`** — the arithmetic between node
  indices and the byte-offset handles stored in the buffer.
- The layout constants of the format itself (`flow-buffer.ts`) are
  exported for tools that read the buffer directly.

The format, the walk, and the deliberate approximations are specified in
[`docs/architecture.md`](./docs/architecture.md).
