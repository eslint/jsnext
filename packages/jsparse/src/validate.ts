/**
 * @fileoverview The validation phase.
 *
 * Parsing accepts the union of everything JavaScript and TypeScript allow.
 * This pass walks the result and reports the problems that only become
 * problems once you know how the program is meant to be interpreted: the
 * source type, the dialect, whether strict mode is in effect, and what names
 * are already bound in the surrounding scope.
 */

import { TF_LEGACY_OCTAL } from "./binary.js";
import {
	LIT_REGEXP,
	DECL_CONST,
	DECL_MASK,
	DECL_SHIFT,
	DECL_VAR,
	NODE_A,
	NODE_B,
	NODE_C,
	MKIND_GET,
	MKIND_MASK,
	MKIND_SET,
	MKIND_SHIFT,
	NF_COMPUTED,
	NF_METHOD,
	NF_STATIC,
	TS_FIRST,
	N_ArrayPattern,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_BinaryExpression,
	N_BlockStatement,
	N_CallExpression,
	N_ChainExpression,
	N_CatchClause,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_ArrowFunctionExpression,
	N_Identifier,
	N_ImportDeclaration,
	N_ImportSpecifier,
	N_JSXElement,
	N_JSXFragment,
	N_Literal,
	N_ObjectPattern,
	N_Program,
	N_Property,
	N_RestElement,
	N_ReturnStatement,
	N_StaticBlock,
	N_SwitchStatement,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumDeclaration,
	N_TSInterfaceDeclaration,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSTypeAliasDeclaration,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_MemberExpression,
	N_MethodDefinition,
	N_PrivateIdentifier,
	N_TSAbstractMethodDefinition,
	N_TSAsExpression,
	N_TSNonNullExpression,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	N_UnaryExpression,
	N_UpdateExpression,
	N_WithStatement,
} from "./node-kinds.js";
import { AstReader, TokenReader } from "./reader.js";
import { RegExpValidator } from "./regexp.js";
import { decodeEscapes } from "./values.js";
import { SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE } from "./slots.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KIND_KEYWORD_FLAGS,
	KW_STRICT_RESERVED,
	T_ASSIGN,
	T_delete,
	T_in,
	lookupKeyword,
	hashChar,
} from "./token-kinds.js";

/** A problem found during validation. */
export interface ValidationProblem {
	message: string;
	start: number;
}

/**
 * How a binding was introduced, which decides what may shadow it.
 *
 * `BINDING_VAR` never appears in a scope's `names`; a `var` is recorded in
 * `varNames` instead, because it is the only kind that binds somewhere other
 * than where it is written.
 */
const BINDING_VAR = 0;
const BINDING_LEXICAL = 1;
const BINDING_FUNCTION = 2;
const BINDING_PARAM = 3;
const BINDING_TYPE = 4;
const BINDING_SIGNATURE = 5;
const BINDING_CATCH = 6;

/**
 * One lexical scope's bindings.
 */
interface Scope {
	/** Names bound where they are written, mapped to how they were introduced. */
	names: Map<string, number>;

	/**
	 * Names `var`-declared in this scope or in any scope below it that a
	 * `var` climbs out of. A lexical declaration collides with one of these
	 * however the two are ordered, which is what makes `{ var a; let a; }`
	 * and `{ let a; var a; }` alike.
	 */
	varNames: Set<string>;

	/** Whether `var` declarations stop climbing here. */
	isFunctionScope: boolean;

	/**
	 * Whether a function declaration written directly in this scope binds
	 * here rather than in the nearest function scope. That is true of a
	 * block and of a module's top level, and false of a script's top level
	 * and of a function body — which is why `function a(){} var a;` is a
	 * redeclaration in a module and not in a script.
	 */
	functionsAreLexical: boolean;

	/** The enclosing scope, or `null` for the program scope. */
	parent: Scope | null;
}

/**
 * Walks a parsed program and reports context-dependent problems.
 * @param reader The reader over the AST buffer.
 * @param tokens The reader over the token buffer.
 * @param sourceType How the program should be interpreted.
 * @param dialect Whether TypeScript syntax is allowed.
 * @param jsx Whether JSX syntax is allowed.
 * @returns Every problem found, in the order they were encountered.
 */
export function validateAst(
	reader: AstReader,
	tokens: TokenReader,
	sourceType: "script" | "module" | "commonjs",
	dialect: "js" | "ts",
	jsx: boolean,
): ValidationProblem[] {
	const validator = new Validator(reader, tokens, sourceType, dialect, jsx);

	validator.run();

	return validator.problems;
}

/**
 * Implements the validation walk.
 */
class Validator {
	/** Problems found so far. */
	readonly problems: ValidationProblem[] = [];

	/** The reader over the AST buffer. */
	private readonly reader: AstReader;

	/** The reader over the token buffer. */
	private readonly tokens: TokenReader;

	/** How the program should be interpreted. */
	private readonly sourceType: "script" | "module" | "commonjs";

	/** Whether TypeScript syntax is allowed. */
	private readonly dialect: "js" | "ts";

	/** Whether JSX syntax is allowed. */
	private readonly jsx: boolean;

	/** Whether strict mode rules currently apply. */
	private strict: boolean;

	/** Depth of enclosing functions; `0` means top level. */
	private functionDepth = 0;

	/**
	 * Whether the walk is inside a JSX element or fragment, so that a
	 * disallowed JSX tree is reported once at its root rather than once per
	 * node it contains.
	 */
	private inJsx = false;

	/** The innermost scope. */
	private scope: Scope;

	/**
	 * Whether the parameter list being declared may not repeat a name.
	 *
	 * Sloppy code lets a plain function repeat a *simple* parameter —
	 * `function f(a, a) {}` is legal and the last one wins. Every other
	 * combination bans it: strict code, any non-simple list, a method, and an
	 * arrow function.
	 */
	private uniqueParams = false;

	/**
	 * Whether the function being visited is a method, which its own node does
	 * not record — the method-ness belongs to the `MethodDefinition` or
	 * `Property` above it, and only reaches the function through here.
	 */
	private inMethod = false;

	/**
	 * The private names each enclosing class declares, outermost first.
	 *
	 * Empty at the top level, which is what makes a `#x` outside any class an
	 * error rather than an unresolved name.
	 */
	private readonly privateNames: Set<string>[] = [];

	/**
	 * The reader for regular expression patterns, made on first use.
	 *
	 * Most programs have no regular expression literal at all, and the one
	 * instance is reused by every literal in the ones that do.
	 */
	private regexp: RegExpValidator | null = null;

	/**
	 * Creates a validator.
	 * @param reader The reader over the AST buffer.
	 * @param tokens The reader over the token buffer.
	 * @param sourceType How the program should be interpreted.
	 * @param dialect Whether TypeScript syntax is allowed.
	 * @param jsx Whether JSX syntax is allowed.
	 */
	constructor(
		reader: AstReader,
		tokens: TokenReader,
		sourceType: "script" | "module" | "commonjs",
		dialect: "js" | "ts",
		jsx: boolean,
	) {
		this.reader = reader;
		this.tokens = tokens;
		this.sourceType = sourceType;
		this.dialect = dialect;
		this.jsx = jsx;
		this.strict = sourceType === "module";
		this.scope = {
			names: new Map(),
			varNames: new Set(),
			isFunctionScope: true,
			functionsAreLexical: sourceType === "module",
			parent: null,
		};
	}

	/**
	 * Runs every check over the whole program.
	 * @returns Nothing.
	 */
	run(): void {
		const root = this.reader.root;

		if (!this.strict && this.hasUseStrictDirective(root)) {
			this.strict = true;
		}

		this.checkTokens();
		this.hoist(this.reader.field(root, NODE_A));
		this.visitList(this.reader.field(root, NODE_A));
	}

	/**
	 * Reports a problem.
	 * @param message A description of the problem.
	 * @param start The offset where the problem begins.
	 * @returns Nothing.
	 */
	private report(message: string, start: number): void {
		this.problems.push({ message, start });
	}

	//-------------------------------------------------------------------------
	// Token-Level Checks
	//-------------------------------------------------------------------------

	/**
	 * Reports problems that can be seen from the token stream alone.
	 * @returns Nothing.
	 */
	private checkTokens(): void {
		if (!this.strict) {
			return;
		}

		for (let i = 0; i < this.tokens.count; i++) {
			if ((this.tokens.flags(i) & TF_LEGACY_OCTAL) !== 0) {
				this.report(
					"Octal literals are not allowed in strict mode.",
					this.tokens.start(i),
				);
			}
		}
	}

	/**
	 * Determines whether a body begins with a `"use strict"` directive.
	 * @param node The `Program` or function body node.
	 * @returns `true` when the directive is present.
	 */
	private hasUseStrictDirective(node: number): boolean {
		const body = this.reader.field(node, NODE_A);
		const size = this.reader.listSize(body);

		for (let i = 0; i < size; i++) {
			const statement = this.reader.listItem(body, i);

			// The prologue ends at the first non-directive statement.
			if (this.reader.field(statement, NODE_B) !== 1) {
				return false;
			}

			const raw = this.reader.text(
				this.reader.field(statement, NODE_A),
			);

			if (raw === '"use strict"' || raw === "'use strict'") {
				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Traversal
	//-------------------------------------------------------------------------

	/**
	 * Visits a node and everything below it.
	 * @param node The node index, or `0`.
	 * @returns Nothing.
	 */
	private visit(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		this.check(node, kind);

		switch (kind) {
			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				this.visitFunction(node);
				return;

			case N_BlockStatement:
				this.enterScope(false);
				this.hoist(reader.field(node, NODE_A));
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			/*
			 * A `var` cannot escape a static block or a namespace body, so
			 * both stop the climb the way a function body does, and a
			 * function declared in either one binds there.
			 */
			case N_StaticBlock:
			case N_TSModuleBlock:
				this.enterScope(true);
				this.hoist(reader.field(node, NODE_A));
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			/*
			 * Every case shares the switch's one block scope, so a lexical
			 * declaration in one case collides with the same name in
			 * another.
			 */
			case N_SwitchStatement: {
				const cases = reader.field(node, NODE_B);
				const size = reader.listSize(cases);

				this.enterScope(false);

				for (let i = 0; i < size; i++) {
					this.hoist(reader.field(reader.listItem(cases, i), NODE_B));
				}

				this.visitChildren(node, kind);
				this.exitScope();
				return;
			}

			/*
			 * A `let` or `const` in the head binds in a scope of its own, so
			 * that a `var` of the same name in the body is a redeclaration
			 * while a `let` is not.
			 */
			case N_ForStatement:
			case N_ForInStatement:
			case N_ForOfStatement: {
				const head = reader.field(node, NODE_A);

				this.enterScope(false);

				if (head !== 0 && reader.kind(head) === N_VariableDeclaration) {
					// Only a C-style head has a place to put an initializer.
					this.declareVariableDeclaration(
						head,
						kind === N_ForStatement,
					);
				}

				this.visitChildren(node, kind);
				this.exitScope();
				return;
			}

			/*
			 * The clause and its block share one scope, because a lexical
			 * declaration in the block collides with the parameter even
			 * though the block is a scope of its own everywhere else.
			 */
			case N_CatchClause: {
				const param = reader.field(node, NODE_A);
				const body = reader.field(node, NODE_B);

				this.enterScope(false);

				/*
				 * A `var` may reuse the name of a simple parameter but not of
				 * one picked out of a pattern, so only the simple one gets a
				 * binding kind that a `var` passes through.
				 */
				this.declarePattern(
					param,
					param !== 0 && reader.kind(param) === N_Identifier
						? BINDING_CATCH
						: BINDING_LEXICAL,
				);
				this.visit(param);

				if (body !== 0) {
					this.hoist(reader.field(body, NODE_A));
					this.visitList(reader.field(body, NODE_A));
				}

				this.exitScope();
				return;
			}

			/*
			 * A method's parameters may never repeat a name, however sloppy
			 * the surrounding code is, and an accessor's list has a fixed
			 * shape. Neither fact is recorded on the function itself, so both
			 * are settled here and the first is handed down for the value
			 * alone — a computed key holding a function is not a method.
			 */
			case N_MethodDefinition:
			case N_TSAbstractMethodDefinition:
			case N_Property: {
				const flags = reader.flags(node);
				const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
				const value = reader.field(node, NODE_B);

				if (accessor === MKIND_GET || accessor === MKIND_SET) {
					this.checkAccessorParameters(value, accessor);
				}

				this.visit(reader.field(node, NODE_A));

				const wasMethod = this.inMethod;

				this.inMethod =
					kind !== N_Property ||
					(flags & NF_METHOD) !== 0 ||
					accessor === MKIND_GET ||
					accessor === MKIND_SET;
				this.visit(value);
				this.inMethod = wasMethod;
				this.visitList(reader.field(node, NODE_C));
				return;
			}

			/*
			 * A class opens a private environment that covers its body and
			 * nothing else. The heritage clause is deliberately visited before
			 * the push, because the specification evaluates it in the *outer*
			 * environment: `class C extends this.#x { #x; }` does not resolve.
			 */
			case N_ClassDeclaration:
			case N_ClassExpression: {
				const body = reader.field(node, NODE_C);

				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_B));

				if (body === 0) {
					return;
				}

				this.privateNames.push(this.collectPrivateNames(body));
				this.visitChildren(body, reader.kind(body));
				this.privateNames.pop();
				return;
			}

			/*
			 * Everything below a JSX element or fragment is JSX too, so the
			 * subtree is marked to keep `check()` from reporting a disallowed
			 * tree again at every element nested inside it.
			 */
			case N_JSXElement:
			case N_JSXFragment: {
				const wasInJsx = this.inJsx;

				this.inJsx = true;
				this.visitChildren(node, kind);
				this.inJsx = wasInJsx;
				return;
			}

			default:
				this.visitChildren(node, kind);
		}
	}

	/**
	 * Visits every child of a node using the slot descriptor table.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitList(this.reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits every element of a list.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private visitList(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.visit(this.reader.listItem(handle, i));
		}
	}

	/**
	 * Visits a function, giving its parameters and body a fresh scope.
	 * @param node The function node index.
	 * @returns Nothing.
	 */
	private visitFunction(node: number): void {
		const reader = this.reader;
		const previousStrict = this.strict;
		const previousUnique = this.uniqueParams;
		const isMethod = this.inMethod;
		const body = reader.field(node, NODE_C);

		/*
		 * Method-ness reaches exactly one function, the one it was set for.
		 * A function nested inside a method is an ordinary function again.
		 */
		this.inMethod = false;
		this.functionDepth++;
		this.enterScope(true);

		const directive =
			body !== 0 &&
			reader.kind(body) === N_BlockStatement &&
			this.hasUseStrictDirective(body);

		if (directive) {
			this.strict = true;
		}

		const params = reader.field(node, NODE_B);
		const size = reader.listSize(params);
		const simple = this.hasSimpleParameters(params, size);

		/*
		 * A `"use strict"` directive cannot make strict something the engine
		 * would have to evaluate to know — a default expression runs in the
		 * function's own scope, so whether *it* is strict would depend on the
		 * directive it precedes. The language sidesteps the question by
		 * banning the combination outright.
		 */
		if (directive && !simple) {
			this.report(
				"Illegal 'use strict' directive in a function with a non-simple parameter list.",
				reader.start(node),
			);
		}

		this.uniqueParams =
			this.strict ||
			!simple ||
			isMethod ||
			reader.kind(node) === N_ArrowFunctionExpression;

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if (
				reader.kind(param) === N_RestElement &&
				i !== size - 1
			) {
				this.report(
					"A rest parameter must be the last parameter.",
					reader.start(param),
				);
			}

			this.declarePattern(param, BINDING_PARAM);
		}

		this.uniqueParams = previousUnique;
		this.visit(reader.field(node, NODE_A));
		this.visitList(params);

		if (body !== 0 && reader.kind(body) === N_BlockStatement) {
			this.hoist(reader.field(body, NODE_A));
			this.visitList(reader.field(body, NODE_A));
		} else {
			this.visit(body);
		}

		this.visit(reader.field(node, 7));
		this.visit(reader.field(node, 8));
		this.exitScope();
		this.functionDepth--;
		this.strict = previousStrict;
	}

	/**
	 * Determines whether every parameter is a plain binding identifier.
	 *
	 * That is the specification's `IsSimpleParameterList`, and it decides two
	 * separate things: whether the list may repeat a name in sloppy code, and
	 * whether the body may open with a `"use strict"` directive.
	 * @param params The parameter list handle.
	 * @param size How many parameters it holds.
	 * @returns `true` when no parameter is a pattern, a default, or a rest.
	 */
	private hasSimpleParameters(params: number, size: number): boolean {
		for (let i = 0; i < size; i++) {
			if (
				this.reader.kind(this.reader.listItem(params, i)) !==
				N_Identifier
			) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Reports an accessor whose parameter list is not the shape it must be.
	 *
	 * A getter takes nothing and a setter takes exactly one thing, and neither
	 * may collect a rest — the two are called with a fixed shape by the
	 * property machinery, so there is nothing for the extra parameters to be.
	 * @param value The function node index, or `0`.
	 * @param accessor The packed method kind.
	 * @returns Nothing.
	 */
	private checkAccessorParameters(value: number, accessor: number): void {
		if (value === 0) {
			return;
		}

		const reader = this.reader;
		const params = reader.field(value, NODE_B);
		const size = reader.listSize(params);

		if (accessor === MKIND_GET) {
			if (size > 0) {
				this.report(
					"A getter must have no parameters.",
					reader.start(reader.listItem(params, 0)),
				);
			}

			return;
		}

		if (size !== 1) {
			this.report(
				"A setter must have exactly one parameter.",
				reader.start(size === 0 ? value : reader.listItem(params, 1)),
			);

			return;
		}

		const only = reader.listItem(params, 0);

		if (reader.kind(only) === N_RestElement) {
			this.report(
				"A setter cannot have a rest parameter.",
				reader.start(only),
			);
		}
	}

	//-------------------------------------------------------------------------
	// Scopes
	//-------------------------------------------------------------------------

	/**
	 * Pushes a new scope.
	 * @param isFunctionScope Whether `var` declarations stop here.
	 * @returns Nothing.
	 */
	private enterScope(isFunctionScope: boolean): void {
		this.scope = {
			names: new Map(),
			varNames: new Set(),
			isFunctionScope,
			functionsAreLexical: !isFunctionScope,
			parent: this.scope,
		};
	}

	/**
	 * Pops the innermost scope.
	 * @returns Nothing.
	 */
	private exitScope(): void {
		this.scope = this.scope.parent!;
	}

	/**
	 * Declares the block-scoped names of a statement list before visiting it,
	 * which is what lets a redeclaration be reported at either occurrence.
	 * @param handle The list handle of the statements.
	 * @returns Nothing.
	 */
	private hoist(handle: number): void {
		const reader = this.reader;
		const size = reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			let statement = reader.listItem(handle, i);
			let kind = reader.kind(statement);

			// Look through `export` to the declaration it wraps.
			if (
				kind === N_ExportNamedDeclaration ||
				kind === N_ExportDefaultDeclaration
			) {
				statement = reader.field(statement, NODE_A);

				if (statement === 0) {
					continue;
				}

				kind = reader.kind(statement);
			}

			switch (kind) {
				case N_VariableDeclaration:
					this.declareVariableDeclaration(statement, true);
					break;

				case N_ImportDeclaration:
					this.declareImportDeclaration(statement);
					break;

				case N_FunctionDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? BINDING_FUNCTION
							: BINDING_VAR,
					);
					break;

				/*
				 * A body-less function declaration is either a TypeScript
				 * overload signature or an ambient one, and both merge with
				 * the other declarations of the same name instead of
				 * redeclaring it.
				 */
				case N_TSDeclareFunction:
					this.declare(
						reader.field(statement, NODE_A),
						this.scope.functionsAreLexical
							? BINDING_SIGNATURE
							: BINDING_VAR,
					);
					break;

				case N_ClassDeclaration:
					this.declare(
						reader.field(statement, NODE_A),
						BINDING_LEXICAL,
					);
					break;

				case N_TSInterfaceDeclaration:
				case N_TSTypeAliasDeclaration:
				case N_TSEnumDeclaration:
				case N_TSModuleDeclaration:
					this.declare(reader.field(statement, NODE_A), BINDING_TYPE);
					break;

				default:
					break;
			}
		}
	}

	/**
	 * Declares every name introduced by a variable declaration.
	 * @param node The `VariableDeclaration` node index.
	 * @param checkInitializer Whether a `const` here needs an initializer,
	 *      which a `for...in` or `for...of` head does not.
	 * @returns Nothing.
	 */
	private declareVariableDeclaration(
		node: number,
		checkInitializer: boolean,
	): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const declarationKind = (flags & DECL_MASK) >>> DECL_SHIFT;
		const binding =
			declarationKind === DECL_VAR ? BINDING_VAR : BINDING_LEXICAL;
		const declarations = reader.field(node, NODE_A);
		const size = reader.listSize(declarations);

		for (let i = 0; i < size; i++) {
			const declarator = reader.listItem(declarations, i);

			this.declarePattern(reader.field(declarator, NODE_A), binding);

			if (
				checkInitializer &&
				declarationKind === DECL_CONST &&
				reader.field(declarator, NODE_B) === 0 &&
				(reader.flags(declarator) & (1 << 15)) === 0 &&
				(reader.flags(node) & (1 << 11)) === 0
			) {
				this.report(
					"Missing initializer in const declaration.",
					reader.start(declarator),
				);
			}
		}
	}

	/**
	 * Declares the local name of every specifier of an import declaration.
	 * @param node The `ImportDeclaration` node index.
	 * @returns Nothing.
	 */
	private declareImportDeclaration(node: number): void {
		const reader = this.reader;
		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);

			/*
			 * A named specifier carries the imported name first and the local
			 * one second; a default or namespace specifier has only the local
			 * name.
			 */
			this.declare(
				reader.field(
					specifier,
					reader.kind(specifier) === N_ImportSpecifier
						? NODE_B
						: NODE_A,
				),
				BINDING_LEXICAL,
			);
		}
	}

	/**
	 * Declares every identifier inside a binding pattern.
	 * @param node The pattern node index.
	 * @param binding How the names are being introduced.
	 * @returns Nothing.
	 */
	private declarePattern(node: number, binding: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				this.declare(node, binding);
				return;

			case N_ArrayPattern: {
				const elements = reader.field(node, NODE_A);
				const size = reader.listSize(elements);

				for (let i = 0; i < size; i++) {
					this.declarePattern(
						reader.listItem(elements, i),
						binding,
					);
				}

				return;
			}

			case N_ObjectPattern: {
				const properties = reader.field(node, NODE_A);
				const size = reader.listSize(properties);

				for (let i = 0; i < size; i++) {
					const property = reader.listItem(properties, i);

					this.declarePattern(
						reader.kind(property) === N_Property
							? reader.field(property, NODE_B)
							: reader.field(property, NODE_A),
						binding,
					);
				}

				return;
			}

			case N_AssignmentPattern:
			case N_RestElement:
				this.declarePattern(reader.field(node, NODE_A), binding);
				return;

			default:
				return;
		}
	}

	/**
	 * Binds a name in the current scope and reports illegal redeclarations.
	 * @param identifier The `Identifier` node index, or `0`.
	 * @param binding How the name is being introduced.
	 * @returns Nothing.
	 */
	private declare(identifier: number, binding: number): void {
		if (identifier === 0) {
			return;
		}

		const reader = this.reader;

		if (reader.kind(identifier) !== N_Identifier) {
			return;
		}

		const name = reader.text(identifier);
		const start = reader.start(identifier);

		this.checkReservedBinding(name, start);

		if (binding === BINDING_VAR) {
			this.declareVar(name, start);
			return;
		}

		const scope = this.scope;
		const existing = scope.names.get(name);

		if (
			existing !== undefined
				? this.conflicts(existing, binding)
				: scope.varNames.has(name) && !this.tolerantOfVar(binding)
		) {
			this.report(
				`Identifier '${name}' has already been declared.`,
				start,
			);

			return;
		}

		/*
		 * A signature written after the implementation must not erase the
		 * record of the implementation, or a second implementation would go
		 * unreported.
		 */
		if (binding === BINDING_SIGNATURE && existing === BINDING_FUNCTION) {
			return;
		}

		scope.names.set(name, binding);
	}

	/**
	 * Binds a name that climbs to the nearest function scope, recording it in
	 * every scope it passes through so that a lexical declaration written
	 * later in any of them is still caught.
	 * @param name The name being bound.
	 * @param start The offset of the identifier.
	 * @returns Nothing.
	 */
	private declareVar(name: string, start: number): void {
		let scope = this.scope;

		for (;;) {
			const existing = scope.names.get(name);

			if (existing !== undefined && !this.tolerantOfVar(existing)) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					start,
				);

				return;
			}

			scope.varNames.add(name);

			if (scope.isFunctionScope || scope.parent === null) {
				return;
			}

			scope = scope.parent;
		}
	}

	/**
	 * Determines whether a binding may share its scope with a `var` of the
	 * same name.
	 * @param binding How the name was introduced.
	 * @returns `true` when the two may coexist.
	 */
	private tolerantOfVar(binding: number): boolean {
		return binding !== BINDING_LEXICAL && binding !== BINDING_FUNCTION;
	}

	/**
	 * Determines whether two bindings of the same name may coexist.
	 * @param existing How the name was first introduced.
	 * @param incoming How the name is being introduced now.
	 * @returns `true` when the pair is an illegal redeclaration.
	 */
	private conflicts(existing: number, incoming: number): boolean {
		// Types may merge freely with each other and with values.
		if (existing === BINDING_TYPE || incoming === BINDING_TYPE) {
			return false;
		}

		if (existing === BINDING_PARAM && incoming === BINDING_PARAM) {
			return this.uniqueParams;
		}

		/*
		 * Overload signatures merge with each other and with the
		 * implementation they belong to, so only two implementations of the
		 * same name are a redeclaration — and then only where a function
		 * declaration binds lexically, since two of them in a function scope
		 * are as legal as two `var`s.
		 */
		if (
			(existing === BINDING_FUNCTION || existing === BINDING_SIGNATURE) &&
			(incoming === BINDING_FUNCTION || incoming === BINDING_SIGNATURE)
		) {
			return (
				this.strict &&
				existing === BINDING_FUNCTION &&
				incoming === BINDING_FUNCTION
			);
		}

		return true;
	}

	/**
	 * Reports names that may not be bound under the current rules.
	 * @param name The name being bound.
	 * @param start The offset of the identifier.
	 * @returns Nothing.
	 */
	private checkReservedBinding(name: string, start: number): void {
		let hash = 0;

		for (let i = 0; i < name.length; i++) {
			hash = hashChar(hash, name.charCodeAt(i));
		}

		const kind = lookupKeyword(name, 0, name.length, hash);

		if (kind < KEYWORD_FIRST || kind > KEYWORD_LAST) {
			return;
		}

		if (this.strict && (KIND_KEYWORD_FLAGS[kind] & KW_STRICT_RESERVED) !== 0) {
			this.report(
				`Unexpected reserved word '${name}' in strict mode.`,
				start,
			);

			return;
		}

		if (name === "await" && this.sourceType === "module") {
			this.report(
				"'await' cannot be used as an identifier in a module.",
				start,
			);
		}
	}

	//-------------------------------------------------------------------------
	// JSX
	//-------------------------------------------------------------------------

	/**
	 * Reports a JSX element or fragment written where JSX is not enabled.
	 *
	 * `parse()` reads JSX unconditionally, because whether it is allowed is
	 * exactly the kind of question the text alone cannot answer. Only the
	 * outermost element or fragment is reported, so a whole tree costs one
	 * problem rather than one per node.
	 * @param node The `JSXElement` or `JSXFragment` node index.
	 * @returns Nothing.
	 */
	private checkJsxNotAllowed(node: number): void {
		if (!this.jsx && !this.inJsx) {
			this.report(
				"JSX syntax is not allowed unless the jsx option is enabled.",
				this.reader.start(node),
			);
		}
	}

	/**
	 * Reports a closing tag whose name does not match its opening tag.
	 *
	 * A mismatched pair still forms a well-shaped tree, so it is reported here
	 * rather than thrown during parsing.
	 * @param node The `JSXElement` node index.
	 * @returns Nothing.
	 */
	private checkJsxTagsMatch(node: number): void {
		const reader = this.reader;
		const closing = reader.field(node, NODE_B);

		if (closing === 0) {
			return;
		}

		const opening = reader.field(node, NODE_A);
		const openingName = this.jsxTagName(reader.field(opening, NODE_A));
		const closingName = this.jsxTagName(reader.field(closing, NODE_A));

		if (openingName !== closingName) {
			this.report(
				`JSX element <${openingName}> is closed by </${closingName}>.`,
				reader.start(closing),
			);
		}
	}

	/**
	 * Reads a JSX tag name with its internal whitespace removed, so that
	 * `<A.B>` and `</A . B>` compare equal.
	 * @param name The name node index.
	 * @returns The tag name as written, without whitespace.
	 */
	private jsxTagName(name: number): string {
		return name === 0 ? "" : this.reader.text(name).replace(/\s+/gu, "");
	}

	//-------------------------------------------------------------------------
	// Private Names
	//-------------------------------------------------------------------------

	/*
	 * A `#x` is not a property name but a binding, and the thing it binds in is
	 * the class body — one private environment per class, nested inside the
	 * environments of any enclosing classes. A reference resolves against that
	 * whole stack, which is what lets an inner class reach an outer class's
	 * `#x`, and what makes a reference with no class around it an error.
	 *
	 * Two things make this unlike the ordinary scope walk. A class may refer to
	 * a name declared *later* in its own body, so every name has to be
	 * collected before any member is visited. And the heritage clause is
	 * outside its own class's environment — `class C extends this.#x { #x; }`
	 * does not resolve — which is why `extends` is visited before the push.
	 */

	/**
	 * Collects the private names a class body declares, reporting the ones it
	 * may not declare twice.
	 *
	 * A name may appear twice only as a getter/setter pair on the same side of
	 * `static`, so what is remembered per name is enough to tell that pair from
	 * every other repeat.
	 * @param body The `ClassBody` node index.
	 * @returns The names it declares.
	 */
	private collectPrivateNames(body: number): Set<string> {
		const reader = this.reader;
		const members = reader.field(body, NODE_A);
		const size = reader.listSize(members);
		const names = new Set<string>();

		/** What has been seen for a name so far, to allow one getter/setter pair. */
		const seen = new Map<string, number>();

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(members, i);
			const key = reader.field(member, NODE_A);

			if (
				key === 0 ||
				reader.kind(key) !== N_PrivateIdentifier ||
				(reader.flags(member) & NF_COMPUTED) !== 0
			) {
				continue;
			}

			const name = this.privateName(key);

			if (name === "#constructor") {
				this.report(
					"Classes may not have a private element named '#constructor'.",
					reader.start(key),
				);
				continue;
			}

			names.add(name);

			/*
			 * A getter and a setter pair up only with each other. Encoding the
			 * accessor kind and the `static` side in one number makes "have I
			 * already seen something this cannot sit beside?" a single lookup.
			 */
			const flags = reader.flags(member);
			const accessor = (flags & MKIND_MASK) >>> MKIND_SHIFT;
			const isStatic = (flags & NF_STATIC) !== 0;
			const descriptor =
				accessor === MKIND_GET || accessor === MKIND_SET
					? accessor | (isStatic ? 4 : 0)
					: -1;
			const previous = seen.get(name);

			if (previous === undefined) {
				seen.set(name, descriptor);
				continue;
			}

			const pairs =
				descriptor >= 0 &&
				previous >= 0 &&
				(descriptor & 4) === (previous & 4) &&
				(descriptor & 3) !== (previous & 3);

			if (!pairs) {
				this.report(
					`Identifier '${name}' has already been declared.`,
					reader.start(key),
				);
				continue;
			}

			// A completed pair may not take a third member.
			seen.set(name, -1);
		}

		return names;
	}

	/**
	 * Reads a private name, resolving any escapes in it.
	 *
	 * Two private names are the same name when their `StringValue`s match, and
	 * `StringValue` is what the escapes mean rather than how they are spelled —
	 * `#℘` declares the same field `#℘` refers to. Comparing source text
	 * would report every escaped name as undeclared.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns The name, `#` included.
	 */
	private privateName(key: number): string {
		const raw = this.reader.text(key);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Determines whether an expression reads a private field.
	 *
	 * Parentheses and an optional chain both wrap the member access without
	 * changing what is being deleted, so `delete (o?.#x)` has to be seen
	 * through to be reported.
	 * @param node The expression node index.
	 * @returns `true` when the expression is a private reference.
	 */
	private isPrivateReference(node: number): boolean {
		const reader = this.reader;
		let current = node;

		while (reader.kind(current) === N_ChainExpression) {
			current = reader.field(current, NODE_A);

			if (current === 0) {
				return false;
			}
		}

		if (reader.kind(current) !== N_MemberExpression) {
			return false;
		}

		const property = reader.field(current, NODE_B);

		return (
			property !== 0 && reader.kind(property) === N_PrivateIdentifier
		);
	}

	/**
	 * Reports a private name that no enclosing class declares.
	 * @param key The `PrivateIdentifier` node index.
	 * @returns Nothing.
	 */
	private checkPrivateReference(key: number): void {
		const name = this.privateName(key);

		for (let i = this.privateNames.length - 1; i >= 0; i--) {
			if (this.privateNames[i].has(name)) {
				return;
			}
		}

		this.report(
			`Private field '${name}' must be declared in an enclosing class.`,
			this.reader.start(key),
		);
	}

	//-------------------------------------------------------------------------
	// Assignment Targets
	//-------------------------------------------------------------------------

	/*
	 * The spec calls this a node's `AssignmentTargetType`, and it is `simple`
	 * for exactly two things: a reference to a name, and a member access.
	 * Everything else is `invalid`, and assigning to it, incrementing it, or
	 * naming it in a `for-in`/`for-of` head is an early error.
	 *
	 * Destructuring widens that for `=` alone. `[a, b] = c` assigns through a
	 * pattern, so a pattern is allowed on the left of a plain assignment and
	 * of a `for-of` head, and each of its elements is then a target in its own
	 * right. It is *not* allowed on the left of `+=`, which has nothing to
	 * destructure.
	 *
	 * The parser has already done the hard half: it rewrites the left of a
	 * plain assignment into `ArrayPattern` and `ObjectPattern` where that
	 * reading works, so a bare `ArrayExpression` surviving to here is one that
	 * could not be reinterpreted.
	 */

	/**
	 * Reports an expression being assigned to that cannot be.
	 * @param node The target node index, or `0`.
	 * @param pattern Whether a destructuring pattern is allowed here, which it
	 *      is for `=` and a `for-of` head but not for `+=` or `++`.
	 * @returns Nothing.
	 */
	private checkAssignmentTarget(node: number, pattern: boolean): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;

		switch (reader.kind(node)) {
			case N_Identifier:
			case N_MemberExpression:
				return;

			/*
			 * A TypeScript wrapper is transparent here. `x! = 1` and
			 * `(x as T) = 1` are the parser's shape for an assignment to `x`,
			 * and `@typescript-eslint/parser` accepts both, so looking through
			 * keeps this from reporting real TypeScript.
			 */
			case N_TSNonNullExpression:
			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
			case N_TSTypeAssertion:
				this.checkAssignmentTarget(reader.field(node, NODE_A), pattern);
				return;

			case N_ArrayPattern:
				if (pattern) {
					this.checkArrayPattern(node);
					return;
				}

				break;

			case N_ObjectPattern:
				if (pattern) {
					this.checkObjectPattern(node);
					return;
				}

				break;

			/*
			 * `f() = 1` is an early error in strict code and, for web
			 * compatibility, only a runtime `ReferenceError` in sloppy code —
			 * the spec spells the sloppy answer `~web-compat~` rather than
			 * `~invalid~`. `espree` reports it either way, which is the one
			 * deviation this check carries; see `docs/deviations.md`.
			 */
			case N_CallExpression:
				if (!this.strict) {
					return;
				}

				break;

			/*
			 * An optional chain is never a target: `a?.b = c` is an error even
			 * though `a.b = c` is fine, because the chain may produce
			 * `undefined` and there would be nothing to assign to.
			 */
			default:
				break;
		}

		this.report(
			"Invalid assignment target.",
			reader.start(node),
		);
	}

	/**
	 * Checks the elements of an array destructuring pattern.
	 *
	 * A rest element has to come last and take no default, since there is
	 * nothing after it to collect and nothing to be absent.
	 * @param node The `ArrayPattern` node index.
	 * @returns Nothing.
	 */
	private checkArrayPattern(node: number): void {
		const reader = this.reader;
		const elements = reader.field(node, NODE_A);
		const size = reader.listSize(elements);

		for (let i = 0; i < size; i++) {
			const element = reader.listItem(elements, i);

			// A hole is written as a missing element and targets nothing.
			if (element === 0) {
				continue;
			}

			if (reader.kind(element) !== N_RestElement) {
				this.checkPatternElement(element);
				continue;
			}

			if (i !== size - 1) {
				this.report(
					"A rest element must be the last element.",
					reader.start(element),
				);
			}

			this.checkRestTarget(element);
		}
	}

	/**
	 * Checks the properties of an object destructuring pattern.
	 * @param node The `ObjectPattern` node index.
	 * @returns Nothing.
	 */
	private checkObjectPattern(node: number): void {
		const reader = this.reader;
		const properties = reader.field(node, NODE_A);
		const size = reader.listSize(properties);

		for (let i = 0; i < size; i++) {
			const property = reader.listItem(properties, i);

			if (reader.kind(property) === N_RestElement) {
				if (i !== size - 1) {
					this.report(
						"A rest element must be the last element.",
						reader.start(property),
					);
				}

				this.checkRestTarget(property);
				continue;
			}

			this.checkPatternElement(reader.field(property, NODE_B));
		}
	}

	/**
	 * Checks one element of a pattern, seeing past its default.
	 * @param node The element node index, or `0`.
	 * @returns Nothing.
	 */
	private checkPatternElement(node: number): void {
		if (node === 0) {
			return;
		}

		this.checkAssignmentTarget(
			this.reader.kind(node) === N_AssignmentPattern
				? this.reader.field(node, NODE_A)
				: node,
			true,
		);
	}

	/**
	 * Checks what a rest element collects into.
	 * @param node The `RestElement` node index.
	 * @returns Nothing.
	 */
	private checkRestTarget(node: number): void {
		const target = this.reader.field(node, NODE_A);

		if (target !== 0 && this.reader.kind(target) === N_AssignmentPattern) {
			this.report(
				"A rest element cannot have an initializer.",
				this.reader.start(target),
			);

			return;
		}

		this.checkAssignmentTarget(target, true);
	}

	//-------------------------------------------------------------------------
	// Node Checks
	//-------------------------------------------------------------------------

	/**
	 * Applies the checks that belong to a single node.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private check(node: number, kind: number): void {
		if (this.dialect === "js" && kind >= TS_FIRST) {
			this.report(
				`TypeScript syntax is not allowed when the dialect is "js".`,
				this.reader.start(node),
			);
		}

		switch (kind) {
			case N_ImportDeclaration:
			case N_ExportNamedDeclaration:
			case N_ExportDefaultDeclaration:
			case N_ExportAllDeclaration:
				if (this.sourceType !== "module") {
					this.report(
						"'import' and 'export' may only appear when sourceType is \"module\".",
						this.reader.start(node),
					);
				}

				return;

			case N_WithStatement:
				if (this.strict) {
					this.report(
						"Strict mode code may not include a with statement.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * The two places a private name is *used*: `o.#x`, and the
			 * `#x in o` form that exists to ask whether an object has one
			 * without throwing.
			 */
			case N_MemberExpression: {
				const property = this.reader.field(node, NODE_B);

				if (
					property !== 0 &&
					this.reader.kind(property) === N_PrivateIdentifier
				) {
					this.checkPrivateReference(property);
				}

				return;
			}

			case N_BinaryExpression: {
				const left = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_C) === T_in &&
					left !== 0 &&
					this.reader.kind(left) === N_PrivateIdentifier
				) {
					this.checkPrivateReference(left);
				}

				return;
			}

			/*
			 * `delete o.#x` is an early error however the reference is
			 * written, because a private field cannot be removed.
			 */
			case N_UnaryExpression: {
				const argument = this.reader.field(node, NODE_A);

				if (
					this.reader.field(node, NODE_B) === T_delete &&
					argument !== 0 &&
					this.isPrivateReference(argument)
				) {
					this.report(
						"Private fields cannot be deleted.",
						this.reader.start(node),
					);
				}

				return;
			}

			case N_AssignmentExpression:
				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					this.reader.field(node, NODE_C) === T_ASSIGN,
				);
				return;

			case N_UpdateExpression:
				this.checkAssignmentTarget(
					this.reader.field(node, NODE_A),
					false,
				);
				return;

			/*
			 * A `for` head either declares its binding, in which case the
			 * declaration is what is checked, or assigns to an existing
			 * target. `for-in` takes a pattern too — `for ([a, b] in c)` is
			 * legal, if odd.
			 */
			case N_ForInStatement:
			case N_ForOfStatement: {
				const left = this.reader.field(node, NODE_A);

				if (
					left !== 0 &&
					this.reader.kind(left) !== N_VariableDeclaration
				) {
					this.checkAssignmentTarget(left, true);
				}

				return;
			}

			/*
			 * The pattern between the slashes. `parse()` found where the
			 * literal ends, which is all the lexical grammar covers; whether
			 * the text in between is a pattern at all is an early error on the
			 * literal, and so belongs here.
			 */
			case N_Literal: {
				if (this.reader.field(node, NODE_A) !== LIT_REGEXP) {
					return;
				}

				this.regexp ??= new RegExpValidator();

				const problem = this.regexp.validate(
					this.reader.source,
					this.reader.start(node),
					this.reader.field(node, NODE_B),
					this.reader.end(node),
				);

				if (problem !== null) {
					this.report(problem.message, problem.start);
				}

				return;
			}

			case N_JSXElement:
				this.checkJsxNotAllowed(node);
				this.checkJsxTagsMatch(node);
				return;

			case N_JSXFragment:
				this.checkJsxNotAllowed(node);
				return;

			case N_ReturnStatement:
				if (this.functionDepth === 0) {
					this.report(
						"'return' outside of function.",
						this.reader.start(node),
					);
				}

				return;

			/*
			 * Top-level `await` is not checked here. Whether `await` is an
			 * operator at all is settled in `parse()`, which is told the
			 * source type: in a script it is an ordinary name, so no
			 * `AwaitExpression` can reach the top level of one to be
			 * complained about.
			 */

			case N_Program:
			case N_VariableDeclarator:
			case N_VariableDeclaration:
			default:
				return;
		}
	}
}

/** Re-exported for callers that want the node constant. */
export { N_Program };
