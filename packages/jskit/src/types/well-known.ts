/**
 * @fileoverview The global names this analysis attributes to the TypeScript
 * standard library.
 *
 * The analysis reads one file and loads no `lib.d.ts`, so when a type
 * reference resolves to nothing in the program, it cannot ask a declaration
 * where the name came from. What it can do is recognize the names the
 * standard library is known to declare: an unresolved `Promise` is the
 * library's `Promise` in any program that has not declared its own, which is
 * exactly the reading `typescript-eslint`'s `{ from: "lib" }` specifier
 * gives it — and a program that *has* declared its own resolves locally and
 * never reaches this table.
 *
 * The table is part of the analysis contract even though it never appears in
 * a buffer: adding a name changes the origin the walk assigns, so the
 * TypeScript and Rust implementations must carry the same list. Keep it to
 * names `lib.es*.d.ts` and `lib.dom.d.ts` actually declare, and keep the two
 * implementations in step.
 */

/**
 * Builds the set of known standard-library global type names.
 * @returns The set.
 */
function buildWellKnown(): Set<string> {
	return new Set([
		// Fundamental objects and primitives' wrappers
		"Object",
		"Function",
		"Boolean",
		"Symbol",
		"String",
		"Number",
		"BigInt",
		"Math",
		"Date",
		"RegExp",
		"JSON",

		// Errors
		"Error",
		"AggregateError",
		"EvalError",
		"RangeError",
		"ReferenceError",
		"SyntaxError",
		"TypeError",
		"URIError",

		// Collections and arrays
		"Array",
		"ReadonlyArray",
		"Map",
		"ReadonlyMap",
		"Set",
		"ReadonlySet",
		"WeakMap",
		"WeakSet",
		"WeakRef",

		// Typed arrays and binary data
		"ArrayBuffer",
		"SharedArrayBuffer",
		"DataView",
		"Int8Array",
		"Uint8Array",
		"Uint8ClampedArray",
		"Int16Array",
		"Uint16Array",
		"Int32Array",
		"Uint32Array",
		"Float32Array",
		"Float64Array",
		"BigInt64Array",
		"BigUint64Array",

		// Control of asynchrony
		"Promise",
		"PromiseLike",
		"PromiseConstructor",
		"Awaited",

		// Iteration
		"Iterable",
		"Iterator",
		"IterableIterator",
		"AsyncIterable",
		"AsyncIterator",
		"AsyncIterableIterator",
		"Generator",
		"AsyncGenerator",
		"GeneratorFunction",
		"AsyncGeneratorFunction",

		// Reflection and structure
		"Proxy",
		"Reflect",
		"Atomics",
		"FinalizationRegistry",
		"Intl",

		// Utility types the library declares as aliases
		"Partial",
		"Required",
		"Readonly",
		"Record",
		"Pick",
		"Omit",
		"Exclude",
		"Extract",
		"NonNullable",
		"Parameters",
		"ConstructorParameters",
		"ReturnType",
		"InstanceType",
		"ThisParameterType",
		"OmitThisParameter",
		"ThisType",
		"Uppercase",
		"Lowercase",
		"Capitalize",
		"Uncapitalize",
		"NoInfer",

		// Structured data and text
		"URL",
		"URLSearchParams",
		"TextEncoder",
		"TextDecoder",

		// The globals rules ask about most from lib.dom.d.ts
		"Window",
		"Document",
		"Element",
		"HTMLElement",
		"Node",
		"Event",
		"EventTarget",
		"AbortController",
		"AbortSignal",
		"Blob",
		"File",
		"FormData",
		"Headers",
		"Request",
		"Response",
		"ReadableStream",
		"WritableStream",
		"TransformStream",
		"MessagePort",
		"Worker",
		"Console",
	]);
}

/** The known standard-library global type names. */
const WELL_KNOWN_LIB_TYPES = /* @__PURE__ */ buildWellKnown();

/**
 * Reports whether an unresolved global name is one the TypeScript standard
 * library declares.
 * @param name The referenced name.
 * @returns `true` when the name belongs to the standard library.
 */
export function isWellKnownLibType(name: string): boolean {
	return WELL_KNOWN_LIB_TYPES.has(name);
}
