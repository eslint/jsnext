# Requirements for the scope analyzer rewrite

## Goal

Create a utility that evaluates the binary AST format from the parser for scope information.

## Description

This utility is meant to efficiently evaluate JavaScript/TypeScript code in such a way as to provide additional insights into how the code is structured and functions.

## Scope analysis

Capture scope and symbol information. We ultimately want the same data that is captured in `eslint-scope`, but represented in a compact, binary format. References to the AST should use byte offsets in the `ArrayBuffer` containing the binary AST. We should not duplicate information already available in the binary AST.

Ensure all bindings have unique, immutable symbol IDs.

The following must be first-class in the binary format, because the query API
below needs each of them without recomputation:

- **Per scope:** type, `isStrict` bit, upper scope, nearest variable scope,
  block node offset, and its symbol, reference, and unresolved-reference
  (`through`) lists. The `through` lists are computed during resolution
  anyway; store them rather than rebuild them on demand.
- **Per symbol:** a unique, immutable **symbol ID** (per the requirement
  above; the record's index in the buffer is sufficient, provided nothing
  ever renumbers records after `analyze()` returns), name, owning scope,
  definition list (definition kind plus node offsets), and a single
  **"has no definitions"** flag marking a symbol that exists only because
  configuration or the environment says so (a configured global). Rules test
  exactly `variable.defs.length === 0`; make that one bit read. The symbol ID
  is what references resolve to and what the `eslintUsed` side bitset is
  keyed by, so it must be stable across the lifetime of the analysis result.
- **Per symbol, continued:** a **read count** and a **write count** over the
  symbol's references. Pattern 3 below asks both of a binding constantly —
  `no-unused-vars` wants "read at all?", `prefer-const` wants "written more
  than once?" — and neither should cost a walk of the reference list. A
  read-write (`x += 1`) counts in both.
- **Per reference:** identifier node offset, containing scope, resolved symbol
  ID or an explicit unresolved marker, and read/write/init flags.

## What rules actually ask for

A survey of all 293 core rules in `eslint@10.8.1` (88 of which touch scope)
found the usage concentrates into a few patterns. Ranked by rule count:

1. **Global identity checks — 43 rules, half of all scope use.** "Does this
   identifier still refer to the built-in `Symbol`/`RegExp`/`console`?" and
   "enumerate every reference to global _X_." Asked via
   `getVariableByName() + defs.length === 0`, `isGlobalReference()`, or
   `ReferenceTracker`.
2. **Declaration node → bindings — 19 rules** (`getDeclaredVariables()`),
   usually followed by a scan of each binding's references for writes
   (the six `no-*-assign` rules) or for absence of reads.
3. **Read/write tracing over one symbol's reference list — 9 rules**
   (`prefer-const`, `no-param-reassign`, …). Needs the per-reference
   read/write/init flags.
4. **Unresolved references — 7 rules.** `no-undef` is a loop over the global
   scope's `through`; `no-loop-func` reads a _function_ scope's `through` to
   find what it closes over.
5. **Position and nesting comparisons — 6 rules** (`no-shadow`,
   `no-use-before-define`, `no-redeclare`). Needs scope-chain walking,
   `variableScope`, and definition node offsets (positions come from the AST).
6. **Strictness — 5 rules.** Read `scope.isStrict`, never recompute it.
7. **Fix-safety checks — 6 rules.** Scope consulted only to verify an autofix
   cannot change resolution (`no-else-return`, `no-var`). Uses the same
   primitives as 4 and 5.

Full scope traversal (every scope, every symbol) is rare — two rules — so it
must be _possible_ but does not need to be optimized for.

## Public API

- A `analyze()` function that accepts an array buffer representing a binary AST and the same options as the current version. It returns an array buffer containing the scope and symbol information.
- A `toScopeTree()` function that takes the result of `analyze()` and the binary AST, and converts it into an object AST for easy debugging and serialization. The returned value must be JSON-serializable and match the style of the AST produced by the parser. The tree must be fully-self contained without references to external objects.
- A `Scopes` class that accepts the result of `analyze()` and the binary AST, and contains methods for easy lookup of scope data based on common use cases. The methods interrogate the array buffer to find the information. `Scopes` is an exploratory API — a way to find out what queries the binary format can answer well, not a planned replacement for the rule-facing scope API. Prioritized by the survey above:
    - `isGlobalReference(node)` — matches the semantics of ESLint's
      `SourceCode#isGlobalReference()` exactly: true only when the identifier
      resolves to a configured global with no definitions in code. A fully
      unresolved reference returns false; those are served by
      `getGlobalReferences(name)` and `getUnresolvedReferences(scope)` instead.
      This is the single most common question rules ask; it should be
      answerable without materializing any objects.
    - `getGlobalReferences(name)` — every reference to global _name_, including
      unresolved ones, for the "report all uses of `eval`/`Symbol`/`console`"
      pattern.
    - `getDeclaredSymbols(node)` — declaration node → symbol IDs.
    - `getReferences(symbolId)` — iterate a symbol's references with their
      read/write/init flags exposed.
    - `getSymbolReadCount(symbolId)` / `getSymbolWriteCount(symbolId)` /
      `getSymbolReferenceCount(symbolId)` — the same list summarized, for the
      rules that only need to count.
    - `getOwnSymbolByName(scope, name)` / `getSymbolByName(scope, name)` —
      `getVariableByName()`, the second-most-used entry point in the survey:
      one scope's own binding, and the same lookup climbing the chain.
    - `getUnresolvedReferences(scope)` — the `through` list, for the global
      scope (`no-undef`) or any function scope (`no-loop-func`).
    - `getScope(node)`, `upper(scope)`, `variableScope(scope)`,
      `isStrict(scope)` — chain walking for the shadowing/position rules.
    - `markSymbolAsUsed(symbolId)` / `isSymbolUsed(symbolId)` — the
      `eslintUsed` protocol. The buffer is immutable, so this is a mutable side
      bitset keyed by symbol ID, owned by the `Scopes` instance.
- A `toScopeManager()` function that accepts the result of `analyze()` and the binary AST, and produces an escope-compatible `ScopeManager` structure (with optional extra properties as needed for common use cases). Compatibility bar: the structure must be complete enough for `@eslint-community/eslint-utils` (`ReferenceTracker`, `findVariable`, `getStaticValue`) to work unmodified — 8+ core rules reach scope only through those helpers — and `Variable#eslintUsed` must be settable, feeding the same side bitset as `markSymbolAsUsed()`.
- `analyzeTree` is updated to return the same binary representation as `analyze()`.
