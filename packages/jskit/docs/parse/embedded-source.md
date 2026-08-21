# The Embedded Source Region

Why a parse buffer can carry a copy of the program text, why it does not by
default, and how to decide.

## The short version

```js
parse(code); // no text in the buffer — the default
parse(code, { embedSource: true }); // text embedded, buffer ~17% larger
```

**Reading text works either way in the process that parsed.** Turn
`embedSource` on when the buffer will be read somewhere else: a worker, a
file, a cache, another process.

## Why the buffer needs text at all

A node record is twelve 32-bit words — `start`, `end`, `kind`, `flags`, and
eight child slots. Every one of them is an integer. Nowhere in a node record
is there a name, a string value, or a single character.

That is a large part of why the parser is fast: no per-node string
allocation, no property bag, just integers written into a word buffer. It is
also why text has to exist somewhere. When `AstReader#text()` or the scope
analyzer's `BinaryAst#name()` needs to know what an identifier is called, it
slices the characters out of the source text using the record's two offsets:

```js
text(node) {
    return this.source.slice(this.start(node), this.end(node));
}
```

Take the text away and every node still parses, resolves, and walks. It just
cannot say what any name **is**.

## Two places the text can live

`buildParseBuffer()` finishes a parse by doing two things with the source
string:

1. **Optionally** copying it into the buffer as UTF-16 code units, in the last
   region, located by `PARSE_HEADER_SOURCE_OFFSET`.
2. **Always** calling `cacheSource(buffer, source)`, which parks the original
   JavaScript string on the buffer itself, under the registry symbol
   `Symbol.for("@eslint/jskit.source")`.

`readSource()` checks that property first. `AstReader` calls it the first time
anything asks for `source`, and in the process that just parsed, it is always
a hit — the reader gets the original string back by reference, with no decode
and no copy.

So the embedded region is not a data path. It is what remains when the cached
string cannot be reached.

### Why a property and not a `WeakMap`

The cache was a module-level `WeakMap` at first, and that was wrong in a way
worth recording: **a `WeakMap` reaches only as far as one instance of the
module.** When the scope analyzer shipped as its own package it bundled its
own copy of the reader, so a buffer produced by the parser's copy missed the
`WeakMap` living inside the analyzer's and looked exactly like a buffer from
another process. The plain `analyze(parse(code))` case threw. The two are one
package now, but a tool that bundles its own copy alongside another puts the
same trap back.

A registry symbol is shared by every copy of the module in the realm, so the
cache is as wide as the heap. An own property is also the right boundary: it
is carried by neither `slice()`, `structuredClone()`, nor a `postMessage`
transfer — precisely the crossings after which the text really is gone.

## When to turn it on

Every case below leaves the heap that parsed, so the cached string is gone and
the embedded region is the only text that survives.

| Scenario                   | Why                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Worker pool**            | A thread `postMessage`s buffers to workers, or workers ship results back. The receiving heap has never seen the string.                          |
| **Persistent parse cache** | A build tool or language server writes buffers to disk and reads them back on a later run, in a process with no memory of the file.              |
| **Analysis daemon**        | A long-lived server hands ASTs to short-lived clients. The bytes are the whole message; there is no second channel for a string.                 |
| **WASM or native interop** | Linear memory has no access to the JavaScript heap. A buffer with text inside is readable there; one without is a table of offsets into nothing. |

And the case that does not need it, which is most of them: parse, validate,
`toAST()`, and analyze scope, all in one process. ESLint itself works this
way.

## Why embed rather than pass the string alongside

The alternative to a flag is to keep the text where it already is and hand
callers a `(buffer, string)` pair. That is smaller and faster, and it loses on
every axis that matters once the pair has to go anywhere.

- **Transfers get cheaper, not dearer.** An `ArrayBuffer` is transferable:
  `postMessage(buf, [buf])` hands over ownership with no copy. A string has no
  such path — structured clone duplicates it on every message. Putting the
  text inside the buffer means it rides along in the zero-copy transfer
  instead of being re-serialized each time.
- **A mismatch becomes unrepresentable.** Two objects that must stay married
  are a bug waiting to happen: buffer from one file, string from another, and
  the offsets still land in range. There is no exception — just plausible,
  wrong names. One allocation makes the pairing an identity rather than a
  convention.
- **The parse becomes a file.** One buffer is one artifact you can write,
  hash, version, and read back. A side-car string is two files that can drift,
  plus a consistency check you have to invent.
- **The format stays self-describing.** The header carries a magic number, a
  version, region offsets, and now a flag saying whether the text is present.
  A buffer can be checked on load. There is no way to ask a loose string
  whether it belongs to the parse you just read off disk.
- **The units already agree.** Every `start` and `end` is a UTF-16 code-unit
  offset, and the region is UTF-16 code units, so index _i_ in the region is
  code unit _i_ of the program — no translation table, no surrogate
  arithmetic. This is also why the region is not UTF-8, which would nearly
  halve it.

So embedding is the right way to make a buffer portable. The flag exists
because most buffers never need to be.

## What it costs

Measured on a generated 200 KiB JavaScript module (40,263 nodes, 2,362 KiB
buffer with the text):

| Cost                                                | Amount    | Share                     |
| --------------------------------------------------- | --------- | ------------------------- |
| `writeSource()` — a per-character `charCodeAt` loop | 0.500 ms  | 3.7% of `parse()`         |
| Region size                                         | 401.2 KiB | 17.0% of the parse buffer |
| Times read in the parsing process                   | 0         | —                         |

Ratios move with node density: source-heavy files weight the region more,
node-dense files less. Both numbers are why the default is `false` — a
consumer that never leaves the process was paying about 4% of parse time and
a sixth of its memory for a copy it never read.

## The failure mode, and why it is loud

Without the flag, a reader that missed the cache would walk straight into
decoding a region that is not there. Today that raises
`RangeError: Invalid typed array length` from deep inside `readSource()` —
opaque, and pointing at the wrong thing. Keep the region but leave it
zero-filled and it gets worse: the decode succeeds, every name comes back as
a run of NUL characters, and nothing throws at all.

So the buffer records what it did. `PARSE_HEADER_FLAGS` carries
`PARSE_FLAG_SOURCE_EMBEDDED`, and `readSource()` checks it **after** the cache
lookup and before decoding anything:

```
TypeError: This parse buffer carries no source text, and none is cached for it
in this process. Re-parse with `{ embedSource: true }` before transferring or
persisting a buffer whose text will be read elsewhere.
```

The check sits after the cache lookup on purpose. In the parsing process the
lookup hits and the flag never matters; the error is reachable only by
actually moving a text-less buffer somewhere it cannot be read.

## Structure-only consumers still work

`AstReader#source` resolves on first use rather than in the constructor, so a
consumer reading only kinds, extents, and child slots can walk a transferred
buffer that carries no text:

```js
const reader = new AstReader(transferred);

reader.kind(reader.root); // fine — integers all the way down
reader.nodeCount; // fine
reader.text(reader.root); // throws, and says how to fix it
```

That is the reason for the laziness. Resolving in the constructor would have
been simpler, but it would refuse a whole class of legitimate work — node
counting, shape diffing, complexity metrics — that never needs a character.

## The parent table works the same way

`parents` is the buffer's other opt-in region, and every decision above was
made again the same way: off by default because deriving it costs a pass over
every node record that most consumers do not need, resolved on first use so a
reader without one still works, and loud rather than silent when it is missing.
The failure mode is the reason it cannot be silent — `NO_NODE` is a real answer
meaning "not in the tree", so handing it back for a buffer with no table would
report every node as unreachable. See
[the parent table](./architecture.md#the-parent-table).

## Related

- [`architecture.md`](./architecture.md) — the binary format field by field.
- `PARSE_FLAG_SOURCE_EMBEDDED`, `buildParseBuffer()`, `readSource()`,
  `cacheSource()` in [`../../src/parse/binary.ts`](../../src/parse/binary.ts).
- `AstReader#source` in [`../../src/parse/reader.ts`](../../src/parse/reader.ts).
