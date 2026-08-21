/**
 * @fileoverview The public API: `parse()`, `validate()`, and `toAST()`.
 */

import {
	SOURCE_TYPE_NAMES,
	TF_HAS_ESCAPE,
	TF_NEWLINE_BEFORE,
	buildParseBuffer,
	readLineStarts,
	readSourceType,
} from "./binary.js";
import { decodeEntities } from "./entities.js";
import { LineIndex, type SourceLocation } from "./locations.js";
import { Parser } from "./parser.js";
import { AstReader, TokenReader } from "./reader.js";
import { AstDecoder } from "./to-ast.js";
import type { Program } from "./ast-types.js";
import {
	KIND_TOKEN_TYPE,
	TOKEN_TYPE_NAMES,
	TT_BLOCK_COMMENT,
	TT_EOF,
	TT_HASHBANG,
	TT_IDENTIFIER,
	TT_LINE_COMMENT,
	TT_PRIVATE_IDENTIFIER,
	TT_REGEXP,
	T_BLOCK_COMMENT,
	T_HASHBANG,
	T_JSX_TEXT,
	T_LINE_COMMENT,
} from "./token-kinds.js";
import { validateAst, type ValidationProblem } from "./validate.js";
import { decodeEscapes } from "./values.js";

/**
 * Everything parsing produced, in one buffer.
 *
 * The encoded AST, the encoded token stream (comments included), the offset
 * each line begins at, and — when `embedSource` asked for it — a copy of the
 * source text all live in a single `ArrayBuffer`, so a parse result is one
 * value to hold, one value to transfer, and one value to persist. Its layout
 * is `binary.ts`; `AstReader`, `TokenReader`, and `readLineStarts()` are how
 * the regions are read.
 */
export type ParseResult = ArrayBuffer;

/**
 * How a parsed program should be interpreted during validation.
 */
export interface ValidateOptions {
	/**
	 * Whether the program is a script, an ES module, or a CommonJS module.
	 *
	 * Defaults to whatever `parse()` was told, which the buffer records, so
	 * this normally need not be given at all. Its use is to narrow `"script"`
	 * to `"commonjs"`; the two parse identically and differ only in what is
	 * allowed. Naming the opposite side of the module line throws, because
	 * the tree was built the other way.
	 */
	sourceType?: "script" | "module" | "commonjs";

	/** Whether TypeScript syntax is allowed. */
	dialect?: "js" | "ts";

	/**
	 * Whether JSX syntax is allowed. Off unless asked for, because a `<` in
	 * expression position means something else in a file that is not JSX.
	 */
	jsx?: boolean;

	/**
	 * Whether the whole file is a TypeScript declaration file — a `.d.ts`.
	 *
	 * Everything in one is ambient: it describes what exists elsewhere rather
	 * than bringing anything into being, so `export const x: number;` is a
	 * complete declaration there and the missing initializer that would be an
	 * error in a `.ts` is the point. Nothing in the text says which kind of
	 * file it is — TypeScript goes by the name — so it has to be told, the
	 * same way `dialect` and `jsx` are.
	 */
	declaration?: boolean;
}

/**
 * A non-fatal problem found during validation.
 *
 * The position is reported the same way `ParseError` reports one, so that a
 * caller can present fatal and non-fatal problems without special-casing
 * either.
 */
export interface ValidationError {
	/** A description of the problem. */
	message: string;

	/** The 1-based line number where the problem starts. */
	lineNumber: number;

	/** The 1-based column number where the problem starts. */
	column: number;
}

/**
 * An ESLint-compatible token.
 */
export interface Token {
	type: string;
	value: string;
	start: number;
	end: number;
	regex?: { pattern: string; flags: string };

	/** Present only on tokens produced for the ESLint parser. */
	range?: [number, number];

	/** Present only on tokens produced for the ESLint parser. */
	loc?: SourceLocation;
}

/**
 * The result of converting a parse result into an ESTree AST.
 */
export interface ToAstResult {
	/** The ESTree `Program` node. */
	ast: Program;

	/** The problems found while validating. */
	errors: ValidationError[];
}

/**
 * How the buffers `parse()` produces should be built.
 *
 * Apart from `sourceType` and `jsx` — the two questions where two readings of
 * the same text can both be valid — these describe the *encoding* of the
 * output, never how the text is interpreted. Everything that is merely
 * allowed or disallowed stays with `validate()`, per the phase split.
 */
export interface ParseOptions {
	/**
	 * Whether to read the text as a script, an ES module, or a CommonJS
	 * module. Defaults to `"module"`.
	 *
	 * This is the one interpretation question phase one cannot avoid, because
	 * two readings of the same text can both be valid and produce different
	 * trees. `await.x` is a member expression in a script and a syntax error
	 * in a module; `a <!--b` is `a` followed by an Annex B comment in a
	 * script and `a < !(--b)` in a module. No tree can stand for both, so the
	 * choice is made here and recorded in the buffer, and `validate()` reads
	 * it back rather than being told again.
	 *
	 * `"script"` and `"commonjs"` are read identically. They differ only in
	 * what is *allowed*, which is phase two's question and is why both are
	 * accepted here rather than collapsing them.
	 */
	sourceType?: "script" | "module" | "commonjs";

	/**
	 * How a `<` in expression position reads. It is the other interpretation
	 * question two readings of the same text can answer differently:
	 * `<T>() => x` is a generic arrow function in a `.ts` file and an
	 * unclosed JSX element in a `.tsx` file, and no tree stands for both.
	 *
	 * `true` reads it the way a `.tsx` file does: JSX directly, with a
	 * generic arrow only behind the unambiguous `<T,>` and `<T extends ...>`
	 * spellings, and no `<T>expr` type assertions. `false` reads it the way a
	 * `.ts` file does: a type assertion or a generic arrow, never JSX.
	 *
	 * Left unset, the parser accepts the union: JSX is tried speculatively
	 * first and the TypeScript readings are the fallback. That accepts
	 * everything either mode accepts — which is what lets `validate()` be the
	 * one to say whether JSX was *allowed* — but the speculation costs a
	 * substantial share of the parse on JSX-heavy files, so a caller that
	 * knows which kind of file it has should say so.
	 *
	 * Unlike `sourceType`, the choice is not recorded in the buffer: a JSX
	 * node either is in the tree or is not, and the later phases read the
	 * tree rather than re-deciding.
	 */
	jsx?: boolean;

	/**
	 * Whether to copy the source text into the parse buffer, making the buffer
	 * readable in a process that did not parse it.
	 *
	 * Defaults to `false`. Reading text in the parsing process works either
	 * way, because the original string is cached against the buffer. Turn it
	 * on when the buffer will be transferred to a worker, written to disk, or
	 * otherwise read anywhere else — the text is roughly a sixth of the
	 * buffer, so it is not carried unless it is asked for. See
	 * [`docs/embedded-source.md`](../docs/embedded-source.md).
	 */
	embedSource?: boolean;

	/**
	 * Whether to derive the parent of every node and store it in the buffer.
	 *
	 * Defaults to `false`. Deriving it is a pass over every node record, which
	 * costs a few percent of a parse, and a consumer that walks down from the
	 * root already knows every parent it passed through. Turn it on for a tool
	 * that starts from a node and needs its context — the enclosing statement,
	 * the function it belongs to — without having walked there.
	 *
	 * `AstReader#parent()` and `readParents()` throw on a buffer parsed without
	 * it, rather than reporting that every node has no parent.
	 */
	parents?: boolean;
}

/**
 * Parses source text into one binary buffer.
 *
 * Only problems that make the text impossible to tokenize or shape into a tree
 * are reported here; everything context-dependent is left to `validate()`.
 * @param code The JavaScript or TypeScript source to parse.
 * @param options How the buffer should be built.
 * @returns The encoded AST, token stream, and line offsets, in one buffer.
 * @throws {ParseError} When the source contains a syntax error.
 */
export function parse(code: string, options: ParseOptions = {}): ParseResult {
	const sourceType = options.sourceType ?? "module";
	const parser = new Parser(code, sourceType === "module", options.jsx);
	const root = parser.parseProgram();
	const writer = parser.writer;
	const tokenizer = parser.tokenizer;

	return buildParseBuffer({
		nodes: writer.nodes,
		nodeCount: writer.count,
		lists: writer.lists,
		root,
		tokens: tokenizer.records,
		tokenCount: tokenizer.count,
		lineStarts: tokenizer.lineStarts,
		lineCount: tokenizer.lineCount,
		source: code,
		embedSource: options.embedSource ?? false,
		parents: options.parents ?? false,
		sourceType: SOURCE_TYPE_NAMES.indexOf(sourceType),
	});
}

/**
 * Settles which source type a parse buffer is being interpreted as.
 *
 * The buffer already carries the answer, so the option is only a way to say
 * the same thing twice, or to narrow `"script"` to `"commonjs"` — the two are
 * read identically and differ only in what phase two allows. Contradicting the
 * buffer across the module line is the case that has to be loud: the tree was
 * built the other way round, so validating it as the opposite would report
 * problems about a program the caller never wrote.
 * @param result The value returned by `parse()`.
 * @param requested The source type the caller asked for, if any.
 * @returns The source type to interpret the buffer as.
 * @throws {TypeError} When the request crosses the module line.
 */
function resolveSourceType(
	result: ParseResult,
	requested: ValidateOptions["sourceType"],
): "script" | "module" | "commonjs" {
	const parsed = readSourceType(result);

	if (requested === undefined || requested === parsed) {
		return parsed;
	}

	if ((requested === "module") !== (parsed === "module")) {
		throw new TypeError(
			`This buffer was parsed as ${parsed === "module" ? '"module"' : `"${parsed}"`}, so it cannot be read as "${requested}": the two produce different trees for the same text. Re-parse with \`{ sourceType: "${requested}" }\`.`,
		);
	}

	return requested;
}

/**
 * Checks a parse result for problems that depend on how the program is meant
 * to be interpreted.
 * @param result The value returned by `parse()`.
 * @param options How the program should be interpreted.
 * @returns Every problem found, in source order.
 */
export function validate(
	result: ParseResult,
	options: ValidateOptions = {},
): ValidationError[] {
	const problems = validateAst(
		new AstReader(result),
		resolveSourceType(result, options.sourceType),
		options.dialect ?? "ts",
		options.jsx ?? false,
		options.declaration ?? false,
	);

	return locateProblems(problems, new LineIndex(readLineStarts(result)));
}

/**
 * Attaches line and column numbers to the problems the validator found.
 * @param problems The problems, each carrying a source offset.
 * @param lines Where to look up positions.
 * @returns The same problems with their positions resolved.
 */
function locateProblems(
	problems: ValidationProblem[],
	lines: LineIndex,
): ValidationError[] {
	const errors = new Array<ValidationError>(problems.length);

	for (let i = 0; i < problems.length; i++) {
		const start = problems[i].start;

		errors[i] = {
			message: problems[i].message,
			lineNumber: lines.line(start),
			column: lines.column(start) + 1,
		};
	}

	return errors;
}

/**
 * The result of building an AST, including the offsets that the public
 * result drops.
 */
export interface AstBuildResult extends ToAstResult {
	/** The same problems as `errors`, still carrying their source offsets. */
	problems: ValidationProblem[];
}

/**
 * Validates a parse result and converts it into an ESTree AST.
 * @param result The value returned by `parse()`.
 * @param options How the program should be interpreted.
 * @param lines Where to look up positions, or `null` for no `range`/`loc`.
 * @returns The ESTree AST and any problems found while validating.
 */
export function buildAst(
	result: ParseResult,
	options: ValidateOptions,
	lines: LineIndex | null,
): AstBuildResult {
	const reader = new AstReader(result);
	const tokenReader = new TokenReader(result);
	const sourceType = resolveSourceType(result, options.sourceType);
	const dialect = options.dialect ?? "ts";
	const problems = validateAst(
		reader,
		sourceType,
		dialect,
		options.jsx ?? false,
		options.declaration ?? false,
	);
	const decoder = new AstDecoder(reader, dialect === "ts", lines);
	const program = decoder.node(reader.root)!;
	const { tokens, comments } = decodeTokens(
		tokenReader,
		reader.source,
		lines,
	);

	program.sourceType = sourceType;
	program.comments = comments;
	program.tokens = tokens;

	/*
	 * The decoder builds a node by assigning to a bag of properties, which no
	 * discriminated union can describe, so it works in `EsNode` and the shape
	 * is asserted once here. `conformance-types.mjs` is what actually holds
	 * the two together.
	 */
	return {
		ast: program as unknown as Program,
		errors: locateProblems(
			problems,
			lines ?? new LineIndex(readLineStarts(result)),
		),
		problems,
	};
}

/**
 * Validates a parse result and converts it into an ESTree AST.
 * @param result The value returned by `parse()`.
 * @param options How the program should be interpreted.
 * @returns The ESTree AST and any problems found while validating.
 */
export function toAST(
	result: ParseResult,
	options: ValidateOptions = {},
): ToAstResult {
	const { ast, errors } = buildAst(result, options, null);

	return { ast, errors };
}

/**
 * Creates a token, positioned if the caller asked for positions.
 * @param lines Where to look up positions, or `null` for no `range`/`loc`.
 * @param type The ESLint token type.
 * @param value The token's text as ESLint reports it.
 * @param start The 0-based offset where the token begins.
 * @param end The 0-based offset where the token ends.
 * @returns The token.
 */
function makeToken(
	lines: LineIndex | null,
	type: string,
	value: string,
	start: number,
	end: number,
): Token {
	const token: Token = { type, value, start, end };

	if (lines !== null) {
		token.range = [start, end];
		token.loc = lines.location(start, end);
	}

	return token;
}

/**
 * Splits a token buffer into ESLint-compatible tokens and comments.
 * @param reader The reader over the token buffer.
 * @param source The source text the tokens came from.
 * @param lines Where to look up positions, or `null` for no `range`/`loc`.
 * @returns The significant tokens and the comments, each in source order.
 */
export function decodeTokens(
	reader: TokenReader,
	source: string,
	lines: LineIndex | null = null,
): { tokens: Token[]; comments: Token[] } {
	const tokens: Token[] = [];
	const comments: Token[] = [];

	for (let i = 0; i < reader.count; i++) {
		const kind = reader.kind(i);
		const type = KIND_TOKEN_TYPE[kind];

		if (type === TT_EOF) {
			continue;
		}

		const start = reader.start(i);
		const end = reader.end(i);

		if (
			kind === T_LINE_COMMENT ||
			kind === T_BLOCK_COMMENT ||
			kind === T_HASHBANG
		) {
			const trim =
				type === TT_LINE_COMMENT || type === TT_HASHBANG ? 2 : 2;
			comments.push(
				makeToken(
					lines,
					TOKEN_TYPE_NAMES[type],
					source.slice(
						start + trim,
						type === TT_BLOCK_COMMENT ? end - 2 : end,
					),
					start,
					end,
				),
			);
			continue;
		}

		let value = source.slice(
			// A private name's reported value omits the leading `#`.
			type === TT_PRIVATE_IDENTIFIER ? start + 1 : start,
			end,
		);

		/*
		 * Child text is reported with its entity references resolved, while a
		 * quoted attribute value is reported exactly as written.
		 */
		if (kind === T_JSX_TEXT) {
			value = decodeEntities(value);
		} else if (
			(type === TT_IDENTIFIER || type === TT_PRIVATE_IDENTIFIER) &&
			(reader.flags(i) & TF_HAS_ESCAPE) !== 0
		) {
			/*
			 * A name written with unicode escapes is reported by the name it
			 * spells, not by the text that spells it, which is the same answer
			 * the `Identifier` node gives.
			 */
			value = decodeEscapes(value, false);
		}

		const token = makeToken(
			lines,
			TOKEN_TYPE_NAMES[type],
			value,
			start,
			end,
		);

		if (type === TT_REGEXP) {
			const patternEnd = reader.extra(i);

			token.regex = {
				pattern: source.slice(start + 1, patternEnd),
				flags: source.slice(patternEnd + 1, end),
			};
		}

		tokens.push(token);
	}

	return { tokens, comments };
}

/**
 * Reports whether a line terminator precedes a token.
 * @param reader The reader over the token buffer.
 * @param index The token index.
 * @returns `true` when the token is the first on its line.
 */
export function tokenStartsLine(reader: TokenReader, index: number): boolean {
	return (reader.flags(index) & TF_NEWLINE_BEFORE) !== 0;
}
