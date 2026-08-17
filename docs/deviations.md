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

**Unaffected:** `jsscope`. The binary parse buffer has always carried `espree`'s
extent — the decoder was the only thing that adjusted it — so the scope graph
never saw the other rule.

### Function declarations in a class static block

**Reference:** `espree` treats a function declaration at the top level of a
class static block as a *lexical* declaration, so it rejects all three of
these.

```js
class C { static { var a; function a(){} } }
class C { static { function a(){} var a; } }
class C { static { function a(){} function a(){} } }
```

**Here:** all three are accepted. A static block is a variable scope, so a
function declared directly in it binds the way one declared at the top of a
function body does.

**Why:** `acorn` is wrong here, and V8 agrees. `ClassStaticBlockBody` is
specified with `TopLevelVarDeclaredNames` and `TopLevelLexicallyDeclaredNames`,
exactly as a function body is, which puts a top-level function declaration
among the *var*-declared names. `node --input-type=module -e` accepts all three.
Reproducing the reference would mean rejecting valid code, which is the worse
of the two failure modes, so the specification wins.

**How conformance absorbs it:** it does not have to. This is a `validate()`
diagnostic, and the differential corpus compares parser output, not
diagnostics. `packages/jsparse/tests/validate.test.ts` pins the behavior.

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

## Known gaps

Not deviations — bugs that are simply not fixed yet.

The first four were found by running TypeScript's own conformance suite (see
[AGENTS.md](../AGENTS.md#conformance-is-the-real-test-suite)) and all four are
confined to input that is already an error, which is why they have been left.

- **`export { type as as bar }`** throws. A binding actually named `as`, with a
  `type` modifier and a rename, needs three tokens of lookahead to tell from a
  binding named `type`; the parser does two. The four other spellings in that
  family parse correctly.
- **`({...({})} = {})`** produces an `ObjectPattern` where the reference keeps
  an `ObjectExpression`. Parentheses around an invalid rest target are the
  trigger; without them the two agree.
- **`function *f(a = yield) {}`** reads `yield` as an identifier where
  `@typescript-eslint/parser` builds a `YieldExpression`. `yield` is not legal
  in a generator's parameters at all, and `espree` rejects the program
  outright, so there is no answer that satisfies both references.
- **Error recovery in general.** TypeScript's parser continues after a syntax
  error and produces a tree; this one throws. Roughly twenty files in the
  conformance suite differ for that reason alone, all of them negative tests.
  Matching TypeScript's recovery is not a goal — see [the rule that decides
  where code goes](../AGENTS.md#the-rule-that-decides-where-code-goes).

The next three come from test262, which is the only corpus that tests what the
parser *rejects*. The first two are valid programs it will not accept, which is
the worse kind of gap; the third is thousands of invalid programs it accepts in
silence.

- **Annex B HTML-like comments.** `<!--` opens a comment running to the end of
  the line, and a `-->` that begins one closes a comment, in sloppy script code
  only. Neither is recognized. Implementing them runs straight into the phase
  split: `parse()` does not know the source type, so the tokenizer would have
  to accept both everywhere and `validate()` would have to reject them in a
  module.
- **`await` where the source type decides what it is.** `parse()` reads `await
  x` as an `AwaitExpression` because it cannot know it is looking at a script,
  where `await` is an ordinary identifier. A program that reads only as an
  identifier — `await = 1`, `await instanceof C`, `await.x` — is handled, since
  no `AwaitExpression` can be built from it. One that reads both ways is not:
  `await + 1` and `import(x, await(undefined))` in a script are reported by
  `validate()` as a top-level `await` that the author did not write. This is
  inherent to the split rather than a bug in either phase.
- **Most of ECMAScript's early errors.** Around 3,200 test262 files are invalid
  programs that both phases accept: an assignment to something that cannot be
  assigned to, a duplicate parameter name where it is banned, `yield` as a
  binding name inside a generator, anything at all wrong inside a regular
  expression pattern. The families are enumerated with rough counts in
  [`packages/jsparse/scripts/262-exclusions.mjs`](../packages/jsparse/scripts/262-exclusions.mjs),
  and the per-directory counts are pinned in `262-baseline.json` so that the
  number cannot quietly grow.

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
