# Deviations

`jsparse` reproduces `espree` for JavaScript and JSX, and
`@typescript-eslint/parser` for TypeScript. `jsscope` reproduces `eslint-scope`
and `@typescript-eslint/scope-manager`. "Reproduces" means byte-for-byte equal
output on every file of the differential corpus, and that is enforced — see
[Conformance is the real test suite](../AGENTS.md#conformance-is-the-real-test-suite).

Everything below is a place where the output is deliberately *not* equal. Each
one is a decision, not a gap. **If you find a difference that is not on this
list, it is a bug** — fix the parser rather than adding an entry, unless you
have a reason of the kind the entries below give.

The list is what the conformance comparisons are allowed to forgive, so it is
also the place to look when a comparison mysteriously passes.

## How to read this

Each entry says what the reference does, what this does, and why. Where the
difference is invisible to the conformance run, the entry says how it is
absorbed — usually by the shared `normalize()`/`stable()` helpers in
`packages/jsparse/tests/helpers.ts` and `packages/jsparse/scripts/`.

---

## Parser

### Absent properties are spelled `null`

**Reference:** `@typescript-eslint/parser` sometimes omits a property entirely
rather than giving it a value. A body-less module declaration is the clearest
case: `declare module "m";` produces a `TSModuleDeclaration` with no `body`
key at all, while `declare module "m" {}` produces one with a `TSModuleBlock`.

**Here:** the property is always present, with `null` for "nothing here".

```js
// declare module "m";
{ type: "TSModuleDeclaration", id: …, body: null, kind: "module", … }
```

**Why:** a node of a given type should have the same shape every time. A
consumer that reads `node.body` gets `null` instead of `undefined`, and a
consumer that enumerates keys sees the same keys for every
`TSModuleDeclaration`. Hidden-class stability is the secondary benefit; the
primary one is that `"body" in node` is not a question anyone has to ask.

This generalizes: **wherever the reference omits a property or leaves it
`undefined`, it is `null` here.** The `undefined` half of that was already the
documented contract; the omitted half is the same rule.

**How conformance absorbs it:** the comparison helpers drop any property whose
value is `null` or `undefined` from *both* sides before comparing, so an absent
property and a `null` one are the same thing. A real disagreement — `null`
against a value — still fails.

**Exception:** in `dialect: "js"` the TypeScript-only properties are omitted
entirely rather than set to `null`, because `espree` does not have them at all
and the contract there is to match `espree` exactly.

### Astral characters in JSX entity references

**Reference:** `espree` resolves a numeric character reference with
`String.fromCharCode`, which takes only the low 16 bits. `&#x1F600;` comes out
as U+F600, a private-use character, rather than as the emoji.
`@typescript-eslint/parser` resolves it correctly to U+1F600.

**Here:** `@typescript-eslint/parser`'s answer, in both dialects.

```jsx
<div>&#x1F600;</div>   // value: "😀", not ""
```

**Why:** the two references disagree and one of them is wrong. Reproducing a
truncation bug would corrupt text for anyone using the AST to read what a
document says. This is the one place where matching `espree` exactly is
knowingly given up.

**How conformance absorbs it:** it does not — it cannot. `jsx.json` is checked
against both reference parsers, so no fixture there can cover an astral
reference. The case is covered in `tsx.json`, which is checked against
`@typescript-eslint/parser` only. Nothing in the corpus contains one.

### `range` and `loc`

**Reference:** both reference parsers can be asked for `range`, `loc`, or both,
and ESLint asks for both.

**Here:** `toAST()` nodes carry `start` and `end` and never `range` or `loc`.
Only the ESLint parser object adds them, by passing a `LineIndex` into the
decoder.

**Why:** `loc` is two objects per node and is needed by a small fraction of
consumers. Making it opt-in is most of the reason the decoder is as cheap as it
is. There is a test pinning this, and `src/ast-types.ts` encodes it: `start`
and `end` are required, `range` and `loc` optional.

### The extent of `Program`

**Reference:** the two disagree. `espree` trims a `Program` to its statements,
so leading trivia, a hashbang, and trailing comments all sit outside it, and
gives a program with no statements the whole text.
`@typescript-eslint/parser` always runs a program to the end of the source, and
gives an empty one the zero-width range at the end.

**Here:** `espree`'s answer, in **both** dialects.

```ts
//   a;  (with two spaces either side)
{ type: "Program", start: 2, end: 4, … }   // not end: 6

// "// only a comment"
{ type: "Program", start: 0, end: 17, … }  // not start: 17
```

**Why:** a program's extent should not depend on which dialect decoded it. The
two rules differ on almost every real file — any file ending in a newline is
enough — so a consumer that works in both dialects would otherwise have to know
which one produced the tree before it could trust `program.end`. `espree`'s
rule is the one ESLint has always had for JavaScript, and it is the more useful
of the two: it points at the code rather than at the file.

This is the only deviation from `@typescript-eslint/parser` that shows up on
ordinary input rather than on an edge case, so it is the one most likely to
surprise. Note that `range` and `loc`, when the ESLint parser object adds them,
follow the same extent.

**How conformance absorbs it:** the conversion between the two rules is exact
in one direction, so rather than dropping the field the TypeScript comparisons
derive the reference's answer from ours and then diff in full —
`asReferenceProgramExtent()` in `packages/jsparse/tests/helpers.ts` and in
`packages/jsparse/scripts/conformance-ts.mjs`. An extent that is wrong for any
other reason still fails. `packages/jsparse/tests/parse.test.ts` pins the
behavior directly.

**Unaffected:** `jsscope`. The binary AST buffer has always carried `espree`'s
extent — the decoder was the only thing that adjusted it — so the scope graph
never saw the other rule.

---

## Scope analysis

`jsscope` reproduces two analyzers that disagree with each other in three
places. **Where they disagree, `eslint-scope` wins**, and each of the three is
an option that defaults to the `eslint-scope` answer.

### The JSX factory reference

**Reference:** `@typescript-eslint/scope-manager` adds a reference to `React`
once per file on the theory that a JSX element compiles to a call to it.
`eslint-scope` adds nothing.

**Here:** nothing, by default. Set `jsxPragma` and `jsxFragmentName` to get the
other behavior.

### The TypeScript standard library

**Reference:** `@typescript-eslint/scope-manager` seeds the global scope with
every name in whichever `lib` is configured, plus `const` so that `x as const`
resolves. `eslint-scope` seeds nothing.

**Here:** nothing is seeded. Pass `globals` for the same effect with control
over what goes in.

### `export { a }`

**Reference:** `@typescript-eslint/scope-manager` treats the name as both a
value and a type reference, which is what TypeScript needs.

**Here:** both under `dialect: "ts"`, and an ordinary value read under
`dialect: "js"`, which is `eslint-scope`'s answer.

### `Reference#partial`

**Reference:** `eslint-scope` sets `partial` on a write that only assigns part
of what the right-hand side evaluates to, as the writes in `[a, b] = pair` do.
`@typescript-eslint/scope-manager` drops the field.

**Here:** always present. Rules written against `eslint-scope` read it, and a
field that exists in one dialect and not the other is worse than a field that
is always there.

---

## Not deviations

Two things look like deviations and are not.

**`parse()` accepts more than either reference.** It accepts the union of
everything JavaScript and TypeScript allow and throws only when the text cannot
be tokenized or shaped into a tree. Everything that is merely *not allowed
here* — strict mode violations, `return` outside a function, TypeScript syntax
under `dialect: "js"` — is reported by `validate()` instead. The output for a
program both accept is unchanged; what moved is *when* the complaint arrives.
See [The rule that decides where code goes](../AGENTS.md#the-rule-that-decides-where-code-goes).

**Property order.** Object key order is not part of any AST contract, and the
conformance comparisons sort keys before comparing. Nothing depends on it.
