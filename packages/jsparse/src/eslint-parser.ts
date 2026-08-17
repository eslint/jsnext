/**
 * @fileoverview The ESLint-compatible parser object.
 */

import { buildAst, parse } from "./api.js";
import { readLineStarts } from "./binary.js";
import { ParseError } from "./errors.js";
import { LineIndex } from "./locations.js";
import type { Program } from "./ast-types.js";

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
	 * The language features to enable, spelled the way `espree` spells them so
	 * that a configuration written for it keeps working.
	 */
	ecmaFeatures?: {
		/**
		 * Whether JSX syntax is allowed. When omitted it is taken from the
		 * file's extension, so `.jsx` and `.tsx` files lint without any
		 * configuration and JSX elsewhere is reported as the mistake it is.
		 */
		jsx?: boolean;
	};

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
	if (options.ecmaFeatures?.jsx !== undefined) {
		return options.ecmaFeatures.jsx;
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
		const sourceType = options.sourceType ?? "module";

		/*
		 * The source type goes to both phases, because it decides how some
		 * text *reads* as well as what is allowed. ESLint has it before the
		 * first character is scanned, so there is nothing to defer.
		 */
		const result = parse(code, { sourceType });
		const lines = new LineIndex(readLineStarts(result));
		const { ast, problems } = buildAst(
			result,
			{
				sourceType,
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
