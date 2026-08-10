# jsparse

A fast, ESLint-compatible parser for the latest JavaScript, TypeScript, and JSX
syntax.

`jsparse` splits the work that other parsers do in one pass into three:

1. **`parse()`** turns source text into two `ArrayBuffer`s — a binary AST and a
   binary token stream — plus the offset of every line. It throws only for text
   that cannot be tokenized or shaped into a tree.
2. **`validate()`** answers the questions that depend on *how* the program is
   meant to be interpreted: module or script, TypeScript or JavaScript, strict
   or sloppy, and what names are already bound.
3. **`toAST()`** materializes the ESTree objects that tools such as ESLint
   expect, and returns the validation problems along with them.

If all you want is to lint with it, skip all three and use the
[ESLint parser object](#using-it-with-eslint).

Splitting the phases is what makes the fast path fast. Nothing allocates a
JavaScript object per node until something actually asks for one, and a tool
that only needs to look at part of a file can read the binary buffers directly
and never pay for the rest.

There are no version options. The parser accepts the latest JavaScript,
TypeScript, and JSX syntax, always.

## Install

```bash
npm install jsparse
```

## Usage

```js
import { parse, validate, toAST } from "jsparse";

const code = `const greeting: string = "hello";`;

// Phase 1: source text -> binary buffers. Throws on syntax errors.
const result = parse(code);

result.ast; // ArrayBuffer: the binary AST
result.tokens; // ArrayBuffer: every token, including comments
result.lineStarts; // Uint32Array: the offset each line begins at

// Phase 2: context-dependent checks.
const problems = validate(result, { sourceType: "module", dialect: "ts" });
// => []

validate(result, { dialect: "js" });
// => [{ message: 'TypeScript syntax is not allowed ...', lineNumber: 1, column: 15 }, ...]
// (one problem per TypeScript-only node, so the report points at each of them)

// Phase 3: validation plus an ESTree AST.
const { ast, errors } = toAST(result, { sourceType: "module", dialect: "ts" });

ast.type; // "Program"
ast.body[0].declarations[0].id.typeAnnotation.type; // "TSTypeAnnotation"
```

### `parse(code)`

Returns `{ ast, tokens, lineStarts }`.

Throws a `ParseError` for an invalid token or an invalid sequence of tokens.
The error carries `index` (0-based offset), `lineNumber`, and `column` (both
1-based), and its message ends with `(line:column)`.

```js
import { parse, ParseError } from "jsparse";

try {
	parse("var a = ;");
} catch (error) {
	error instanceof ParseError; // true
	error.message; // "Unexpected token ';' (1:9)"
	error.index; // 8
	error.lineNumber; // 1
	error.column; // 9
}
```

Everything that is merely *not allowed here* — a `with` statement in strict
mode, a redeclared binding, an octal literal, TypeScript syntax in a `.js`
file — parses without complaint and is reported by `validate()` instead.

### `validate(result, options)`

Returns an array of `{ message, lineNumber, column }`, in source order. The
position is spelled the way `ParseError` spells one — both 1-based — so fatal
and non-fatal problems can be reported through the same code path.

| Option       | Values                                | Default    |
| ------------ | ------------------------------------- | ---------- |
| `sourceType` | `"script"`, `"module"`, `"commonjs"`  | `"module"` |
| `dialect`    | `"js"`, `"ts"`                        | `"ts"`     |

It currently reports:

- `import` and `export` outside a module
- top-level `await` outside a module
- a JSX closing tag whose name does not match its opening tag
- TypeScript syntax when the dialect is `"js"`
- `with` in strict mode, and octal literals in strict mode
- strict-mode reserved words used as bindings
- duplicate lexical declarations, and `var`/`let` collisions
- `const` without an initializer
- `return` outside a function

### `toAST(result, options)`

Takes the same options as `validate()` and returns `{ ast, errors }`. The
`Program` node also carries `tokens` and `comments`, which is what ESLint reads.

## Using it with ESLint

`eslintParser` is a ready-made parser object. Drop it into `languageOptions`
and you are done — there are no low-level calls to make.

```js
// eslint.config.js
import { eslintParser } from "jsparse";

export default [
	{
		files: ["**/*.js", "**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: eslintParser,
		},
	},
];
```

It differs from `toAST()` in three ways, each because ESLint requires it:

- **Nodes, tokens, and comments carry `range` and `loc`.** ESLint refuses an
  AST without them. Everywhere else they are still left off.
- **Validation problems are thrown, not returned.** ESLint has no notion of a
  non-fatal parse problem: a file either parses or it doesn't. The first
  problem becomes a `ParseError`, which ESLint turns into a fatal lint message
  on the right line — the same thing its own parsers do.
- **The dialect comes from the file name.** `.js`, `.cjs`, `.mjs`, and `.jsx`
  are parsed as JavaScript, so TypeScript syntax in them is reported rather
  than quietly accepted; everything else is parsed as TypeScript. Pass an
  explicit `dialect` in `parserOptions` to override that.

`sourceType` is taken from the `languageOptions.sourceType` that ESLint already
resolves for you.

`range` and `loc` are ordinary properties here, exactly as `espree` produces
them, so anything that copies, enumerates, or serializes a node behaves the
same way.

Note that ESLint's built-in `no-undef` and `no-unused-vars` only understand
values, so on TypeScript files they report every type name as undefined and
every type-only import as unused. Turn them off for `**/*.ts`, exactly as
`typescript-eslint` does. This repository's own
[`eslint.config.js`](./eslint.config.js) is a worked example: `jsparse` lints
its own source.

## AST shape

- Parsing JavaScript produces the same AST as [`espree`](https://github.com/eslint/espree)
  with `ecmaVersion: "latest"`.
- Parsing TypeScript produces the same AST as
  [`@typescript-eslint/parser`](https://typescript-eslint.io/), except that
  properties which that parser leaves `undefined` are `null` here.
- JSX produces the same nodes as both, matching whichever the `dialect` selects.
- Nodes and tokens carry `start` and `end` offsets. They do not carry `range`
  or `loc`; use `lineStarts`, or the `LineIndex` helper built on it, if you
  need line and column numbers. The one exception is
  [the ESLint parser](#using-it-with-eslint), which adds both because ESLint
  requires them.

The `dialect` option decides which of the two shapes you get. In `"js"` mode the
TypeScript-only properties (`importKind`, `typeAnnotation`, `decorators`, and
friends) are left off entirely, so the output is structurally identical to
`espree`'s.

## JSX

JSX is always available; there is no flag to turn it on. Both dialects support
it, and each produces the JSX nodes its reference parser produces.

```js
const { ast } = toAST(parse('<ul>{items.map(i => <li key={i}>{i}</li>)}</ul>;'));
```

Two things are worth knowing.

**A `<` in expression position is read as JSX first.** If that fails, it is
retried as an old-style `<T>value` type assertion, which is what keeps
`<any>value` working in code that contains no JSX at all. TypeScript itself
resolves this ambiguity by file extension, which `parse()` cannot see, so it
resolves it by trying. The practical effect is that JSX always wins where both
readings are possible - the same choice a `.tsx` file makes.

One consequence: text that is neither valid JSX nor a valid assertion may be
reported with whichever diagnostic the second reading produced, which can point
past the real problem. `<div a={1}>text` reports the JSX error; `<div>text</div`
reports the assertion's.

**A mismatched closing tag is not a parse error.** `<div>{x}</span>` produces a
well-shaped tree, so it parses and `validate()` reports the mismatch. That
follows the same rule as everything else here: only text that cannot be shaped
into a tree throws.

### Verified against the reference parsers

`npm run conformance` parses every JavaScript and TypeScript file it can find
under `node_modules` with both `jsparse` and the reference parser and compares
the results structurally. As of this writing that is 1412 JavaScript files
(ASTs, tokens, and comments) and 1135 TypeScript files, with zero differences.
JSX has no real-world corpus to point it at, so it is covered by the fixture
suite instead: every sample in `tests/fixtures/jsx.json` is compared against
both `espree` and `@typescript-eslint/parser`.

There is one deliberate deviation: `espree` leaves `start` and `end` undefined
on merged template tokens unless its `range` option is on. `jsparse` always
fills them in.

## Binary formats

Both buffers begin with a header holding a magic number, a format version, and
the size of one record. Readers must honor the recorded record size rather than
assume a constant — that is what lets a later version add fields without
breaking existing consumers. Node kinds and token kinds are numbers assigned
from append-only ranges, so new node types and token types slot in without
renumbering the old ones.

### Token buffer

A 16-byte header followed by fixed 16-byte records:

| Offset | Size | Contents                                                    |
| ------ | ---- | ----------------------------------------------------------- |
| 0      | 4    | start offset                                                 |
| 4      | 4    | end offset                                                   |
| 8      | 2    | kind (fine-grained: every keyword, punctuator, and JSX form)  |
| 10     | 2    | flags (line break before, contains escapes, legacy octal, …)  |
| 12     | 4    | auxiliary data (for a regular expression, where the pattern ends) |

Comments are recorded in source order alongside everything else.

### AST buffer

A 48-byte header, then three regions: fixed 48-byte node records, a list region
holding child indexes, and a copy of the source text as UTF-16. Carrying the
text inside the buffer is what lets `validate()` and `toAST()` work from the
parse result alone, and makes the buffers safe to transfer to a worker.

Each node record is twelve 32-bit words: start, end, kind, flags, and eight
slots whose meaning depends on the kind. Node index `0` is the "no node"
sentinel, so a slot holding `0` always decodes to `null`.

### Reading the buffers directly

```js
import { parse, AstReader, TokenReader, N_Identifier } from "jsparse";

const { ast } = parse("const answer = 42;");
const reader = new AstReader(ast);

// Walk without materializing a single node object.
for (let node = 1; node < reader.nodeCount; node++) {
	if (reader.kind(node) === N_Identifier) {
		console.log(reader.text(node)); // "answer"
	}
}
```

## Performance

`npm run bench` measures full AST creation — source text in, complete ESTree
out — against `espree`, `acorn`, and `@typescript-eslint/parser` backed by two
different TypeScript versions.

Each suite runs in its own child process, because loading two copies of
TypeScript leaves a large heap behind and the resulting garbage collection
pressure lands hardest on whichever parser allocates most — which is not a
property of the parsers worth measuring.

On ~196 KiB generated modules (Node 24, Linux x64). Absolute figures depend on
how warm the machine is and can move a lot; the ratios within a suite are what
to read.

JavaScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jsparse`                                  | 37.6  | 1.00x    |
| `acorn`                                    | 35.9  | 0.95x    |
| `espree`                                   | 21.5  | 0.57x    |
| `@typescript-eslint/parser` + TypeScript 6 | 3.2   | 0.09x    |

TypeScript:

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jsparse`                                  | 35.6  | 1.00x    |
| `@typescript-eslint/parser` + TypeScript 6 | 2.5   | 0.07x    |

JSX (`acorn` has no JSX support of its own, so it does not appear):

| Parser                                     | ops/s | Relative |
| ------------------------------------------ | ----- | -------- |
| `jsparse`                                  | 21.4  | 1.00x    |
| `espree`                                   | 11.0  | 0.51x    |
| `@typescript-eslint/parser` + TypeScript 6 | 3.2   | 0.15x    |

JSX is the slowest of the three because a `<` in expression position is parsed
speculatively, and because the fixture is dense in small nodes.

The job ESLint actually asks for, where every node, token, and comment also
carries `range` and `loc`. Both contenders are configured to produce all of it,
and their output on this fixture is identical:

| Parser                     | ops/s | Relative |
| -------------------------- | ----- | -------- |
| `jsparse` (`eslintParser`) | 26.0  | 1.00x    |
| `espree`                   | 16.8  | 0.65x    |

Measured in the same session as the JavaScript table above, so the two are
directly comparable. Locations are not free for either parser: the ESTree shape
wants a fresh `{ line, column }` pair for each end of every node and token, and
building roughly 400,000 small objects costs `jsparse` about a third of its
parse time (37.6 down to 26.0) and `espree` about a fifth (21.0 down to 16.8).
Finding which line an offset falls on is the cheap half — `LineIndex` remembers
the line it matched last, and source-order traversal hits it nearly every time.
Allocation is the expensive half, and neither parser can avoid it while
producing the shape ESLint expects.

**What this is worth in a real lint run is smaller than it looks.** Parsing is
roughly 15% of the time ESLint spends on a file; scope analysis and rules are
the rest. Everything downstream of parsing costs the same on either parser's
AST — traversal plus every recommended rule measures 96.0 ms on `espree`'s tree
and 96.2 ms on ours, and scope analysis is likewise within noise — so the parse
win carries through undiluted but only in proportion to its share.

The TypeScript 7 row is measured the same way, by redirecting module resolution
for `"typescript"` and reloading the parser. `@typescript-eslint/parser` does
not yet accept TypeScript 7, so that row currently reports itself as skipped
with the reason.

Note that the first three tables compare `parse()` **plus** `toAST()`. Skipping
`toAST()` is much faster still, which is the point of the binary
representation.

Benchmark a file of your own with:

```bash
npm run bench -- path/to/file.ts
```

Or run one suite on its own, which is the most reliable way to compare two
numbers:

```bash
node benchmarks/benchmark.js --suite=eslint
```

## Design notes

A few decisions are worth knowing about if you plan to read the source.
[`docs/architecture.md`](./docs/architecture.md) is the full specification: how the scanner
and parser work, the exact layout of both binary buffers, and the invariants to
respect when changing them.

**The scanner is driven by the parser, one token at a time.** That is what lets
`/` resolve into either division or a regular expression, and `}` into either a
punctuator or the continuation of a template literal, without guessing. The
parser tells the scanner whether a `{` opened a block or an object literal, and
whether a `(` belongs to a statement head.

The same mechanism is what makes JSX possible at all. JSX is not a rearrangement
of JavaScript tokens - `<div>a + b</div>` has one text token where JavaScript
would see five, `foo-bar` is one name where JavaScript sees three, and an
attribute's `"a\nb"` has no escape sequence in it - so the parser asks for the
next token in a JSX mode (`nextJsxText`, `nextJsxName`, `nextJsxAttributeValue`)
rather than letting the scanner guess. Each mode falls back to ordinary scanning
when the text at that position is not the JSX-specific form.

**Classification is table-driven.** Character classes are bit masks in a
`Uint8Array` indexed by character code. Keywords are recognized from a rolling
hash of their character codes and confirmed with a character-by-character
comparison, so no substring is ever created to decide whether a word is a
keyword. Operator precedence, the coarse token type, and which slots of a node
hold children are all lookup tables.

**Nothing intermediate is allocated during parsing.** Child lists are gathered
on a shared scratch stack and flushed into the list region once their length is
known. Speculative parses — the ones needed to tell `(a: T) => x` from `(a)` —
rewind the node writer and the scanner rather than building throwaway objects.

## Known limitations

- **`await` at the top level is parsed as an operator.** Whether `await(1)` is a
  call or an `AwaitExpression` depends on the source type, which `parse()`
  deliberately does not know. It is parsed the way a module would read it, which
  matches the default; `validate()` reports the mismatch for a script.
- Scope analysis in `validate()` covers declarations and redeclarations. It does
  not resolve references or report unused bindings — that is ESLint's job.

## Development

```bash
npm test          # unit and conformance tests
npm run typecheck # tsc --noEmit
npm run lint      # lint this repository with its own parser
npm run build     # esbuild bundle + .d.ts files
npm run bench     # performance comparison
npm run conformance  # differential test against espree and typescript-eslint
```

## License

Apache-2.0
