# Parser Technical Specification

How the tokenizer and parser work, and what the binary parse buffer contains.

This is a reference for people changing the parser. The [README](../../README.md)
covers the public API; this document covers the machinery behind it.

## Contents

- [The three phases](#the-three-phases)
- [Source layout](#source-layout)
- [Tokenization](#tokenization)
  - [Character classification](#character-classification)
  - [Token kinds](#token-kinds)
  - [Keyword recognition](#keyword-recognition)
  - [The parser drives the scanner](#the-parser-drives-the-scanner)
  - [The context stack](#the-context-stack)
  - [Rescanning](#rescanning)
  - [JSX modes](#jsx-modes)
- [Parsing](#parsing)
  - [The parser chain](#the-parser-chain)
  - [Writing nodes](#writing-nodes)
  - [Building child lists](#building-child-lists)
  - [Speculation and rewinding](#speculation-and-rewinding)
  - [Expressions](#expressions)
  - [Patterns without a cover grammar](#patterns-without-a-cover-grammar)
  - [The two ambiguities worth knowing](#the-two-ambiguities-worth-knowing)
- [Binary format](#binary-format)
  - [Shared conventions](#shared-conventions)
  - [The header](#the-header)
  - [Token records](#token-records)
  - [Node records](#node-records)
  - [The flags word](#the-flags-word)
  - [The list region](#the-list-region)
  - [The parent table](#the-parent-table)
  - [Records that are not in the tree](#records-that-are-not-in-the-tree)
  - [The embedded source text](#the-embedded-source-text)
  - [Reading a buffer](#reading-a-buffer)
- [Validation](#validation)
- [Decoding to ESTree](#decoding-to-estree)
- [Invariants](#invariants)
- [Extending the format](#extending-the-format)

## The three phases

Most parsers do one pass and hand back an object tree. This one splits that
into three, and the split is the reason the fast path is fast.

| Phase | Entry point | Produces | Fails how |
| ----- | ----------- | -------- | --------- |
| Parse | `parse(code)` | Two `ArrayBuffer`s and a `Uint32Array` | Throws `ParseError` |
| Validate | `validate(result, options)` | An array of problems | Never throws |
| Decode | `toAST(result, options)` | ESTree objects, plus the problems | Never throws |

The dividing line between phase 1 and phase 2 is **whether the answer depends
on context that the text alone does not supply**. `parse()` accepts the union
of everything JavaScript and TypeScript allow. It throws only when the text
cannot be turned into tokens, or those tokens cannot be shaped into a tree.

Everything that is merely *not allowed here* — `with` in strict mode, a
redeclared binding, `return` outside a function, TypeScript syntax in a `.js`
file, JSX in a file that is not JSX, top-level `await` in a script — parses
cleanly and is reported by `validate()`. That is what makes the source type,
the dialect, and `jsx` options of phase 2 rather than phase 1, and it means one
parse can be validated several ways.

Phase 3 is where JavaScript objects finally get allocated. A tool that only
needs to inspect part of a file can read the binary buffer directly with
`AstReader` and never pay for the rest.

## Source layout

```text
src/
  chars.ts          character classification tables
  token-kinds.ts    token kinds, keyword table, per-kind lookup tables
  node-kinds.ts     node kinds, node flags, the node record layout
  binary.ts         the buffer header, WordBuffer, buffer assembly
  tokenizer.ts      the scanner
  node-writer.ts    node allocation, child lists, rewind support
  parser-base.ts    shared parser state and token helpers
  parser-types.ts   the TypeScript type grammar
  parser-expressions.ts  expressions, patterns, functions, classes
  parser-jsx.ts     the JSX grammar
  parser.ts         statements, declarations, modules, the entry point
  slots.ts          which node slots hold children, for generic walks
  validate.ts       phase 2
  regexp.ts         the regular expression pattern grammar, for phase 2
  unicode-properties.ts  the names \p{…} may use; generated, do not edit
  reader.ts         readers over the nodes and the tokens
  to-ast.ts         phase 3
  locations.ts      offset to line and column
  values.ts         escape and numeric literal decoding
  entities.ts       XHTML named entities for JSX text
  errors.ts         ParseError
  api.ts            parse(), validate(), toAST(), and the token decoder
  eslint-parser.ts  the ESLint parser object
  index.ts          the public surface, and nothing but re-exports
```

## Tokenization

### Character classification

`chars.ts` holds `CHAR_FLAGS`, a `Uint8Array(128)` with one entry per ASCII
character. Each entry packs six answers into bits:

| Mask | Bit | Meaning |
| ---- | --- | ------- |
| `MASK_ID_START` | 0 | May begin an identifier |
| `MASK_ID_PART` | 1 | May continue an identifier |
| `MASK_SPACE` | 2 | Is whitespace |
| `MASK_NEWLINE` | 3 | Is a line terminator |
| `MASK_DIGIT` | 4 | Is `0`–`9` |
| `MASK_HEX_DIGIT` | 5 | Is a hexadecimal digit |

Classifying a character is one array read and one bitwise AND. Characters at or
above 128 fall through to `isNonAsciiIdStart`, `isNonAsciiIdPart`, and
`isNonAsciiSpace`, which are slower but reached rarely — the table covers
essentially all of real-world source text.

### Token kinds

A *kind* is a small integer identifying a token precisely: not "punctuator" but
`T_PLUS_EQUALS`, not "keyword" but `T_instanceof`. The range is partitioned so
that a category test is a comparison rather than a set lookup:

| Range | Contents |
| ----- | -------- |
| 0–19 | Literals and trivia: EOF, identifiers, numbers, strings, regexps, the four template pieces, comments, hashbang, the three JSX kinds |
| 20–`PUNCT_LAST` | Punctuators, starting at `T_BRACE_OPEN = 20` |
| 100–182 | Keywords, from `T_await = 100` to `T_intrinsic = 182` |

Anything else a consumer needs is a table indexed by kind, built once at module
load:

- `KIND_TOKEN_TYPE` — the coarse ESLint token type (`Identifier`, `Keyword`,
  `Punctuator`, …). This deliberately reproduces `espree`'s behavior rather
  than the specification's: contextual keywords such as `async` and `of` are
  reported as identifiers, while `let`, `static`, and `yield` are promoted to
  keywords.
- `KIND_BEFORE_EXPR` — whether an expression may follow this token, which is
  how `/` is resolved. See [the context stack](#the-context-stack).
- `KIND_PRECEDENCE` — binding power for the binary operator loop.
- `KIND_KEYWORD_FLAGS` — `KW_RESERVED`, `KW_STRICT_RESERVED`, `KW_CONTEXTUAL`.
- `KEYWORD_NAMES` and `PUNCTUATOR_NAMES` — spellings, indexed by
  `kind - KEYWORD_FIRST` and `kind - PUNCT_FIRST`.

### Keyword recognition

Deciding whether an identifier is a keyword must not allocate a substring —
doing so for every identifier in a file is one of the larger costs in a naive
scanner.

While scanning an identifier the tokenizer maintains a rolling hash,
`hash = (hash * 31 + code) | 0`, at no extra cost since it is already walking
the characters. Then `lookupKeyword(source, start, end, hash)`:

1. Rejects anything shorter than 2 or longer than 10 characters outright, since
   no keyword falls outside that range.
2. Probes `KEYWORD_SLOTS`, a 512-entry open-addressed `Uint16Array` keyed on
   `hash & 511`, walking forward on collision.
3. Confirms a candidate by comparing the stored spelling to the source
   character by character, straight out of the original string.

An empty slot means "not a keyword". No substring is ever created.

### The parser drives the scanner

There is no token stream sitting between the two. The parser asks for one token
at a time by calling `next()`, and the scanner uses state that only the parser
knows to decide what it is looking at.

This is what resolves the two genuinely ambiguous characters in JavaScript:

- **`/` is division or the start of a regular expression.** Deciding needs to
  know whether an expression could begin here.
- **`}` is a punctuator or the resumption of a template literal.** Deciding
  needs to know whether the matching `{` opened a block, an object literal, or
  a `${` substitution.

Neither is answerable from the character stream alone. Because the parser asks
for each token at the moment it knows the answer, the scanner never has to
guess and never has to be corrected.

Every token the scanner produces is appended to the token region as it is
scanned, including comments. That is why the token stream in the result
contains trivia that the parser itself skipped over.

### The context stack

The scanner keeps a small stack of what brackets are currently open:

| Context | Pushed by |
| ------- | --------- |
| `CTX_BLOCK` | `{` that opened a statement block |
| `CTX_OBJECT` | `{` that opened an object literal |
| `CTX_PAREN_STMT` | `(` of `if`, `for`, `while`, and friends |
| `CTX_PAREN_EXPR` | any other `(` |
| `CTX_TEMPLATE` | `${` inside a template literal |

Alongside it sits `exprAllowed`, a boolean meaning "an expression could start
at the next token". After most tokens it is set from
`KIND_BEFORE_EXPR[kind]`; a few need more care:

- After `}` and `)`, it is set from the context being popped — an expression may
  follow the `)` of `if (x)` but not the `)` of `f(x)`.
- After `yield` and `await`, it depends on whether the parser is inside a
  generator or an async function, which the parser reports to the scanner.
- After `++` and `--`, it depends on what came before.

The parser tells the scanner which kind of `{` it is about to consume with
`markBrace(isBlock)`, and flags a statement head with `markStatementParen()`,
because only the parser knows.

### Rescanning

Some tokens can only be understood after the parser has looked further ahead.
Rather than buffer tokens, the parser asks the scanner to re-read the current
one:

- `reScanAsRegExp()` — the token was scanned as `/` or `/=` but belongs to a
  regular expression.
- `reScanGreaterThan()` — `>>` and `>>>` must be split when they close nested
  type arguments, as in `Array<Map<K, V>>`.
- `reScanAsJsxName()` — return to JSX naming rules after a type argument list.
- `demoteKeywordToIdentifier()` — a keyword used as a property name is reported
  as an `Identifier` token, matching `espree.parse`. `let`, `static`, and
  `yield` are exempt, again matching `espree`.

### JSX modes

JSX cannot be handled by the parser alone, because its lexical grammar differs
from JavaScript's in ways that change what a token *is*:

| Source | JavaScript scanning | JSX needs |
| ------ | ------------------- | --------- |
| `<div>a + b</div>` | `a`, `+`, `b` | one `JSXText` token |
| `<foo-bar/>` | `foo`, `-`, `bar` | one `JSXIdentifier` |
| `attr="a\nb"` | `\n` is an escape | literal backslash and `n`; `&amp;` is an entity |
| `</div>` | regexp literal, since `<` allows an expression | `/` punctuator |

So JSX is three extra scanner entry points the parser calls where the grammar
says a JSX construct is expected. Each falls back to ordinary scanning when the
text is not the JSX form, which keeps the JSX parser readable:

- `nextJsxText()` — literal child text up to `<` or `{`, whitespace included.
- `nextJsxName()` — a JSX identifier, which may contain `-`.
- `nextJsxAttributeValue()` — a quoted attribute value, in which backslash is
  not an escape.

One subtlety: `finishSkippedToken()` clears `exprAllowed` first, because inside
JSX a `/` always closes a tag and must never be read as a regular expression.

## Parsing

### The parser chain

The parser is one object split across an inheritance chain, so that each layer
sees the layers below it without any indirection at a call site:

```text
ParserBase          token helpers, context flags, identifiers, literals
  TypeParser        the TypeScript type grammar
    ExpressionParser  expressions, patterns, parameters, functions, classes
      JsxParser       JSX elements, fragments, attributes
        Parser        statements, declarations, modules, parseProgram()
```

The layers below declare abstract methods that the layers above implement,
which is how the type grammar can call back into the expression grammar for a
computed property name.

### Writing nodes

`NodeWriter` owns two `WordBuffer`s — one for node records, one for child lists
— and a scratch stack.

`alloc(kind, start)` reserves twelve words and returns an index. The node's end
offset is filled in later by `finish(index, end)`. Slots are written with
`set(index, slot, value)` and flags with `addFlags(index, flags)`.

`retype(index, kind)` changes a node's kind in place. This is how an expression
becomes a binding pattern: `({a, b} = c)` is parsed as an `ObjectExpression`
and then retyped to `ObjectPattern` once the `=` is seen, without rebuilding
anything.

`discard(index)` goes the other way, for a node that turned out not to belong
in the tree at all after its children were handed to another node. The index
cannot be reclaimed, so the record is zeroed in place and every generic pass
skips it. See
[records that are not in the tree](#records-that-are-not-in-the-tree) for when
that is required and what goes wrong without it.

### Building child lists

A node slot cannot hold a variable number of children, so children go in a
separate list region and the slot holds a *handle* — a word index into that
region.

Lists are gathered on a shared scratch stack:

```js
const mark = writer.startList();

while (!this.at(T_BRACKET_CLOSE)) {
	writer.pushList(this.parseElement());
}

const handle = writer.endList(mark);   // flushed to the list region
```

`endList` copies the run into the list region and returns the handle, resetting
the scratch length to the mark. Nesting works because the discipline is a
stack: an inner list always ends before the outer one continues.

Two special cases:

- `singletonList(nodeIndex)` skips the scratch stack for a one-element list.
- `endInterleavedLists(mark)` splits one scratch run into two handles by
  even and odd position. Template literals alternate quasis and expressions,
  and gathering them into one run and splitting at the end is the only way to
  do that within the stack discipline.

An empty list is handle `0`, which is why the list region never stores a
zero-length list.

### Speculation and rewinding

Some constructs cannot be decided by lookahead alone. The parser tries one
reading and abandons it:

```js
const state = this.tokenizer.save();
const snapshot = this.writer.mark();

try {
	return this.parseArrowFunction();
} catch {
	this.writer.rewind(snapshot);
	this.tokenizer.restore(state);
}
```

`writer.mark()` captures the node count, list length, and scratch length;
`rewind()` restores all three and zero-fills the abandoned node region so that
stale words can never be read back. `tokenizer.restore()` also discards any
token records written during the attempt, so speculation leaves no trace in the
token region.

Speculation is not free, so the parser avoids it where a cheap test will do.
`nextCanStartParameterList()` rejects most `(` in one token before the more
expensive matching-paren scan runs at all.

### Expressions

Binary operators use precedence climbing over `KIND_PRECEDENCE`: parse a unary
expression, then loop while the next token binds at least as tightly as the
current minimum, recursing with `precedence + 1`. No table of parse functions
per level, and no recursion through a chain of one-production-per-level
methods.

`&&`, `||`, and `??` produce `LogicalExpression` rather than
`BinaryExpression`, matching ESTree.

### Patterns without a cover grammar

The specification defines a cover grammar so that `(a, b)` can be re-read as an
arrow's parameter list. This parser does not implement one. Instead it looks
ahead to the token after the matching `)` — `kindAfterMatchingParen()` — and
commits to parsing either a parenthesized expression or a parameter list.

That scan runs in ordinary JavaScript mode, so text that only tokenizes under
another mode (JSX, most often) can throw during the scan. The scan catches it
and reports `T_EOF`, which simply means "not an arrow", and the real parse then
proceeds under the correct mode.

Where an expression really has already been parsed and turns out to be a
pattern, `retype()` converts it in place.

### The two ambiguities worth knowing

**`<` in expression position.** `<T>value` is a TypeScript type assertion and
`<T>value</T>` is a JSX element. TypeScript resolves this by file extension,
which `parse()` does not have. So the parser tries JSX first, and on failure
rewinds and tries a type assertion. JSX wins wherever both readings work, which
is the `.tsx` choice. When both fail, the JSX diagnostic is preferred, since
that is nearly always what the author meant.

The `jsx` option does not enter into this. It belongs to phase 2, so a JSX
element parses either way and `validate()` reports it when the option is off —
once per outermost `JSXElement` or `JSXFragment`, which is what the `inJsx`
flag in the walk is for.

**A mismatched JSX closing tag.** `<div>{x}</span>` yields a perfectly
well-shaped tree, so under the phase rule it is not a parse error. It is
reported by `validate()`. `espree` throws here; this is a deliberate
divergence.

## Binary format

### Shared conventions

- A parse produces exactly one `ArrayBuffer`. Everything it found — the nodes,
  the child lists, the tokens, the line offsets, and optionally the source
  text — is a region inside it, so a parse result is one value to hold, one
  value to transfer, and one value to persist.
- All multi-byte values are 32-bit unsigned little-endian words. The buffer is
  read through a `Uint32Array` over the whole `ArrayBuffer`.
- The buffer starts with a magic number and a format version.
- **The buffer records its own record sizes and region offsets.** Readers must
  compute record positions from the recorded size, and find a region at the
  recorded offset, rather than from compiled-in constants. That is the whole
  extension story: a later version can grow a record, or grow the header
  itself, and a reader built against an earlier version still finds every field
  it knows about, because they are all at the front.
- Offsets stored in records are offsets into the *source text*, in UTF-16 code
  units — the same units as JavaScript string indices.

### The header

Seven regions, in order, each beginning on a word boundary.

```text
Header (68 bytes, 17 words)
  word 0   magic          0x4250534A  ("JSPB" little-endian)
  word 1   version        1
  word 2   flags          bit 0: PARSE_FLAG_SOURCE_EMBEDDED
                          bit 1: PARSE_FLAG_PARENTS
  word 3   root           index of the root node
  word 4   nodeCount      index slots: the reserved node 0, the tree, and the
                          records that are not in it
  word 5   nodeBytes      48
  word 6   nodesOffset    byte offset of the node region
  word 7   listCount      length of the list region, in words
  word 8   listOffset     byte offset of the list region
  word 9   tokenCount     number of token records
  word 10  tokenBytes     16
  word 11  tokensOffset   byte offset of the token region
  word 12  lineCount      number of lines
  word 13  linesOffset    byte offset of the line offset table
  word 14  sourceLength   length of the text, in UTF-16 code units
  word 15  sourceOffset   byte offset of the embedded source text
  word 16  parentsOffset  byte offset of the parent table

Node region     nodeCount * 48 bytes
Parent region   nodeCount * 4 bytes, or absent when parents were not asked for
List region     listCount * 4 bytes
Token region    tokenCount * 16 bytes
Line region     lineCount * 4 bytes
Source region   sourceLength * 2 bytes, padded up to a word boundary,
                or absent entirely when the source is not embedded
```

The parent table has no count of its own: it is one word per node, so
`nodeCount` sizes it. Like the source text, it is present only when it was
asked for, and the flag in word 2 is what says so.

`sourceLength` describes the *program*, not the region: it is recorded whether
or not the text is present, and the flag in word 2 is what says whether the
characters are actually there.

The line region is the offset at which each line begins, one word per line.
`readLineStarts()` returns it as a `Uint32Array` view onto the buffer rather
than a copy, which is what `LineIndex` is built over.

### Token records

Fixed 16-byte records, `tokenCount` of them.

```text
Record (16 bytes, 4 words), repeated `tokenCount` times
  word 0   start          offset of the first character
  word 1   end            offset just past the last character
  word 2   kind | flags   kind in the low 16 bits, flags in the high 16
  word 3   extra          meaning depends on the kind
```

`extra` is currently used by regular expression tokens, where it holds the
offset of the closing `/`. That is what lets a consumer split the token into
`pattern` and `flags` without rescanning.

The four token flags occupy the high half of word 2:

| Flag | Bit | Meaning |
| ---- | --- | ------- |
| `TF_NEWLINE_BEFORE` | 0 | A line terminator precedes this token. Automatic semicolon insertion reads this. |
| `TF_HAS_ESCAPE` | 1 | The text contains a backslash escape, so the raw text is not the value. |
| `TF_INVALID_ESCAPE` | 2 | Contains an escape that is only legal in a tagged template. |
| `TF_LEGACY_OCTAL` | 3 | Uses legacy octal syntax, which strict mode forbids. |

Comments and the hashbang are recorded as tokens. There is no separate comment
region.

### Node records

Every node is twelve 32-bit words — 48 bytes — regardless of kind. Finding node
`n` is one multiply and one add.

```text
word 0   start    offset of the node's first character
word 1   end      offset just past its last character
word 2   kind     a node kind constant
word 3   flags    see below
word 4   slot A   \
word 5   slot B    |
word 6   slot C    |  meaning depends on the kind; each holds a node
word 7   slot D    |  index, a list handle, a token kind, or a raw offset
word 8   slot E    |
word 9   slot F    |
word 10  slot G    |
word 11  slot H   /
```

Node index `0` is reserved as the "no node" sentinel and its record is left
zeroed, so a slot holding `0` always decodes to `null`. This is why node
indices start at 1 and `nodeCount` includes the unused record — along with a
handful of others that are not in the tree either, which
[has its own section](#records-that-are-not-in-the-tree) because an index walk
reaches them.

Node kinds are partitioned like token kinds: `N_Program = 1`, JavaScript kinds
run up through 74, JSX occupies 75–89 (`N_JSXElement = 75` … `N_JSXText = 89`),
and TypeScript starts at `TS_FIRST = 100` (`N_TSTypeAnnotation = 100`). The
`kind >= TS_FIRST` test is how `validate()` finds TypeScript-only syntax when
the dialect is `"js"` without enumerating kinds.

A slot's meaning is per kind and is documented by `SLOT_TABLE` in `slots.ts`,
which records for each kind whether each slot is a child node (`SLOT_NODE`), a
list handle (`SLOT_LIST`), or opaque data (`SLOT_DATA`). Generic passes such as
validation walk the tree from that table alone, with no per-kind switch, and
[the parent table](#the-parent-table) is derived from it. `SLOT_DESCRIPTORS`
carries the same answers packed two bits per slot, for a pass that reads every
slot of every node rather than asking about one at a time.

Two slot conventions are worth calling out because they are easy to trip over:

- On `Identifier`, slot A holds the offset of the **end of the name**. A type
  annotation extends the node's `end` past the name, so the decoder must slice
  to slot A rather than to `end` when reading the name.
- On several nodes a slot holds a **token kind** rather than a node index — the
  operator of a `BinaryExpression`, for instance. `AstDecoder.operator()` turns
  it back into a spelling through `KEYWORD_NAMES` or `PUNCTUATOR_NAMES`.

### The flags word

Word 3 packs boolean flags in the low bits and small enumerations in the high
bits, which keeps them out of the data slots.

Bits 0–22 are independent booleans:

| Bit | Flag | Bit | Flag |
| --- | ---- | --- | ---- |
| 0 | `NF_ASYNC` | 12 | `NF_ABSTRACT` |
| 1 | `NF_GENERATOR` | 13 | `NF_CONST` |
| 2 | `NF_STATIC` | 14 | `NF_OVERRIDE` |
| 3 | `NF_COMPUTED` | 15 | `NF_DEFINITE` |
| 4 | `NF_OPTIONAL` | 16 | `NF_TYPE_ONLY` |
| 5 | `NF_PREFIX` | 17 | `NF_PARENTHESIZED` |
| 6 | `NF_DELEGATE` | 18 | `NF_TAIL` |
| 7 | `NF_SHORTHAND` | 19 | `NF_INVALID_ESCAPE` |
| 8 | `NF_METHOD` | 20 | `NF_STRICT` |
| 9 | `NF_EXPRESSION_BODY` | 21 | `NF_EXPORT` |
| 10 | `NF_READONLY` | 22 | `NF_IN` |
| 11 | `NF_DECLARE` | | |

`NF_SELF_CLOSING` is deliberately an alias of `NF_ASYNC` (bit 0). A JSX opening
element is never async, so the bit is free on that kind. Reusing bits across
disjoint kinds is allowed, but it must be documented at the definition.

Bits 23 and up hold packed enumerations:

| Field | Shift | Width | Values |
| ----- | ----- | ----- | ------ |
| Accessibility | 23 | 2 | none, `public`, `private`, `protected` |
| Declaration kind | 25 | 3 | `var`, `let`, `const`, `using`, `await using` |
| Module/misc kind | 28 | 3 | kind-dependent; also used for literal subtype |

The literal subtypes carried in the third field are `LIT_STRING`, `LIT_NUMBER`,
`LIT_BOOLEAN`, `LIT_NULL`, `LIT_REGEXP`, `LIT_BIGINT`, and `LIT_JSX_STRING`.

### The list region

A list is stored as its length followed by its elements:

```text
word h       size
word h+1     element 0
word h+2     element 1
...
```

A *handle* is the word index `h`, relative to the start of the list region.
Handle `0` means the empty list, so no list is ever stored with size zero.
Elements are node indices; a `0` element is an array hole, as in `[a, , b]`.

### The parent table

One word per node, indexed by node index: the node that holds this one as a
child. `AstReader#parent()` reads a single entry and `readParents()` returns
the whole table as a view onto the buffer.

**It is there only when `parse()` was given `{ parents: true }`.** Deriving it
is a pass over every node record, which costs a few percent of a parse, and a
consumer that walks down from the root already knows every parent it went
through — so, like the embedded source text, it is not carried unless it is
asked for. Both readers throw on a buffer that has no table rather than
reporting `NO_NODE`, which is a real answer meaning
[not in the tree](#records-that-are-not-in-the-tree) and would make every node
look abandoned. `AstReader` resolves the table on first use for the same reason
it resolves the source text that way: a reader over a buffer without one is
perfectly usable for everything else.

The parser cannot fill this in as it goes, because a node is very often
allocated *after* its children — `a + b` parses both operands before the
`BinaryExpression` that owns them exists, and `retype()` can change what a
finished node even is. So `fillParentTable()` derives it once during buffer
assembly, in a linear sweep over the node region that hands each node's own
index to every child its slots point at. `SLOT_DESCRIPTORS` is what makes that
sweep cheap: the whole slot layout of a kind in one 16-bit word, shifted out
two bits at a time, so a leaf kind costs one read. It is the same information
`SLOT_TABLE` holds, filled from the same definition.

Three consequences worth knowing:

- **It is a region, not a thirteenth word of every node.** Node records stay 48
  bytes for the passes that never ask about a parent, and walking up an
  ancestor chain touches four bytes per level instead of a whole record.
- **`NO_NODE` means one of two things.** The root has no parent — and neither
  does a record that is not in the tree at all, which is the next section. So
  `parent(node) === NO_NODE && node !== root` is the test that identifies one,
  and the parent table is the first thing that ever made them visible.
- **A node can be its parent's child twice.** Shorthand `import { a }` stores
  one `Identifier` in both the `imported` and `local` slots of its specifier.
  Both writes name the same parent, so the table is unambiguous even though the
  decoder emits two ESTree objects for it.

### Records that are not in the tree

**A parse buffer contains a few node records that no slot points at, and
`nodeCount` counts them.** They are 0.3% of the records in the corpus and
appear in about one file in five, so a pass that walks node indices rather than
the tree has to expect them.

They exist because `alloc()` hands out an index at the moment the parser
decides to *try* a production, and an index is a position: once a later node
has one, an earlier one cannot be given back. The usual escape hatch is
`rewind()`, which rolls `count` back so the indices are reused — which is why
speculation leaves nothing behind, not even for a whole abandoned arrow
function. A record survives only where the parse moved forward past a node it
turned out not to need. There are three such places:

| Where | What is left | Why |
| ----- | ------------ | --- |
| `parseNewExpression()` | an `Identifier` covering `new` | `parseWordAsIdentifier()` must consume the keyword before the parser can see whether `.target` follows, and that node *is* the `meta` slot of a `MetaProperty` if it does |
| `parseImportExpression()` | an `Identifier` covering `import` | the same shape, for `import.meta` |
| `parseNewExpression()` | a zeroed record | `new Map<K, V>()` parses its callee as a `TSInstantiationExpression`, then lifts the callee and type arguments into the `NewExpression` |

The first two are the common case by far — a little over 22,000 of them across
7.4 million nodes — and both are leaves, so they cost 48 bytes and mislead
nothing that reads their slots.

The third is different in kind, and is the reason `discard()` exists. The
wrapper's slots still named the callee and the type arguments after the
`NewExpression` took them, and because the wrapper is allocated *after* the
node that now owns them, it won the parent sweep's last write and handed both
children a parent that is not in the tree. `parseNewExpression()` therefore
zeroes it, kind `0` and all, exactly as `rewind()` zeroes a speculative parse.
**Any future site that moves children from one node to another owes the same
call.**

Nothing that descends from the root can see any of this: `validate()` and
`toAST()` never reach an unreferenced record, which is why the ESTree output
and every conformance comparison are unaffected. An index walk does see them,
though, and in `new Map()` the `new` comes back looking like an ordinary
`Identifier`. Telling one apart takes the parent table, so a walk that cares
has to ask for it:

```js
const reader = new AstReader(parse(code, { parents: true }));

for (let node = 1; node < reader.nodeCount; node++) {
	if (reader.parent(node) === NO_NODE && node !== reader.root) {
		continue; // not in the tree
	}
	// …
}
```

### The embedded source text

The parse buffer *can* carry a copy of the source as little-endian UTF-16 code
units, so that the buffer is self-describing when it is transferred to a worker
or written to disk. It does not by default: the region is roughly a sixth of
the buffer and costs about 4% of a parse, and a consumer that stays in the
process that parsed never reads it.

`buildParseBuffer()` always calls `cacheSource()`, which parks the original
string on the buffer under `Symbol.for("@eslint/jskit.source")` — a registry
symbol rather than a `WeakMap`, so that another bundled copy of this module in
the same realm finds the same cache. `readSource()` returns that string when
the same process reads the same buffer — so text works whether or not the
region exists — and only falls through to decoding when the buffer arrived from
somewhere else. On that path it checks `PARSE_FLAG_SOURCE_EMBEDDED` first and
throws rather than decoding an absent region into a run of NUL characters.

`AstReader#source` resolves lazily for the same reason: a consumer reading only
kinds, extents, and child slots can walk a transferred buffer that carries no
text at all.

**[`embedded-source.md`](./embedded-source.md) covers the option, when to turn
it on, and what it costs.**

### Reading a buffer

`AstReader` and `TokenReader` are both constructed over the whole parse buffer.
Each validates the magic number, finds its own region at the offset the header
records, and computes record positions from the recorded record size:

```js
import { parse, AstReader, N_Identifier } from "@eslint/jskit";

const reader = new AstReader(parse("const answer = 42;"));

for (let node = 1; node < reader.nodeCount; node++) {
	if (reader.kind(node) === N_Identifier) {
		console.log(reader.text(node)); // "answer"
	}
}
```

Iterating node indices from 1 upward visits every node with no traversal at
all, which is often what a tool wants — plus the
[records that are not in the tree](#records-that-are-not-in-the-tree), which
such a walk has to skip for itself.

`reader.parent(node)` is what turns an index walk into context — the enclosing
node, and from there the whole ancestor chain, without having walked down to
get there. It needs `{ parents: true }`, which is the price of asking:

```js
const reader = new AstReader(parse(code, { parents: true }));
let scope = reader.parent(node);

while (scope !== NO_NODE && reader.kind(scope) !== N_FunctionDeclaration) {
	scope = reader.parent(scope);
}
```

## Validation

`validate.ts` walks the tree using `SLOT_TABLE`, so it needs no per-kind switch
to find children. It maintains a scope stack whose bindings are tagged
`BINDING_VAR`, `BINDING_LEXICAL`, `BINDING_FUNCTION`, `BINDING_PARAM`, or
`BINDING_TYPE`, hoists `var` and function declarations into the nearest function
scope, and reports a conflict when two bindings cannot coexist.

Problems carry a source offset internally; the public `ValidationError` reports
`lineNumber` and `column`, resolved through `LineIndex`.

## Decoding to ESTree

`AstDecoder` is the only place that creates a JavaScript object per node. Its
`fill()` method is one large switch over node kinds that writes the
kind-specific properties.

Two options change the output:

- `typescript` — in `"js"` mode the TypeScript-only properties are omitted
  entirely, so the result is structurally identical to `espree`'s. In `"ts"`
  mode, properties that `@typescript-eslint/parser` leaves `undefined` are
  emitted as `null`.
- `lines` — when a `LineIndex` is supplied, each node also gets `range` and
  `loc`. Only the ESLint parser object asks for this; `toAST()` passes `null`,
  because its contract is that nodes carry `start` and `end` and nothing else.

Both parsers' notion of a `Program`'s extent differs — `espree` trims it to its
statements, `@typescript-eslint/parser` spans the whole text — and **`espree`'s
answer is used in both dialects**, so the decoder does not adjust it at all.
The buffer already holds that extent, written by `parseProgram()`. This is a
deliberate deviation from `@typescript-eslint/parser`; see
[`docs/deviations.md`](../../../../docs/deviations.md) for why, and for how the
TypeScript conformance comparisons stay total in spite of it.

## Invariants

Things that will break subtly if violated:

1. **Node index 0 is never a real node.** Its record stays zeroed.
2. **Handle 0 is the empty list.** Never write a zero-length list.
3. **`rewind()` must zero the abandoned node region.** Otherwise a later
   allocation can read stale words from a speculative parse.
4. **Every token the scanner produces is recorded**, including trivia and
   including tokens produced during speculation — which is why `restore()`
   must roll the token count back.
5. **Readers honor the recorded record size**, never `NODE_BYTES` directly.
6. **A node's `end` is only final after `finish()`.** Type annotations and
   `!` assertions extend it after the fact.
7. **Reused flag bits must be documented where they are defined**, as
   `NF_SELF_CLOSING` is.
8. **The parent table is derived from `slots.ts`, not from the parser.** A
   child in a slot described as `SLOT_DATA` gets no parent, and nothing else
   reports it.
9. **A node abandoned after its children moved elsewhere must be discarded.**
   `writer.discard()` zeroes the record so it stops claiming them; leaving it
   in place hands those children a parent that is not in the tree. See
   [records that are not in the tree](#records-that-are-not-in-the-tree).
10. **`nodeCount` is a count of index slots, not of nodes in the tree.** A walk
    over indices reaches records that no slot points at.

## Extending the format

To add a field to a node kind: use a free slot. Slots are per kind, so a slot
unused by that kind costs nothing.

To add a *new* word to every node record: raise `NODE_WORDS`. Existing readers
keep working because they compute stride from the header's `nodeBytes` and only
read the fields they know. Do not reorder existing words.

To add a token flag: take the next free bit in the high half of word 2. Four of
the sixteen are used, so twelve remain.

To add a header word: append it and grow `PARSE_HEADER_BYTES`. Every region is
found at a recorded offset, so nothing an existing reader knows how to locate
moves. Do not reorder existing words.

To add a node kind: append it in the correct partition (JavaScript, JSX, or
TypeScript at or above `TS_FIRST`), raise `NODE_KIND_COUNT`, add its name to
`NODE_KIND_NAMES`, describe its slots in `slots.ts`, add a `fill()` case, and
declare its interface in `ast-types.ts`. Forgetting the `slots.ts` entry is the
failure mode to watch for: the node decodes correctly but generic walks
silently do not descend into it, so validation quietly stops checking that
subtree and its children come back with no parent.

The `ast-types.ts` entry is the one thing on that list nothing else depends on
at runtime, so it is also the easiest to skip. Two scripts stop it drifting:
`conformance-types.mjs` compares the declarations against what the decoder
emits over the whole corpus, and `derive-shapes.mjs` reads the `fill()` switch
itself and reports any node whose declared properties disagree with the ones
assigned. Both run as part of `npm run conformance`. Between them, a new kind
with no interface, an interface with a property the decoder never writes, and a
property whose declared type forbids a `null` the decoder emits are all caught.
What neither can check is which node types belong in a slot: `this.node(a)`
says a child goes there, not which children, so the unions in `ast-types.ts`
are written by hand.

Bumping `PARSE_VERSION` is only necessary for a change that existing readers
could misinterpret. Adding a field at the end of a record, a word at the end of
the header, a new flag bit, or a new node kind does not qualify.
