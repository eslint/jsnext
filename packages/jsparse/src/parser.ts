/**
 * @fileoverview The statement, declaration, and module grammar, plus the
 * top-level entry point that assembles the binary buffers.
 */

import {
	DECL_AWAIT_USING,
	DECL_CONST,
	DECL_LET,
	DECL_SHIFT,
	DECL_USING,
	DECL_VAR,
	MODULE_KIND_SHIFT,
	MODULE_GLOBAL,
	MODULE_MODULE,
	MODULE_NAMESPACE,
	NF_ABSTRACT,
	NF_ASYNC,
	NF_COMPUTED,
	LIT_STRING,
	NF_CONST,
	NF_DECLARE,
	NF_DEFINITE,
	NF_GENERATOR,
	NF_TYPE_ONLY,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_G,
	NODE_FLAGS,
	NODE_KIND,
	NODE_START,
	N_BlockStatement,
	N_BreakStatement,
	N_CatchClause,
	N_ClassDeclaration,
	N_ContinueStatement,
	N_DebuggerStatement,
	N_DoWhileStatement,
	N_EmptyStatement,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ExportSpecifier,
	N_ExpressionStatement,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_IfStatement,
	N_ImportAttribute,
	N_ImportDeclaration,
	N_ImportDefaultSpecifier,
	N_ImportNamespaceSpecifier,
	N_ImportSpecifier,
	N_Identifier,
	N_LabeledStatement,
	N_Literal,
	N_Program,
	N_ReturnStatement,
	N_SwitchCase,
	N_SwitchStatement,
	N_TSDeclareFunction,
	N_TSEnumBody,
	N_TSEnumDeclaration,
	N_TSEnumMember,
	N_TSExportAssignment,
	N_TSExternalModuleReference,
	N_TSImportEqualsDeclaration,
	N_TSInterfaceBody,
	N_TSInterfaceDeclaration,
	N_TSInterfaceHeritage,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSNamespaceExportDeclaration,
	N_TSTypeAliasDeclaration,
	N_ThrowStatement,
	N_TryStatement,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_WithStatement,
} from "./node-kinds.js";
import { JsxParser } from "./parser-jsx.js";
import {
	T_ASSIGN,
	T_AT,
	T_BRACE_CLOSE,
	T_BRACE_OPEN,
	T_BRACKET_OPEN,
	T_COLON,
	T_COMMA,
	T_DOT,
	T_EOF,
	T_LT,
	T_NOT,
	T_PAREN_CLOSE,
	T_PAREN_OPEN,
	T_SEMICOLON,
	T_STAR,
	T_STRING,
	T_abstract,
	T_as,
	T_assert,
	T_async,
	T_await,
	T_break,
	T_case,
	T_catch,
	T_class,
	T_const,
	T_continue,
	T_debugger,
	T_declare,
	T_default,
	T_do,
	T_else,
	T_enum,
	T_export,
	T_extends,
	T_finally,
	T_for,
	T_from,
	T_function,
	T_global,
	T_if,
	T_import,
	T_in,
	T_interface,
	T_let,
	T_module,
	T_namespace,
	T_of,
	T_require,
	T_return,
	T_switch,
	T_throw,
	T_try,
	T_type,
	T_using,
	T_var,
	T_while,
	T_with,
	isIdentifierNameKind,
} from "./token-kinds.js";

/**
 * The complete parser.
 */
export class Parser extends JsxParser {
	//-------------------------------------------------------------------------
	// Program
	//-------------------------------------------------------------------------

	/**
	 * Parses the whole source text.
	 * @returns The index of the `Program` node.
	 * @throws {ParseError} When the source cannot be parsed.
	 */
	parseProgram(): number {
		const node = this.writer.alloc(N_Program, 0);
		const mark = this.writer.startList();

		/*
		 * Where the first token begins, which is not always where the first
		 * statement begins: decorators written before an `export` sit outside
		 * the node they decorate, so `@dec export class C {}` starts its
		 * program at the `@` and its export at the `export`.
		 */
		const firstTokenStart = this.start;

		this.parseStatementList(T_EOF);

		/*
		 * A program spans its statements, not the whole file: leading trivia
		 * and trailing comments sit outside it. An empty program keeps the
		 * whole text so that its range is never inverted.
		 */
		const size = this.writer.listSize(mark);
		const start = size === 0 ? 0 : firstTokenStart;
		const end = size === 0 ? this.source.length : this.lastEnd;

		this.writer.set(node, NODE_START, start);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, end);
	}

	/**
	 * Parses statements until a closing token, marking the directive prologue
	 * as it goes.
	 * @param terminator The token kind that ends the list.
	 * @returns Nothing.
	 */
	private parseStatementList(terminator: number): void {
		let inPrologue = true;

		while (!this.at(terminator) && !this.at(T_EOF)) {
			const statement = this.parseStatement();

			if (inPrologue) {
				if (this.isDirective(statement)) {
					this.writer.set(statement, NODE_B, 1);
				} else {
					inPrologue = false;
				}
			}

			this.writer.pushList(statement);
		}
	}

	/**
	 * Determines whether a statement belongs to a directive prologue.
	 * @param statement The statement node to test.
	 * @returns `true` when the statement is a bare string literal.
	 */
	private isDirective(statement: number): boolean {
		if (this.writer.get(statement, NODE_KIND) !== N_ExpressionStatement) {
			return false;
		}

		const expression = this.writer.get(statement, NODE_A);

		if (this.writer.get(expression, NODE_KIND) !== N_Literal) {
			return false;
		}

		/*
		 * Only a string literal is a directive. Without the subtype check a
		 * number in the same position would be marked as one, and `toAST()`
		 * would report the text between its first and last character as the
		 * directive it states.
		 */
		return this.writer.get(expression, NODE_A) === LIT_STRING;
	}

	//-------------------------------------------------------------------------
	// Statements
	//-------------------------------------------------------------------------

	/**
	 * Parses a single statement or declaration.
	 * @returns The index of the statement node.
	 * @throws {ParseError} When no statement can start here.
	 */
	parseStatement(single = false): number {
		const start = this.start;

		switch (this.kind) {
			case T_BRACE_OPEN:
				return this.parseBlock();

			case T_SEMICOLON: {
				const node = this.writer.alloc(N_EmptyStatement, start);
				const end = this.end;

				this.next();

				return this.writer.finish(node, end);
			}

			case T_var:
				return this.parseVariableStatement(DECL_VAR);

			case T_const:
				if (this.nextIs(T_enum)) {
					this.next();

					return this.parseEnumDeclaration(start, NF_CONST);
				}

				return this.parseVariableStatement(DECL_CONST);

			case T_let:
				/*
				 * A single-statement position takes no declaration, so `let`
				 * written there is an ordinary identifier and the rest of the
				 * line is an expression: `if (x) let` followed by a newline
				 * is `let;`, and automatic semicolon insertion carries the
				 * next line away on its own.
				 *
				 * A `[` is the exception, because `ExpressionStatement` may
				 * not begin with `let [` — with the expression reading ruled
				 * out, the declaration is all that is left, and `validate()`
				 * reports it as one.
				 */
				if (
					this.nextStartsBinding() &&
					(!single || this.nextIs(T_BRACKET_OPEN))
				) {
					return this.parseVariableStatement(DECL_LET);
				}

				break;

			case T_using:
				if (this.usingStartsBinding()) {
					return this.parseVariableStatement(DECL_USING);
				}

				break;

			case T_function:
				return this.parseFunctionDeclaration(start, false, 0);

			case T_class:
				return this.parseClass(N_ClassDeclaration, 0);

			case T_AT: {
				const decorators = this.parseDecorators();

				/*
				 * Decorators may sit on either side of `export`. Written
				 * before it they belong to the class all the same, but they
				 * widen neither the export nor the class, which is why they
				 * are attached after both have been parsed.
				 */
				if (this.at(T_export)) {
					return this.parseDecoratedExport(decorators);
				}

				return this.parseDecoratedClass(decorators, start);
			}

			case T_if:
				return this.parseIfStatement();

			case T_for:
				return this.parseForStatement();

			case T_while:
				return this.parseWhileStatement();

			case T_do:
				return this.parseDoWhileStatement();

			case T_switch:
				return this.parseSwitchStatement();

			case T_try:
				return this.parseTryStatement();

			case T_throw:
				return this.parseThrowStatement();

			case T_return:
				return this.parseReturnStatement();

			case T_break:
			case T_continue:
				return this.parseBreakOrContinue();

			case T_with:
				return this.parseWithStatement();

			case T_debugger: {
				const node = this.writer.alloc(N_DebuggerStatement, start);

				this.next();
				this.semicolon();

				return this.writer.finish(node, this.lastEnd);
			}

			case T_import:
				if (this.importIsDeclaration()) {
					return this.parseImportDeclaration();
				}

				break;

			case T_export:
				return this.parseExportDeclaration();

			case T_async:
				if (this.asyncStartsFunction()) {
					this.next();

					return this.parseFunctionDeclaration(start, true, 0);
				}

				break;

			case T_await:
				if (this.awaitStartsUsing()) {
					this.next();

					/*
					 * The `await` has already been consumed, so the
					 * declaration's own start has to be handed down; the
					 * current token is the `using` that follows it.
					 */
					return this.parseVariableStatement(
						DECL_AWAIT_USING,
						start,
					);
				}

				break;

			case T_interface:
				if (this.nextStartsBinding()) {
					return this.parseInterfaceDeclaration(start, 0);
				}

				break;

			case T_type:
				if (this.typeStartsAlias()) {
					return this.parseTypeAliasDeclaration(start, 0);
				}

				break;

			case T_enum:
				return this.parseEnumDeclaration(start, 0);

			case T_declare:
				if (this.declareStartsDeclaration()) {
					return this.parseDeclare(start);
				}

				break;

			case T_abstract:
				if (this.nextIs(T_class, true)) {
					this.next();

					const node = this.parseClass(N_ClassDeclaration, 0, start);

					this.writer.addFlags(node, NF_ABSTRACT);

					return this.writer.finish(node, this.lastEnd);
				}

				break;

			case T_namespace:
			case T_module:
				if (this.nextStartsModuleName()) {
					return this.parseModuleDeclaration(start, 0);
				}

				break;

			case T_global:
				if (this.nextIs(T_BRACE_OPEN)) {
					return this.parseModuleDeclaration(start, 0);
				}

				break;

			default:
				break;
		}

		return this.parseExpressionOrLabeledStatement();
	}

	/**
	 * Parses a brace-delimited block of statements.
	 * @param withDirectives Whether a directive prologue may open the block.
	 * @param isStatement Whether a `/` after the closing brace begins a new
	 *      statement. A function *expression* can be divided —
	 *      `function(){} / 2` — so its body passes `false`; every other block
	 *      ends a statement, after which a `/` opens a regular expression.
	 * @returns The index of the `BlockStatement` node.
	 */
	parseBlock(withDirectives = false, isStatement = true): number {
		const node = this.writer.alloc(N_BlockStatement, this.start);
		const mark = this.writer.startList();

		this.enterBrace(isStatement);

		if (withDirectives) {
			this.parseStatementList(T_BRACE_CLOSE);
		} else {
			while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
				this.writer.pushList(this.parseStatement());
			}
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an expression statement or a labeled statement.
	 * @returns The index of the statement node.
	 */
	private parseExpressionOrLabeledStatement(): number {
		const start = this.start;
		const expression = this.parseExpression();

		if (
			this.at(T_COLON) &&
			this.writer.get(expression, NODE_KIND) === N_Identifier &&
			this.writer.get(expression, NODE_B) === 0
		) {
			const node = this.writer.alloc(N_LabeledStatement, start);

			this.next();
			this.writer.set(node, NODE_A, expression);
			this.writer.set(node, NODE_B, this.parseStatement(true));

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_ExpressionStatement, start);

		this.writer.set(node, NODE_A, expression);
		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a variable statement and its terminating semicolon.
	 * @param declarationKind The packed declaration kind.
	 * @returns The index of the `VariableDeclaration` node.
	 */
	private parseVariableStatement(
		declarationKind: number,
		start: number = this.start,
	): number {
		const node = this.parseVariableDeclaration(declarationKind, start);

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a variable declaration without its terminating semicolon, which
	 * is how the head of a `for` statement uses it.
	 * @param declarationKind The packed declaration kind.
	 * @returns The index of the `VariableDeclaration` node.
	 */
	private parseVariableDeclaration(
		declarationKind: number,
		start: number = this.start,
	): number {
		const node = this.writer.alloc(N_VariableDeclaration, start);
		const mark = this.writer.startList();

		this.writer.addFlags(node, declarationKind << DECL_SHIFT);
		this.next();

		do {
			const declarator = this.writer.alloc(
				N_VariableDeclarator,
				this.start,
			);
			const target = this.parseBindingAtom();

			if (this.at(T_NOT)) {
				this.next();
				this.writer.addFlags(declarator, NF_DEFINITE);
			}

			const annotation = this.tryParseTypeAnnotation();

			if (annotation !== 0) {
				this.writer.set(target, NODE_B, annotation);
				this.writer.finish(target, this.lastEnd);
			}

			this.writer.set(declarator, NODE_A, target);

			if (this.eat(T_ASSIGN)) {
				this.writer.set(
					declarator,
					NODE_B,
					this.parseAssignmentExpression(),
				);
			}

			this.writer.pushList(
				this.writer.finish(declarator, this.lastEnd),
			);
		} while (this.eat(T_COMMA));

		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a function declaration.
	 * @param start The offset at which the declaration begins.
	 * @param isAsync Whether the function was preceded by `async`.
	 * @param flags Extra flags such as `declare`.
	 * @returns The index of the declaration node.
	 */
	private parseFunctionDeclaration(
		start: number,
		isAsync: boolean,
		flags: number,
	): number {
		const node = this.writer.alloc(N_FunctionDeclaration, start);

		this.writer.addFlags(node, flags);
		this.next();

		const isGenerator = this.eat(T_STAR);

		if (isAsync) {
			this.writer.addFlags(node, NF_ASYNC);
		}

		if (isGenerator) {
			this.writer.addFlags(node, NF_GENERATOR);
		}

		if (this.atBindingName()) {
			this.writer.set(node, NODE_A, this.parseIdentifier());
		}

		this.writer.set(node, NODE_D, this.tryParseTypeParameters());
		this.writer.set(
			node,
			NODE_B,
			this.parseParameterList(isAsync, isGenerator),
		);
		this.writer.set(node, NODE_E, this.tryParseTypeAnnotation());

		if (this.at(T_BRACE_OPEN)) {
			this.writer.set(
				node,
				NODE_C,
				this.parseFunctionBody(isAsync, isGenerator, true),
			);
		} else {
			// A body-less function declaration is an overload signature.
			this.writer.retype(node, N_TSDeclareFunction);
			this.semicolon();
		}

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// Control Flow
	//-------------------------------------------------------------------------

	/**
	 * Parses an `if` statement.
	 * @returns The index of the `IfStatement` node.
	 */
	private parseIfStatement(): number {
		const node = this.writer.alloc(N_IfStatement, this.start);

		this.next();
		this.enterStatementParen();
		this.writer.set(node, NODE_A, this.parseExpression());
		this.expect(T_PAREN_CLOSE);
		this.writer.set(node, NODE_B, this.parseStatement(true));

		if (this.eat(T_else)) {
			this.writer.set(node, NODE_C, this.parseStatement(true));
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `while` statement.
	 * @returns The index of the `WhileStatement` node.
	 */
	private parseWhileStatement(): number {
		const node = this.writer.alloc(N_WhileStatement, this.start);

		this.next();
		this.enterStatementParen();
		this.writer.set(node, NODE_A, this.parseExpression());
		this.expect(T_PAREN_CLOSE);
		this.writer.set(node, NODE_B, this.parseStatement(true));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `do ... while` statement.
	 * @returns The index of the `DoWhileStatement` node.
	 */
	private parseDoWhileStatement(): number {
		const node = this.writer.alloc(N_DoWhileStatement, this.start);

		this.next();
		this.writer.set(node, NODE_A, this.parseStatement(true));
		this.expect(T_while);
		this.enterStatementParen();
		this.writer.set(node, NODE_B, this.parseExpression());
		this.expect(T_PAREN_CLOSE);
		this.eat(T_SEMICOLON);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses every form of `for` statement.
	 * @returns The index of the loop node.
	 * @throws {ParseError} When the loop head is malformed.
	 */
	private parseForStatement(): number {
		const start = this.start;

		this.next();

		const isAwait = this.eat(T_await);

		this.enterStatementParen();

		// `for (;` has no initializer at all.
		if (this.at(T_SEMICOLON)) {
			return this.finishClassicFor(start, 0);
		}

		const declarationKind = this.declarationKindAtForHead();
		let init: number;

		if (declarationKind >= 0) {
			const previousAllowIn = this.allowIn;

			this.allowIn = false;

			const declarationStart = this.start;

			if (declarationKind === DECL_AWAIT_USING) {
				this.next();
			}

			init = this.parseVariableDeclaration(
				declarationKind,
				declarationStart,
			);
			this.allowIn = previousAllowIn;
		} else {
			const previousAllowIn = this.allowIn;

			this.allowIn = false;
			init = this.parseExpression();
			this.allowIn = previousAllowIn;
		}

		if (this.at(T_in) || this.at(T_of)) {
			const isOf = this.at(T_of);
			const node = this.writer.alloc(
				isOf ? N_ForOfStatement : N_ForInStatement,
				start,
			);

			if (declarationKind < 0) {
				this.toPattern(init);
			}

			this.next();
			this.writer.set(node, NODE_A, init);
			this.writer.set(
				node,
				NODE_B,
				isOf ? this.parseAssignmentExpression() : this.parseExpression(),
			);
			this.expect(T_PAREN_CLOSE);
			this.writer.set(node, NODE_C, this.parseStatement(true));

			if (isAwait) {
				this.writer.addFlags(node, NF_ASYNC);
			}

			return this.writer.finish(node, this.lastEnd);
		}

		return this.finishClassicFor(start, init);
	}

	/**
	 * Finishes a three-part `for` statement once its initializer is known.
	 * @param start The offset at which the loop begins.
	 * @param init The initializer node, or `0` when there is none.
	 * @returns The index of the `ForStatement` node.
	 */
	private finishClassicFor(start: number, init: number): number {
		const node = this.writer.alloc(N_ForStatement, start);

		this.writer.set(node, NODE_A, init);
		this.expect(T_SEMICOLON);

		if (!this.at(T_SEMICOLON)) {
			this.writer.set(node, NODE_B, this.parseExpression());
		}

		this.expect(T_SEMICOLON);

		if (!this.at(T_PAREN_CLOSE)) {
			this.writer.set(node, NODE_C, this.parseExpression());
		}

		this.expect(T_PAREN_CLOSE);
		this.writer.set(node, NODE_D, this.parseStatement(true));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines which kind of declaration, if any, opens a `for` head.
	 * @returns The packed declaration kind, or `-1` for an expression head.
	 */
	private declarationKindAtForHead(): number {
		switch (this.kind) {
			case T_var:
				return DECL_VAR;

			case T_const:
				return DECL_CONST;

			case T_let:
				return this.nextStartsBinding() ? DECL_LET : -1;

			case T_using:
				return this.usingStartsBinding() ? DECL_USING : -1;

			case T_await:
				return this.awaitStartsUsing() ? DECL_AWAIT_USING : -1;

			default:
				return -1;
		}
	}

	/**
	 * Parses a `switch` statement.
	 * @returns The index of the `SwitchStatement` node.
	 */
	private parseSwitchStatement(): number {
		const node = this.writer.alloc(N_SwitchStatement, this.start);

		this.next();
		this.enterStatementParen();
		this.writer.set(node, NODE_A, this.parseExpression());
		this.expect(T_PAREN_CLOSE);

		const mark = this.writer.startList();

		this.enterBrace(true);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			const clause = this.writer.alloc(N_SwitchCase, this.start);

			if (this.eat(T_case)) {
				this.writer.set(clause, NODE_A, this.parseExpression());
			} else {
				this.expect(T_default);
			}

			this.expect(T_COLON);

			const body = this.writer.startList();

			while (
				!this.at(T_case) &&
				!this.at(T_default) &&
				!this.at(T_BRACE_CLOSE) &&
				!this.at(T_EOF)
			) {
				this.writer.pushList(this.parseStatement());
			}

			this.writer.set(clause, NODE_B, this.writer.endList(body));
			this.writer.pushList(this.writer.finish(clause, this.lastEnd));
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(node, NODE_B, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `try` statement.
	 * @returns The index of the `TryStatement` node.
	 * @throws {ParseError} When neither `catch` nor `finally` is present.
	 */
	private parseTryStatement(): number {
		const node = this.writer.alloc(N_TryStatement, this.start);

		this.next();
		this.writer.set(node, NODE_A, this.parseBlock());

		if (this.at(T_catch)) {
			const handler = this.writer.alloc(N_CatchClause, this.start);

			this.next();

			if (this.eat(T_PAREN_OPEN)) {
				const parameter = this.parseBindingAtom();
				const annotation = this.tryParseTypeAnnotation();

				if (annotation !== 0) {
					this.writer.set(parameter, NODE_B, annotation);
					this.writer.finish(parameter, this.lastEnd);
				}

				this.writer.set(handler, NODE_A, parameter);
				this.expect(T_PAREN_CLOSE);
			}

			this.writer.set(handler, NODE_B, this.parseBlock());
			this.writer.set(
				node,
				NODE_B,
				this.writer.finish(handler, this.lastEnd),
			);
		}

		if (this.eat(T_finally)) {
			this.writer.set(node, NODE_C, this.parseBlock());
		}

		if (
			this.writer.get(node, NODE_B) === 0 &&
			this.writer.get(node, NODE_C) === 0
		) {
			throw this.error("Missing catch or finally clause");
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `throw` statement.
	 * @returns The index of the `ThrowStatement` node.
	 * @throws {ParseError} When a line break follows `throw`.
	 */
	private parseThrowStatement(): number {
		const node = this.writer.alloc(N_ThrowStatement, this.start);

		this.next();

		if (this.newlineBefore) {
			throw this.error("Illegal newline after throw");
		}

		this.writer.set(node, NODE_A, this.parseExpression());
		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `return` statement.
	 * @returns The index of the `ReturnStatement` node.
	 */
	private parseReturnStatement(): number {
		const node = this.writer.alloc(N_ReturnStatement, this.start);

		this.next();

		if (!this.canInsertSemicolon() && !this.at(T_SEMICOLON)) {
			this.writer.set(node, NODE_A, this.parseExpression());
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `break` or `continue` statement.
	 * @returns The index of the statement node.
	 */
	private parseBreakOrContinue(): number {
		const node = this.writer.alloc(
			this.at(T_break) ? N_BreakStatement : N_ContinueStatement,
			this.start,
		);

		this.next();

		if (!this.canInsertSemicolon() && this.atBindingName()) {
			this.writer.set(node, NODE_A, this.parseIdentifier());
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `with` statement.
	 * @returns The index of the `WithStatement` node.
	 */
	private parseWithStatement(): number {
		const node = this.writer.alloc(N_WithStatement, this.start);

		this.next();
		this.enterStatementParen();
		this.writer.set(node, NODE_A, this.parseExpression());
		this.expect(T_PAREN_CLOSE);
		this.writer.set(node, NODE_B, this.parseStatement(true));

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// Modules
	//-------------------------------------------------------------------------

	/**
	 * Determines whether an `import` token starts a declaration rather than a
	 * dynamic import or `import.meta`.
	 * @returns `true` when a declaration follows.
	 */
	private importIsDeclaration(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result = kind !== T_PAREN_OPEN && kind !== T_DOT;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses an import declaration, including `import x = require(...)`.
	 * @returns The index of the declaration node.
	 */
	private parseImportDeclaration(): number {
		const start = this.start;

		this.next();

		// `import x = require("m")` and `import x = A.B`.
		if (this.atBindingName() && this.nextIs(T_ASSIGN)) {
			return this.parseImportEquals(start, false);
		}

		const node = this.writer.alloc(N_ImportDeclaration, start);
		const mark = this.writer.startList();
		let typeOnly = false;

		if (this.at(T_type) && !this.nextIs(T_from) && !this.nextIs(T_ASSIGN)) {
			const state = this.tokenizer.save();

			this.next();

			if (
				this.atBindingName() ||
				this.at(T_BRACE_OPEN) ||
				this.at(T_STAR)
			) {
				typeOnly = true;

				if (this.atBindingName() && this.nextIs(T_ASSIGN)) {
					return this.parseImportEquals(start, true);
				}
			} else {
				this.tokenizer.restore(state);
			}
		}

		if (this.at(T_STRING)) {
			// A bare `import "mod"` has no specifiers.
			this.writer.set(node, NODE_B, this.parseLiteral());
			this.writer.set(node, NODE_A, this.writer.endList(mark));
			this.writer.set(node, NODE_C, this.parseImportAttributes());
			this.semicolon();

			return this.writer.finish(node, this.lastEnd);
		}

		if (this.atBindingName()) {
			const specifier = this.writer.alloc(
				N_ImportDefaultSpecifier,
				this.start,
			);

			this.writer.set(specifier, NODE_A, this.parseIdentifier());
			this.writer.pushList(
				this.writer.finish(specifier, this.lastEnd),
			);
			this.eat(T_COMMA);
		}

		if (this.at(T_STAR)) {
			const specifier = this.writer.alloc(
				N_ImportNamespaceSpecifier,
				this.start,
			);

			this.next();
			this.expect(T_as);
			this.writer.set(specifier, NODE_A, this.parseIdentifier());
			this.writer.pushList(
				this.writer.finish(specifier, this.lastEnd),
			);
		} else if (this.at(T_BRACE_OPEN)) {
			this.enterBrace(false);

			while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
				this.writer.pushList(this.parseImportSpecifier());

				if (!this.eat(T_COMMA)) {
					break;
				}
			}

			this.expect(T_BRACE_CLOSE);
		}

		this.writer.set(node, NODE_A, this.writer.endList(mark));
		this.expect(T_from);
		this.writer.set(node, NODE_B, this.parseLiteral());
		this.writer.set(node, NODE_C, this.parseImportAttributes());

		if (typeOnly) {
			this.writer.addFlags(node, NF_TYPE_ONLY);
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses one `{ a as b }` import specifier.
	 * @returns The index of the `ImportSpecifier` node.
	 */
	private parseImportSpecifier(): number {
		const node = this.writer.alloc(N_ImportSpecifier, this.start);
		let typeOnly = false;

		if (
			this.at(T_type) &&
			!this.nextIsAsRename() &&
			!this.nextIs(T_COMMA)
		) {
			const state = this.tokenizer.save();

			this.next();

			if (isIdentifierNameKind(this.kind) || this.at(T_STRING)) {
				typeOnly = true;
			} else {
				this.tokenizer.restore(state);
			}
		}

		const imported = this.at(T_STRING)
			? this.parseLiteral()
			: this.parseIdentifierName();

		this.writer.set(node, NODE_A, imported);

		if (this.eat(T_as)) {
			this.writer.set(node, NODE_B, this.parseIdentifier());
		} else {
			this.writer.set(node, NODE_B, imported);
		}

		if (typeOnly) {
			this.writer.addFlags(node, NF_TYPE_ONLY);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `with { ... }` or `assert { ... }` attributes clause.
	 * @returns A list handle holding the `ImportAttribute` nodes.
	 */
	private parseImportAttributes(): number {
		if (
			(!this.at(T_with) && !this.at(T_assert)) ||
			this.newlineBefore
		) {
			return 0;
		}

		this.next();

		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			const attribute = this.writer.alloc(N_ImportAttribute, this.start);

			this.writer.set(
				attribute,
				NODE_A,
				this.at(T_STRING)
					? this.parseLiteral()
					: this.parseIdentifierName(),
			);
			this.expect(T_COLON);
			this.writer.set(attribute, NODE_B, this.parseLiteral());
			this.writer.pushList(
				this.writer.finish(attribute, this.lastEnd),
			);

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);

		return this.writer.endList(mark);
	}

	/**
	 * Parses `import x = require("mod")` or `import x = A.B`.
	 * @param start The offset at which the declaration begins.
	 * @param typeOnly Whether the declaration was marked `type`.
	 * @returns The index of the `TSImportEqualsDeclaration` node.
	 */
	private parseImportEquals(start: number, typeOnly: boolean): number {
		const node = this.writer.alloc(N_TSImportEqualsDeclaration, start);

		this.writer.set(node, NODE_A, this.parseIdentifier());
		this.expect(T_ASSIGN);

		if (this.at(T_require) && this.nextIs(T_PAREN_OPEN)) {
			const reference = this.writer.alloc(
				N_TSExternalModuleReference,
				this.start,
			);

			this.next();
			this.expect(T_PAREN_OPEN);
			this.writer.set(reference, NODE_A, this.parseLiteral());
			this.expect(T_PAREN_CLOSE);
			this.writer.set(
				node,
				NODE_B,
				this.writer.finish(reference, this.lastEnd),
			);
		} else {
			this.writer.set(node, NODE_B, this.parseEntityName());
		}

		if (typeOnly) {
			this.writer.addFlags(node, NF_TYPE_ONLY);
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an export whose decorators were written before the `export`.
	 * @param decorators A list handle holding the `Decorator` nodes.
	 * @returns The index of the export declaration node.
	 * @throws {ParseError} When the export declares something undecoratable.
	 */
	private parseDecoratedExport(decorators: number): number {
		const node = this.parseExportDeclaration();
		const declaration = this.writer.get(node, NODE_A);
		const kind = this.writer.get(declaration, NODE_KIND);

		if (kind !== N_ClassDeclaration) {
			throw this.error("Decorators are not valid here");
		}

		this.writer.set(declaration, NODE_G, decorators);

		return node;
	}

	/**
	 * Parses every form of export declaration.
	 * @returns The index of the declaration node.
	 * @throws {ParseError} When the export form is not recognized.
	 */
	private parseExportDeclaration(): number {
		const start = this.start;

		this.next();

		if (this.at(T_ASSIGN)) {
			const node = this.writer.alloc(N_TSExportAssignment, start);

			this.next();
			this.writer.set(node, NODE_A, this.parseExpression());
			this.semicolon();

			return this.writer.finish(node, this.lastEnd);
		}

		/*
		 * `export as namespace A;` has to be tested before the `export *`
		 * branch, because `export * as A from "m"` also continues with `as`.
		 */
		if (this.at(T_as) && this.nextIs(T_namespace)) {
			const node = this.writer.alloc(
				N_TSNamespaceExportDeclaration,
				start,
			);

			this.next();
			this.next();
			this.writer.set(node, NODE_A, this.parseIdentifierName());
			this.semicolon();

			return this.writer.finish(node, this.lastEnd);
		}

		if (this.at(T_default)) {
			const node = this.writer.alloc(N_ExportDefaultDeclaration, start);

			this.next();
			this.writer.set(node, NODE_A, this.parseExportDefaultValue());

			return this.writer.finish(node, this.lastEnd);
		}

		if (this.at(T_STAR)) {
			const node = this.writer.alloc(N_ExportAllDeclaration, start);

			this.next();

			if (this.eat(T_as)) {
				this.writer.set(
					node,
					NODE_A,
					this.at(T_STRING)
						? this.parseLiteral()
						: this.parseIdentifierName(),
				);
			}

			this.expect(T_from);
			this.writer.set(node, NODE_B, this.parseLiteral());
			this.writer.set(node, NODE_C, this.parseImportAttributes());
			this.semicolon();

			return this.writer.finish(node, this.lastEnd);
		}

		const typeOnly = this.at(T_type) && !this.nextIs(T_ASSIGN);

		if (typeOnly) {
			const state = this.tokenizer.save();

			this.next();

			if (this.at(T_BRACE_OPEN) || this.at(T_STAR)) {
				return this.parseExportNamed(start, true);
			}

			this.tokenizer.restore(state);
		}

		if (this.at(T_BRACE_OPEN)) {
			return this.parseExportNamed(start, false);
		}

		if (this.at(T_import)) {
			const node = this.writer.alloc(N_ExportNamedDeclaration, start);
			const importStart = this.start;

			this.next();
			this.writer.set(
				node,
				NODE_A,
				this.parseImportEquals(importStart, false),
			);

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_ExportNamedDeclaration, start);
		const declaration = this.parseStatement();
		const declarationKind = this.writer.get(declaration, NODE_KIND);

		this.writer.set(node, NODE_A, declaration);

		/*
		 * Exporting a type declaration, or anything marked `declare`, makes
		 * the export itself type-only.
		 */
		if (
			declarationKind === N_TSInterfaceDeclaration ||
			declarationKind === N_TSTypeAliasDeclaration ||
			(this.writer.get(declaration, NODE_FLAGS) & NF_DECLARE) !== 0
		) {
			this.writer.addFlags(node, NF_TYPE_ONLY);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses the value of an `export default` declaration.
	 * @returns The index of the exported node.
	 */
	private parseExportDefaultValue(): number {
		const start = this.start;

		if (this.at(T_function)) {
			return this.parseFunctionDeclaration(start, false, 0);
		}

		if (this.at(T_async) && this.asyncStartsFunction()) {
			this.next();

			return this.parseFunctionDeclaration(start, true, 0);
		}

		if (this.at(T_class)) {
			return this.parseClass(N_ClassDeclaration, 0);
		}

		if (this.at(T_AT)) {
			const decorators = this.parseDecorators();

			return this.parseDecoratedClass(decorators, start);
		}

		if (this.at(T_abstract) && this.nextIs(T_class, true)) {
			this.next();

			const node = this.parseClass(N_ClassDeclaration, 0, start);

			this.writer.addFlags(node, NF_ABSTRACT);

			return node;
		}

		if (this.at(T_interface) && this.nextStartsBinding()) {
			return this.parseInterfaceDeclaration(start, 0);
		}

		const value = this.parseAssignmentExpression();

		this.semicolon();

		return value;
	}

	/**
	 * Parses `export { ... }` with an optional `from` clause.
	 * @param start The offset at which the declaration begins.
	 * @param typeOnly Whether the export was marked `type`.
	 * @returns The index of the declaration node.
	 */
	private parseExportNamed(start: number, typeOnly: boolean): number {
		if (this.at(T_STAR)) {
			const node = this.writer.alloc(N_ExportAllDeclaration, start);

			this.next();

			// The namespace may be named by a string, as `export * as` allows.
			if (this.eat(T_as)) {
				this.writer.set(
					node,
					NODE_A,
					this.at(T_STRING)
						? this.parseLiteral()
						: this.parseIdentifierName(),
				);
			}

			this.expect(T_from);
			this.writer.set(node, NODE_B, this.parseLiteral());
			this.writer.addFlags(node, NF_TYPE_ONLY);
			this.semicolon();

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_ExportNamedDeclaration, start);
		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			const specifier = this.writer.alloc(N_ExportSpecifier, this.start);

			// An individual specifier may carry its own `type` marker.
			if (
				this.at(T_type) &&
				!this.nextIs(T_COMMA) &&
				!this.nextIsAsRename()
			) {
				const state = this.tokenizer.save();

				this.next();

				if (
					!isIdentifierNameKind(this.kind) &&
					!this.at(T_STRING)
				) {
					this.tokenizer.restore(state);
				} else {
					this.writer.addFlags(specifier, NF_TYPE_ONLY);
				}
			}

			const local = this.at(T_STRING)
				? this.parseLiteral()
				: this.parseIdentifierName();

			this.writer.set(specifier, NODE_A, local);

			if (this.eat(T_as)) {
				this.writer.set(
					specifier,
					NODE_B,
					this.at(T_STRING)
						? this.parseLiteral()
						: this.parseIdentifierName(),
				);
			} else {
				this.writer.set(specifier, NODE_B, local);
			}

			this.writer.pushList(
				this.writer.finish(specifier, this.lastEnd),
			);

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(node, NODE_B, this.writer.endList(mark));

		if (this.eat(T_from)) {
			this.writer.set(node, NODE_C, this.parseLiteral());
			this.writer.set(node, NODE_D, this.parseImportAttributes());
		}

		if (typeOnly) {
			this.writer.addFlags(node, NF_TYPE_ONLY);
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// TypeScript Declarations
	//-------------------------------------------------------------------------

	/**
	 * Parses a `declare` declaration.
	 * @param start The offset at which the declaration begins.
	 * @returns The index of the declaration node.
	 */
	private parseDeclare(start: number): number {
		this.next();

		const node = this.parseStatement();

		this.writer.addFlags(node, NF_DECLARE);
		this.writer.set(node, NODE_START, start);

		return node;
	}

	/**
	 * Parses an interface declaration.
	 * @param start The offset at which the declaration begins.
	 * @param flags Extra flags such as `declare`.
	 * @returns The index of the `TSInterfaceDeclaration` node.
	 */
	private parseInterfaceDeclaration(start: number, flags: number): number {
		const node = this.writer.alloc(N_TSInterfaceDeclaration, start);

		this.writer.addFlags(node, flags);
		this.next();
		this.writer.set(node, NODE_A, this.parseIdentifier());
		this.writer.set(node, NODE_C, this.tryParseTypeParameters());

		if (this.eat(T_extends)) {
			const mark = this.writer.startList();

			do {
				const heritage = this.writer.alloc(
					N_TSInterfaceHeritage,
					this.start,
				);

				this.writer.set(
					heritage,
					NODE_A,
					this.parseHeritageExpression(),
				);

				if (this.at(T_LT)) {
					this.writer.set(
						heritage,
						NODE_B,
						this.parseTypeArguments(),
					);
				}

				this.writer.pushList(
					this.writer.finish(heritage, this.lastEnd),
				);
			} while (this.eat(T_COMMA));

			this.writer.set(node, NODE_D, this.writer.endList(mark));
		}

		const body = this.writer.alloc(N_TSInterfaceBody, this.start);

		this.writer.set(body, NODE_A, this.parseObjectTypeMembers());
		this.writer.set(node, NODE_B, this.writer.finish(body, this.lastEnd));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a type alias declaration.
	 * @param start The offset at which the declaration begins.
	 * @param flags Extra flags such as `declare`.
	 * @returns The index of the `TSTypeAliasDeclaration` node.
	 */
	private parseTypeAliasDeclaration(start: number, flags: number): number {
		const node = this.writer.alloc(N_TSTypeAliasDeclaration, start);

		this.writer.addFlags(node, flags);
		this.next();
		this.writer.set(node, NODE_A, this.parseIdentifier());
		this.writer.set(node, NODE_C, this.tryParseTypeParameters());
		this.expect(T_ASSIGN);
		this.writer.set(node, NODE_B, this.parseType());
		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an enum declaration.
	 * @param start The offset at which the declaration begins.
	 * @param flags Extra flags such as `declare` or `const`.
	 * @returns The index of the `TSEnumDeclaration` node.
	 */
	private parseEnumDeclaration(start: number, flags: number): number {
		const node = this.writer.alloc(N_TSEnumDeclaration, start);

		this.writer.addFlags(node, flags);
		this.next();
		this.writer.set(node, NODE_A, this.parseIdentifier());

		const body = this.writer.alloc(N_TSEnumBody, this.start);
		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			const member = this.writer.alloc(N_TSEnumMember, this.start);
			const computed = this.at(T_BRACKET_OPEN);

			this.writer.set(member, NODE_A, this.parsePropertyName());

			if (computed) {
				this.writer.addFlags(member, NF_COMPUTED);
			}

			if (this.eat(T_ASSIGN)) {
				this.writer.set(
					member,
					NODE_B,
					this.parseAssignmentExpression(),
				);
			}

			this.writer.pushList(this.writer.finish(member, this.lastEnd));

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(body, NODE_A, this.writer.endList(mark));
		this.writer.set(node, NODE_B, this.writer.finish(body, this.lastEnd));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses the class a set of decorators is written on.
	 *
	 * A decorator decorates a class and nothing else, so the only things that
	 * may stand between it and the `class` keyword are `abstract` and
	 * `declare`, in either order. Without this the decorator path called
	 * `parseClass()` outright, which takes the current token for `class`
	 * without reading it: `@dec interface I {}` built a `class I {}` and
	 * dropped the keyword, and `@dec abstract class C {}` — which is valid —
	 * threw instead.
	 * @param decorators The list handle of the decorators.
	 * @param start The offset at which the first decorator began.
	 * @returns The index of the class declaration node.
	 */
	private parseDecoratedClass(decorators: number, start: number): number {
		let flags = 0;

		/*
		 * Either order is written, so both are read rather than a fixed one.
		 * Consuming them before knowing a `class` follows is safe because
		 * anything else throws below whichever way it is spelled.
		 */
		for (;;) {
			if (this.at(T_abstract)) {
				flags |= NF_ABSTRACT;
			} else if (this.at(T_declare)) {
				flags |= NF_DECLARE;
			} else {
				break;
			}

			this.next();
		}

		if (!this.at(T_class)) {
			throw this.error(
				"A decorator may only be applied to a class declaration.",
				this.start,
			);
		}

		const node = this.parseClass(N_ClassDeclaration, decorators, start);

		this.writer.addFlags(node, flags);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `namespace`, `module`, or `global` declaration.
	 * @param start The offset at which the declaration begins.
	 * @param flags Extra flags such as `declare`.
	 * @returns The index of the `TSModuleDeclaration` node.
	 */
	private parseModuleDeclaration(start: number, flags: number): number {
		const node = this.writer.alloc(N_TSModuleDeclaration, start);
		const keyword = this.kind;

		this.writer.addFlags(node, flags);

		if (keyword === T_global) {
			this.writer.addFlags(node, MODULE_GLOBAL << MODULE_KIND_SHIFT);
			this.writer.set(node, NODE_A, this.parseIdentifier());
		} else {
			this.writer.addFlags(
				node,
				(keyword === T_module ? MODULE_MODULE : MODULE_NAMESPACE) <<
					MODULE_KIND_SHIFT,
			);
			this.next();
			this.writer.set(
				node,
				NODE_A,
				this.at(T_STRING) ? this.parseLiteral() : this.parseEntityName(),
			);
		}

		if (this.at(T_BRACE_OPEN)) {
			const body = this.writer.alloc(N_TSModuleBlock, this.start);
			const mark = this.writer.startList();

			this.enterBrace(true);

			while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
				this.writer.pushList(this.parseStatement());
			}

			this.expect(T_BRACE_CLOSE);
			this.writer.set(body, NODE_A, this.writer.endList(mark));
			this.writer.set(
				node,
				NODE_B,
				this.writer.finish(body, this.lastEnd),
			);
		} else {
			this.semicolon();
		}

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// Lookahead Helpers
	//-------------------------------------------------------------------------

	/**
	 * Determines whether the `as` after the current token renames it, rather
	 * than being the name that a `type` modifier applies to.
	 *
	 * `as` is a name like any other, so `{ type as }` is a type-only specifier
	 * for something called `as`, while `{ type as foo }` renames something
	 * called `type`. What tells them apart is whether a name follows the `as`.
	 * @returns `true` when the `as` introduces a new name.
	 */
	private nextIsAsRename(): boolean {
		const state = this.tokenizer.save();

		this.next();

		let result = false;

		if (this.at(T_as)) {
			this.next();
			result = !this.at(T_COMMA) && !this.at(T_BRACE_CLOSE);
		}

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Tests the kind of the token after the current one.
	 * @param kind The kind to look for.
	 * @param sameLine Whether a line break between the two disqualifies it,
	 *      which is how a modifier such as `abstract` is told apart from an
	 *      expression statement that merely mentions the same name.
	 * @returns `true` when the next token has that kind.
	 */
	private nextIs(kind: number, sameLine = false): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(kind) && (!sameLine || !this.newlineBefore);

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether a binding target follows the current token, which is
	 * how `let` and `using` are told apart from identifiers of the same name.
	 * @returns `true` when a binding target follows.
	 */
	private nextStartsBinding(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result =
			this.atBindingName() ||
			this.at(T_BRACKET_OPEN) ||
			this.at(T_BRACE_OPEN);

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `using` introduces a `using` declaration.
	 *
	 * A `using` declaration binds a plain identifier and nothing else, and the
	 * identifier has to be on the same line — `using \n x` is the identifier
	 * `using` followed by the expression `x`, and `using [x]` is a member
	 * expression. The line to check is therefore the one *after* `using`, not
	 * the one before it: a `using` declaration that opens a block written on
	 * its own line is perfectly ordinary.
	 * @returns `true` when `using x` follows on the same line.
	 */
	private usingStartsBinding(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.atBindingName() && !this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `async` introduces a function declaration.
	 * @returns `true` when `async function` follows on the same line.
	 */
	private asyncStartsFunction(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(T_function) && !this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `await` introduces an `await using` declaration.
	 * @returns `true` when `await using x` follows.
	 */
	private awaitStartsUsing(): boolean {
		const state = this.tokenizer.save();

		this.next();

		let result = false;

		if (this.at(T_using) && !this.newlineBefore) {
			this.next();
			result = this.atBindingName() && !this.newlineBefore;
		}

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `type` introduces a type alias declaration.
	 * @returns `true` when `type Name =` or `type Name<` follows.
	 */
	private typeStartsAlias(): boolean {
		const state = this.tokenizer.save();

		this.next();

		let result = false;

		if (this.atBindingName() && !this.newlineBefore) {
			this.next();
			result = this.at(T_ASSIGN) || this.at(T_LT);
		}

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `namespace` or `module` introduces a declaration.
	 * @returns `true` when a module name follows.
	 */
	private nextStartsModuleName(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result =
			(this.atBindingName() || this.at(T_STRING)) && !this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether `declare` introduces a declaration.
	 * @returns `true` when a declarable construct follows.
	 */
	private declareStartsDeclaration(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			!this.newlineBefore &&
			(kind === T_var ||
				kind === T_let ||
				kind === T_const ||
				kind === T_function ||
				kind === T_class ||
				kind === T_enum ||
				kind === T_interface ||
				kind === T_type ||
				kind === T_namespace ||
				kind === T_module ||
				kind === T_global ||
				kind === T_abstract ||
				kind === T_async);

		this.tokenizer.restore(state);

		return result;
	}
}
