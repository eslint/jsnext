# @eslint/jskit-native

The native (Rust) implementation of `@eslint/jskit`'s four buffer producers
— `parse()`, `analyze()`, `createGraph()`, and `inferTypes()` — plus its
validator. The producers write **the same binary formats, byte for byte** —
the same parse buffer, the same scope buffer, the same flow buffer, the same
type buffer — and `validate()` reports **the same problems in the same order
with the same messages**, so everything downstream (`toAST()`, `Scopes`,
`toScopeManager()`, `FlowBufferReader`, `Types`, the ESLint parser object) is
the untouched TypeScript code reading output it cannot tell apart from its
own.

## How it plugs in

`@eslint/jskit`'s Node entry point (`dist/jskit-node.js`, selected by the
`node` export condition) tries to `require("@eslint/jskit-native")` and, when
the binding loads, registers it through `setNative()`. Every later call to
`parse()`, `validate()`, `analyze()`, `createGraph()`, or `inferTypes()` — including the ones
the ESLint parser object makes internally — then runs in Rust. When the package is
missing, was not built for this platform, or `JSKIT_NATIVE=0` is set in the
environment, nothing is registered and the TypeScript implementation runs
instead: same buffers, same errors, just slower. The browser bundle is built
from the neutral entry point and never attempts to load anything.

`analyzeTree()` stays TypeScript-only by design: it reads the caller's own
ESTree objects, and crossing the native boundary per node would cost more
than the walk saves.

## Layout

```
crates/jskit-core   the implementation: parse/, scope/, flow/, types/, no
                    Node dependencies; `src/bin/jskit-dump.rs` writes any of
                    the four buffers to stdout for the differential harness
crates/jskit-napi   the Node-API bindings (thin: strings in, ArrayBuffers out)
npm/                one npm package per platform binary, esbuild-style: each
                    declares the `os`/`cpu`/`libc` it is for, the release
                    workflow stamps all of them into this package's
                    `optionalDependencies` at publish time, and npm installs
                    only the one matching the machine
index.js            requires the matching platform package — or the locally
                    built binary in npm/<target>/ — and exports `null` when
                    neither loads
build.mjs           `cargo build --release` + copy into npm/<target>/,
                    skipped without cargo
test.mjs            parity tests: native and TypeScript buffers byte-equal
tools/              the differential runs (see below)
```

The Rust sources mirror the TypeScript sources file by file — `tokenizer.rs`
beside `tokenizer.ts`, `scope/builder.rs` beside `scope-builder.ts` — so the
two implementations can be read side by side. **A change to one side is a
change to both**: any edit to a buffer producer in `packages/jskit/src` must
be mirrored here (or the binding falls behind and the differential runs
fail), and the binary formats' constants exist in both languages.

## The standard of correctness

Byte identity, checked differentially. Each tool parses files with both
implementations and compares the raw buffers:

```bash
node tools/diff-parse.mjs    ../../node_modules   # parse buffers, +--all-options
node tools/diff-validate.mjs ../../node_modules   # problem lists, both dialects
node tools/diff-analyze.mjs  ../../node_modules   # scope buffers, + option flags
node tools/diff-graph.mjs    ../../node_modules   # flow buffers
node tools/diff-types.mjs    ../../node_modules   # type buffers
```

`diff-validate.mjs` is at its strongest over a test262 checkout — the one
corpus full of programs that _should_ produce problems — and a clone at the
repository root is where the conformance suite already expects one:

```bash
node tools/diff-validate.mjs ../../test262/test
```

Each accepts a directory (or one file), an optional file cap, and option
flags; run them from this package. `mismatch=0` is the standard, and both
implementations must also agree on which files they reject. The full corpus —
21,000+ files — currently passes all three with zero mismatches, as do the
JSX/TSX fixtures under every `jsx`/`sourceType`/buffer-option combination,
which matters because `node_modules` contains no JSX.

## Building

```bash
npm run build --workspace=@eslint/jskit-native   # needs a Rust toolchain
```

Without `cargo` on the path the build script prints a note and exits
successfully, so `npm run build` at the repository root works on machines
with no Rust toolchain — they simply run the TypeScript implementation.
