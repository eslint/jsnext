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
	N_JSXElement,
	N_ObjectPattern,
	N_Program,
	N_Property,
	N_RestElement,
	N_ReturnStatement,
	N_StaticBlock,
	N_SwitchCase,
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

/** How a binding was introduced, which decides what may shadow it. */
const BINDING_VAR = 0;
const BINDING_LEXICAL = 1;
const BINDING_FUNCTION = 2;
const BINDING_PARAM = 3;
const BINDING_TYPE = 4;

/**
 * One lexical scope's bindings.
 */
interface Scope {
	/** Names bound in this scope, mapped to how they were introduced. */
	names: Map<string, number>;

	/** Whether this scope is a function or program scope. */
	isFunctionScope: boolean;

	/** The enclosing scope, or `null` for the program scope. */
	parent: Scope | null;
}

/**
 * Walks a parsed program and reports context-dependent problems.
 * @param reader The reader over the AST buffer.
 * @param tokens The reader over the token buffer.
 * @param sourceType How the program should be interpreted.
 * @param dialect Whether TypeScript syntax is allowed.
 * @returns Every problem found, in the order they were encountered.
 */
export function validateAst(
	reader: AstReader,
	tokens: TokenReader,
	sourceType: "script" | "module" | "commonjs",
	dialect: "js" | "ts",
): ValidationProblem[] {
	const validator = new Validator(reader, tokens, sourceType, dialect);

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

	/** Whether strict mode rules currently apply. */
	private strict: boolean;

	/** Depth of enclosing functions; `0` means top level. */
	private functionDepth = 0;

	/** The innermost scope. */
	private scope: Scope;

	/**
	 * Creates a validator.
	 * @param reader The reader over the AST buffer.
	 * @param tokens The reader over the token buffer.
	 * @param sourceType How the program should be interpreted.
	 * @param dialect Whether TypeScript syntax is allowed.
	 */
	constructor(
		reader: AstReader,
		tokens: TokenReader,
		sourceType: "script" | "module" | "commonjs",
		dialect: "js" | "ts",
	) {
		this.reader = reader;
		this.tokens = tokens;
		this.sourceType = sourceType;
		this.dialect = dialect;
		this.strict = sourceType === "module";
		this.scope = {
			names: new Map(),
			isFunctionScope: true,
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
			case N_StaticBlock:
			case N_TSModuleBlock:
			case N_SwitchCase:
				this.enterScope(false);
				this.hoist(
					reader.field(node, kind === N_SwitchCase ? NODE_B : NODE_A),
				);
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			case N_ForStatement:
			case N_ForInStatement:
			case N_ForOfStatement:
				this.enterScope(false);
				this.visitChildren(node, kind);
				this.exitScope();
				return;

			case N_CatchClause: {
				this.enterScope(false);
				this.declarePattern(
					reader.field(node, NODE_A),
					BINDING_LEXICAL,
				);
				this.visitChildren(node, kind);
				this.exitScope();
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
			isFunctionScope,
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
					this.declareVariableDeclaration(statement);
					break;

				case N_FunctionDeclaration:
				case N_TSDeclareFunction:
					this.declare(
						reader.field(statement, NODE_A),
						BINDING_FUNCTION,
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
	 * @returns Nothing.
	 */
	private declareVariableDeclaration(node: number): void {
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

		this.checkReservedBinding(name, reader.start(identifier));

		/*
		 * `var` climbs to the nearest function scope; everything else binds
		 * where it is written.
		 */
		let scope = this.scope;

		if (binding === BINDING_VAR) {
			while (!scope.isFunctionScope && scope.parent !== null) {
				const existing = scope.names.get(name);

				if (existing === BINDING_LEXICAL) {
					this.report(
						`Identifier '${name}' has already been declared.`,
						reader.start(identifier),
					);

					return;
				}

				scope = scope.parent;
			}
		}

		const existing = scope.names.get(name);

		if (existing !== undefined && this.conflicts(existing, binding)) {
			this.report(
				`Identifier '${name}' has already been declared.`,
				reader.start(identifier),
			);

			return;
		}

		scope.names.set(name, binding);
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

		// Repeated `var` declarations of the same name are allowed.
		if (existing === BINDING_VAR && incoming === BINDING_VAR) {
			return false;
		}

		if (existing === BINDING_PARAM && incoming === BINDING_VAR) {
			return false;
		}

		if (existing === BINDING_PARAM && incoming === BINDING_PARAM) {
			return this.strict;
		}

		if (existing === BINDING_FUNCTION && incoming === BINDING_FUNCTION) {
			return this.strict;
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
				this.checkJsxTagsMatch(node);
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
