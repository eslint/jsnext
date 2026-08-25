# Type Analysis Technical Specification

The syntax-directed type reader: two passes over the binary buffers,
producing the binary type format.

This is a reference for people changing the analyzer. For the API a consumer
sees, read [api.md](./api.md); for what the analysis was built to do, read
[requirements.md](./requirements.md).

## Contents

- [What the analysis is](#what-the-analysis-is)
- [What shaped the format](#what-shaped-the-format)
- [Source layout](#source-layout)
- [The walk](#the-walk)
    - [Two passes, both in source order](#two-passes-both-in-source-order)
    - [Symbols carry the meaning](#symbols-carry-the-meaning)
    - [References do not copy their targets](#references-do-not-copy-their-targets)
    - [Origins](#origins)
    - [Expressions](#expressions)
    - [Determinism](#determinism)
- [The binary type format](#the-binary-type-format)
    - [Handles](#handles)
    - [Layout](#layout)
    - [The three lookups](#the-three-lookups)
    - [The consumers](#the-consumers)
- [Deliberate silence](#deliberate-silence)
- [Conformance](#conformance)
- [Future affordances](#future-affordances)
- [Invariants](#invariants)

## What the analysis is

A **type** here is a record built from TypeScript's own vocabulary: a flags
bitfield whose values match `ts.TypeFlags` on every bit both define, a
**shape** word playing the role of `ts.ObjectFlags`, optional pooled data —
union constituents, type arguments, tuple elements, parameter types — a
contiguous run of **members** for the object kinds, and an optional
**symbol** carrying the type's name and provenance.

The analysis is a **reader, not a checker**. It computes no assignability, it
loads no declaration files, and it never narrows. It records what one file
states — annotations, literals, initializers, signatures, declarations —
combined by rules simple enough to hold in your head, and it stays silent
everywhere else. Silence is a first-class answer: type ID `0` (`TYPE_NONE`)
means "nothing recorded", which every query surfaces as `false` or "unknown"
rather than as a guess. The one thing the analysis must never do is claim
something false; the corpus of things it declines to claim is listed under
[Deliberate silence](#deliberate-silence).

## What shaped the format

The design target is the cheapest and most common use type-aware lint rules
make of a type checker, read off the sixty-one type-aware rules in
`typescript-eslint`:

| What rules actually do                          | How often            | What the format provides                                       |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| Test a `TypeFlags` bit                          | nearly every rule    | `TY_FLAGS`, `ts.TypeFlags`-aligned, one word read              |
| Ask `isArrayType`/`isTupleType`                 | classification rules | `TY_SHAPE` bits                                                |
| Decompose a union                               | several rules        | pooled constituents; the union's flags OR its constituents'    |
| Match a type by name **and where it came from** | seven rules          | symbols with `TYO_*` origins and specifiers                    |
| Ask "is this a `Promise`?" two different ways   | six rules            | nominal-with-provenance (`lib` + name) and structural (`then`) |
| Read a property's type                          | member rules         | member runs plus heritage pools                                |

Two `ts.TypeChecker` capabilities were deliberately **not** kept: computed
relations (`isTypeAssignableTo`, contextual types) and flow-sensitive
narrowing. Both need a checker; the format leaves room for narrowing later
(the node-type index is per-node, so a refinement pass can add entries
without a format change) and stores nothing that presumes either.

## Source layout

```text
types-buffer.ts        the format: every constant, and nothing else
types-builder.ts       the writer: records, interning, pools, emission
types-walker.ts        the two passes over the parse and scope buffers
well-known.ts          the standard-library global names, shared with Rust
types-buffer-reader.ts word-level reads: records, lists, the node index
types.ts               the classification queries, keyed by node or NodeRef
to-type-tree.ts        the JSON debugging view
handles.ts             the handle arithmetic, in both directions
index.ts               inferTypes() and the re-exports
```

The Rust implementation
(`packages/jskit-native/crates/jskit-core/src/types/`) mirrors the producer
half file by file — `buffer.rs`, `builder.rs`, `walker.rs`, `well_known.rs` —
and must write byte-identical buffers;
`packages/jskit-native/tools/diff-types.mjs` is the check. The reading half
(`Types`, `TypesBufferReader`, `toTypeTree()`) stays TypeScript only, the
same split every other analysis uses.

## The walk

### Two passes, both in source order

The **declaration pass** reads what the program states and binds it to the
scope buffer's symbols: function and method signatures, class instance and
constructor types, interfaces, type aliases, enums, namespaces, imports,
annotated variables and parameters. Reading declarations first is what makes
hoisting free — a call above the function it calls still types, because the
signature was bound before any expression was looked at.

The **expression pass** then types expressions bottom-up: literals, operators
with fixed result types, array and object literals, initializers (widened
for mutable bindings, kept narrow for `const`), member lookups, calls through
typed callees, `new` through constructor types, `await` through `Promise`
references. Every answer is recorded as a `(node handle, type ID)` pair.

Both passes descend by the slot table, the same generic walk the scope
analyzer uses, so a node kind neither pass handles is still descended
through — a new expression kind cannot hide declarations from the walk.

### Symbols carry the meaning

Two dense arrays, indexed by the scope buffer's symbol IDs, carry what the
walk learned about names:

- the **value type** — what `x` holds: its annotation, else its initializer;
- the **declared type** — what the name means in type position: an
  interface's structure, a class's instance type, an alias's target, an
  enum's type, a type parameter's record.

A class populates both — constructor type as value, instance type as
declared — which is exactly the two-sided nature `class` has in the
language. An enum does the same: its value is the object the declaration
creates (`typeof E` answers `"object"`), its declared type the enum type a
value of `E` inhabits, and both share one member run. The first binding wins
everywhere (`setSymbolType` and `setDeclaredType` keep the first answer),
which is what makes redeclaration and merging deterministic without modeling
them — with two namespace carve-outs: a namespace never binds a declared
type at all, because a bare namespace name is not a type and the interface,
alias, or enum it merges with is what a type reference means; and a
namespace whose symbol also has a function, class, enum, or variable
definition binds no value type either, whichever side of it the merge
partner sits on, because the merged value is that declaration's.

### References do not copy their targets

A written type name — `Foo`, `Promise<T>` — becomes a **reference** record:
shape `TYS_REFERENCE`, a symbol, optionally pooled type arguments. It does
not copy the target's structure. Consumers chase the symbol's `SY_TARGET` to
the declared-types array when they need the structure. Three things fall out:

- forward references cost nothing — the declared type is bound by the time
  any consumer reads the buffer;
- one interface is one record no matter how many times it is named;
- an alias chain is resolved by the reader (depth-capped), not baked in.

An interface's `extends` bases are pooled references too; a base named any
other way — `extends React.FC<P>` — becomes a deferred record rather than
being dropped, so an inherited member or call signature the analysis cannot
see reads as _unknown_ rather than _absent_. That is what lets `Types`
refuse to call such an interface an object: a base out of reach might make
its values functions.

### Origins

Every symbol records where its name came from, the split
`TypeOrValueSpecifier` matches on:

- **`local`** — declared in this file; `SY_DECL` is the declaring node and
  `SY_TARGET` the scope symbol.
- **`package`** / **`file`** — an import binding; the specifier string is
  the module specifier as written, split on whether it starts with `.` or
  `/`. The symbol's name is the name the binding was _exported_ under —
  `import { SafePromise as SP }` records `SafePromise`; a default import
  records `default` — because that is the name an allowlist names.
- **`lib`** — a reference that resolved to nothing in the program but whose
  name the TypeScript standard library is known to declare (`well-known.ts`
  holds the list, mirrored in Rust). A program that declares its own
  `Promise` resolves locally and never reaches this table — which is
  precisely what makes `isAwaitable()`'s nominal check provenance-safe.
- **`global`** — unresolved and unknown; the reference is also marked
  `TYS_UNRESOLVED` and claims nothing.

### Expressions

The rules are fixed and conservative. The ones worth knowing:

- **Widening**: a `let`/`var` initializer widens literal types to their
  bases; `const` keeps them. A union widens constituent by constituent —
  the union branch runs _first_, because a union's flags word carries the OR
  of its constituents and would otherwise satisfy a literal test. A mutable
  binding whose widened initializer is purely nullish — `let x = null` — is
  an _evolving_ binding the checker types by its later assignments, which
  one pass cannot see, so it stays untyped.
- **Optionality admits `undefined`**: `x?: T` on a parameter binds
  `T | undefined` — the argument may simply be absent — and reading an
  optional member produces `T | undefined` the same way. Both are the
  checker's answers too.
- **Names are not expressions**: a non-computed member key, a module
  declaration's name literal, and the identifiers of a type-only export
  record nothing, and the expression pass never descends into type-context
  subtrees — annotations, generic parameter lists, type arguments, heritage
  clauses — where an identifier names a type, not a value.
- **Operators**: comparisons, `in`, `instanceof`, `!`, `delete` are
  `boolean`; `typeof` is `string`; `void` is `undefined`; unary `+` is
  `number` always (a bigint operand throws at runtime). `+` concatenates when
  either side is string-like, and claims nothing when either side is unknown
  and neither is string-like. Other arithmetic claims nothing when **both**
  operands are unknown — they could both be bigints.
- **`await`** unwraps a library `Promise`/`PromiseLike` reference to its
  first type argument, distributes over unions, passes `any`/`unknown` and
  non-thenables through.
- **Optional chaining** unions `undefined` into a known member or call type.
- **`x!`** removes the all-nullish constituents of a union; an entirely
  nullish type becomes `never`.
- **`new`** on an unresolved well-known global (`new Map()`) produces a
  library reference carrying any written type arguments.

### Determinism

The Rust walk must write the same bytes, so every ordering is pinned:

- record creation order is source order of the two passes;
- types with no members and no node are interned by their five meaningful
  words; symbols by all five fields; strings by **UTF-16 content** (two
  distinct lone-surrogate strings stay distinct even though both encode to
  the same replacement-character bytes);
- literal values are stored as text — the cooked text for strings, the raw
  source slice for numbers and bigints — so no numeric formatting exists to
  diverge between languages;
- the node-type index is sorted by `(handle, type ID)` with exact duplicates
  dropped, a total order, so the sort algorithm cannot matter.

## The binary type format

### Handles

Node references are the byte offset of the node's record in the parse buffer
the analysis ran over, exactly as the scope and flow buffers store them, and
`0` means "no node". This is why `inferTypes()` refuses a scope buffer from
`analyzeTree()`: its handles name nodes another way. IDs are zero-based
indexes into their own record sections; optional ID fields store `id + 1` so
`0` can mean "none".

### Layout

Little-endian 32-bit words throughout. The header is 20 words
(`TYPES_H_*`); two words are reserved for a future imports section (see
[Future affordances](#future-affordances)).

```text
header          20 words                  TYPES_H_*
types           TYPE_WORDS (8) each       flags, shape, symbol+1, data0,
                                          data1, memberFirst, memberCount,
                                          node handle
members         MEMBER_WORDS (3) each     name string ID, type ID, TMF_*
pool            [count, items...] runs    handle 0 = empty list
symbols         TYPE_SYMBOL_WORDS (5)     name, origin, specifier+1,
                                          decl handle, scope symbol+1
symbol types    1 word per scope symbol   value types
declared types  1 word per scope symbol   declared types
node-type index NODE_TYPE_WORDS (2) each  sorted (handle, type ID) pairs
strings         offsets, then UTF-8 bytes padded to a word
```

What the two data words hold, by kind, is documented in `types-buffer.ts`
and is part of the format. The first `TYPE_INTRINSIC_COUNT` records are the
pinned intrinsics, in `TYPE_*` order, so `any` is type `1` in every buffer
ever written. Record `0` is the sentinel: it exists, and it means "no type
recorded".

Every flag table — `TYF_*`, `TYS_*`, `TMF_*`, `TYO_*` — and the intrinsic
order are **append-only**.

### The three lookups

- The **node-type index** answers "what is the type at this node" by binary
  search over sorted pairs. Only nodes the walk could say something about
  have entries — absence is the "no idea" answer.
- The **symbol-types array** and **declared-types array** answer by scope
  symbol ID in one indexed read, and are what reference-chasing consumers
  resolve through.

### The consumers

- `Types` — resolution (`NodeRef` by position, references by symbol),
  classification predicates, rendering. All conservatism lives here and in
  the walker; `TypesBufferReader` below it is mechanical.
- `toTypeTree()` — the JSON view, self-contained and serializable.
- The flag constants are exported so a tool can read the buffer without
  either.

## Deliberate silence

Everything here is a _refusal to claim_, not an approximation. Anything the
analysis records that is actually wrong is a bug; anything on this list is
working as designed.

1. **Unmodeled type syntax defers.** Conditional, mapped, indexed-access,
   `keyof`, `typeof`, `infer`, `import()` types, `TSTypeOperator`, `this`
   types, and `intrinsic` become `TYS_DEFERRED` records with `unknown`
   flags: they say where they came from and claim nothing.
2. **No inference beyond single expressions.** Function return types come
   from annotations (plus the `async` `Promise` wrapper); unannotated
   returns, generator types, and assignments to unannotated uninitialized
   variables record nothing.
3. **Generics are not instantiated.** `Foo<string>` keeps its written
   arguments, but member lookups through it see the declared, uninstantiated
   member types; a type parameter reference answers with the parameter
   record itself (its constraint is stored, not substituted).
4. **Member lists can be inexact.** Spreads, computed keys, call signatures,
   parameter properties, and static members mark a type `TYS_INEXACT` or are
   skipped; a missing member on an inexact type proves nothing, and lookups
   return `TYPE_NONE` rather than "not present". A call or construct
   signature additionally marks the type `TYS_CALLABLE` — its structure is
   not recorded, but callability is, because it decides `typeof`.
5. **No narrowing.** The recorded type of a reference is the symbol's
   declared or initialized type at every mention; `x` inside
   `if (x !== null)` still reports the nullable union.
6. **Standard-library structure is unknown.** `lib` references carry names
   and provenance, not members: `map.get(...)` records nothing. The two
   exceptions are `length` on arrays and tuples, which is `number`.
7. **Merging and redeclaration keep the first answer.** A second interface
   declaration of the same name does not extend the first record, and
   merging across files is invisible by construction — the analysis reads
   one file. The namespace merges the walk does understand are the two the
   [symbol rules](#symbols-carry-the-meaning) carve out: a namespace never
   claims the type meaning of a merged name, or the value meaning of one a
   function, class, enum, or variable also declares.

## Conformance

The analysis replaces no existing implementation, so there is no output to
diff — but the conservatism above turns out to be checkable. Every positive
claim `Types` makes is a statement about runtime behavior that
`ts.TypeChecker` can confirm or contradict, and
[`scripts/types/conformance-ts.mjs`](../../scripts/types/conformance-ts.mjs)
does exactly that: it runs a corpus through `inferTypes()`, asks about every
node the walk recorded a type for, and grades each positive answer against
the checker's type at the same span. The comparison is one-directional —
silence is always allowed, so a node the checker can type and this analysis
cannot is correct behavior — and a claim the checker cannot judge (`any`, a
type parameter, a multiply-declared symbol whose merged structure one file
cannot see) is skipped rather than graded. Each file gets a checker program
of its own, because the analysis is per-file by contract and one shared
program would let cross-file declaration merging inform the reference.

`npm run test:conformance:types` runs it; `disagree=0` and `threw=0` are the
standard, the first because a disagreement is an unsound claim and the
second because `threw` counts files the checker parses cleanly and the
parser rejects. The differential in
`packages/jskit-native/tools/diff-types.mjs` is the unrelated other half of
the story: it holds the TypeScript and Rust producers byte-identical, while
this one holds what those bytes _claim_ to the checker's truth.

## Future affordances

The format reserves room for the growth the requirements name, without a
version break:

- **Imports across files.** `TYPES_H_IMPORTS_BASE`/`TYPES_H_IMPORT_COUNT`
  are written `0` today. A future multi-file store can add a section linking
  `TYS_FOREIGN` symbols — which already record the specifier and the
  imported name — to the type buffers of the files they come from.
- **Narrowing.** The node-type index is per-node, so a later pass reading
  the flow buffer can record refined types at reference sites without
  touching the format; `EK_TRUE`/`EK_FALSE`/`EK_NULLISH` edges already carry
  the conditions it would need.
- **Deeper structure.** `TY_NODE` points every deferred record back at its
  source, so a version that models more syntax converts in place; the shape
  word and the flag tables grow by appending.

## Invariants

Things that will break subtly if violated:

1. **Every produced buffer must be byte-identical between the TypeScript and
   Rust implementations.** Any change to the walk, the builder, or the
   well-known list is a change to both; `diff-types.mjs` over a corpus is
   the check, and `mismatch=0` is the standard.
2. **The intrinsic internments in the builder's constructor pin the
   `TYPE_*` IDs.** Reordering them, or interning anything before them,
   renumbers every buffer.
3. **A member run is contiguous.** Collect entries first, then write them;
   converting a member's type while writing the run would interleave a
   nested type's members into it.
4. **The union branch in widening runs before the literal tests.** A union's
   flags word carries the OR of its constituents, so the literal bits are
   set on records that are not literals.
5. **References always carry a symbol.** `#memberType` and the promise check
   read `TY_SYMBOL - 1` without a guard on the walker's own records; a
   reference written without a symbol would read the wrong record.
6. **`convert()` never returns `TYPE_NONE`**, so annotation-driven code can
   distinguish "no annotation" from every converted answer.
7. **The two dense arrays are sized by the scope buffer's symbol count**,
   and every symbol-keyed read is bounds-checked against it in the reader —
   a truncated buffer must fail loudly, not read past a section.
8. **Only `types-builder.ts` and `types-buffer-reader.ts` know the layout**
   (`builder.rs` in Rust). Everything else reads through the constants, so
   a section can move by editing two files and the format module.
