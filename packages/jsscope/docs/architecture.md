# jsscope Technical Specification

How one scope analysis serves two AST representations, and what it does
differently from the two implementations it reproduces.

This is a reference for people changing the analyzer. The
[README](../README.md) covers the public API; this document covers the
machinery behind it.

## Contents

- [What the analysis is](#what-the-analysis-is)
- [Source layout](#source-layout)
- [Two representations, one walk](#two-representations-one-walk)
  - [The accessor](#the-accessor)
  - [Nodes are integers, or objects](#nodes-are-integers-or-objects)
  - [Dispatch](#dispatch)
  - [The generic child walk](#the-generic-child-walk)
  - [Slot names](#slot-names)
  - [Names](#names)
  - [Tree shaking](#tree-shaking)
- [The walk](#the-walk)
  - [Opening and closing scopes](#opening-and-closing-scopes)
  - [Patterns](#patterns)
  - [Value position and type position](#value-position-and-type-position)
  - [Classes](#classes)
- [Resolution](#resolution)
  - [Delegation](#delegation)
  - [Dynamic scopes](#dynamic-scopes)
  - [Implicit globals](#implicit-globals)
  - [The two resolution rules that are not lexical](#the-two-resolution-rules-that-are-not-lexical)
- [The binary scope format](#the-binary-scope-format)
  - [IDs](#ids)
  - [Node handles](#node-handles)
  - [Layout](#layout)
  - [What is stored and what is re-derived](#what-is-stored-and-what-is-re-derived)
  - [The consumers](#the-consumers)
- [Reproducing two implementations at once](#reproducing-two-implementations-at-once)
- [Invariants](#invariants)
- [Adding a node kind](#adding-a-node-kind)

## What the analysis is

One walk over the program, in source order, that does three things:

1. Opens a scope wherever the language says one begins, and closes it where it
   ends.
2. Declares a **variable** wherever a name is bound, with a **definition**
   recording how.
3. Records a **reference** wherever a name is used, and files it under the
   scope it was written in.

Nothing is resolved during the walk. A reference is queued on the scope that
holds it, and resolution happens when that scope closes, because only then is
every name it binds known. A reference the scope cannot satisfy is handed to
the enclosing scope, which repeats the process. That is why a `var` declared at
the bottom of a function still resolves a reference from the top of it.

The walk materializes no graph. It records everything into `ScopeBuilder` —
a scope is thirteen words in a growable buffer, a reference is its eight
format words plus one side word, every list is a chain of `[value, next]`
cells in a shared pool — and resolution at scope close runs over those words.
`finish()` compacts them into one `ArrayBuffer` in the binary scope format
described [below](#the-binary-scope-format), and that buffer is the result.
There is no `Scope`, `Variable`, `Reference`, or `Definition` object anywhere
in the analysis; the classes with those names exist on the other side of the
buffer, in `toScopeManager()`, which rehydrates the escope-compatible graph
on demand. The conformance suites go through that rehydration, so the whole
build–emit–rehydrate pipeline is checked against both reference
implementations on every corpus file.

## Source layout

```text
src/
  ast-access.ts            the narrow view of an AST that the walk needs
  binary-ast.ts            that view over @eslint/jsparse's binary buffers
  estree-ast.ts            that view over an ordinary ESTree tree
  slot-names.ts            what each slot is called in an ESTree tree
  kinds.ts                 scope types, definition types, reference flags
  options.ts               the options an analysis runs with
  pattern-visitor.ts       the walk over a destructuring pattern
  referencer.ts            the main walk
  scope-builder.ts         the graph in binary form: recording, resolution, emission
  scope-buffer.ts          the binary scope format: layout constants, enum codes
  scope-buffer-reader.ts   the low-level reads every consumer goes through
  handles.ts               node handle arithmetic for the binary path
  tree-nodes.ts            the deterministic enumeration behind tree handles
  node-source.ts           turning stored handles back into nodes, both paths
  scopes.ts                Scopes: point queries straight off the buffer
  to-scope-manager.ts      rehydrates the escope-compatible object graph
  to-scope-tree.ts         renders the buffer as a plain JSON tree
  definition.ts            the rehydrated view: a declaring occurrence
  variable.ts              the rehydrated view: a bound name
  reference.ts             the rehydrated view: an occurrence of a name
  scope.ts                 the rehydrated view: one lexical scope
  scope-manager.ts         the rehydrated view: the collection of scopes
  index.ts                 the public API: analyze(), analyzeTree(), the consumers
```

The last five are what `toScopeManager()` builds and what anything written
against `eslint-scope` consumes. `scope.ts` still carries the object
implementation of closing and resolution, but the entry points no longer
execute it — the one piece both implementations share is
`hasUseStrictDirective()`, which the builder imports rather than restating.
**Scope semantics have one home: the walk's decisions live in
`referencer.ts`, and what happens as scopes bind, resolve, and close lives
in `scope-builder.ts`.** The object methods in `scope.ts` are kept for the
rehydrated API's completeness, not as a second implementation to update.

## Two representations, one walk

### The accessor

The walk never touches a node directly. Everything it needs to know goes
through `AstAccess`, an interface with two implementations: `BinaryAst` over
`@eslint/jsparse`'s buffers, and `EstreeAst` over an ordinary tree.

The alternative was writing the walk twice, which would have been faster —
neither implementation would pay for the indirection, and each could read
children the way its representation prefers. It was rejected because the walk
is fifty-odd rules reconciled from two reference implementations, and keeping
two copies of those rules in agreement is a losing game. One walk, checked
against both references through both entry points, is worth the indirection.

Three things had to be true for a single walk to be possible at all, and the
interface is shaped around them: kinds are integers, children are addressed by
slot, and absence is `null`.

### Nodes are integers, or objects

`@eslint/jsparse` stores every node as twelve 32-bit words in one
`ArrayBuffer`, and a node is identified by its index. On that path `jsscope`
never leaves the buffer: a scope's `block`, a reference's `identifier`, and a
definition's `name`, `node`, and `parent` are all integers.

This is the performance story. The reference analyzers are not slow; they are
handed a tree that had to be built first, and building it allocates an object
per node with a string `type` on it. Reading `reader.kind(node)` instead is one
multiply, one add, and one typed-array load.

On the tree path a node is the caller's own object, which is what makes the
result usable next to an AST the caller already holds: a rule can compare
`reference.identifier` against the node it is visiting.

**Absence is `null` in both.** The binary format spells it `0`, and `BinaryAst`
translates on the way out, so nothing above the accessor has to know. The one
extra comparison per child read buys a model that means the same thing either
way.

A caller holding a bare node index cannot do much with it, which is what
`ScopeManager#nodeType`, `ScopeManager#nodeRange`, and the exposed `reader` are
for. The first two work on either representation.

### Dispatch

The reference implementations dispatch by looking up a method named after the
node's `type` string. Here it is a `switch` over an integer kind, which the
engine compiles to a jump table. `Referencer#visit` is that switch, and
`Referencer#visitType` is a second one for [type
position](#value-position-and-type-position).

`EstreeAst` maps `type` to the same integer constants `@eslint/jsparse`
assigns, once per node, and caches the result so that the slot lookups right
after it are free. A `type` it does not recognize maps to kind `0`, which
routes to the fallback described below.

### The generic child walk

Kinds with no rule of their own fall through to `visitChildren`, which reads
`SLOT_TABLE` from `@eslint/jsparse` — the table that says, for each kind,
whether each of the eight data slots holds a child node, a list handle, or
opaque data.

The reference implementations use visitor keys for the same purpose, and the
two agree on **order** everywhere the difference is observable, which matters
because references are compared in the order they were recorded. The kinds
where slot order and visitor-key order differ are all handled explicitly:
`JSXElement`, `CallExpression`, `NewExpression`, `TaggedTemplateExpression`,
`TSImportType`, `TSParameterProperty`, `TSMappedType`, the class kinds, and the
function kinds.

That is the failure mode to watch for when adding a node kind: a wrong slot
order produces a scope graph that is correct in every respect except the order
of two references, which nothing but the differential corpus will catch.

A node whose kind is `0` — a type from a parser with syntax of its own — has no
slot table, so its children are found by inspecting its properties instead.
That is what `eslint-scope` does for the same case, and skipping the subtree
would silently lose every reference in it.

### Slot names

`EstreeAst` turns a slot back into a property name through `SLOT_NAMES`, which
is `slots.ts` from `@eslint/jsparse` with names filled in. The two files are
deliberately laid out the same way so they can be read side by side, but the
grouping differs wherever kinds share a layout without sharing names: a
`WithStatement` and a `LabeledStatement` both hold two child nodes, and one
calls the first `object` while the other calls it `label`.

Three things the two representations genuinely disagree about could not be
expressed as a slot, so they are separate methods on the accessor:

- **`TSMappedType`.** The binary format hangs the key and its constraint off a
  synthetic `TSTypeParameter`; the ESTree shape has them directly on the mapped
  type.
- **A parameter's decorators.** `@eslint/jsparse` wraps a decorated parameter
  in a `TSParameterProperty`; an ESTree tree leaves the parameter alone and
  gives it a `decorators` property.
- **Directives.** The binary format flags an `ExpressionStatement` as a
  directive; a tree carries the text in `directive`.

### Names

Resolution is by name, so every identifier's text has to be read. On a tree
that is `node.name`. On the binary path `BinaryAst#name` slices it straight out
of the source string and only calls `@eslint/jsparse`'s `decodeEscapes` when a
backslash is present, which is almost never; the name ends where slot A says,
not at the node's `end`, because a type annotation extends the node past its
name.

A name is read once and stored on the `Reference`, because resolution needs it
again at every scope on the way out.

### Tree shaking

`analyze()` and `analyzeTree()` are separate exports importing separate
adapters, and the package is marked `sideEffects: false`, so a bundler drops
whichever one is unused — along with, in the binary case, the slot-name table
that only the tree adapter reads.

That only works if these modules are free of top-level side effects, which took
some care: both `SLOT_NAMES` and the tree adapter's type-to-kind map are built
by a function called as a `/* @__PURE__ */` expression rather than by top-level
statements that mutate a module-level array. Eighty `define()` calls at the top
level look like eighty side effects, and no bundler will remove any of them.
`tests/tree-shaking.test.ts` bundles each entry point and asserts what came
out, so the property cannot quietly regress.

## The walk

### Opening and closing scopes

`ScopeManager#nest*` opens a scope and makes it current. `Referencer#close(node)`
closes every scope whose `block` is that node — a loop, not a single pop,
because one node can open several: a `Program` opens the global scope, a
function scope under `globalReturn`, and a module scope, and all three close
together.

A scope's `block` is what identifies it, which is why a class field initializer
uses the *value* expression as its block rather than the property: the property
is not a scope, and the value is what runs.

### Patterns

`PatternVisitor` walks a destructuring pattern and calls back at every name it
binds. What it does not do is visit the expressions mixed in with those names —
a computed key, a default value, the object of a member expression — because
those are evaluated rather than bound. It collects them into `rightHandNodes`
and the caller visits them afterward as ordinary code.

The callback receives three things the caller needs: `topLevel` (whether the
name is the whole pattern, which decides whether a write is partial), `rest`
(whether it came from a rest element), and `assignments` (the defaults
enclosing it, each of which is a write in its own right).

### Value position and type position

TypeScript needs the same name to mean different things depending on where it
appears, so there are two walks. `visit` records value references; `visitType`
records type references and opens the type-only scopes. Which one runs is
decided at the point where the grammar changes, never by inspecting the node:
`visitType` is called on a type annotation, a type argument list, a heritage
clause, and so on.

Three places cross back:

- A computed key inside a type member is ordinary code.
- `typeof x` names a value even though it sits in type position.
- A type predicate's parameter name is a value.

### Classes

A class binds its own name twice: once in the enclosing scope, so the
declaration is visible, and once inside the class scope, so that the body sees
the class even if the outer binding is later reassigned. Both bindings are
separate `Variable`s in separate scopes with the same definition type.

A method's parameter decorators are the one place where the two reference
implementations order things differently from each other for the *same*
construct: on a plain function they are evaluated inside the function scope,
after the parameter; on a method they are evaluated in the class scope, before
the function scope opens. Both are reproduced, which is what the `isMethod`
argument to `visitFunction` is for.

## Resolution

### Delegation

When a scope closes, each queued reference is looked up in that scope's `set`.
A hit links the two — `reference.resolved` and `variable.references` — and a
miss pushes the reference onto the enclosing scope's queue and records it in
this scope's `through`. A reference that reaches the global scope without
resolving stays unresolved and appears in `globalScope.through`.

### Dynamic scopes

A `with` body and a scope containing a direct call to `eval` cannot be resolved
from the source alone: either could introduce a binding at runtime. Such a
scope is `dynamic`, and closing it pushes every reference onto `through` all
the way to the global scope instead of resolving it. References passing out of
a `with` are also marked `tainted`, so a consumer can tell a resolution it can
trust from one it cannot.

The global scope is dynamic too, but it closes statically anyway: there is
nowhere left to pass a reference to.

### Implicit globals

Outside strict mode, assigning to a name nothing declared creates a global. The
assignment records a `maybeImplicitGlobal` on its reference, and the global
scope turns the ones no declaration covers into variables in
`globalScope.implicit` — deliberately not in `globalScope.set`, so that "this
program creates an undeclared global" stays distinguishable from "this program
uses a global the host provides".

### The two resolution rules that are not lexical

- **A default parameter cannot see the body.** In
  `function f(a = x) { const x = 2; }` the `x` belongs to whatever encloses
  `f`. The check compares offsets: a reference before the body's start does not
  resolve to a variable whose every definition is inside the body.
- **A name bound only as a type does not satisfy a value reference, and vice
  versa.** `interface A {}` followed by `A;` leaves the `A` unresolved. Each
  definition kind declares whether it contributes a type binding, a value
  binding, or both; a variable is whatever its definitions make it.

Both rules run in every dialect. In JavaScript the second one cannot fire,
because every reference is a value reference and every definition contributes a
value binding.

## The binary scope format

What `analyze()` and `analyzeTree()` return: one `ArrayBuffer` of
little-endian 32-bit words, emitted by `ScopeBuilder#finish()` and read
back by `scope-buffer-reader.ts`. The format exists so that scope data can be
kept, passed, and queried without materializing an object per scope, variable,
and reference; the requirements it answers to — which queries had to be cheap,
and why — are recorded in [`requirements.md`](./requirements.md).

### IDs

Every scope, symbol (the format's name for a variable), reference, and
definition is identified by its zero-based index into its record section.
IDs are assigned once, when the buffer is written, and are never renumbered:

- **Scopes** are numbered in creation order.
- **References** are numbered in the order the walk recorded them. A scope's
  own reference list still reads in per-scope order — the list is stored,
  not derived from the IDs.
- **Symbols** are numbered scope by scope in binding order, with the global
  scope's implicit variables at the end. That grouping is what lets an
  implicit variable a supplied global replaced simply not be emitted.
- **Definitions** follow their symbols.

Where a record field holds an *optional* ID or index, it is stored as
`value + 1` so that `0` can mean "none".

### Node handles

The buffer never contains a node; it contains **handles**. On the binary path
a handle is the byte offset of the node's record in the AST buffer
(`handles.ts` holds the arithmetic both directions). On the tree path it is
the node's one-based position in the deterministic enumeration
`tree-nodes.ts` produces — a pure depth-first walk over own properties,
`parent` skipped — which `analyzeTree()` runs to assign handles and every
consumer re-runs on the same tree to get the very same objects back. Handle
`0` means "no node" on both paths, and a header flag records which scheme a
buffer uses so a consumer handed the wrong program fails loudly instead of
resolving nonsense.

### Layout

```text
header               24 words: magic "JSSC", version, flags, counts, section
                     bases, the options the analysis ran with
scope records        9 words each: type, flags, block, upper+1, variableScope,
                     variables, references, through, implicit
symbol records       6 words each: name, scope, flags, identifiers,
                     definitions, references
reference records    8 words each: identifier, name, from, resolved+1, flags,
                     writeExpr, implicit-global pattern and node
definition records   7 words each: type, name, node, parent, index+1, kind+1,
                     flags
pool                 every variable-length list, as [count, items...]; a
                     record's list field holds a pool handle, 0 = empty
node-scope index     sorted (block handle, scope ID) pairs — acquire()
declared index       sorted (node handle, pool handle) pairs —
                     getDeclaredVariables()
ident-ref index      sorted (identifier handle, reference ID) pairs —
                     resolving one identifier
string table         offsets, then UTF-8 bytes; names and definition kinds,
                     interned once
```

The three pair sections are the point-query indexes: each is sorted by key,
answered by binary search. They cover the three lookups rules do most —
node to scope, declaration to bindings, identifier to reference — without
scanning a record section.

Names live in the buffer's own string table rather than being re-read from
the AST, for two reasons: some symbols have no identifier to read a name from
(`arguments`, every configured global), and interning makes name comparison
an integer comparison. This is the one deliberate duplication between the two
buffers.

The enum code tables in `scope-buffer.ts` — scope types, definition types —
are part of the format, and their order is **append-only**: repositioning an
entry changes what every previously written buffer means.

### What is stored and what is re-derived

Serialization keeps exactly what cannot be recomputed and drops what can.
Stored: every flag the walk decided (`isStrict`, `dynamic`, taint, `stack`),
every list in its final order, the `through` lists, the declared-variables
index (its per-node order is walk order, not derivable from the records), and
the options. Re-derived on rehydration: `childScopes` and the node-to-scope
map (both fall out of creating scopes in stored order), `implicit.left` (a
copy of the global `through`), and the `arguments` taint on non-arrow
function scopes (set at scope creation, before any resolution). The `Scope`
constructor accepts the stored strictness so rehydration does not re-scan
directive prologues.

### The consumers

Three views read the buffer, all through `ScopeBufferReader`, all taking the
buffer plus the program it was produced from:

- **`Scopes`** answers point queries straight off the words — the exploratory
  API for finding out what the format can do, shaped by the rule survey in
  `requirements.md`. `markSymbolAsUsed()` keeps its marks in a side bitset
  beside the immutable buffer.
- **`toScopeManager()`** rebuilds the object graph out of the very classes
  the walk uses, so a rehydrated graph is indistinguishable from a freshly
  built one — including for `@eslint-community/eslint-utils`. Passing the
  `Scopes` view via its options bridges `Variable#eslintUsed` to that view's
  bitset. Each `Variable` carries its buffer ID as `symbolId`.
- **`toScopeTree()`** renders a nested, self-contained JSON tree for
  debugging, with nodes spelled `{type, start, end}`.

The consumers accept either representation and therefore import both
adapters; only the two entry points are split for tree shaking.

## Reproducing two implementations at once

`eslint-scope` and `@typescript-eslint/scope-manager` are the same design with
a decade of drift between them. The rule here is that **`eslint-scope` wins**
wherever they disagree about ground both cover, and the TypeScript analyzer is
followed for everything only it has an opinion about.

Three disagreements survive as options rather than as decisions, because both
answers are defensible and a caller may need either: `jsxPragma`,
`jsxFragmentName`, and `globals`. All three default to the `eslint-scope`
answer. The fourth, `export { a }` naming both a value and a type, follows the
`dialect` option, since that is exactly the question the dialect asks.

Two fields exist only because one implementation has them: `Reference#partial`
(`eslint-scope`) and `Reference#isTypeReference` (`@typescript-eslint`). Both
are always present here.

## Invariants

Things that will break subtly if violated:

1. **A scope's queue is consumed exactly once.** The builder clears a
   scope's `left` chain as `closeCurrent()` finishes with it — and the object
   implementation sets `left` to `null`, which `isClosed()` reads.
   Referencing a closed scope loses the reference silently.
2. **`close(node)` loops.** One node can open several scopes; popping one is a
   correct-looking bug that misplaces every later scope.
3. **Reference order is part of the contract.** Rules read
   `scope.references` in order, and the differential corpus compares it
   element by element.
4. **A name is read once.** `Reference#name` is the resolution key; deriving it
   again from the node at resolution time would be correct but slow.
5. **`null` means no node** everywhere above the accessor, including in a
   definition's `parent` and a reference's `writeExpr`. Only `BinaryAst` knows
   that the buffer spells it `0`.
6. **The global scope's implicit variables are not in `set`.** Putting them
   there would resolve later references to them and change the meaning of
   `through`.
7. **The two adapters answer identically.** Anything the walk asks is a
   question about the program, not about how the program is stored. A method
   that only one of them can answer honestly belongs somewhere else.
8. **The enum code tables are append-only.** A scope type or definition type's
   position in `scope-buffer.ts` is its meaning in every buffer ever written;
   new entries go at the end.
9. **IDs are never renumbered.** A symbol ID is the record's index, assigned
   at write time; everything from `Reference#resolved` to the `eslintUsed`
   bitset keys off it. Any pass that reordered records would silently corrupt
   every cross-reference.
10. **Tree enumeration is pure.** `collectTreeNodes()` must visit the same
    tree the same way every time, because `analyzeTree()` and the consumers
    each run it independently and rely on getting the same numbering. Nothing
    in it may depend on anything but the tree's own objects.
11. **The writer and the reader are the only modules that know the layout.**
    Every consumer reads through `ScopeBufferReader`; a field offset used
    anywhere else is a bug waiting for the next format change.

## Adding a node kind

When `@eslint/jsparse` gains a node kind, decide four things:

1. **What are its slots called?** Add an entry to `SLOT_NAMES`, in the same
   place `slots.ts` puts the kind. Forgetting this is the failure mode to watch
   for: the binary path keeps working and the tree path silently stops
   descending into the node.
2. **Does it open a scope?** Add a `nest*` method to `ScopeManager` and a scope
   type to `kinds.ts`, and remember `isVariableScopeType` and
   `isImplicitlyStrictType` if the answer is not obvious.
3. **Does it bind or reference a name?** Add a case to `Referencer#visit`, or
   to `visitType` if the name appears in type position.
4. **Does it do neither?** Then it needs no case at all — the generic child
   walk handles it — but check that its slot order matches the visitor-key
   order of whichever reference implementation covers it, and add an explicit
   case if it does not.

Then run `npm run conformance`, which exercises both entry points. Zero
mismatches is the standard.
