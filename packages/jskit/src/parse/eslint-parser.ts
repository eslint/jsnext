/**
 * @fileoverview The ESLint-compatible parser object.
 */

import {
	analyzeTree,
	toScopeManager,
	type EsTreeNode,
	type ScopeManager,
} from "../scope/index.js";
import { buildAst, parse } from "./api.js";
import { readLineStarts } from "./binary.js";
import { ParseError } from "./errors.js";
import { LineIndex } from "./locations.js";
import { VISITOR_KEYS } from "./visitor-keys.js";
import type { Program } from "./ast-types.js";

/** File extensions that are JavaScript rather than TypeScript. */
const JAVASCRIPT_FILE = /\.[cm]?jsx?$/iu;

/** File extensions that carry JSX. */
const JSX_FILE = /\.[jt]sx$/iu;

/** File extensions that make a whole file ambient. */
const DECLARATION_FILE = /\.d\.[cm]?ts$/iu;

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

		/**
		 * Whether an implicit function wraps the program, which is what makes
		 * top-level `return` legal — the same thing `sourceType: "commonjs"`
		 * says, spelled the way `espree` spells it. Ignored for a module,
		 * which ESLint ignores it for too.
		 */
		globalReturn?: boolean;

		/** Whether strict mode applies without a directive saying so. */
		impliedStrict?: boolean;
	};

	/**
	 * Whether the whole file is ambient. When omitted it is taken from the
	 * file's extension, so a `.d.ts` lints without any configuration.
	 */
	declaration?: boolean;

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
 * Decides whether a file ESLint asked to parse declares anything at run time.
 *
 * A `.d.ts` describes what exists elsewhere, so a `const` in one needs no
 * initializer. TypeScript goes by the file's name for this and so does this.
 * @param options The options ESLint passed to the parser.
 * @returns `true` when the file is a declaration file.
 */
function declarationFor(options: EslintParserOptions): boolean {
	if (options.declaration !== undefined) {
		return options.declaration;
	}

	return (
		options.filePath !== undefined &&
		DECLARATION_FILE.test(options.filePath)
	);
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
 * Decides whether an implicit function wraps the program, which is what makes
 * a top-level `return` legal.
 * @param options The options ESLint passed to the parser.
 * @returns `true` when the program is wrapped.
 */
function globalReturnFor(options: EslintParserOptions): boolean {
	return options.ecmaFeatures?.globalReturn ?? false;
}

/**
 * Parses source text the way ESLint needs it: positions on everything, and the
 * first validation problem thrown rather than returned.
 * @param code The JavaScript or TypeScript source to parse.
 * @param options The options ESLint passed to the parser.
 * @returns The ESTree `Program` node.
 * @throws {ParseError} When the source has a syntax error, or when validation
 * finds a problem that makes the program invalid.
 */
function buildProgram(code: string, options: EslintParserOptions): Program {
	const sourceType = options.sourceType ?? "module";

	/*
	 * The source type goes to both phases, because it decides how some text
	 * *reads* as well as what is allowed. ESLint has it before the first
	 * character is scanned, so there is nothing to defer.
	 *
	 * `jsx` goes to phase one only when it is on. `jsx: true` reads a `<` in
	 * expression position as an element directly, which is both the `.tsx`
	 * reading and the fast path. When JSX is off, phase one is deliberately
	 * left in its permissive mode instead of being told `false`: a stray
	 * element then still parses, and phase two reports it as "JSX is not
	 * enabled" — a far better diagnostic than the type-assertion parse error
	 * the strict reading would produce.
	 */
	const result = parse(
		code,
		jsxFor(options) ? { sourceType, jsx: true } : { sourceType },
	);
	const lines = new LineIndex(readLineStarts(result));
	const { ast, problems } = buildAst(
		result,
		{
			/*
			 * `ecmaFeatures.globalReturn` asks for the one thing that already
			 * separates a CommonJS module from a script — a wrapping function,
			 * and so a legal top-level `return` — so phase 2 is told the
			 * source is CommonJS. ESLint drops the flag for a module, and so
			 * does this.
			 */
			sourceType:
				sourceType === "script" && globalReturnFor(options)
					? "commonjs"
					: sourceType,
			dialect: dialectFor(options),
			jsx: jsxFor(options),
			declaration: declarationFor(options),
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
}

/**
 * What `parseForESLint()` hands back.
 */
export interface EslintParseResult {
	/** The ESTree `Program` node, with `range` and `loc` throughout. */
	ast: Program;

	/**
	 * The scope graph over that very tree, in place of the one ESLint would
	 * otherwise build with `eslint-scope`.
	 */
	scopeManager: ScopeManager<EsTreeNode>;

	/**
	 * Which properties of each node hold its children.
	 *
	 * Without this ESLint uses `eslint-visitor-keys`, which knows the
	 * JavaScript nodes only, and reaches a TypeScript one — everything under
	 * an `Identifier`'s `typeAnnotation`, say — through the fallback that
	 * enumerates a node's own properties. Rules would then see those nodes
	 * without a `parent`, since the walk that assigns it never gets there.
	 */
	visitorKeys: Readonly<Record<string, readonly string[]>>;
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
 *
 * `parseForESLint()` is the entry point ESLint prefers, and the one that
 * supplies the scope graph as well as the tree. `parse()` remains for anything
 * that wants only the tree; going through it leaves ESLint to run
 * `eslint-scope` over the result, which understands no TypeScript.
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
		return buildProgram(code, options);
	},

	/**
	 * Parses source text into an AST and the scope graph over it.
	 *
	 * ESLint calls this in preference to `parse()`, and takes the scope graph
	 * it returns instead of running `eslint-scope` over the tree. That is what
	 * makes scope analysis understand TypeScript: `eslint-scope` sees a type
	 * annotation as an unknown node and walks straight past the bindings and
	 * references inside it.
	 * @param code The JavaScript or TypeScript source to parse.
	 * @param options The options ESLint passed to the parser.
	 * @returns The `Program` node and the scope graph over it.
	 * @throws {ParseError} When the source has a syntax error, or when
	 * validation finds a problem that makes the program invalid.
	 */
	parseForESLint(
		code: string,
		options: EslintParserOptions = {},
	): EslintParseResult {
		const ast = buildProgram(code, options);

		/*
		 * The graph has to refer to the very node objects ESLint is about to
		 * hand the rules, so this goes through the tree entry point rather
		 * than the binary one: a rule asking for the scope of a node compares
		 * node identity, and a scope built over the parse buffer knows only
		 * byte offsets.
		 */
		const tree = ast as unknown as EsTreeNode;
		const scopes = analyzeTree(tree, {
			sourceType: options.sourceType ?? "module",
			dialect: dialectFor(options),
			jsx: jsxFor(options),
			globalReturn: globalReturnFor(options),
			impliedStrict: options.ecmaFeatures?.impliedStrict ?? false,

			/*
			 * ESLint passes `ignoreEval: true` to `eslint-scope`, so a direct
			 * `eval` leaves the enclosing scopes static and every rule reading
			 * the graph is written expecting that.
			 */
			ignoreEval: true,
		});

		return {
			ast,
			scopeManager: toScopeManager(scopes, tree),
			visitorKeys: VISITOR_KEYS,
		};
	},
};
