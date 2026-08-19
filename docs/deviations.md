# Deviations

The parser reproduces `espree` for JavaScript and JSX, and
`@typescript-eslint/parser` for TypeScript. The scope analyzer reproduces
`eslint-scope`
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
`packages/jskit/tests/parse/helpers.ts` and `packages/jskit/scripts/parse/`.

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
`asReferenceProgramExtent()` in `packages/jskit/tests/parse/helpers.ts` and in
`packages/jskit/scripts/parse/conformance-ts.mjs`. An extent that is wrong for
any other reason still fails. `packages/jskit/tests/parse/parse.test.ts` pins
the
behavior directly.

**Unaffected:** the scope analyzer. The binary parse buffer has always carried
`espree`'s
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
diagnostics. `packages/jskit/tests/parse/validate.test.ts` pins the behavior.

---

### A call as an assignment target in sloppy code

**Reference:** `espree` rejects all of these outright.

```js
f() = 1;
f()++;
for (f() of x);
```

**Here:** they are accepted in sloppy code and reported in strict code, so the
same three inside a module, or after a `"use strict"` directive, are errors.

**Why:** the specification says so, in as many words. `AssignmentTargetType` of
a `CallExpression` returns `~web-compat~` — not `~invalid~` — when the call is
not strict and the host supports Runtime Errors for Function Call Assignment
Targets, which every browser does. The result is a `ReferenceError` when the
assignment runs, not a `SyntaxError` before it does. `acorn` does not implement
the carve-out; test262 asserts it, in
`test/annexB/language/expressions/assignmenttargettype/`. Reproducing the
reference would mean rejecting seven programs the specification calls valid,
and rejecting working code is the worse of the two failure modes.

**How conformance absorbs it:** it does not have to, for the same reason as
above — this is a `validate()` diagnostic. The test262 run is what covers it,
and `packages/jskit/tests/parse/test262.test.ts` pins both halves.

---

### `eval` and `arguments` where `espree` misses them

**Reference:** `espree` implements the strict mode rules about these two names,
and two of its checks fall short. It rejects a class *declaration* named
`eval` but accepts the expression, and it does not look inside an arrow
function for the `arguments` that a class static block bans.

```js
(class eval {});                          // espree accepts
class C { static { () => arguments; } }   // espree accepts
```

**Here:** both are reported. Every part of a class is strict mode code whether
it is a declaration or an expression, and `ContainsArguments` reaches through
an arrow function precisely because an arrow has no argument list of its own to
name. V8 rejects both, and `espree` rejects the neighbouring spelling of each —
`class eval {}` and `class C { static { arguments; } }` — so these read as
oversights rather than as decisions.

**How conformance absorbs it:** it does not have to. Both are `validate()`
diagnostics, and the differential corpus compares trees.
`tests/fixtures/invalid-javascript.json` pins them.

---

### The cooked value of an unreadable template escape

**Reference:** `@typescript-eslint/parser` gives a `TemplateElement` whose
escape it cannot read a `cooked` value equal to its `raw` text.

```ts
String.raw`\u{}`;      // cooked: "\\u{}"
type T = `\u{}`;       // the same, in a template literal type
```

**Here:** `cooked` is `null`, which is what `espree` produces and what the
specification calls for: `TV` of a `TemplateCharacters` containing a
`NotEscapeSequence` is undefined, which is exactly why a tag may be applied to
a template no untagged one may hold. Evaluating the tag in V8 confirms it —
`(s => s[0])` `` `\u{}` `` is `undefined`, not the raw text.

The second line is the same case in a position where nothing is tagged at all:
a template literal type is a `TemplateLiteral` here, so the rule that makes an
untagged one an error has to be turned off for it, and the cooked value it
carries is the one every other template carries.

**How conformance absorbs it:** the differential corpus would see this, but
`node_modules` contains no tagged template with an unreadable escape and no
template literal type with one. `tests/parse/validate.test.ts` and
`tests/parse/parse.test.ts` pin the behaviour instead.

---

### Three places TypeScript is looser than ECMAScript

**Reference:** `@typescript-eslint/parser` accepts all three, and so does
`tsc`.

```ts
class D { #y = 1 }
class C { static { const g = (o: D) => o.#y; } }  // a private name from D

declare namespace Foo { export var static: any; } // a reserved word in strict

var v =0;                                       // NEL as whitespace
```

**Here:** all three are reported.

**Why:** each is an early error in ECMAScript, and the leniency is
TypeScript's own. Reading a private name that no enclosing class declares is
an early error the specification states outright; TypeScript reports it as
TS2339, a *type* error, which is a classification rather than a disagreement,
and `@babel/parser` rejects it here too. `static`, `public`, and the rest are
future reserved words in strict mode, and a module is strict. U+0085 is in
neither `WhiteSpace` nor `LineTerminator`, so a program that uses it as a
space is not a program; TypeScript's scanner treats it as one anyway.

V8 rejects all three, which is the tiebreaker the scope analyzer already uses
where the two references disagree: the ECMAScript answer wins.

**How conformance absorbs it:** they appear as `overzealous` in
`conformance-ts-negative.mjs`, where most of that count is this parser being
right rather than wrong. Its baseline records them per rule, so a *new* one is
still visible.

---

## Scope analysis

The scope analyzer reproduces two analyzers that disagree with each other in
six places. **Where they disagree, `eslint-scope` wins.** Three of the six are
reachable through an option that defaults to the `eslint-scope` answer —
`jsxPragma`, `jsxFragmentName`, and `globals`. The other three are not
configurable.

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

### The name a JSX closing tag repeats

**Reference:** `@typescript-eslint/scope-manager` creates a reference for the
name in `</Foo>` as well as for the one in `<Foo>`, so a component used with a
closing tag is referenced twice. `eslint-scope` creates only the opening one.

**Here:** only the opening one. A JSX element evaluates its name once — the
closing tag is punctuation the grammar requires, not a second read — and every
rule that cares only needs to know the name was used at all.

**How conformance absorbs it:** `scripts/scope/serialize.mjs` exports
`jsxClosingNameKeys()`, and the two `@typescript-eslint/scope-manager` runs
drop those references from both sides before comparing. The `eslint-scope` runs
need nothing, because they agree.

### A namespaced JSX name

**Reference:** `@typescript-eslint/scope-manager` references both halves of
`<x:y />`. `eslint-scope` references neither.

**Here:** neither. A namespaced name is not a JavaScript binding — it exists
for XML-shaped dialects, where `x` names a namespace rather than a value in
scope.

**How conformance absorbs it:** it does not. No file in the corpus uses a
namespaced JSX name, and none of the fixtures may, since the two references
disagree. `tests/scope/analyze.test.ts` pins the behavior instead.

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

All three were found by running TypeScript's own conformance suite (see
[AGENTS.md](../AGENTS.md#conformance-is-the-real-test-suite)) and all three are
confined to input that is already an error, which is why they have been left.

- **`export { type as as bar }`** throws. A binding actually named `as`, with a
  `type` modifier and a rename, needs three tokens of lookahead to tell from a
  binding named `type`; the parser does two. The four other spellings in that
  family parse correctly.
- **`({...({})} = {})`** produces an `ObjectPattern` where the reference keeps
  an `ObjectExpression`. Parentheses around an invalid rest target are the
  trigger; without them the two agree.
- **Error recovery in general.** TypeScript's parser continues after a syntax
  error and produces a tree; this one throws. Roughly twenty files in the
  conformance suite differ for that reason alone, all of them negative tests.
  Matching TypeScript's recovery is not a goal — see [the rule that decides
  where code goes](../AGENTS.md#the-rule-that-decides-where-code-goes).

ECMAScript's early errors used to be the fourth entry here, and are not any
more. test262 tests what the parser *rejects* in JavaScript, and both of its
counts are now zero: no valid program is rejected, and no invalid one is
accepted. `262-baseline.json` is an empty object, so any directory that starts
failing is one that was passing.

**TypeScript's grammar errors are the fourth entry, and are still open.**
`conformance-ts-negative.mjs` is the same kind of check for the other dialect,
run against `@typescript-eslint/parser` over TypeScript's own test suite. It
began at 154 programs the reference rejects and this parser accepts, and is now
at 40 spread thin across about fifteen rules — a `/// <reference>` directive,
an AMD module name, a decorator on a `this` parameter, and a tail of one- and
two-file rules. `ts-negative-baseline.json` records them per rule, so a
regression names the rule it broke rather than the directory it sits in.

## Not deviations

Two things look like deviations and are not.

**`parse()` accepts more than either reference.** It accepts the union of
everything JavaScript and TypeScript allow and throws only when the text cannot
be tokenized or shaped into a tree. Everything that is merely *not allowed
here* — strict mode violations, `return` outside a function, TypeScript syntax
under `dialect: "js"` — is reported by `validate()` instead. The output for a
program both accept is unchanged; what moved is *when* the complaint arrives.
See [The rule that decides where code goes](../AGENTS.md#the-rule-that-decides-where-code-goes).

**A malformed regular expression pattern is part of that**, which surprises,
because the pattern sits inside one token and a bad one looks like a bad token.
It is not. The lexical grammar stops at `RegularExpressionBody`, which is what
finds the closing slash; "BodyText cannot be recognized using the goal symbol
`Pattern`" arrives in §22.2.1 as an early error on the literal, beside the
rules about flags. So `espree` throws for `/(/` and `/a/gg` where this reports
them from `validate()`, and the division of labor follows the specification's
own classification rather than an approximation of it.

**Property order.** Object key order is not part of any AST contract, and the
conformance comparisons sort keys before comparing. Nothing depends on it.
