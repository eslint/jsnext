# jsflow Technical Specification

How a binary AST and a scope buffer become a control flow graph, and what
the flow buffer contains.

This is a reference for people changing the analyzer. The
[README](../README.md) covers the public API; this document covers the
machinery behind it. The requirements the package answers to are in
[`requirements.md`](./requirements.md).

## Contents

- [What the analysis is](#what-the-analysis-is)
- [What shaped the format](#what-shaped-the-format)
- [Source layout](#source-layout)
- [The walk](#the-walk)
  - [Graphs are built one at a time](#graphs-are-built-one-at-a-time)
  - [Blocks, edges, and reachability](#blocks-edges-and-reachability)
  - [Conditions distribute](#conditions-distribute)
  - [Writes come from the scope buffer](#writes-come-from-the-scope-buffer)
  - [Exceptions and finally](#exceptions-and-finally)
  - [Jumps](#jumps)
  - [TypeScript and JSX](#typescript-and-jsx)
- [The binary flow format](#the-binary-flow-format)
  - [Handles](#handles)
  - [Layout](#layout)
  - [The node-block index](#the-node-block-index)
  - [The consumers](#the-consumers)
- [Deliberate imprecision](#deliberate-imprecision)
- [Invariants](#invariants)

## What the analysis is

`createGraph(ast, scope)` reads `@eslint/jsparse`'s binary AST and
`@eslint/jsscope`'s binary scope buffer and produces a basic-block control
flow graph for every **execution unit** in the program — the program itself,
each function, each class field initializer, and each class static block —
in one `ArrayBuffer`.

A **basic block** is a run of code with one entry and one exit: statements
and expressions accumulate into the current block until control can fork or
land. An **edge** records how control moves between blocks, and when the
move was decided by a condition, the edge carries which expression decided
it and which way it went. A **write** records that a block assigns to a
variable or a member expression, in execution order, tied to the scope
buffer's reference record for the written identifier.

Those last two are the forward-looking half of the design: branch conditions
on edges refine a type environment, and writes invalidate one, which is what
a future narrowing pass needs and what ESLint's code path analysis never
recorded.

## What shaped the format

Every ESLint core rule that consumes code path analysis was surveyed before
this format was designed, and the fifteen consumers divide into four jobs.
The format gives each one a direct answer:

| What rules actually do | How often | What the format provides |
| ---------------------- | --------- | ------------------------ |
| Ask "is this point reachable?" | 7 of 15 rules | `BF_REACHABLE` is precomputed per block, and the node-block index turns any visited node into its block with one binary search. The current-segment set that eleven rules hand-maintain disappears. |
| Use code paths as a correct function stack | 4 of 15 | Graphs are their own record section with an `origin` code readable without touching a block, spelled the way `codePath.origin` spells it. |
| Split "on every path" from "on some path" at exit | 2 of 15 | Each graph lists its returned blocks, its thrown blocks, and its implicit-exit block; loop back edges carry `EF_BACK` for fact propagation. |
| Carry variable state along edges | 2 of 15 | Blocks carry ordered writes tied to scope references; predecessor and successor edges are both grouped ranges, so state merges without inverting anything. |

`thrownSegments`, `finalSegments`, `initialSegment`, and `childCodePaths`
have zero consumers in ESLint core; their information is either kept cheaply
(`G_THROWN`, `G_INITIAL`) or reconstructible (a graph's blocks are
contiguous, so "child graphs" is a scan of the graph section).

## Source layout

```text
src/
  flow-buffer.ts         the binary flow format: layout constants, enum codes
  flow-builder.ts        recording blocks, edges, writes; emission
  flow-walker.ts         the walk over the binary AST
  flow-buffer-reader.ts  the low-level reads every consumer goes through
  to-graph-tree.ts       renders the buffer as a plain JSON tree
  handles.ts             node handle arithmetic
  index.ts               createGraph(), toGraphTree(), the exports
```

## The walk

One pass over every value-position node, in evaluation order, reading the
AST buffer directly through `AstReader` — nothing is decoded into ESTree
objects. Kinds with control flow of their own have explicit cases; every
other kind falls through to a generic child walk over `SLOT_TABLE`, the
same table `@eslint/jsscope` walks with.

### Graphs are built one at a time

Meeting a function does not walk into it. It queues a task — the node, its
origin, the enclosing graph's ID — and each queued graph is built after the
current one finishes. That is what makes a graph's blocks **contiguous** in
the block section, which is why a graph needs only a `first`/`count` pair
rather than a block list, and why a `try` region can be described as a range
of block IDs.

Class members queue three ways: a method's function expression queues as a
`function` graph, a field's value expression as a `class-field-initializer`
graph, and a static block as a `class-static-block` graph. Computed keys,
decorators, and the superclass expression run at class definition time and
stay in the enclosing graph.

### Blocks, edges, and reachability

Reachability is computed **while edges are added**, not by a fixpoint pass:
`addEdge(from, to)` marks `to` reachable when `from` is. That is sound
because of two ordering facts the walk maintains:

1. A block's outgoing edges are only recorded once every edge that could
   make it reachable already exists.
2. A loop back edge can never be the edge that first reaches a loop head,
   because the loop body it comes from is itself only reachable through
   that head.

After a `return`, `throw`, `break`, or `continue`, the walk starts a fresh
block with no incoming edges. Unreachable code still gets blocks, edges, and
writes — it simply carries `BF_REACHABLE = 0` — so "report this statement
as unreachable" is a lookup, not a hole.

Two constant conditions fold: a boolean or `null` literal condition emits
only the edge that can be taken, and `for (;;)` iterates unconditionally.
That is what makes code after `while (true) {}` unreachable and keeps
`do {} while (false)` from looking like a loop.

### Conditions distribute

A branch condition is compiled, not just visited: `&&`, `||`, `!`, nested
conditionals, and comma sequences distribute their targets, so every edge
carries the **innermost** expression it actually tests. `if (a && b)`
produces false edges conditioned on `a` and on `b` separately — never on
the whole expression — which is exactly the shape type narrowing needs.
`??` and `?.` fork on nullishness with `nullish`/`not-nullish` edges, and
the logical assignments (`&&=`, `||=`, `??=`) put their right side and
their write on the conditional path.

### Writes come from the scope buffer

The walk never re-derives what counts as a variable write. The scope buffer
already records a reference for every identifier that writes, keyed by the
identifier's node handle, and the walker builds a map from those handles to
reference IDs once, up front. Every visited identifier does one lookup; a
hit means **this very node** is a write target, because a read of the same
variable is a different node. Destructuring, compound assignment, loop
heads, and initializers all fall out of the ordinary descent with no
pattern-specific write logic.

The one thing the scope buffer cannot speak for is a member-expression
target — `obj.x = 1` binds no variable — so assignment targets are walked
explicitly and member writes are recorded with `W_REF = 0` and
`WF_MEMBER`.

A write records the reference's byte offset, the target's handle, the
written value's handle, and how the write happened (`WF_INIT`,
`WF_COMPOUND`, `WF_UPDATE`, `WF_MEMBER`). Everything else — the resolved
symbol, read/write flags, the variable's other references — is one hop away
in the scope buffer through `W_REF`.

### Exceptions and finally

Exception flow is **region-based**. Every block created while walking a
`try` block gets an `exception` edge to the handler (or to the finalizer
when there is no handler), and every block of a `catch` gets one to the
finalizer when there is one. Regions are contiguous ID ranges, so this is a
loop, not a set. Nested `try`s compose: an inner handler's blocks sit
inside the outer region and inherit its edges, which is how a rethrow out
of an inner `catch` reaches the outer handler.

An explicit `throw` marks its block `BF_THROWS` and ends it. If no
enclosing `try` in the same graph routes the exception, the block joins the
graph's `thrown` list.

A `finally` is a single block sequence however control entered it. Abrupt
completions (`return`, `break`, `continue`) route into it with `abrupt`
edges and resume from its end; the exception path continues out of its end
to the enclosing region or the `thrown` list. Its normal exit — the edge to
the code after the statement — is added **only when the protected code can
complete normally**, so `try { return x; } finally {}` does not make the
code after the `try` look reachable.

### Jumps

`break` and `continue` resolve against a stack of enclosing constructs.
Labels attach to the loop or switch they precede (or open a labeled block
context), and label matching compares source text directly — labels are not
variables and appear in neither buffer. A jump that crosses a `finally`
detours through it: the jump edge lands on the finalizer, and the finalizer
records where to continue when it completes, chaining through further
finalizers as needed.

A `continue` edge into the loop head, and the structural loop-closing edge,
carry `EF_BACK`; the head carries `BF_LOOP_HEAD`. `while` heads at the
test, `do...while` heads at the body, `for` heads at the test with the
update outside the back edge, and `for...in`/`for...of` head at a synthetic
iteration block whose `iterate`/`done` edges carry the iterated expression
as their condition.

### TypeScript and JSX

Type positions have no control flow, so TypeScript kinds are skipped
wholesale except the ones that contain runtime code: the expression
wrappers (`as`, `satisfies`, `!`, `<T>`, instantiation), parameter
properties, namespace bodies, and enum member initializers. Skipped nodes
simply have no entry in the node-block index. JSX needs no cases at all —
the generic child walk reaches every embedded expression, and conditional
rendering is just the logical expressions it is written with.

## The binary flow format

What `createGraph()` returns: one `ArrayBuffer` of little-endian 32-bit
words, written by `FlowBuilder#finish()` and read back by
`FlowBufferReader`. Every layout constant lives in `flow-buffer.ts`; the
enum code tables there (edge kinds, origins) are **append-only**, because
an entry's position is its meaning in every buffer ever written.

IDs are stable and immutable: a graph, block, edge, or write is its
zero-based index into its own record section. Where a field holds an
optional ID it is stored as `id + 1`, so `0` means "none".

### Handles

The buffer never contains a node; it contains **handles** — the byte offset
of the node's record in the AST buffer, exactly as the scope buffer's
binary path stores them, so a handle read out of either buffer names the
same node. Scope references are byte offsets of reference records in the
scope buffer. `0` means "none" for both.

This is why `createGraph()` requires a scope buffer from `analyze()` and
refuses one from `analyzeTree()`: tree buffers number nodes another way,
and the mismatch would resolve nonsense. The header flag makes the refusal
loud.

### Layout

```text
header             16 words: magic "JCFG", version, flags, counts,
                   section bases
graph records      9 words each: origin, node, upper+1, initial block,
                   first block, block count, returned list, thrown list,
                   implicit block+1
block records      8 words each: flags, graph, successor range,
                   predecessor range, write range
edge records       4 words each: from, to, kind+flags, condition handle;
                   grouped by source block
predecessor index  edge IDs grouped by target block
write records      4 words each: reference offset, target, value, flags;
                   grouped by block, in execution order
pool               every variable-length list, as [count, items...];
                   0 = empty
node-block index   sorted (node handle, block ID) pairs
```

Three groupings replace every list a consumer would otherwise build:

- **Edges are sorted by source block**, so a block's successors are a
  `first`/`count` slice of the edge section itself.
- **The predecessor index groups edge IDs by target block**, so a dataflow
  pass merges incoming state without inverting the edge list.
- **Writes are sorted by block**, stably, so a block's writes are a slice
  and read in execution order.

All three groupings are computed at emission with counting sorts; the
recording side just appends.

### The node-block index

One `(handle, block)` pair per node the walk visited, sorted by handle,
answered by binary search. This is the piece that retires the
current-segment set: "which block holds this node" and "is this node
reachable" — the two questions nearly every code-path rule asks — become
`blockOfNode()` and `isReachable()` with no consumer-side tracking across
four visitor events.

The pairs arrive from the walk nearly sorted, so emission sorts with an
insertion-cutoff quicksort rather than trusting the order or paying a
comparator-based sort.

Nodes the walk never visits — type annotations, unexecuted declaration
scaffolding — have no entry, and the queries answer `-1` and `false` for
them.

### The consumers

Two views read the buffer, both through `FlowBufferReader`:

- **`FlowBufferReader`** itself answers point queries straight off the
  words: record fields, pool lists, `blockOfNode()`, `isReachable()`.
- **`toGraphTree(flow, ast, scope)`** renders a nested, self-contained JSON
  tree for debugging, with nodes spelled `{type, start, end}` and writes
  resolved to symbol names through the scope buffer.

## Deliberate imprecision

Four places trade precision for simplicity, on purpose. Anything else that
differs from actual runtime control flow is a bug.

1. **`finally` is one block sequence**, not one copy per completion kind.
   Every way in merges, every way out fans back out, so state observed
   inside a finalizer is the union over completion paths. The normal-exit
   guard (see [above](#exceptions-and-finally)) keeps the common
   reachability questions right anyway.
2. **Exception edges are per-region, not per-operation.** Every block in a
   `try` region is assumed able to throw; which operations actually can is
   not modeled. Handler-entry state is therefore the union over the whole
   region.
3. **Pattern and parameter defaults are walked as always evaluated**,
   without the fork on `undefined`.
4. **Constant folding stops at boolean and `null` literals** (plus the
   absent `for` test). `while (1)` is not folded; `while (true)` is.

Evaluation-order fine print: a member assignment's target object is
recorded after its right side, and a template literal's quasis and
expressions are visited by slot rather than interleaved. Neither reorders
any write or branch.

## Invariants

Things that will break subtly if violated:

1. **A graph's blocks are contiguous.** Nested graphs are queued, never
   walked inline. Regions, `first`/`count` slices, and the tree view all
   depend on it.
2. **All edges into a block precede its outgoing edges**, except loop back
   edges, which can never be first to reach the head. Reachability is
   propagated at `addEdge()` time on this assumption; violate it and blocks
   go stale-unreachable with no error.
3. **Writes within a block are appended in execution order**, and emission
   groups them stably. Dead-store and narrowing passes read that order as
   meaning.
4. **Handles match `@eslint/jsscope`'s binary path.** The write map is
   keyed by the scope buffer's identifier handles; a divergence silently
   records no writes at all.
5. **A shorthand property is visited once.** Its key and value are the
   same identifier; the generic two-slot walk would double every write in
   `{ a } = ...`.
6. **The enum code tables are append-only**, and so are the header words:
   repositioning either changes the meaning of every existing buffer.
7. **The builder and the reader are the only modules that know the
   layout.** Every consumer reads through `FlowBufferReader`; a field
   offset used anywhere else is a bug waiting for the next format change.
