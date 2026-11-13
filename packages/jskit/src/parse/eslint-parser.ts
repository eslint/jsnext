/**
 * @fileoverview The ESLint-compatible parser object.
 */

import { analyze, type EsTreeNode, type ScopeManager } from "../scope/index.js";
import { toDecodedScopeManager } from "../scope/internal.js";
import { buildAst, collectProblems, parse, type ParseResult } from "./api.js";
import { readLineStarts } from "./binary.js";
import { ParseError } from "./errors.js";
import { LineIndex } from "./locations.js";
import { AstReader } from "./reader.js";
import type { EsNode } from "./to-ast.js";
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
 * What `buildProgram()` produces: the tree, and what scope analysis needs to
 * run over the same parse and name the same objects.
 */
interface BuiltProgram {
	/** The ESTree `Program` node. */
	ast: Program;

	/** The parse buffer the tree was decoded from. */
	result: ParseResult;

	/**
	 * Every decoded node under its node index, or `null` when the caller did
	 * not ask for the table.
	 */
	nodes: (EsNode | null)[] | null;
}

/**
 * Parses source text the way ESLint needs it: positions on everything, and the
 * first validation problem thrown rather than returned.
 * @param code The JavaScript or TypeScript source to parse.
 * @param options The options ESLint passed to the parser.
 * @param recordNodes Whether to record every decoded node under its node
 *      index, for resolving a scope buffer to the tree's objects.
 * @returns The ESTree `Program` node, the parse buffer, and the node table.
 * @throws {ParseError} When the source has a syntax error, or when validation
 * finds a problem that makes the program invalid.
 */
function buildProgram(
	code: string,
	options: EslintParserOptions,
	recordNodes: boolean,
): BuiltProgram {
	const sourceType = options.sourceType ?? "module";

	/*
	 * The source type goes to both phases, because it decides how some text
	 * *reads* as well as what is allowed. ESLint has it before the first
	 * character is scanned, so there is nothing to defer.
	 *
	 * `jsx` and `dialect` go to phase one as well, because each decides how a
	 * `<` reads: `jsx` whether one in expression position opens an element or
	 * a type assertion, `dialect` whether one after an expression opens type
	 * arguments or a comparison. So an element in a file without JSX is a
	 * parse error, as it is for `espree` and `@typescript-eslint/parser` —
	 * though `parse()` names the missing option rather than the token it
	 * tripped on, when the file would have parsed as JSX.
	 *
	 * `tokens: true` because ESLint reads tokens as freely as nodes: the
	 * `Program` this hands back must carry the full token and comment lists.
	 */
	const jsx = jsxFor(options);
	const dialect = dialectFor(options);
	const result = parse(code, { sourceType, jsx, dialect, tokens: true });
	const lines = new LineIndex(readLineStarts(result));

	/*
	 * `ecmaFeatures.globalReturn` asks for the one thing that already
	 * separates a CommonJS module from a script — a wrapping function, and so
	 * a legal top-level `return` — so phase 2 is told the source is CommonJS.
	 * ESLint drops the flag for a module, and so does this.
	 */
	const resolvedSourceType =
		sourceType === "script" && globalReturnFor(options)
			? "commonjs"
			: sourceType;

	/*
	 * `toAST()` deliberately does not validate, so the two passes are run
	 * here by hand — validation first, because an invalid program throws and
	 * the tree it would have decoded is never looked at.
	 */
	const problems = collectProblems(
		result,
		resolvedSourceType,
		dialect,
		jsx,
		declarationFor(options),
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

	const nodes = recordNodes
		? new Array<EsNode | null>(new AstReader(result).nodeCount).fill(null)
		: null;
	const ast = buildAst(
		result,
		{ sourceType: resolvedSourceType, dialect },
		lines,
		nodes,
	);

	return { ast, result, nodes };
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
 * doesn't. So while the library keeps validation and decoding as separate
 * passes, this runs both and throws the first problem found, which is how
 * ESLint's own parsers behave and what turns the problem into a fatal lint
 * message pointing at the right line.
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
		return buildProgram(code, options, false).ast;
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
		const { ast, result, nodes } = buildProgram(code, options, true);

		/*
		 * The graph has to refer to the very node objects ESLint is about to
		 * hand the rules, because a rule asking for the scope of a node
		 * compares node identity. A scope buffer built over the parse buffer
		 * knows only byte offsets, so the decode recorded which object it
		 * made for each node index, and the graph is resolved through that.
		 * That keeps the analysis on the binary path — the one a native
		 * binding implements — with no walk over the tree to number it.
		 */
		const scopes = analyze(result, {
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
			scopeManager: toDecodedScopeManager(
				scopes,
				result,
				nodes as unknown as readonly (EsTreeNode | null)[],
			),
			visitorKeys: VISITOR_KEYS,
		};
	},
};
