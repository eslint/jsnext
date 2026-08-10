/**
 * @fileoverview The expression, pattern, function, and class grammar.
 */

import { TypeParser } from "./parser-types.js";
import {
	ACCESS_PRIVATE,
	ACCESS_PROTECTED,
	ACCESS_PUBLIC,
	ACCESS_SHIFT,
	MKIND_CONSTRUCTOR,
	MKIND_GET,
	MKIND_INIT,
	MKIND_METHOD,
	MKIND_SET,
	MKIND_SHIFT,
	NF_ASYNC,
	NF_COMPUTED,
	NF_DECLARE,
	NF_DEFINITE,
	NF_DELEGATE,
	NF_EXPRESSION_BODY,
	NF_GENERATOR,
	NF_METHOD,
	NF_OPTIONAL,
	NF_OVERRIDE,
	NF_PARENTHESIZED,
	NF_PREFIX,
	NF_READONLY,
	NF_SHORTHAND,
	NF_STATIC,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	NODE_END,
	NODE_G,
	NODE_KIND,
	NODE_START,
	N_AccessorProperty,
	N_ArrayExpression,
	N_ArrayPattern,
	N_ArrowFunctionExpression,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_AwaitExpression,
	N_BinaryExpression,
	N_CallExpression,
	N_ChainExpression,
	N_ClassBody,
	N_ClassExpression,
	N_ConditionalExpression,
	N_Decorator,
	N_Identifier,
	N_ImportExpression,
	N_LogicalExpression,
	N_MemberExpression,
	N_MetaProperty,
	N_MethodDefinition,
	N_NewExpression,
	N_ObjectExpression,
	N_ObjectPattern,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_SequenceExpression,
	N_SpreadElement,
	N_StaticBlock,
	N_Super,
	N_TSAbstractAccessorProperty,
	N_TSAbstractMethodDefinition,
	N_TSAbstractPropertyDefinition,
	N_TSAsExpression,
	N_TSClassImplements,
	N_TSEmptyBodyFunctionExpression,
	N_TSInstantiationExpression,
	N_TSNonNullExpression,
	N_TSParameterProperty,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	N_TaggedTemplateExpression,
	N_TemplateLiteral,
	N_ThisExpression,
	N_UnaryExpression,
	N_UpdateExpression,
	N_YieldExpression,
	N_FunctionExpression,
} from "./node-kinds.js";
import {
	KIND_PRECEDENCE,
	T_ARROW,
	T_ASSIGN,
	T_AT,
	T_AMPAMP,
	T_BIGINT,
	T_BRACE_CLOSE,
	T_BRACE_OPEN,
	T_BRACKET_CLOSE,
	T_BRACKET_OPEN,
	T_COLON,
	T_COMMA,
	T_DOT,
	T_ELLIPSIS,
	T_EOF,
	T_GT,
	T_LT,
	T_MINUS,
	T_MINUS_MINUS,
	T_NOT,
	T_NUMBER,
	T_PAREN_CLOSE,
	T_PAREN_OPEN,
	T_PIPEPIPE,
	T_PLUS,
	T_PLUS_PLUS,
	T_PRIVATE_IDENT,
	T_QQ,
	T_QUESTION,
	T_QUESTION_DOT,
	T_SEMICOLON,
	T_STAR,
	T_STARSTAR,
	T_STRING,
	T_TEMPLATE_FULL,
	T_TEMPLATE_HEAD,
	T_TEMPLATE_MIDDLE,
	T_TEMPLATE_TAIL,
	T_TILDE,
	T_abstract,
	T_accessor,
	T_as,
	T_async,
	T_await,
	T_class,
	T_declare,
	T_delete,
	T_extends,
	T_function,
	T_get,
	T_implements,
	T_import,
	T_in,
	T_new,
	T_override,
	T_private,
	T_protected,
	T_public,
	T_readonly,
	T_satisfies,
	T_set,
	T_static,
	T_super,
	T_this,
	T_typeof,
	T_void,
	T_yield,
	isAssignmentKind,
	isIdentifierNameKind,
} from "./token-kinds.js";

/**
 * Adds the expression, pattern, function, and class grammar to the parser.
 */
export abstract class ExpressionParser extends TypeParser {
	//-------------------------------------------------------------------------
	// Expressions
	//-------------------------------------------------------------------------

	/**
	 * Parses a comma-separated expression list as a single expression.
	 * @returns The index of the expression node.
	 */
	parseExpression(): number {
		const start = this.start;
		const first = this.parseAssignmentExpression();

		if (!this.at(T_COMMA)) {
			return first;
		}

		const node = this.writer.alloc(N_SequenceExpression, start);
		const mark = this.writer.startList();

		this.writer.pushList(first);

		while (this.eat(T_COMMA)) {
			this.writer.pushList(this.parseAssignmentExpression());
		}

		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an assignment-level expression, which also covers arrow
	 * functions, `yield`, and conditional expressions.
	 * @returns The index of the expression node.
	 */
	parseAssignmentExpression(): number {
		if (this.at(T_yield) && this.inGenerator) {
			return this.parseYieldExpression();
		}

		const start = this.start;
		const arrow = this.tryParseArrowFunction();

		if (arrow !== 0) {
			return arrow;
		}

		const left = this.parseConditionalExpression();

		if (!isAssignmentKind(this.kind)) {
			return left;
		}

		const operator = this.kind;
		const node = this.writer.alloc(N_AssignmentExpression, start);

		this.next();

		if (operator === T_ASSIGN) {
			this.toPattern(left);
		}

		this.writer.set(node, NODE_A, left);
		this.writer.set(node, NODE_B, this.parseAssignmentExpression());
		this.writer.set(node, NODE_C, operator);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `yield` and `yield*`.
	 * @returns The index of the `YieldExpression` node.
	 */
	private parseYieldExpression(): number {
		const node = this.writer.alloc(N_YieldExpression, this.start);

		this.next();

		if (this.eat(T_STAR)) {
			this.writer.addFlags(node, NF_DELEGATE);
			this.writer.set(node, NODE_A, this.parseAssignmentExpression());
		} else if (!this.canInsertSemicolon() && this.atExpressionStart()) {
			this.writer.set(node, NODE_A, this.parseAssignmentExpression());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a conditional expression.
	 * @returns The index of the expression node.
	 */
	private parseConditionalExpression(): number {
		const start = this.start;
		const test = this.parseBinaryExpression(0);

		if (!this.at(T_QUESTION)) {
			return test;
		}

		const node = this.writer.alloc(N_ConditionalExpression, start);

		this.next();
		this.writer.set(node, NODE_A, test);

		const previousAllowIn = this.allowIn;

		this.allowIn = true;
		this.writer.set(node, NODE_B, this.parseAssignmentExpression());
		this.allowIn = previousAllowIn;
		this.expect(T_COLON);
		this.writer.set(node, NODE_C, this.parseAssignmentExpression());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses binary operators using precedence climbing.
	 * @param minimumPrecedence The lowest binding power to accept.
	 * @returns The index of the expression node.
	 */
	private parseBinaryExpression(minimumPrecedence: number): number {
		const start = this.start;
		let left = this.parseUnaryExpression();

		for (;;) {
			const operator = this.kind;

			// `in` is banned in the head of a classic `for` statement.
			if (operator === T_in && !this.allowIn) {
				break;
			}

			const precedence = KIND_PRECEDENCE[operator];

			if (precedence === 0 || precedence <= minimumPrecedence) {
				break;
			}

			if (
				(operator === T_as || operator === T_satisfies) &&
				this.newlineBefore
			) {
				break;
			}

			if (operator === T_as || operator === T_satisfies) {
				const node = this.writer.alloc(
					operator === T_as
						? N_TSAsExpression
						: N_TSSatisfiesExpression,
					start,
				);

				this.next();
				this.writer.set(node, NODE_A, left);
				this.writer.set(node, NODE_B, this.parseType());
				left = this.writer.finish(node, this.lastEnd);
				continue;
			}

			const isLogical =
				operator === T_AMPAMP ||
				operator === T_PIPEPIPE ||
				operator === T_QQ;
			const node = this.writer.alloc(
				isLogical ? N_LogicalExpression : N_BinaryExpression,
				start,
			);

			this.next();
			this.writer.set(node, NODE_A, left);

			/*
			 * Exponentiation is right-associative, so its right operand is
			 * parsed at one step below its own precedence.
			 */
			const rightPrecedence =
				operator === T_STARSTAR ? precedence - 1 : precedence;

			this.writer.set(
				node,
				NODE_B,
				this.parseBinaryExpression(rightPrecedence),
			);
			this.writer.set(node, NODE_C, operator);
			left = this.writer.finish(node, this.lastEnd);
		}

		return left;
	}

	/**
	 * Parses prefix operators and `await`.
	 * @returns The index of the expression node.
	 */
	private parseUnaryExpression(): number {
		const kind = this.kind;
		const start = this.start;

		switch (kind) {
			case T_NOT:
			case T_TILDE:
			case T_PLUS:
			case T_MINUS:
			case T_typeof:
			case T_void:
			case T_delete: {
				const node = this.writer.alloc(N_UnaryExpression, start);

				this.next();
				this.writer.set(node, NODE_A, this.parseUnaryExpression());
				this.writer.set(node, NODE_B, kind);
				this.writer.addFlags(node, NF_PREFIX);

				return this.writer.finish(node, this.lastEnd);
			}

			case T_PLUS_PLUS:
			case T_MINUS_MINUS: {
				const node = this.writer.alloc(N_UpdateExpression, start);

				this.next();
				this.writer.set(node, NODE_A, this.parseUnaryExpression());
				this.writer.set(node, NODE_B, kind);
				this.writer.addFlags(node, NF_PREFIX);

				return this.writer.finish(node, this.lastEnd);
			}

			case T_await:
				if (this.inAsync && !this.nextIsIdentifierUse()) {
					const node = this.writer.alloc(N_AwaitExpression, start);

					this.next();
					this.writer.set(node, NODE_A, this.parseUnaryExpression());

					return this.writer.finish(node, this.lastEnd);
				}

				break;

			case T_LT:
				return this.parseAngleBracketExpression();

			default:
				break;
		}

		return this.parsePostfixExpression();
	}

	/**
	 * Parses whatever a `<` in expression position turns out to introduce.
	 *
	 * It is either JSX or an old-style `<T>expr` type assertion, and nothing
	 * short of parsing tells them apart. JSX is tried first, which is how a
	 * `.tsx` file reads it; the assertion is the fallback, which is what keeps
	 * `<any>value` working in code that has no JSX in it.
	 * @returns The index of the expression node.
	 * @throws {ParseError} When neither reading works.
	 */
	private parseAngleBracketExpression(): number {
		const state = this.tokenizer.save();
		const snapshot = this.writer.mark();
		let element = 0;
		let jsxError: unknown;

		try {
			element = this.parseJsxRoot(false);
		} catch (error) {
			jsxError = error;
			this.writer.rewind(snapshot);
			this.tokenizer.restore(state);
		}

		if (element !== 0) {
			return this.parseCallOrMemberExpression(false, element);
		}

		try {
			return this.parseTypeAssertion();
		} catch {
			/*
			 * Neither reading worked. The JSX diagnostic is reported because a
			 * `<` in expression position is far more often a broken element
			 * than a broken type assertion.
			 */
			throw jsxError;
		}
	}

	/**
	 * Parses an old-style `<T>expr` type assertion.
	 * @returns The index of the `TSTypeAssertion` node.
	 */
	private parseTypeAssertion(): number {
		const node = this.writer.alloc(N_TSTypeAssertion, this.start);

		this.next();
		this.writer.set(node, NODE_A, this.parseType());

		if (!this.at(T_GT)) {
			this.tokenizer.reScanGreaterThan();
		}

		this.expect(T_GT);
		this.writer.set(node, NODE_B, this.parseUnaryExpression());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses postfix `++` and `--`.
	 * @returns The index of the expression node.
	 */
	private parsePostfixExpression(): number {
		const start = this.start;
		const expression = this.parseCallOrMemberExpression(false);

		if (
			(this.at(T_PLUS_PLUS) || this.at(T_MINUS_MINUS)) &&
			!this.newlineBefore
		) {
			const node = this.writer.alloc(N_UpdateExpression, start);

			this.writer.set(node, NODE_A, expression);
			this.writer.set(node, NODE_B, this.kind);

			const end = this.end;

			this.next();

			return this.writer.finish(node, end);
		}

		return expression;
	}

	//-------------------------------------------------------------------------
	// Member and Call Expressions
	//-------------------------------------------------------------------------

	/**
	 * Parses member access, calls, tagged templates, and the TypeScript
	 * suffixes `!` and `<...>`.
	 * @param noCalls Whether call expressions are disallowed, which is the
	 *      case while parsing the callee of `new`.
	 * @returns The index of the expression node.
	 */
	private parseCallOrMemberExpression(
		noCalls: boolean,
		atom = 0,
	): number {
		const start = atom === 0 ? this.start : this.writer.get(atom, NODE_START);
		let expression = atom === 0 ? this.parsePrimaryExpression() : atom;
		let optionalChain = false;

		for (;;) {
			const kind = this.kind;

			if (kind === T_DOT) {
				this.next();
				expression = this.finishMember(
					start,
					expression,
					this.at(T_PRIVATE_IDENT)
						? this.parsePrivateIdentifier()
						: this.parseIdentifierName(),
					false,
					false,
				);
				continue;
			}

			if (kind === T_QUESTION_DOT) {
				optionalChain = true;
				this.next();

				if (this.at(T_PAREN_OPEN)) {
					expression = this.finishCall(
						start,
						expression,
						true,
						noCalls,
					);
					continue;
				}

				if (this.at(T_BRACKET_OPEN)) {
					this.next();

					const property = this.parseExpression();

					this.expect(T_BRACKET_CLOSE);
					expression = this.finishMember(
						start,
						expression,
						property,
						true,
						true,
					);
					continue;
				}

				expression = this.finishMember(
					start,
					expression,
					this.at(T_PRIVATE_IDENT)
						? this.parsePrivateIdentifier()
						: this.parseIdentifierName(),
					false,
					true,
				);
				continue;
			}

			if (kind === T_BRACKET_OPEN) {
				this.next();

				const property = this.parseExpression();

				this.expect(T_BRACKET_CLOSE);
				expression = this.finishMember(
					start,
					expression,
					property,
					true,
					false,
				);
				continue;
			}

			if (kind === T_PAREN_OPEN && !noCalls) {
				expression = this.finishCall(start, expression, false, noCalls);
				continue;
			}

			if (kind === T_NOT && !this.newlineBefore) {
				const node = this.writer.alloc(N_TSNonNullExpression, start);
				const end = this.end;

				this.next();
				this.writer.set(node, NODE_A, expression);
				expression = this.writer.finish(node, end);
				continue;
			}

			if (kind === T_TEMPLATE_FULL || kind === T_TEMPLATE_HEAD) {
				const node = this.writer.alloc(
					N_TaggedTemplateExpression,
					start,
				);

				this.writer.set(node, NODE_A, expression);
				this.writer.set(node, NODE_B, this.parseTemplateLiteral());
				expression = this.writer.finish(node, this.lastEnd);
				continue;
			}

			if (kind === T_LT) {
				const typeArguments = this.tryParseTypeArgumentsInExpression();

				if (typeArguments === 0) {
					break;
				}

				if (this.at(T_PAREN_OPEN) && !noCalls) {
					expression = this.finishCall(
						start,
						expression,
						false,
						noCalls,
						typeArguments,
					);
					continue;
				}

				if (
					this.at(T_TEMPLATE_FULL) ||
					this.at(T_TEMPLATE_HEAD)
				) {
					const node = this.writer.alloc(
						N_TaggedTemplateExpression,
						start,
					);

					this.writer.set(node, NODE_A, expression);
					this.writer.set(node, NODE_B, this.parseTemplateLiteral());
					this.writer.set(node, NODE_C, typeArguments);
					expression = this.writer.finish(node, this.lastEnd);
					continue;
				}

				const node = this.writer.alloc(
					N_TSInstantiationExpression,
					start,
				);

				this.writer.set(node, NODE_A, expression);
				this.writer.set(node, NODE_B, typeArguments);
				expression = this.writer.finish(node, this.lastEnd);
				continue;
			}

			break;
		}

		if (optionalChain) {
			const node = this.writer.alloc(N_ChainExpression, start);

			this.writer.set(node, NODE_A, expression);

			return this.writer.finish(
				node,
				this.writer.get(expression, NODE_END),
			);
		}

		return expression;
	}

	/**
	 * Builds a `MemberExpression` node.
	 * @param start The offset at which the whole expression began.
	 * @param object The object being accessed.
	 * @param property The property node.
	 * @param computed Whether the access used brackets.
	 * @param optional Whether the access used `?.`.
	 * @returns The index of the `MemberExpression` node.
	 */
	protected finishMember(
		start: number,
		object: number,
		property: number,
		computed: boolean,
		optional: boolean,
	): number {
		const node = this.writer.alloc(N_MemberExpression, start);

		this.writer.set(node, NODE_A, object);
		this.writer.set(node, NODE_B, property);

		if (computed) {
			this.writer.addFlags(node, NF_COMPUTED);
		}

		if (optional) {
			this.writer.addFlags(node, NF_OPTIONAL);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Builds a `CallExpression` node from the argument list that follows.
	 * @param start The offset at which the whole expression began.
	 * @param callee The expression being called.
	 * @param optional Whether the call used `?.()`.
	 * @param noCalls Whether calls are disallowed in this position.
	 * @param typeArguments A type argument list node, or `0`.
	 * @returns The index of the `CallExpression` node.
	 * @throws {ParseError} When a call is not allowed here.
	 */
	private finishCall(
		start: number,
		callee: number,
		optional: boolean,
		noCalls: boolean,
		typeArguments = 0,
	): number {
		if (noCalls) {
			throw this.unexpected();
		}

		const node = this.writer.alloc(N_CallExpression, start);

		this.writer.set(node, NODE_A, callee);
		this.writer.set(node, NODE_B, this.parseArguments());
		this.writer.set(node, NODE_C, typeArguments);

		if (optional) {
			this.writer.addFlags(node, NF_OPTIONAL);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a parenthesized argument list.
	 * @returns A list handle holding the argument nodes.
	 */
	private parseArguments(): number {
		const mark = this.writer.startList();

		this.expect(T_PAREN_OPEN);

		while (!this.at(T_PAREN_CLOSE) && !this.at(T_EOF)) {
			if (this.at(T_ELLIPSIS)) {
				const spread = this.writer.alloc(N_SpreadElement, this.start);

				this.next();
				this.writer.set(
					spread,
					NODE_A,
					this.parseAssignmentExpression(),
				);
				this.writer.pushList(
					this.writer.finish(spread, this.lastEnd),
				);
			} else {
				this.writer.pushList(this.parseAssignmentExpression());
			}

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_PAREN_CLOSE);

		return this.writer.endList(mark);
	}

	/**
	 * Tries to read a `<...>` type argument list in an expression position.
	 * @returns The instantiation node index, or `0` when the `<` was a
	 *      less-than operator after all.
	 */
	private tryParseTypeArgumentsInExpression(): number {
		const state = this.tokenizer.save();
		const snapshot = this.writer.mark();

		try {
			const typeArguments = this.parseTypeArguments();
			const following = this.kind;

			/*
			 * A type argument list in an expression only makes sense when it
			 * is followed by a call, a tagged template, or something that
			 * cannot continue an expression.
			 */
			if (
				following === T_PAREN_OPEN ||
				following === T_TEMPLATE_FULL ||
				following === T_TEMPLATE_HEAD ||
				following === T_SEMICOLON ||
				following === T_COMMA ||
				following === T_PAREN_CLOSE ||
				following === T_BRACKET_CLOSE ||
				following === T_BRACE_CLOSE ||
				following === T_EOF
			) {
				return typeArguments;
			}
		} catch {
			// Fall through and treat the `<` as a comparison operator.
		}

		this.writer.rewind(snapshot);
		this.tokenizer.restore(state);

		return 0;
	}

	//-------------------------------------------------------------------------
	// Primary Expressions
	//-------------------------------------------------------------------------

	/**
	 * Determines whether an expression can begin at the current token.
	 * @returns `true` when the current token can start an expression.
	 */
	protected atExpressionStart(): boolean {
		const kind = this.kind;

		switch (kind) {
			case T_SEMICOLON:
			case T_PAREN_CLOSE:
			case T_BRACKET_CLOSE:
			case T_BRACE_CLOSE:
			case T_COMMA:
			case T_COLON:
			case T_EOF:
				return false;

			default:
				return true;
		}
	}

	/**
	 * Parses the innermost form of an expression.
	 * @returns The index of the expression node.
	 * @throws {ParseError} When no expression can start here.
	 */
	private parsePrimaryExpression(): number {
		const kind = this.kind;
		const start = this.start;

		switch (kind) {
			case T_this: {
				const node = this.writer.alloc(N_ThisExpression, start);
				const end = this.end;

				this.next();

				return this.writer.finish(node, end);
			}

			case T_super: {
				const node = this.writer.alloc(N_Super, start);
				const end = this.end;

				this.next();

				return this.writer.finish(node, end);
			}

			case T_BRACKET_OPEN:
				return this.parseArrayLiteral();

			case T_BRACE_OPEN:
				return this.parseObjectLiteral();

			case T_function:
				return this.parseFunctionExpression(start, false);

			case T_class:
				return this.parseClass(N_ClassExpression, 0);

			case T_new:
				return this.parseNewExpression();

			case T_TEMPLATE_FULL:
			case T_TEMPLATE_HEAD:
				return this.parseTemplateLiteral();

			case T_PAREN_OPEN:
				return this.parseParenthesizedExpression();

			case T_import:
				return this.parseImportExpression();

			case T_async:
				return this.parseAsyncExpression();

			case T_PRIVATE_IDENT:
				return this.parsePrivateIdentifier();

			default:
				if (this.atLiteral()) {
					return this.parseLiteral();
				}

				if (isIdentifierNameKind(kind)) {
					return this.parseIdentifier();
				}

				throw this.unexpected();
		}
	}

	/**
	 * Parses expressions that begin with the word `async`, which may be an
	 * ordinary identifier, an async function, or an async arrow.
	 * @returns The index of the expression node.
	 */
	private parseAsyncExpression(): number {
		const start = this.start;
		const state = this.tokenizer.save();

		this.next();

		if (this.at(T_function) && !this.newlineBefore) {
			return this.parseFunctionExpression(start, true);
		}

		if (!this.newlineBefore) {
			// `async x => ...`
			if (this.atBindingName() && this.peekIsArrow()) {
				return this.parseArrowFromSingleParameter(start, true);
			}

			if (this.at(T_PAREN_OPEN)) {
				if (this.parenthesizedIsFollowedByArrow()) {
					return this.parseArrowFunction(start, true);
				}

				if (this.kindAfterMatchingParen() === T_COLON) {
					const arrow = this.speculateArrowFunction(start, true);

					if (arrow !== 0) {
						return arrow;
					}
				}
			} else if (this.at(T_LT)) {
				const arrow = this.speculateArrowFunction(start, true);

				if (arrow !== 0) {
					return arrow;
				}
			}
		}

		// `async` turned out to be an ordinary identifier after all.
		this.tokenizer.restore(state);

		return this.parseIdentifier();
	}

	/**
	 * Looks ahead one token to see whether an arrow follows.
	 * @returns `true` when the next token is `=>`.
	 */
	private peekIsArrow(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(T_ARROW) && !this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Looks ahead to decide whether an `await` token is being used as a plain
	 * identifier rather than as an operator.
	 * @returns `true` when `await` is followed by something that cannot start
	 *      an expression.
	 */
	private nextIsIdentifierUse(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = !this.atExpressionStart() || this.at(T_ARROW);

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses an array literal, including holes and spread elements.
	 * @returns The index of the `ArrayExpression` node.
	 */
	private parseArrayLiteral(): number {
		const node = this.writer.alloc(N_ArrayExpression, this.start);
		const mark = this.writer.startList();

		this.next();

		while (!this.at(T_BRACKET_CLOSE) && !this.at(T_EOF)) {
			if (this.at(T_COMMA)) {
				// An elision produces a null element.
				this.writer.pushList(0);
				this.next();
				continue;
			}

			if (this.at(T_ELLIPSIS)) {
				const spread = this.writer.alloc(N_SpreadElement, this.start);

				this.next();
				this.writer.set(
					spread,
					NODE_A,
					this.parseAssignmentExpression(),
				);
				this.writer.pushList(this.writer.finish(spread, this.lastEnd));
			} else {
				this.writer.pushList(this.parseAssignmentExpression());
			}

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACKET_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an object literal.
	 * @returns The index of the `ObjectExpression` node.
	 */
	private parseObjectLiteral(): number {
		const node = this.writer.alloc(N_ObjectExpression, this.start);
		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			this.writer.pushList(this.parseObjectMember());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses one member of an object literal.
	 * @returns The index of the member node.
	 */
	private parseObjectMember(): number {
		const start = this.start;

		if (this.at(T_ELLIPSIS)) {
			const node = this.writer.alloc(N_SpreadElement, start);

			this.next();
			this.writer.set(node, NODE_A, this.parseAssignmentExpression());

			return this.writer.finish(node, this.lastEnd);
		}

		let isAsync = false;
		let isGenerator = false;
		let methodKind = MKIND_INIT;

		if (this.at(T_async) && this.nextStartsPropertyName()) {
			this.next();
			isAsync = true;
		}

		if (this.eat(T_STAR)) {
			isGenerator = true;
		}

		if (
			!isAsync &&
			!isGenerator &&
			(this.at(T_get) || this.at(T_set)) &&
			this.nextStartsPropertyName()
		) {
			methodKind = this.at(T_get) ? MKIND_GET : MKIND_SET;
			this.next();
		}

		const node = this.writer.alloc(N_Property, start);
		const computed = this.at(T_BRACKET_OPEN);
		const key = this.parsePropertyName();

		if (computed) {
			this.writer.addFlags(node, NF_COMPUTED);
		}

		this.writer.set(node, NODE_A, key);

		if (methodKind !== MKIND_INIT) {
			this.writer.addFlags(node, methodKind << MKIND_SHIFT);
			this.writer.set(
				node,
				NODE_B,
				this.parseMethodValue(false, false),
			);

			return this.writer.finish(node, this.lastEnd);
		}

		if (isAsync || isGenerator || this.at(T_PAREN_OPEN) || this.at(T_LT)) {
			this.writer.addFlags(node, NF_METHOD);
			this.writer.set(
				node,
				NODE_B,
				this.parseMethodValue(isAsync, isGenerator),
			);

			return this.writer.finish(node, this.lastEnd);
		}

		if (this.eat(T_COLON)) {
			this.writer.set(node, NODE_B, this.parseAssignmentExpression());

			return this.writer.finish(node, this.lastEnd);
		}

		// Shorthand, optionally with a default value in a pattern position.
		this.writer.addFlags(node, NF_SHORTHAND);

		if (this.at(T_ASSIGN)) {
			const pattern = this.writer.alloc(N_AssignmentPattern, start);

			this.next();
			this.writer.set(pattern, NODE_A, key);
			this.writer.set(pattern, NODE_B, this.parseAssignmentExpression());
			this.writer.set(
				node,
				NODE_B,
				this.writer.finish(pattern, this.lastEnd),
			);
		} else {
			this.writer.set(node, NODE_B, key);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses the function that implements a method or accessor.
	 * @param isAsync Whether the method was marked `async`.
	 * @param isGenerator Whether the method was marked with `*`.
	 * @returns The index of the `FunctionExpression` node.
	 */
	private parseMethodValue(isAsync: boolean, isGenerator: boolean): number {
		const node = this.writer.alloc(N_FunctionExpression, this.start);

		this.writer.set(node, NODE_D, this.tryParseTypeParameters());
		this.writer.set(node, NODE_B, this.parseParameterList());
		this.writer.set(node, NODE_E, this.tryParseTypeAnnotation());

		if (isAsync) {
			this.writer.addFlags(node, NF_ASYNC);
		}

		if (isGenerator) {
			this.writer.addFlags(node, NF_GENERATOR);
		}

		if (this.at(T_BRACE_OPEN)) {
			this.writer.set(
				node,
				NODE_C,
				this.parseFunctionBody(isAsync, isGenerator),
			);
		} else {
			// A method without a body is an overload signature.
			this.writer.retype(node, N_TSEmptyBodyFunctionExpression);
			this.semicolon();
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines whether a property name follows the current token.
	 * @returns `true` when the next token can start a property name.
	 */
	private nextStartsPropertyName(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			isIdentifierNameKind(kind) ||
			kind === T_STRING ||
			kind === T_NUMBER ||
			kind === T_BRACKET_OPEN ||
			kind === T_PRIVATE_IDENT ||
			kind === T_STAR;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses a property name, which may be computed.
	 * @returns The index of the key node.
	 */
	protected parsePropertyName(): number {
		if (this.at(T_BRACKET_OPEN)) {
			this.next();

			const key = this.parseAssignmentExpression();

			this.expect(T_BRACKET_CLOSE);

			return key;
		}

		if (this.at(T_STRING) || this.at(T_NUMBER) || this.at(T_BIGINT)) {
			return this.parseLiteral();
		}

		if (this.at(T_PRIVATE_IDENT)) {
			return this.parsePrivateIdentifier();
		}

		return this.parseIdentifierName();
	}

	/**
	 * Parses a template literal.
	 * @returns The index of the `TemplateLiteral` node.
	 */
	private parseTemplateLiteral(): number {
		const node = this.writer.alloc(N_TemplateLiteral, this.start);
		const mark = this.writer.startList();

		if (this.at(T_TEMPLATE_FULL)) {
			this.writer.pushList(this.parseTemplateElement(true));
		} else {
			this.writer.pushList(this.parseTemplateElement(false));

			for (;;) {
				this.writer.pushList(this.parseExpression());

				if (this.at(T_TEMPLATE_TAIL)) {
					this.writer.pushList(this.parseTemplateElement(true));
					break;
				}

				if (!this.at(T_TEMPLATE_MIDDLE)) {
					throw this.unexpected();
				}

				this.writer.pushList(this.parseTemplateElement(false));
			}
		}

		const [quasis, expressions] = this.writer.endInterleavedLists(mark);

		this.writer.set(node, NODE_A, quasis);
		this.writer.set(node, NODE_B, expressions);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `new X(...)` and `new.target`.
	 * @returns The index of the expression node.
	 */
	private parseNewExpression(): number {
		const start = this.start;
		const meta = this.parseWordAsIdentifier();

		if (this.at(T_DOT)) {
			const node = this.writer.alloc(N_MetaProperty, start);

			this.next();
			this.writer.set(node, NODE_A, meta);
			this.writer.set(node, NODE_B, this.parseIdentifierName());

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_NewExpression, start);

		this.writer.set(node, NODE_A, this.parseCallOrMemberExpression(true));

		if (this.at(T_LT)) {
			this.writer.set(node, NODE_C, this.parseTypeArguments());
		}

		if (this.at(T_PAREN_OPEN)) {
			this.writer.set(node, NODE_B, this.parseArguments());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `import(...)` and `import.meta`.
	 * @returns The index of the expression node.
	 */
	private parseImportExpression(): number {
		const start = this.start;
		const meta = this.parseWordAsIdentifier();

		if (this.at(T_DOT)) {
			const node = this.writer.alloc(N_MetaProperty, start);

			this.next();
			this.writer.set(node, NODE_A, meta);
			this.writer.set(node, NODE_B, this.parseIdentifierName());

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_ImportExpression, start);

		this.expect(T_PAREN_OPEN);
		this.writer.set(node, NODE_A, this.parseAssignmentExpression());

		if (this.eat(T_COMMA) && !this.at(T_PAREN_CLOSE)) {
			this.writer.set(node, NODE_B, this.parseAssignmentExpression());
			this.eat(T_COMMA);
		}

		this.expect(T_PAREN_CLOSE);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a parenthesized expression or sequence.
	 * @returns The index of the expression node.
	 */
	private parseParenthesizedExpression(): number {
		this.next();

		const inner = this.parseExpression();

		this.expect(T_PAREN_CLOSE);
		this.writer.addFlags(inner, NF_PARENTHESIZED);

		return inner;
	}

	//-------------------------------------------------------------------------
	// Arrow Functions
	//-------------------------------------------------------------------------

	/**
	 * Tries to parse an arrow function at the current position.
	 * @returns The node index, or `0` when this is not an arrow function.
	 */
	private tryParseArrowFunction(): number {
		const kind = this.kind;
		const start = this.start;

		if (this.atBindingName() && kind !== T_async && this.peekIsArrow()) {
			return this.parseArrowFromSingleParameter(start, false);
		}

		if (kind === T_PAREN_OPEN) {
			/*
			 * Finding the matching `)` means scanning everything in between,
			 * so one token of lookahead rules out the common cases first. A
			 * parenthesized JSX element is the one that matters: without this
			 * check, every `return (<div>...</div>)` would rescan its whole
			 * subtree looking for an arrow that cannot be there.
			 */
			if (!this.nextCanStartParameterList()) {
				return 0;
			}

			if (this.parenthesizedIsFollowedByArrow()) {
				return this.parseArrowFunction(start, false);
			}

			// A return type annotation hides the arrow behind a type.
			if (this.kindAfterMatchingParen() === T_COLON) {
				return this.speculateArrowFunction(start, false);
			}

			return 0;
		}

		if (kind === T_LT) {
			return this.speculateArrowFunction(start, false);
		}

		return 0;
	}

	/**
	 * Determines whether the token after the current `(` could begin a
	 * parameter list.
	 * @returns `true` when an arrow function is still possible.
	 */
	private nextCanStartParameterList(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			this.atBindingName() ||
			kind === T_PAREN_CLOSE ||
			kind === T_BRACE_OPEN ||
			kind === T_BRACKET_OPEN ||
			kind === T_ELLIPSIS ||
			kind === T_this ||
			kind === T_AT;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Attempts a full arrow function parse, undoing it on failure.
	 * @param start The offset at which the arrow function would begin.
	 * @param isAsync Whether the arrow was preceded by `async`.
	 * @returns The node index, or `0` when the attempt failed.
	 */
	private speculateArrowFunction(start: number, isAsync: boolean): number {
		return this.speculate(() => this.parseArrowFunction(start, isAsync));
	}

	/**
	 * Runs a parse that may fail, undoing everything it wrote if it does.
	 * @param attempt The parse to try.
	 * @returns The node index the attempt produced, or `0` when it failed.
	 */
	protected speculate(attempt: () => number): number {
		const state = this.tokenizer.save();
		const snapshot = this.writer.mark();

		try {
			return attempt();
		} catch {
			this.writer.rewind(snapshot);
			this.tokenizer.restore(state);

			return 0;
		}
	}

	/**
	 * Parses an arrow function whose parameters are parenthesized.
	 * @param start The offset at which the arrow function begins.
	 * @param isAsync Whether the arrow was preceded by `async`.
	 * @returns The index of the `ArrowFunctionExpression` node.
	 */
	private parseArrowFunction(start: number, isAsync: boolean): number {
		const node = this.writer.alloc(N_ArrowFunctionExpression, start);

		this.writer.set(node, NODE_D, this.tryParseTypeParameters());
		this.writer.set(node, NODE_B, this.parseParameterList());
		this.writer.set(node, NODE_E, this.tryParseTypeAnnotation());
		this.expect(T_ARROW);
		this.finishArrowBody(node, isAsync);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an arrow function with a single unparenthesized parameter.
	 * @param start The offset at which the arrow function begins.
	 * @param isAsync Whether the arrow was preceded by `async`.
	 * @returns The index of the `ArrowFunctionExpression` node.
	 */
	private parseArrowFromSingleParameter(
		start: number,
		isAsync: boolean,
	): number {
		const node = this.writer.alloc(N_ArrowFunctionExpression, start);

		this.writer.set(
			node,
			NODE_B,
			this.writer.singletonList(this.parseIdentifier()),
		);
		this.expect(T_ARROW);
		this.finishArrowBody(node, isAsync);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses the body of an arrow function.
	 * @param node The arrow function node being built.
	 * @param isAsync Whether the arrow was preceded by `async`.
	 * @returns Nothing.
	 */
	private finishArrowBody(node: number, isAsync: boolean): void {
		if (isAsync) {
			this.writer.addFlags(node, NF_ASYNC);
		}

		const previousAsync = this.inAsync;
		const previousGenerator = this.inGenerator;

		this.inAsync = isAsync;
		this.inGenerator = false;
		this.tokenizer.inAsync = isAsync;
		this.tokenizer.inGenerator = false;

		if (this.at(T_BRACE_OPEN)) {
			this.writer.set(node, NODE_C, this.parseBlock(true));
		} else {
			this.writer.addFlags(node, NF_EXPRESSION_BODY);
			this.writer.set(node, NODE_C, this.parseAssignmentExpression());
		}

		this.inAsync = previousAsync;
		this.inGenerator = previousGenerator;
		this.tokenizer.inAsync = previousAsync;
		this.tokenizer.inGenerator = previousGenerator;
	}

	//-------------------------------------------------------------------------
	// Functions
	//-------------------------------------------------------------------------

	/**
	 * Parses a function expression.
	 * @param start The offset at which the expression begins.
	 * @param isAsync Whether the function was preceded by `async`.
	 * @returns The index of the `FunctionExpression` node.
	 */
	private parseFunctionExpression(start: number, isAsync: boolean): number {
		const node = this.writer.alloc(N_FunctionExpression, start);

		this.next();

		const isGenerator = this.eat(T_STAR);

		if (isAsync) {
			this.writer.addFlags(node, NF_ASYNC);
		}

		if (isGenerator) {
			this.writer.addFlags(node, NF_GENERATOR);
		}

		if (!this.at(T_PAREN_OPEN) && !this.at(T_LT)) {
			this.writer.set(node, NODE_A, this.parseIdentifier());
		}

		this.writer.set(node, NODE_D, this.tryParseTypeParameters());
		this.writer.set(node, NODE_B, this.parseParameterList());
		this.writer.set(node, NODE_E, this.tryParseTypeAnnotation());
		this.writer.set(
			node,
			NODE_C,
			this.parseFunctionBody(isAsync, isGenerator),
		);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a function body, switching the `await` and `yield` contexts.
	 * @param isAsync Whether the function is async.
	 * @param isGenerator Whether the function is a generator.
	 * @returns The index of the `BlockStatement` node.
	 */
	protected parseFunctionBody(
		isAsync: boolean,
		isGenerator: boolean,
	): number {
		const previousAsync = this.inAsync;
		const previousGenerator = this.inGenerator;

		this.inAsync = isAsync;
		this.inGenerator = isGenerator;
		this.tokenizer.inAsync = isAsync;
		this.tokenizer.inGenerator = isGenerator;

		const body = this.parseBlock(true);

		this.inAsync = previousAsync;
		this.inGenerator = previousGenerator;
		this.tokenizer.inAsync = previousAsync;
		this.tokenizer.inGenerator = previousGenerator;

		return body;
	}

	//-------------------------------------------------------------------------
	// Parameters and Patterns
	//-------------------------------------------------------------------------

	/**
	 * Parses a parenthesized parameter list.
	 * @returns A list handle holding the parameter nodes.
	 */
	parseParameterList(): number {
		const mark = this.writer.startList();

		this.expect(T_PAREN_OPEN);

		while (!this.at(T_PAREN_CLOSE) && !this.at(T_EOF)) {
			this.writer.pushList(this.parseParameter());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_PAREN_CLOSE);

		return this.writer.endList(mark);
	}

	/**
	 * Parses one parameter, including TypeScript parameter properties.
	 * @returns The index of the parameter node.
	 */
	parseParameter(): number {
		const start = this.start;
		const decorators = this.parseDecorators();
		let modifiers = 0;
		let sawModifier = false;

		for (;;) {
			const kind = this.kind;
			let bit: number;

			if (kind === T_public) {
				bit = ACCESS_PUBLIC << ACCESS_SHIFT;
			} else if (kind === T_private) {
				bit = ACCESS_PRIVATE << ACCESS_SHIFT;
			} else if (kind === T_protected) {
				bit = ACCESS_PROTECTED << ACCESS_SHIFT;
			} else if (kind === T_readonly) {
				bit = NF_READONLY;
			} else if (kind === T_override) {
				bit = NF_OVERRIDE;
			} else {
				break;
			}

			if (!this.nextStartsBindingElement()) {
				break;
			}

			modifiers |= bit;
			sawModifier = true;
			this.next();
		}

		const element = this.parseBindingElement();

		if (!sawModifier && decorators === 0) {
			return element;
		}

		const node = this.writer.alloc(N_TSParameterProperty, start);

		this.writer.set(node, NODE_A, element);
		this.writer.set(node, NODE_B, decorators);
		this.writer.addFlags(node, modifiers);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines whether a binding element follows the current token.
	 * @returns `true` when the next token can start a binding element.
	 */
	private nextStartsBindingElement(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			this.atBindingName() ||
			kind === T_BRACE_OPEN ||
			kind === T_BRACKET_OPEN ||
			kind === T_ELLIPSIS ||
			kind === T_this ||
			kind === T_public ||
			kind === T_private ||
			kind === T_protected ||
			kind === T_readonly ||
			kind === T_override;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses a binding element: a target with an optional type annotation and
	 * an optional default value.
	 * @returns The index of the pattern node.
	 */
	protected parseBindingElement(): number {
		const start = this.start;

		if (this.at(T_ELLIPSIS)) {
			const node = this.writer.alloc(N_RestElement, start);

			this.next();
			this.writer.set(node, NODE_A, this.parseBindingAtom());
			this.writer.set(node, NODE_B, this.tryParseTypeAnnotation());

			return this.writer.finish(node, this.lastEnd);
		}

		const target = this.parseBindingAtom();

		if (this.eat(T_QUESTION)) {
			this.writer.addFlags(target, NF_OPTIONAL);
		}

		if (this.at(T_NOT)) {
			this.next();
			this.writer.addFlags(target, NF_DEFINITE);
		}

		const annotation = this.tryParseTypeAnnotation();

		if (annotation !== 0) {
			this.writer.set(target, NODE_B, annotation);
			this.writer.finish(target, this.lastEnd);
		}

		if (!this.at(T_ASSIGN)) {
			return target;
		}

		const node = this.writer.alloc(N_AssignmentPattern, start);

		this.next();
		this.writer.set(node, NODE_A, target);
		this.writer.set(node, NODE_B, this.parseAssignmentExpression());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a binding target: an identifier or a destructuring pattern.
	 * @returns The index of the pattern node.
	 */
	parseBindingAtom(): number {
		if (this.at(T_BRACKET_OPEN)) {
			return this.parseArrayPattern();
		}

		if (this.at(T_BRACE_OPEN)) {
			return this.parseObjectPattern();
		}

		if (this.at(T_this)) {
			// A `this` parameter carries only a type annotation.
			const node = this.writer.alloc(N_Identifier, this.start);
			const end = this.end;

			this.writer.set(node, NODE_A, end);
			this.next();

			return this.writer.finish(node, end);
		}

		return this.parseIdentifier();
	}

	/**
	 * Parses an array destructuring pattern.
	 * @returns The index of the `ArrayPattern` node.
	 */
	private parseArrayPattern(): number {
		const node = this.writer.alloc(N_ArrayPattern, this.start);
		const mark = this.writer.startList();

		this.next();

		while (!this.at(T_BRACKET_CLOSE) && !this.at(T_EOF)) {
			if (this.at(T_COMMA)) {
				this.writer.pushList(0);
				this.next();
				continue;
			}

			this.writer.pushList(this.parseBindingElement());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACKET_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an object destructuring pattern.
	 * @returns The index of the `ObjectPattern` node.
	 */
	private parseObjectPattern(): number {
		const node = this.writer.alloc(N_ObjectPattern, this.start);
		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			if (this.at(T_ELLIPSIS)) {
				const rest = this.writer.alloc(N_RestElement, this.start);

				this.next();
				this.writer.set(rest, NODE_A, this.parseBindingAtom());
				this.writer.pushList(this.writer.finish(rest, this.lastEnd));

				if (!this.eat(T_COMMA)) {
					break;
				}

				continue;
			}

			const start = this.start;
			const property = this.writer.alloc(N_Property, start);
			const computed = this.at(T_BRACKET_OPEN);
			const key = this.parsePropertyName();

			if (computed) {
				this.writer.addFlags(property, NF_COMPUTED);
			}

			this.writer.set(property, NODE_A, key);

			if (this.eat(T_COLON)) {
				this.writer.set(property, NODE_B, this.parseBindingElement());
			} else {
				this.writer.addFlags(property, NF_SHORTHAND);

				if (this.at(T_ASSIGN)) {
					const pattern = this.writer.alloc(
						N_AssignmentPattern,
						start,
					);

					this.next();
					this.writer.set(pattern, NODE_A, key);
					this.writer.set(
						pattern,
						NODE_B,
						this.parseAssignmentExpression(),
					);
					this.writer.set(
						property,
						NODE_B,
						this.writer.finish(pattern, this.lastEnd),
					);
				} else {
					this.writer.set(property, NODE_B, key);
				}
			}

			this.writer.pushList(this.writer.finish(property, this.lastEnd));

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Reinterprets an already-parsed expression as a binding pattern, which is
	 * what makes `[a, b] = c` produce an `ArrayPattern`.
	 * @param node The node to convert in place.
	 * @returns Nothing.
	 */
	protected toPattern(node: number): void {
		if (node === 0) {
			return;
		}

		const kind = this.writer.get(node, NODE_KIND);

		switch (kind) {
			case N_ArrayExpression: {
				this.writer.retype(node, N_ArrayPattern);
				this.forEachListItem(this.writer.get(node, NODE_A), item => {
					this.toPattern(item);
				});
				return;
			}

			case N_ObjectExpression: {
				this.writer.retype(node, N_ObjectPattern);
				this.forEachListItem(this.writer.get(node, NODE_A), item => {
					this.toPattern(item);
				});
				return;
			}

			case N_Property:
				this.toPattern(this.writer.get(node, NODE_B));
				return;

			case N_SpreadElement:
				this.writer.retype(node, N_RestElement);
				this.toPattern(this.writer.get(node, NODE_A));
				return;

			case N_AssignmentExpression:
				this.writer.retype(node, N_AssignmentPattern);
				this.toPattern(this.writer.get(node, NODE_A));
				return;

			default:
				return;
		}
	}

	/**
	 * Visits every element of a list.
	 * @param handle The list handle.
	 * @param visit The callback to run for each non-empty element.
	 * @returns Nothing.
	 */
	private forEachListItem(
		handle: number,
		visit: (item: number) => void,
	): void {
		if (handle === 0) {
			return;
		}

		const words = this.writer.lists.words;
		const size = words[handle];

		for (let i = 0; i < size; i++) {
			const item = words[handle + 1 + i];

			if (item !== 0) {
				visit(item);
			}
		}
	}

	//-------------------------------------------------------------------------
	// Classes
	//-------------------------------------------------------------------------

	/**
	 * Parses decorators that precede a declaration or member.
	 * @returns A list handle holding the `Decorator` nodes.
	 */
	protected parseDecorators(): number {
		if (!this.at(T_AT)) {
			return 0;
		}

		const mark = this.writer.startList();

		while (this.at(T_AT)) {
			const node = this.writer.alloc(N_Decorator, this.start);

			this.next();
			this.writer.set(
				node,
				NODE_A,
				this.parseCallOrMemberExpression(false),
			);
			this.writer.pushList(this.writer.finish(node, this.lastEnd));
		}

		return this.writer.endList(mark);
	}

	/**
	 * Parses a class declaration or expression.
	 * @param nodeKind Either `N_ClassDeclaration` or `N_ClassExpression`.
	 * @param decorators A list handle of decorators parsed before the class.
	 * @returns The index of the class node.
	 */
	protected parseClass(
		nodeKind: number,
		decorators: number,
		start = this.start,
	): number {
		const node = this.writer.alloc(nodeKind, start);

		this.writer.set(node, NODE_G, decorators);
		this.next();

		if (this.atBindingName() && !this.at(T_implements)) {
			this.writer.set(node, NODE_A, this.parseIdentifier());
		}

		this.writer.set(node, NODE_D, this.tryParseTypeParameters());

		if (this.eat(T_extends)) {
			this.writer.set(node, NODE_B, this.parseCallOrMemberExpression(true));

			if (this.at(T_LT)) {
				this.writer.set(node, NODE_E, this.parseTypeArguments());
			}
		}

		if (this.at(T_implements)) {
			this.next();

			const mark = this.writer.startList();

			do {
				const heritage = this.writer.alloc(
					N_TSClassImplements,
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

			this.writer.set(node, NODE_F, this.writer.endList(mark));
		}

		this.writer.set(node, NODE_C, this.parseClassBody());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses the name in an `extends` or `implements` clause, which is modeled
	 * as an expression rather than as a type name.
	 * @returns The index of the expression node.
	 */
	protected parseHeritageExpression(): number {
		const start = this.start;
		let expression = this.parseIdentifier();

		while (this.eat(T_DOT)) {
			expression = this.finishMember(
				start,
				expression,
				this.parseIdentifierName(),
				false,
				false,
			);
		}

		return expression;
	}

	/**
	 * Parses the body of a class.
	 * @returns The index of the `ClassBody` node.
	 */
	private parseClassBody(): number {
		const node = this.writer.alloc(N_ClassBody, this.start);
		const mark = this.writer.startList();
		const previousSuperProperty = this.allowSuperProperty;

		this.allowSuperProperty = true;
		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			if (this.eat(T_SEMICOLON)) {
				continue;
			}

			this.writer.pushList(this.parseClassMember());
		}

		this.expect(T_BRACE_CLOSE);
		this.allowSuperProperty = previousSuperProperty;
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses one class member, including all of its modifiers.
	 * @returns The index of the member node.
	 */
	private parseClassMember(): number {
		const start = this.start;
		const decorators = this.parseDecorators();
		let flags = 0;
		let isStatic = false;
		let isAbstract = false;
		let isAsync = false;
		let isGenerator = false;
		let isAccessor = false;
		let methodKind = MKIND_INIT;

		for (;;) {
			const kind = this.kind;

			if (kind === T_static && this.nextStartsClassElementName()) {
				this.next();
				isStatic = true;
				continue;
			}

			if (kind === T_abstract && this.nextStartsClassElementName()) {
				this.next();
				isAbstract = true;
				continue;
			}

			if (kind === T_declare && this.nextStartsClassElementName()) {
				this.next();
				flags |= NF_DECLARE;
				continue;
			}

			if (kind === T_override && this.nextStartsClassElementName()) {
				this.next();
				flags |= NF_OVERRIDE;
				continue;
			}

			if (kind === T_readonly && this.nextStartsClassElementName()) {
				this.next();
				flags |= NF_READONLY;
				continue;
			}

			if (
				(kind === T_public ||
					kind === T_private ||
					kind === T_protected) &&
				this.nextStartsClassElementName()
			) {
				const access =
					kind === T_public
						? ACCESS_PUBLIC
						: kind === T_private
							? ACCESS_PRIVATE
							: ACCESS_PROTECTED;

				this.next();
				flags |= access << ACCESS_SHIFT;
				continue;
			}

			if (kind === T_accessor && this.nextStartsClassElementName()) {
				this.next();
				isAccessor = true;
				continue;
			}

			break;
		}

		// An index signature stands in for a named member.
		if (this.atIndexSignature()) {
			const signature = this.parseIndexSignature(
				start,
				(flags & NF_READONLY) !== 0,
			);

			this.writer.addFlags(
				signature,
				flags & ~NF_READONLY,
			);

			if (isStatic) {
				this.writer.addFlags(signature, NF_STATIC);
			}

			this.semicolon();

			return this.writer.finish(signature, this.lastEnd);
		}

		// A static initialization block has no name.
		if (isStatic && this.at(T_BRACE_OPEN)) {
			const node = this.writer.alloc(N_StaticBlock, start);
			const mark = this.writer.startList();

			this.enterBrace(true);

			while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
				this.writer.pushList(this.parseStatement());
			}

			this.expect(T_BRACE_CLOSE);
			this.writer.set(node, NODE_A, this.writer.endList(mark));

			return this.writer.finish(node, this.lastEnd);
		}

		if (this.at(T_async) && this.nextStartsClassElementName()) {
			this.next();
			isAsync = true;
		}

		if (this.eat(T_STAR)) {
			isGenerator = true;
		}

		if (
			!isAsync &&
			!isGenerator &&
			(this.at(T_get) || this.at(T_set)) &&
			this.nextStartsClassElementName()
		) {
			methodKind = this.at(T_get) ? MKIND_GET : MKIND_SET;
			this.next();
		}

		const computed = this.at(T_BRACKET_OPEN);
		const key = this.parsePropertyName();
		const optional = this.eat(T_QUESTION);
		const definite = !optional && this.at(T_NOT);

		if (definite) {
			this.next();
		}

		if (
			methodKind !== MKIND_INIT ||
			isAsync ||
			isGenerator ||
			this.at(T_PAREN_OPEN) ||
			this.at(T_LT)
		) {
			return this.finishMethodDefinition(
				start,
				key,
				decorators,
				flags,
				isStatic,
				isAbstract,
				computed,
				optional,
				methodKind === MKIND_INIT ? MKIND_METHOD : methodKind,
				isAsync,
				isGenerator,
			);
		}

		return this.finishPropertyDefinition(
			start,
			key,
			decorators,
			flags,
			isStatic,
			isAbstract,
			isAccessor,
			computed,
			optional,
			definite,
		);
	}

	/**
	 * Builds a method definition node from already-parsed modifiers.
	 * @param start The offset at which the member began.
	 * @param key The member's key node.
	 * @param decorators A list handle of the member's decorators.
	 * @param flags Modifier flags gathered so far.
	 * @param isStatic Whether the member is static.
	 * @param isAbstract Whether the member is abstract.
	 * @param computed Whether the key was computed.
	 * @param optional Whether the member was marked with `?`.
	 * @param methodKind The packed method kind.
	 * @param isAsync Whether the method is async.
	 * @param isGenerator Whether the method is a generator.
	 * @returns The index of the method node.
	 */
	private finishMethodDefinition(
		start: number,
		key: number,
		decorators: number,
		flags: number,
		isStatic: boolean,
		isAbstract: boolean,
		computed: boolean,
		optional: boolean,
		methodKind: number,
		isAsync: boolean,
		isGenerator: boolean,
	): number {
		const node = this.writer.alloc(
			isAbstract ? N_TSAbstractMethodDefinition : N_MethodDefinition,
			start,
		);
		const isConstructor =
			!computed &&
			!isStatic &&
			methodKind === MKIND_METHOD &&
			this.isNamed(key, "constructor");

		this.writer.set(node, NODE_A, key);
		this.writer.set(node, NODE_C, decorators);
		this.writer.addFlags(node, flags);

		if (isStatic) {
			this.writer.addFlags(node, NF_STATIC);
		}

		if (computed) {
			this.writer.addFlags(node, NF_COMPUTED);
		}

		if (optional) {
			this.writer.addFlags(node, NF_OPTIONAL);
		}

		this.writer.addFlags(
			node,
			(isConstructor ? MKIND_CONSTRUCTOR : methodKind) << MKIND_SHIFT,
		);

		const previousSuperCall = this.allowSuperCall;

		this.allowSuperCall = isConstructor;
		this.writer.set(node, NODE_B, this.parseMethodValue(isAsync, isGenerator));
		this.allowSuperCall = previousSuperCall;

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Builds a property definition node from already-parsed modifiers.
	 * @param start The offset at which the member began.
	 * @param key The member's key node.
	 * @param decorators A list handle of the member's decorators.
	 * @param flags Modifier flags gathered so far.
	 * @param isStatic Whether the member is static.
	 * @param isAbstract Whether the member is abstract.
	 * @param isAccessor Whether the member used the `accessor` keyword.
	 * @param computed Whether the key was computed.
	 * @param optional Whether the member was marked with `?`.
	 * @param definite Whether the member was marked with `!`.
	 * @returns The index of the property node.
	 */
	private finishPropertyDefinition(
		start: number,
		key: number,
		decorators: number,
		flags: number,
		isStatic: boolean,
		isAbstract: boolean,
		isAccessor: boolean,
		computed: boolean,
		optional: boolean,
		definite: boolean,
	): number {
		let nodeKind = N_PropertyDefinition;

		if (isAccessor) {
			nodeKind = isAbstract
				? N_TSAbstractAccessorProperty
				: N_AccessorProperty;
		} else if (isAbstract) {
			nodeKind = N_TSAbstractPropertyDefinition;
		}

		const node = this.writer.alloc(nodeKind, start);

		this.writer.set(node, NODE_A, key);
		this.writer.set(node, NODE_C, decorators);
		this.writer.set(node, NODE_D, this.tryParseTypeAnnotation());
		this.writer.addFlags(node, flags);

		if (isStatic) {
			this.writer.addFlags(node, NF_STATIC);
		}

		if (computed) {
			this.writer.addFlags(node, NF_COMPUTED);
		}

		if (optional) {
			this.writer.addFlags(node, NF_OPTIONAL);
		}

		if (definite) {
			this.writer.addFlags(node, NF_DEFINITE);
		}

		if (this.eat(T_ASSIGN)) {
			this.writer.set(node, NODE_B, this.parseAssignmentExpression());
		}

		this.semicolon();

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines whether a key node is a plain identifier with a given name.
	 * @param key The key node to test.
	 * @param name The name to compare against.
	 * @returns `true` when the key spells exactly that name.
	 */
	private isNamed(key: number, name: string): boolean {
		const kind = this.writer.get(key, NODE_KIND);

		if (kind !== N_Identifier) {
			return false;
		}

		const start = this.writer.get(key, NODE_START);
		const end = this.writer.get(key, NODE_END);

		if (end - start !== name.length) {
			return false;
		}

		for (let i = 0; i < name.length; i++) {
			if (this.source.charCodeAt(start + i) !== name.charCodeAt(i)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Determines whether a class element name follows the current token.
	 * @returns `true` when the next token can start a class element name.
	 */
	private nextStartsClassElementName(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			(isIdentifierNameKind(kind) ||
				kind === T_STRING ||
				kind === T_NUMBER ||
				kind === T_BRACKET_OPEN ||
				kind === T_PRIVATE_IDENT ||
				kind === T_STAR ||
				kind === T_BRACE_OPEN) &&
			!this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	//-------------------------------------------------------------------------
	// Layer Boundaries
	//-------------------------------------------------------------------------

	/**
	 * Parses a JSX element or fragment starting at the current `<`.
	 * @param inChildren Whether the element is a child of another element.
	 * @returns The index of the element node.
	 */
	protected abstract parseJsxRoot(inChildren: boolean): number;

	/**
	 * Parses a statement.
	 * @returns The index of the statement node.
	 */
	abstract parseStatement(): number;

	/**
	 * Parses a brace-delimited block of statements.
	 * @param withDirectives Whether a directive prologue may appear here.
	 * @returns The index of the `BlockStatement` node.
	 */
	abstract parseBlock(withDirectives?: boolean): number;
}
