/**
 * @fileoverview The public API: `parse()`, `validate()`, `toAST()`, and the
 * ESLint-compatible parser object.
 */

import {
	TF_NEWLINE_BEFORE,
	buildAstBuffer,
	buildTokenBuffer,
} from "./binary.js";
import { decodeEntities } from "./entities.js";
import { ParseError } from "./errors.js";
import { LineIndex, type SourceLocation } from "./locations.js";
import { Parser } from "./parser.js";
import { AstReader, TokenReader } from "./reader.js";
import { AstDecoder, type EsNode } from "./to-ast.js";
import type { Program } from "./ast-types.js";
import {
	KIND_TOKEN_TYPE,
	TOKEN_TYPE_NAMES,
	TT_BLOCK_COMMENT,
	TT_EOF,
	TT_HASHBANG,
	TT_LINE_COMMENT,
	TT_PRIVATE_IDENTIFIER,
	TT_REGEXP,
	T_BLOCK_COMMENT,
	T_HASHBANG,
	T_JSX_TEXT,
	T_LINE_COMMENT,
} from "./token-kinds.js";
import { validateAst, type ValidationProblem } from "./validate.js";

export { ParseError } from "./errors.js";
export { LineIndex } from "./locations.js";
export type { Position, SourceLocation } from "./locations.js";
export { AstReader, TokenReader } from "./reader.js";

/*
 * The shape of everything `toAST()` produces, node by node. Type-only, so a
 * bundler drops the module entirely.
 */
export type * from "./ast-types.js";
export * from "./node-kinds.js";
export * from "./token-kinds.js";
export * from "./slots.js";

/*
 * A tool reading the binary buffers directly still has to turn raw identifier
 * and literal text into values, so the two decoders that do it are part of the
 * public surface rather than an implementation detail of `toAST()`.
 */
export { decodeEscapes, decodeNumber } from "./values.js";

/**
 * The three buffers produced by parsing.
 */
export interface ParseResult {
	/** The binary-encoded AST, which also carries a copy of the source. */
	ast: ArrayBuffer;

	/** The binary-encoded token stream, including comments. */
	tokens: ArrayBuffer;

	/** The offset at which each line of the source begins. */
	lineStarts: Uint32Array;
}

/**
 * How a parsed program should be interpreted during validation.
 */
export interface ValidateOptions {
	/** Whether the program is a script, an ES module, or a CommonJS module. */
	sourceType?: "script" | "module" | "commonjs";

	/** Whether TypeScript syntax is allowed. */
	dialect?: "js" | "ts";

	/**
	 * Whether JSX syntax is allowed. Off unless asked for, because a `<` in
	 * expression position means something else in a file that is not JSX.
	 */
	jsx?: boolean;
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
 * Parses source text into binary buffers.
 *
 * Only problems that make the text impossible to tokenize or shape into a tree
 * are reported here; everything context-dependent is left to `validate()`.
 * @param code The JavaScript or TypeScript source to parse.
 * @returns The encoded AST, the encoded token stream, and the line offsets.
 * @throws {ParseError} When the source contains a syntax error.
 */
export function parse(code: string): ParseResult {
	const parser = new Parser(code);
	const root = parser.parseProgram();
	const writer = parser.writer;
	const tokenizer = parser.tokenizer;

	return {
		ast: buildAstBuffer(
			writer.nodes,
			writer.count,
			writer.lists,
			root,
			code,
		),
		tokens: buildTokenBuffer(tokenizer.records, tokenizer.count),
		lineStarts: tokenizer.lineStarts.slice(0, tokenizer.lineCount),
	};
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
		new AstReader(result.ast),
		new TokenReader(result.tokens),
		options.sourceType ?? "module",
		options.dialect ?? "ts",
		options.jsx ?? false,
	);

	return locateProblems(problems, new LineIndex(result.lineStarts));
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
interface AstBuildResult extends ToAstResult {
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
function buildAst(
	result: ParseResult,
	options: ValidateOptions,
	lines: LineIndex | null,
): AstBuildResult {
	const reader = new AstReader(result.ast);
	const tokenReader = new TokenReader(result.tokens);
	const sourceType = options.sourceType ?? "module";
	const dialect = options.dialect ?? "ts";
	const problems = validateAst(
		reader,
		tokenReader,
		sourceType,
		dialect,
		options.jsx ?? false,
	);
	const decoder = new AstDecoder(reader, dialect === "ts", lines);
	const program = decoder.node(reader.root)!;
	const { tokens, comments } = decodeTokens(tokenReader, reader.source, lines);

	/*
	 * The two reference parsers disagree about a program's range: `espree`
	 * trims it to the first and last token, while `@typescript-eslint/parser`
	 * always spans the whole text.
	 */
	if (dialect === "ts") {
		program.end = reader.source.length;

		if ((program.body as unknown[]).length === 0) {
			program.start = reader.source.length;
		}
	}

	// The program's own extent may have just changed, so restamp it.
	if (lines !== null) {
		const start = program.start as number;
		const end = program.end as number;

		program.range = [start, end];
		program.loc = lines.location(start, end);
	}

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
			lines ?? new LineIndex(result.lineStarts),
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

//-----------------------------------------------------------------------------
// ESLint Integration
//-----------------------------------------------------------------------------

/** File extensions that are JavaScript rather than TypeScript. */
const JAVASCRIPT_FILE = /\.[cm]?jsx?$/iu;

/** File extensions that carry JSX. */
const JSX_FILE = /\.[jt]sx$/iu;

/**
 * The options ESLint passes to a parser.
 *
 * ESLint sends a good deal more than this, all of it describing capabilities
 * that are either always on here or decided by the source text itself, so
 * everything not listed is ignored.
 */
export interface EslintParserOptions {
	/** How the program should be interpreted. */
	sourceType?: "script" | "module" | "commonjs";

	/**
	 * Whether TypeScript syntax is allowed. When omitted the dialect is taken
	 * from the file's extension, so that TypeScript syntax in a `.js` file is
	 * still reported as the mistake it is.
	 */
	dialect?: "js" | "ts";

	/**
	 * Whether JSX syntax is allowed. When omitted it is taken from the file's
	 * extension, so `.jsx` and `.tsx` files lint without any configuration and
	 * JSX elsewhere is reported as the mistake it is.
	 */
	jsx?: boolean;

	/** The path of the file being linted. */
	filePath?: string;
}

/**
 * Chooses a dialect for a file ESLint asked to parse.
 * @param options The options ESLint passed to the parser.
 * @returns The dialect the file should be parsed as.
 */
function dialectFor(options: EslintParserOptions): "js" | "ts" {
	if (options.dialect) {
		return options.dialect;
	}

	return options.filePath && JAVASCRIPT_FILE.test(options.filePath)
		? "js"
		: "ts";
}

/**
 * Decides whether a file ESLint asked to parse may contain JSX.
 * @param options The options ESLint passed to the parser.
 * @returns `true` when JSX syntax should be accepted.
 */
function jsxFor(options: EslintParserOptions): boolean {
	if (options.jsx !== undefined) {
		return options.jsx;
	}

	return options.filePath !== undefined && JSX_FILE.test(options.filePath);
}

/**
 * A parser that can be dropped straight into `languageOptions.parser`.
 *
 * ESLint has no phase for non-fatal problems: a file either parses or it
 * doesn't. So while `toAST()` hands validation problems back to the caller,
 * this throws the first one, which is how ESLint's own parsers behave and
 * what turns the problem into a fatal lint message pointing at the right
 * line.
 *
 * Unlike `toAST()`, the nodes, tokens, and comments produced here carry
 * `range` and `loc`, because ESLint refuses an AST without them.
 */
export const eslintParser = {
	/**
	 * Parses source text into an AST ESLint can lint.
	 * @param code The JavaScript or TypeScript source to parse.
	 * @param options The options ESLint passed to the parser.
	 * @returns The ESTree `Program` node.
	 * @throws {ParseError} When the source has a syntax error, or when
	 * validation finds a problem that makes the program invalid.
	 */
	parse(code: string, options: EslintParserOptions = {}): Program {
		const result = parse(code);
		const lines = new LineIndex(result.lineStarts);
		const { ast, problems } = buildAst(
			result,
			{
				sourceType: options.sourceType ?? "module",
				dialect: dialectFor(options),
				jsx: jsxFor(options),
			},
			lines,
		);

		if (problems.length > 0) {
			const { message, start } = problems[0];

			throw new ParseError(
				message,
				start,
				lines.line(start),
				lines.column(start) + 1,
			);
		}

		return ast;
	},
};

/** Re-exported so callers can narrow thrown errors without a deep import. */
export type { EsNode };
export default { parse, validate, toAST, eslintParser, ParseError };
