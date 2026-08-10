# jsscope Technical Specification

How scope analysis works against a binary AST, and what it does differently
from the two implementations it reproduces.

This is a reference for people changing the analyzer. The
[README](../README.md) covers the public API; this document covers the
machinery behind it.

## Contents

- [What the analysis is](#what-the-analysis-is)
- [Source layout](#source-layout)
- [Working without a tree](#working-without-a-tree)
  - [Nodes are integers](#nodes-are-integers)
  - [Dispatch](#dispatch)
  - [The generic child walk](#the-generic-child-walk)
  - [Names](#names)
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

## Source layout

```text
src/
  kinds.ts            scope types, definition types, reference flags
  options.ts          the options an analysis runs with
  names.ts            reading identifier and literal text out of the source
  definition.ts       a declaring occurrence, and the factories for each kind
  variable.ts         a bound name
  reference.ts        an occurrence of a name
  scope.ts            one lexical scope, and what happens when it closes
  scope-manager.ts    the collection of scopes and the maps over them
  pattern-visitor.ts  the walk over a destructuring pattern
  referencer.ts       the main walk
  index.ts            the public API
```

## Working without a tree

### Nodes are integers

`jsparse` stores every node as twelve 32-bit words in one `ArrayBuffer`, and a
node is identified by its index. `jsscope` never leaves that representation:
a scope's `block`, a reference's `identifier`, and a definition's `name`,
`node`, and `parent` are all indices, and `0` is the "no node" sentinel the
buffer itself uses.

This is the entire performance story. The reference analyzers are not slow;
they are handed a tree that had to be built first, and building it allocates an
object per node with a string `type` on it. Reading `reader.kind(node)` instead
is one multiply, one add, and one typed-array load.

The cost is that a caller holding a node index cannot do much with it directly,
which is what `ScopeManager#nodeType`, `ScopeManager#nodeRange`, and the
exposed `reader` are for.

### Dispatch

The reference implementations dispatch by looking up a method named after the
node's `type` string. Here it is a `switch` over an integer kind, which the
engine compiles to a jump table. `Referencer#visit` is that switch, and
`Referencer#visitType` is a second one for [type
position](#value-position-and-type-position).

### The generic child walk

Kinds with no rule of their own fall through to `visitChildren`, which reads
`SLOT_TABLE` from `jsparse` — the table that says, for each kind, whether each
of the eight data slots holds a child node, a list handle, or opaque data.

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

### Names

Resolution is by name, so every identifier's text has to be read. `names.ts`
slices it straight out of the source string and only calls `jsparse`'s
`decodeEscapes` when a backslash is present, which is almost never. On an
`Identifier` the name ends where slot A says, not at the node's `end`, because
a type annotation extends the node past its name.

A name is read once and stored on the `Reference`, because resolution needs it
again at every scope on the way out.

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

1. **A scope's queue is consumed exactly once.** `close()` sets `left` to
   `null`, and `isClosed()` reads that. Referencing a closed scope loses the
   reference silently.
2. **`close(node)` loops.** One node can open several scopes; popping one is a
   correct-looking bug that misplaces every later scope.
3. **Reference order is part of the contract.** Rules read
   `scope.references` in order, and the differential corpus compares it
   element by element.
4. **A name is read once.** `Reference#name` is the resolution key; deriving it
   again from the node at resolution time would be correct but slow.
5. **Node index `0` means no node** everywhere, including in a definition's
   `parent` and a reference's `writeExpr`.
6. **The global scope's implicit variables are not in `set`.** Putting them
   there would resolve later references to them and change the meaning of
   `through`.

## Adding a node kind

When `jsparse` gains a node kind, decide three things:

1. **Does it open a scope?** Add a `nest*` method to `ScopeManager` and a
   scope type to `kinds.ts`, and remember `isVariableScopeType` and
   `isImplicitlyStrictType` if the answer is not obvious.
2. **Does it bind or reference a name?** Add a case to `Referencer#visit`, or
   to `visitType` if the name appears in type position.
3. **Does it do neither?** Then it needs no case at all — the generic child
   walk handles it — but check that its slot order matches the visitor-key
   order of whichever reference implementation covers it, and add an explicit
   case if it does not.

Then run `npm run conformance`. Zero mismatches is the standard.
