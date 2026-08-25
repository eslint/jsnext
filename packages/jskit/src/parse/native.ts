/**
 * @fileoverview The seam where the native (Rust) implementation plugs in.
 *
 * `@eslint/jskit-native` reimplements the four buffer producers — `parse()`,
 * `analyze()`, `createGraph()`, and `inferTypes()` — and writes the same
 * binary formats, so the rest of the toolkit cannot tell which
 * implementation ran. This module
 * holds the registration point: the Node entry (`src/index-node.ts`) loads
 * the binding and registers it here, and the entry points check for it before
 * running the TypeScript implementation. In the browser bundle nothing ever
 * registers, the check never passes, and the cost is one `null` comparison.
 *
 * The binding is a module-level `let` rather than an option so that every
 * caller — the ESLint parser object included — takes the native path without
 * being told about it.
 */

import { cacheSource } from "./binary.js";
import { ParseError } from "./errors.js";
import type { ParseOptions, ParseResult } from "./api.js";

/**
 * The scope analysis options the binding understands: everything
 * `AnalyzeOptions` carries except `text`, which the JavaScript side resolves
 * before calling in, with `globals` narrowed to an array.
 */
export interface NativeAnalyzeOptions {
	sourceType?: "script" | "module" | "commonjs";
	dialect?: "js" | "ts";
	jsx?: boolean;
	impliedStrict?: boolean;
	globalReturn?: boolean;
	ignoreEval?: boolean;
	globals?: string[];
	jsxPragma?: string;
	jsxFragmentName?: string;
}

/**
 * The validation options the binding understands: everything
 * `ValidateOptions` carries except `text`, which the JavaScript side resolves
 * before calling in. The source type crosses already resolved against the
 * buffer, so the binding never re-answers that question.
 */
export interface NativeValidateOptions {
	sourceType?: "script" | "module" | "commonjs";
	dialect?: "js" | "ts";
	jsx?: boolean;
	declaration?: boolean;
}

/**
 * A problem the native `validate()` found, before its position is resolved.
 * The JavaScript side turns the offset into a line and column, exactly as it
 * does for the TypeScript validator's problems.
 */
export interface NativeValidationProblem {
	message: string;
	start: number;
}

/**
 * What the native binding provides. Each buffer producer returns the same
 * `ArrayBuffer` the TypeScript implementation would have produced, and
 * `validate()` the same problems in the same order.
 */
export interface NativeBinding {
	/** The native `parse()`; throws an `Error` in the packed form below. */
	parse(code: string, options?: ParseOptions): ArrayBuffer;

	/** The native `validate()` over a parse buffer and its source text. */
	validate(
		result: ArrayBuffer,
		text: string,
		options?: NativeValidateOptions,
	): NativeValidationProblem[];

	/** The native `analyze()` over a parse buffer and its source text. */
	analyze(
		result: ArrayBuffer,
		text: string,
		options?: NativeAnalyzeOptions,
	): ArrayBuffer;

	/** The native `createGraph()` over both buffers and the source text. */
	createGraph(
		parsed: ArrayBuffer,
		scope: ArrayBuffer,
		text: string,
	): ArrayBuffer;

	/**
	 * The native `inferTypes()` over both buffers and the source text.
	 * Optional so that a binding built before the type analysis existed
	 * still registers; `inferTypes()` falls back to TypeScript without it.
	 */
	inferTypes?(
		parsed: ArrayBuffer,
		scope: ArrayBuffer,
		text: string,
	): ArrayBuffer;
}

/** The registered binding, or `null` when only TypeScript is available. */
export let native: NativeBinding | null = null;

/**
 * Registers a native binding, replacing the TypeScript buffer producers.
 * @param binding The binding to use, or `null` to go back to TypeScript.
 * @returns Nothing.
 */
export function setNative(binding: NativeBinding | null): void {
	native = binding;
}

/**
 * Runs the native `parse()` and makes its result indistinguishable from the
 * TypeScript one: the source text is cached against the buffer so consumers
 * in this process can read names without embedding, and a failure is
 * re-thrown as the same `ParseError` the TypeScript parser throws.
 * @param binding The native binding to call.
 * @param code The source text to parse.
 * @param options How the buffer should be built.
 * @returns The parse buffer.
 * @throws {ParseError} When the source contains a syntax error.
 */
export function nativeParse(
	binding: NativeBinding,
	code: string,
	options: ParseOptions,
): ParseResult {
	let buffer: ArrayBuffer;

	try {
		buffer = binding.parse(code, options);
	} catch (error) {
		/*
		 * The binding packs the structured fields into the message with
		 * `\u0001` separators, because a Node-API error carries only a
		 * string. Anything shaped differently is not a syntax error — a
		 * malformed option, most likely — and is passed through untouched.
		 */
		const parts = String((error as Error).message).split("\u0001");

		if (parts.length === 5 && parts[0] === "ParseError") {
			throw new ParseError(
				parts[4],
				Number(parts[1]),
				Number(parts[2]),
				Number(parts[3]),
			);
		}

		throw error;
	}

	cacheSource(buffer, code);

	return buffer;
}
