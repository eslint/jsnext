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
	DECL_CONST,
	DECL_MASK,
	DECL_SHIFT,
	DECL_VAR,
	NODE_A,
	NODE_B,
	NODE_C,
	TS_FIRST,
	N_ArrayPattern,
	N_AssignmentPattern,
	N_AwaitExpression,
	N_BlockStatement,
	N_CatchClause,
	N_ClassDeclaration,
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
	N_WithStatement,
} from "./node-kinds.js";
import { AstReader, TokenReader } from "./reader.js";
import { SLOT_COUNT, SLOT_LIST, SLOT_NODE, SLOT_TABLE } from "./slots.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KIND_KEYWORD_FLAGS,
	KW_STRICT_RESERVED,
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
		const body = reader.field(node, NODE_C);

		this.functionDepth++;
		this.enterScope(true);

		if (
			!this.strict &&
			body !== 0 &&
			reader.kind(body) === N_BlockStatement &&
			this.hasUseStrictDirective(body)
		) {
			this.strict = true;
		}

		const params = reader.field(node, NODE_B);
		const size = reader.listSize(params);

		for (let i = 0; i < size; i++) {
			this.declarePattern(reader.listItem(params, i), BINDING_PARAM);
		}

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
			return this.strict;
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

			case N_AwaitExpression:
				if (
					this.functionDepth === 0 &&
					this.sourceType !== "module"
				) {
					this.report(
						"Top-level 'await' is only allowed when sourceType is \"module\".",
						this.reader.start(node),
					);
				}

				return;

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
