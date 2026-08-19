# Parsing

`parse()`, `validate()`, and `toAST()` in full: every option, the errors they
raise, how JSX is handled, how the ESLint parser object differs, and how to
read the binary buffer without building a tree.

The [package README](../../README.md#parsing) has the short version.

## Usage

```js
import {
	parse,
	validate,
	toAST,
	AstReader,
	TokenReader,
	readLineStarts,
	readParents,
} from "@eslint/jskit";

const code = `const greeting: string = "hello";`;

// Phase 1: source text -> one binary buffer. Throws on syntax errors.
const result = parse(code);

result; // ArrayBuffer: the AST, the tokens, and the line offsets
new AstReader(result); // the binary AST
new TokenReader(result); // every token, including comments
readLineStarts(result); // Uint32Array: the offset each line begins at

// Each node's parent, for a parse that was asked for one.
readParents(parse(code, { parents: true }));

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

### `parse(code, options?)`

Returns one `ArrayBuffer` holding the encoded AST, the encoded token stream,
the offset of every line, and — when asked for — a copy of the source text and
each node's parent. `AstReader`, `TokenReader`, `readLineStarts()`, and
`readParents()` read the regions; each takes the whole buffer and finds its
own.

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `sourceType` | `"module"` | Whether to read the text as a script, an ES module, or a CommonJS module. |
| `embedSource` | `false` | Copy the source text into the buffer, so it can be read in a process that did not parse it. |
| `parents` | `false` | Derive each node's parent, so a tool can climb from a node to its context. |

`sourceType` is the one interpretation question phase 1 cannot leave to phase
2, because two readings of the same text can both be valid and produce
different trees:

```js
toAST(parse("await.x;", { sourceType: "script" })).ast.body[0].expression.type;
// => "MemberExpression" — `await` is an ordinary name in a script

parse("await.x;", { sourceType: "module" });
// => throws: `await` is an operator in a module, and `.x` is not an operand
```

The same goes for Annex B's HTML-like comments: `a <!--b` is `a` followed by a
comment in a script, and `a < !(--b)` in a module. The choice is recorded in the
buffer, so `validate()` and `toAST()` read it back and need not be told again —
and refuse to be told the opposite, since the tree was built the other way.

Reading text off a buffer works either way in the process that parsed, because
the original string is cached against the buffer. Turn `embedSource` on when
the buffer will be transferred to a worker, written to disk, or otherwise read
elsewhere — it adds roughly a sixth to the buffer, so it is not carried unless
it is asked for. Reading text off a transferred buffer that was parsed without
it throws and says so. See
[`embedded-source.md`](./embedded-source.md).

Throws a `ParseError` for an invalid token or an invalid sequence of tokens.
The error carries `index` (0-based offset), `lineNumber`, and `column` (both
1-based), and its message ends with `(line:column)`.

```js
import { parse, ParseError } from "@eslint/jskit";

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

| Option        | Values                                | Default              |
| ------------- | ------------------------------------- | -------------------- |
| `sourceType`  | `"script"`, `"module"`, `"commonjs"`  | what `parse()` used  |
| `dialect`     | `"js"`, `"ts"`                        | `"ts"`               |
| `jsx`         | `true`, `false`                       | `false`              |
| `declaration` | `true`, `false`                       | `false`              |

`sourceType` normally need not be passed, since the buffer records what
`parse()` was told. Its use is to narrow `"script"` to `"commonjs"` — the two
parse identically and differ only in what is allowed here. Naming the opposite
side of the module line throws.

`declaration` says the file is a TypeScript declaration file — a `.d.ts`.
Everything in one is ambient: it describes what exists elsewhere rather than
bringing anything into being, so `export const x: number;` is a complete
declaration there while the same line in a `.ts` is a `const` missing its
initializer. Nothing in the text says which kind of file it is — TypeScript
goes by the name — so it has to be told, the same way `dialect` and `jsx` do.
Anything written under a `declare` is ambient without this being set.

It currently reports:

- `import` and `export` outside a module
- a JSX closing tag whose name does not match its opening tag
- JSX when the `jsx` option is off
- TypeScript syntax when the dialect is `"js"`
- `with` in strict mode, and octal literals in strict mode
- strict-mode reserved words used as bindings
- duplicate lexical declarations, and `var`/`let` collisions
- `const` without an initializer, outside an ambient declaration
- `eval` or `arguments` bound or assigned to in strict code, and `arguments`
  mentioned in a class field initializer or a static block
- `return` outside a function

### `toAST(result, options)`

Takes the same options as `validate()` and returns `{ ast, errors }`. The
`Program` node also carries `tokens` and `comments`, which is what ESLint reads.

## Using it with ESLint

`eslintParser` is a ready-made parser object. Drop it into `languageOptions`
and you are done — there are no low-level calls to make.

```js
// eslint.config.js
import { eslintParser } from "@eslint/jskit";

export default [
	{
		files: ["**/*.js", "**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: eslintParser,
		},
	},
];
```

It differs from `toAST()` in five ways, each because ESLint requires it:

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
- **Declaration files come from the file name too.** `.d.ts`, `.d.mts`, and
  `.d.cts` are treated as ambient, so a `const` in one needs no initializer.
  Pass an explicit `declaration` in `parserOptions` to override that.
- **JSX comes from the file name too.** `.jsx` and `.tsx` files accept JSX and
  every other extension reports it, so neither needs configuring. Pass an
  explicit `ecmaFeatures.jsx` in `parserOptions` to override that — the same
  place `espree` reads it from, so a configuration written for `espree` keeps
  working:

  ```js
  languageOptions: {
  	parser: eslintParser,
  	parserOptions: {
  		ecmaFeatures: { jsx: true },
  	},
  }
  ```

`sourceType` is taken from the `languageOptions.sourceType` that ESLint already
resolves for you.

`range` and `loc` are ordinary properties here, exactly as `espree` produces
them, so anything that copies, enumerates, or serializes a node behaves the
same way.

Note that ESLint's built-in `no-undef` and `no-unused-vars` only understand
values, so on TypeScript files they report every type name as undefined and
every type-only import as unused. Turn them off for `**/*.ts`, exactly as
`typescript-eslint` does. This repository's own
[`eslint.config.js`](../../../../eslint.config.js) is a worked example: the toolkit lints its own
source.

## AST shape

- Parsing JavaScript produces the same AST as [`espree`](https://github.com/eslint/espree)
  with `ecmaVersion: "latest"`.
- Parsing TypeScript produces the same AST as
  [`@typescript-eslint/parser`](https://typescript-eslint.io/), except that
  properties which that parser leaves `undefined` are `null` here.
- JSX produces the same nodes as both, matching whichever the `dialect` selects.
- Nodes and tokens carry `start` and `end` offsets. They do not carry `range`
  or `loc`; use `readLineStarts()`, or the `LineIndex` helper built on it, if
  you need line and column numbers. The one exception is
  [the ESLint parser](#using-it-with-eslint), which adds both because ESLint
  requires them.

The `dialect` option decides which of the two shapes you get. In `"js"` mode the
TypeScript-only properties (`importKind`, `typeAnnotation`, `decorators`, and
friends) are left off entirely, so the output is structurally identical to
`espree`'s.

## JSX

JSX is opt-in: pass `jsx: true` to `validate()` or `toAST()`. Both dialects
support it, and each produces the JSX nodes its reference parser produces.

```js
const { ast } = toAST(
	parse('<ul>{items.map(i => <li key={i}>{i}</li>)}</ul>;'),
	{ jsx: true },
);
```

`parse()` reads JSX whether or not the option is on, because which reading a
`<` deserves is exactly the kind of question the text alone cannot answer.
Leaving `jsx` off does not change the tree; it makes `validate()` report every
JSX element and fragment as syntax that is not allowed here, one problem per
outermost element rather than one per node.

Two more things are worth knowing.

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
under this workspace's `node_modules` with both this parser and the reference
parser and compares the results structurally — several thousand files, ASTs,
tokens, and comments alike, with zero differences. JSX has no real-world corpus
to point it at, so it is covered by the fixture suite instead: every sample in
`tests/parse/fixtures/jsx.json` is compared against both `espree` and
`@typescript-eslint/parser`. [`scripts/README.md`](../../scripts/README.md)
explains what each script covers.

There is one deliberate deviation: `espree` leaves `start` and `end` undefined
on merged template tokens unless its `range` option is on. This parser always
fills them in.

## Binary format

A parse produces one buffer. It begins with a 64-byte header holding a magic
number, a format version, the size of one node record and of one token record,
and the byte offset of every region that follows: the nodes, the child lists,
the tokens, the line offsets, and the source text. Readers must honor the
recorded sizes and offsets rather than assume constants — that is what lets a
later version add fields, or grow the header itself, without breaking existing
consumers. Node kinds and token kinds are numbers assigned from append-only
ranges, so new node types and token types slot in without renumbering the old
ones.

### Token records

Fixed 16-byte records:

| Offset | Size | Contents                                                    |
| ------ | ---- | ----------------------------------------------------------- |
| 0      | 4    | start offset                                                 |
| 4      | 4    | end offset                                                   |
| 8      | 2    | kind (fine-grained: every keyword, punctuator, and JSX form)  |
| 10     | 2    | flags (line break before, contains escapes, legacy octal, …)  |
| 12     | 4    | auxiliary data (for a regular expression, where the pattern ends) |

Comments are recorded in source order alongside everything else.

### Node records

Fixed 48-byte records, followed by the optional parent table and a list region
holding child indexes. Each record is twelve 32-bit words: start, end, kind,
flags, and eight slots whose meaning depends on the kind. Node index `0` is the
"no node" sentinel, so a slot holding `0` always decodes to `null`.

### The parent table

One word per node: the index of the node that holds it. `reader.parent(node)`
reads one entry and `readParents(result)` returns the whole table as a view
onto the buffer, so a tool can climb to an enclosing function or statement
without having walked down from the root to get there. The root's parent is
`NO_NODE`.

The region is only there when `parse()` was given `{ parents: true }`, because
deriving it is a pass over every node record and costs a few percent of a
parse. Both readers throw on a buffer that was parsed without it — reporting
`NO_NODE` for everything would be indistinguishable from a tree in which no
node has a parent.

### The source text

The buffer can carry a copy of the source as UTF-16, which is what lets
`validate()` and `toAST()` work from the parse result alone anywhere, and makes
the buffer safe to transfer to a worker. It does not by default; see
`embedSource` above.

### Reading the buffer directly

```js
import { parse, AstReader, N_Identifier, NO_NODE } from "@eslint/jskit";

// `parents` is what makes the guard below possible; it is off by default.
const reader = new AstReader(parse("const answer = 42;", { parents: true }));

// Walk without materializing a single node object.
for (let node = 1; node < reader.nodeCount; node++) {
	if (reader.parent(node) === NO_NODE && node !== reader.root) {
		continue; // a record the parser allocated and abandoned
	}

	if (reader.kind(node) === N_Identifier) {
		console.log(reader.text(node)); // "answer"
	}
}
```

`nodeCount` counts index slots, not nodes in the tree: the sentinel at 0, every
live node, and the occasional record the parser allocated and then walked away
from. Those are unreachable from the root, so `toAST()` and `validate()` never
see one, but an index walk does — in `new Map()` the `new` is one, and without
the guard above it comes back as a third `Identifier`. They are about 0.3% of
the records in a large corpus, and having no parent is what identifies them.

## Design notes

A few decisions are worth knowing about if you plan to read the source.
[`architecture.md`](./architecture.md) is the full specification: how the
scanner and parser work, the exact layout of the binary buffer, and the
invariants to respect when changing them.

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

- **`await` used as a name in a module is only caught where it is bound.**
  `var await = 1` in a module is reported; a bare reference such as
  `function f() { await.x; }` is not. `await` is reserved throughout module
  code, function bodies included.
- Scope analysis in `validate()` covers declarations and redeclarations. It does
  not resolve references or report unused bindings — that is ESLint's job.

