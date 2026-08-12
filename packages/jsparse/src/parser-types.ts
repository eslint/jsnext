/**
 * @fileoverview The TypeScript type grammar.
 *
 * Type syntax is always accepted, regardless of whether the source is meant to
 * be JavaScript. Rejecting it is the validation phase's job, which keeps the
 * scanner and parser free of any dialect switch.
 */

import { ParserBase } from "./parser-base.js";
import {
	MKIND_SHIFT,
	NF_ABSTRACT,
	NF_COMPUTED,
	NF_CONST,
	NF_IN,
	NF_OPTIONAL,
	NF_READONLY,
	NF_STATIC,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	NODE_KIND,
	NF_PREFIX,
	N_UnaryExpression,
	N_TSAnyKeyword,
	N_TSArrayType,
	N_TSBigIntKeyword,
	N_TSBooleanKeyword,
	N_TSCallSignatureDeclaration,
	N_TSConditionalType,
	N_TSConstructSignatureDeclaration,
	N_TSConstructorType,
	N_TSFunctionType,
	N_TSImportType,
	N_TSIndexSignature,
	N_TSIndexedAccessType,
	N_TSInferType,
	N_TSIntersectionType,
	N_TSIntrinsicKeyword,
	N_TSLiteralType,
	N_TSMappedType,
	N_TSMethodSignature,
	N_TSNamedTupleMember,
	N_TSNeverKeyword,
	N_TSNullKeyword,
	N_TSNumberKeyword,
	N_TSObjectKeyword,
	N_TSOptionalType,
	N_TSPropertySignature,
	N_TSQualifiedName,
	N_TSRestType,
	N_TSStringKeyword,
	N_TSSymbolKeyword,
	N_TSTemplateLiteralType,
	N_TSThisType,
	N_ThisExpression,
	N_TSTupleType,
	N_TSTypeAnnotation,
	N_TSTypeLiteral,
	N_TSTypeOperator,
	N_TSTypeParameter,
	N_TSTypeParameterDeclaration,
	N_TSTypeParameterInstantiation,
	N_TSTypePredicate,
	N_TSTypeQuery,
	N_TSTypeReference,
	N_TSUndefinedKeyword,
	N_TSUnionType,
	N_TSUnknownKeyword,
	N_TSVoidKeyword,
	N_TemplateElement,
	NF_TAIL,
	NF_INVALID_ESCAPE,
} from "./node-kinds.js";
import { TF_INVALID_ESCAPE } from "./binary.js";
import {
	T_AMP,
	T_ARROW,
	T_ASSIGN,
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
	T_NUMBER,
	T_PAREN_CLOSE,
	T_PAREN_OPEN,
	T_PIPE,
	T_PLUS,
	T_QUESTION,
	T_SEMICOLON,
	T_STRING,
	T_TEMPLATE_FULL,
	T_TEMPLATE_HEAD,
	T_TEMPLATE_MIDDLE,
	T_TEMPLATE_TAIL,
	T_abstract,
	T_any,
	T_as,
	T_asserts,
	T_bigint,
	T_boolean,
	T_const,
	T_extends,
	T_false,
	T_get,
	T_import,
	T_in,
	T_infer,
	T_intrinsic,
	T_is,
	T_keyof,
	T_never,
	T_new,
	T_null,
	T_number,
	T_object,
	T_out,
	T_readonly,
	T_set,
	T_string,
	T_symbol,
	T_this,
	T_true,
	T_typeof,
	T_undefined,
	T_unique,
	T_unknown,
	T_void,
	isIdentifierNameKind,
} from "./token-kinds.js";

/**
 * Adds the TypeScript type grammar to the parser.
 */
export abstract class TypeParser extends ParserBase {
	/**
	 * Whether a conditional type is currently out of reach, which is true
	 * inside the `extends` type of an enclosing conditional. It is what decides
	 * who owns the `?` in `A extends infer B extends C ? D : E`.
	 */
	private noConditionalTypes = false;

	//-------------------------------------------------------------------------
	// Entry Points
	//-------------------------------------------------------------------------

	/**
	 * Parses a `: Type` annotation when one is present.
	 * @returns The `TSTypeAnnotation` node index, or `0` when absent.
	 */
	tryParseTypeAnnotation(): number {
		if (!this.at(T_COLON)) {
			return 0;
		}

		return this.parseTypeAnnotation();
	}

	/**
	 * Parses a `: Type` annotation, including the colon.
	 * @returns The index of the `TSTypeAnnotation` node.
	 * @throws {ParseError} When the colon or type is missing.
	 */
	parseTypeAnnotation(): number {
		const node = this.writer.alloc(N_TSTypeAnnotation, this.start);

		this.expect(T_COLON);
		this.writer.set(node, NODE_A, this.parseTypeOrPredicate());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a type, allowing the `x is T` and `asserts x is T` forms that are
	 * only legal as a return type.
	 * @returns The index of the type node.
	 */
	parseTypeOrPredicate(): number {
		const start = this.start;

		if (this.at(T_asserts)) {
			const state = this.tokenizer.save();
			const snapshot = this.writer.mark();

			this.next();

			if (
				(this.atBindingName() || this.at(T_this)) &&
				!this.newlineBefore
			) {
				const node = this.writer.alloc(N_TSTypePredicate, start);
				const parameterName = this.at(T_this)
					? this.parseThisType()
					: this.parseIdentifier();

				this.writer.set(node, NODE_A, parameterName);
				this.writer.set(node, NODE_C, 1);

				if (this.at(T_is)) {
					this.next();

					const annotation = this.writer.alloc(
						N_TSTypeAnnotation,
						this.start,
					);

					this.writer.set(annotation, NODE_A, this.parseType());
					this.writer.set(
						node,
						NODE_B,
						this.writer.finish(annotation, this.lastEnd),
					);
				}

				return this.writer.finish(node, this.lastEnd);
			}

			this.writer.rewind(snapshot);
			this.tokenizer.restore(state);
		}

		/*
		 * A predicate such as `object is Foo` begins with a plain name that
		 * would otherwise be read as a keyword type, so it is detected before
		 * the type is parsed at all.
		 */
		if (
			(this.atBindingName() || this.at(T_this)) &&
			this.peekIsOnSameLine(T_is)
		) {
			const node = this.writer.alloc(N_TSTypePredicate, start);

			this.writer.set(
				node,
				NODE_A,
				this.at(T_this) ? this.parseThisType() : this.parseIdentifier(),
			);
			this.next();

			const annotation = this.writer.alloc(
				N_TSTypeAnnotation,
				this.start,
			);

			this.writer.set(annotation, NODE_A, this.parseType());
			this.writer.set(
				node,
				NODE_B,
				this.writer.finish(annotation, this.lastEnd),
			);

			return this.writer.finish(node, this.lastEnd);
		}

		const type = this.parseType();

		if (this.at(T_is) && !this.newlineBefore) {
			const kindOfType = this.writer.get(type, NODE_KIND);

			if (kindOfType === N_TSTypeReference || kindOfType === N_TSThisType) {
				const node = this.writer.alloc(N_TSTypePredicate, start);

				this.next();

				const annotation = this.writer.alloc(
					N_TSTypeAnnotation,
					this.start,
				);

				this.writer.set(annotation, NODE_A, this.parseType());
				this.writer.set(
					node,
					NODE_A,
					kindOfType === N_TSThisType
						? type
						: this.writer.get(type, NODE_A),
				);
				this.writer.set(
					node,
					NODE_B,
					this.writer.finish(annotation, this.lastEnd),
				);

				return this.writer.finish(node, this.lastEnd);
			}
		}

		return type;
	}

	/**
	 * Parses a complete type, including conditional types.
	 * @returns The index of the type node.
	 */
	parseType(): number {
		const start = this.start;

		/*
		 * A conditional type may appear here, so an enclosing one no longer
		 * has any claim on the next `?`.
		 */
		const outerNoConditionalTypes = this.noConditionalTypes;

		this.noConditionalTypes = false;

		try {
			if (this.atConstructorTypeStart() || this.atFunctionTypeStart()) {
				return this.parseFunctionOrConstructorType();
			}

			const checkType = this.parseUnionType();

			if (!this.at(T_extends) || this.newlineBefore) {
				return checkType;
			}

			const node = this.writer.alloc(N_TSConditionalType, start);

			this.next();
			this.writer.set(node, NODE_A, checkType);

			/*
			 * The `extends` type is parsed without conditional types so that
			 * the `?` belongs to this conditional rather than a nested one.
			 */
			this.noConditionalTypes = true;
			this.writer.set(
				node,
				NODE_B,
				this.atConstructorTypeStart() || this.atFunctionTypeStart()
					? this.parseFunctionOrConstructorType()
					: this.parseUnionType(),
			);
			this.noConditionalTypes = false;

			this.expect(T_QUESTION);
			this.writer.set(node, NODE_C, this.parseType());
			this.expect(T_COLON);
			this.writer.set(node, NODE_D, this.parseType());

			return this.writer.finish(node, this.lastEnd);
		} finally {
			this.noConditionalTypes = outerNoConditionalTypes;
		}
	}

	//-------------------------------------------------------------------------
	// Composite Types
	//-------------------------------------------------------------------------

	/**
	 * Parses a union type, which may begin with a leading `|`.
	 * @returns The index of the type node.
	 */
	private parseUnionType(): number {
		return this.parseUnionOrIntersection(
			T_PIPE,
			N_TSUnionType,
			() => this.parseIntersectionType(),
		);
	}

	/**
	 * Parses an intersection type, which may begin with a leading `&`.
	 * @returns The index of the type node.
	 */
	private parseIntersectionType(): number {
		return this.parseUnionOrIntersection(
			T_AMP,
			N_TSIntersectionType,
			() => this.parseTypeOperator(),
		);
	}

	/**
	 * Shared driver for union and intersection types.
	 * @param separator The token kind that separates constituents.
	 * @param nodeKind The node kind to build when there is more than one.
	 * @param parseOperand Parses a single constituent.
	 * @returns The index of the type node.
	 */
	private parseUnionOrIntersection(
		separator: number,
		nodeKind: number,
		parseOperand: () => number,
	): number {
		const start = this.start;
		const leading = this.eat(separator);
		const first = parseOperand();

		if (!this.at(separator)) {
			return leading
				? this.wrapSingleConstituent(nodeKind, start, first)
				: first;
		}

		const node = this.writer.alloc(nodeKind, start);
		const mark = this.writer.startList();

		this.writer.pushList(first);

		while (this.eat(separator)) {
			this.writer.pushList(parseOperand());
		}

		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Wraps a lone constituent that was preceded by a leading separator, which
	 * TypeScript still models as a union or intersection of one.
	 * @param nodeKind The node kind to build.
	 * @param start The offset of the leading separator.
	 * @param operand The only constituent.
	 * @returns The index of the wrapper node.
	 */
	private wrapSingleConstituent(
		nodeKind: number,
		start: number,
		operand: number,
	): number {
		const node = this.writer.alloc(nodeKind, start);

		this.writer.set(node, NODE_A, this.writer.singletonList(operand));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `keyof`, `unique`, and `readonly` type operators.
	 * @returns The index of the type node.
	 */
	private parseTypeOperator(): number {
		const kind = this.kind;

		if (kind === T_keyof || kind === T_unique || kind === T_readonly) {
			const node = this.writer.alloc(N_TSTypeOperator, this.start);

			this.next();
			this.writer.set(node, NODE_A, this.parseTypeOperator());
			this.writer.set(node, NODE_B, kind);

			return this.writer.finish(node, this.lastEnd);
		}

		if (kind === T_infer) {
			return this.parseInferType();
		}

		return this.parsePostfixType();
	}

	/**
	 * Parses `infer T` and `infer T extends U`.
	 * @returns The index of the `TSInferType` node.
	 */
	private parseInferType(): number {
		const node = this.writer.alloc(N_TSInferType, this.start);

		this.next();

		const parameter = this.writer.alloc(N_TSTypeParameter, this.start);

		this.writer.set(parameter, NODE_A, this.parseIdentifier());

		/*
		 * `infer T extends U` is only a constraint when it is not the
		 * `extends` of an enclosing conditional type, which is the case when a
		 * `?` follows the type. Inside the `extends` type of a conditional the
		 * enclosing `extends` has already been consumed, so the `?` belongs to
		 * that conditional and the constraint stands.
		 */
		if (this.at(T_extends)) {
			const state = this.tokenizer.save();
			const snapshot = this.writer.mark();

			this.next();

			const constraint = this.parseUnionType();

			if (!this.noConditionalTypes && this.at(T_QUESTION)) {
				this.writer.rewind(snapshot);
				this.tokenizer.restore(state);
			} else {
				this.writer.set(parameter, NODE_B, constraint);
			}
		}

		this.writer.set(node, NODE_A, this.writer.finish(parameter, this.lastEnd));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses array and indexed access suffixes.
	 * @returns The index of the type node.
	 */
	private parsePostfixType(): number {
		const start = this.start;
		let type = this.parsePrimaryType();

		while (this.at(T_BRACKET_OPEN) && !this.newlineBefore) {
			this.next();

			if (this.eat(T_BRACKET_CLOSE)) {
				const node = this.writer.alloc(N_TSArrayType, start);

				this.writer.set(node, NODE_A, type);
				type = this.writer.finish(node, this.lastEnd);
				continue;
			}

			const node = this.writer.alloc(N_TSIndexedAccessType, start);

			this.writer.set(node, NODE_A, type);
			this.writer.set(node, NODE_B, this.parseType());
			this.expect(T_BRACKET_CLOSE);
			type = this.writer.finish(node, this.lastEnd);
		}

		return type;
	}

	//-------------------------------------------------------------------------
	// Primary Types
	//-------------------------------------------------------------------------

	/**
	 * Parses the innermost form of a type.
	 * @returns The index of the type node.
	 * @throws {ParseError} When no type can start here.
	 */
	private parsePrimaryType(): number {
		const kind = this.kind;
		const start = this.start;

		switch (kind) {
			case T_any:
				return this.parseKeywordType(N_TSAnyKeyword);

			case T_unknown:
				return this.parseKeywordType(N_TSUnknownKeyword);

			case T_never:
				return this.parseKeywordType(N_TSNeverKeyword);

			case T_string:
				return this.parseKeywordType(N_TSStringKeyword);

			case T_number:
				return this.parseKeywordType(N_TSNumberKeyword);

			case T_bigint:
				return this.parseKeywordType(N_TSBigIntKeyword);

			case T_boolean:
				return this.parseKeywordType(N_TSBooleanKeyword);

			case T_symbol:
				return this.parseKeywordType(N_TSSymbolKeyword);

			case T_object:
				return this.parseKeywordType(N_TSObjectKeyword);

			case T_undefined:
				return this.parseKeywordType(N_TSUndefinedKeyword);

			case T_void:
				return this.parseKeywordType(N_TSVoidKeyword);

			case T_intrinsic:
				return this.parseKeywordType(N_TSIntrinsicKeyword);

			case T_null:
				return this.parseKeywordType(N_TSNullKeyword);

			case T_this:
				return this.parseThisType();

			case T_typeof:
				return this.parseTypeQuery();

			case T_import:
				return this.parseImportType();

			case T_BRACKET_OPEN:
				return this.parseTupleType();

			case T_BRACE_OPEN:
				return this.atMappedTypeStart()
					? this.parseMappedType()
					: this.parseTypeLiteral();

			case T_PAREN_OPEN: {
				this.next();

				const inner = this.parseType();

				this.expect(T_PAREN_CLOSE);

				return inner;
			}

			case T_STRING:
			case T_NUMBER:
			case T_BIGINT:
			case T_true:
			case T_false: {
				const node = this.writer.alloc(N_TSLiteralType, start);

				this.writer.set(node, NODE_A, this.parseLiteral());

				return this.writer.finish(node, this.lastEnd);
			}

			case T_MINUS: {
				const node = this.writer.alloc(N_TSLiteralType, start);

				this.writer.set(node, NODE_A, this.parseNegativeLiteral());

				return this.writer.finish(node, this.lastEnd);
			}

			case T_TEMPLATE_FULL:
			case T_TEMPLATE_HEAD:
				return this.parseTemplateLiteralType();

			default:
				if (isIdentifierNameKind(kind)) {
					return this.parseTypeReference();
				}

				throw this.unexpected();
		}
	}

	/**
	 * Parses a keyword type such as `string`.
	 * @param nodeKind The node kind that corresponds to the keyword.
	 * @returns The index of the type node.
	 */
	private parseKeywordType(nodeKind: number): number {
		const node = this.writer.alloc(nodeKind, this.start);
		const end = this.end;

		this.next();

		return this.writer.finish(node, end);
	}

	/**
	 * Parses the `this` type.
	 * @returns The index of the `TSThisType` node.
	 */
	private parseThisType(): number {
		return this.parseKeywordType(N_TSThisType);
	}

	/**
	 * Parses a negated numeric literal used as a literal type.
	 * @returns The index of the `Literal` node covering the sign and number.
	 */
	private parseNegativeLiteral(): number {
		const node = this.writer.alloc(N_UnaryExpression, this.start);
		const operator = this.kind;

		this.next();
		this.writer.set(node, NODE_A, this.parseLiteral());
		this.writer.set(node, NODE_B, operator);
		this.writer.addFlags(node, NF_PREFIX);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `typeof X` and `typeof import(...)`.
	 * @returns The index of the `TSTypeQuery` node.
	 */
	private parseTypeQuery(): number {
		const node = this.writer.alloc(N_TSTypeQuery, this.start);

		this.next();
		this.writer.set(
			node,
			NODE_A,
			this.at(T_import)
				? this.parseImportType()
				: this.parseEntityName(this.at(T_this)),
		);

		if (this.at(T_LT) && !this.newlineBefore) {
			this.writer.set(node, NODE_B, this.parseTypeArguments());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses `import("mod").Qualifier<Args>`.
	 * @returns The index of the `TSImportType` node.
	 */
	private parseImportType(): number {
		const node = this.writer.alloc(N_TSImportType, this.start);

		this.next();
		this.expect(T_PAREN_OPEN);

		// The module specifier is a plain string literal, not a literal type.
		this.writer.set(
			node,
			NODE_A,
			this.at(T_STRING) ? this.parseLiteral() : this.parseType(),
		);

		/*
		 * The import options are an object literal, not a type literal, even
		 * though everything around them here is a type.
		 */
		if (this.eat(T_COMMA)) {
			this.writer.set(node, NODE_D, this.parseAssignmentExpression());
		}

		this.expect(T_PAREN_CLOSE);

		if (this.eat(T_DOT)) {
			this.writer.set(node, NODE_B, this.parseEntityName());
		}

		if (this.at(T_LT) && !this.newlineBefore) {
			this.writer.set(node, NODE_C, this.parseTypeArguments());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a dotted name such as `A.B.C`.
	 * @returns The index of the `Identifier` or `TSQualifiedName` node.
	 */
	parseEntityName(fromThis = false): number {
		const start = this.start;
		/*
		 * In `typeof this.x` the `this` is an expression, not the `this` type,
		 * so it is built as a `ThisExpression`.
		 */
		let name = fromThis
			? this.parseKeywordType(N_ThisExpression)
			: this.parseIdentifierName();

		while (this.at(T_DOT)) {
			this.next();

			const node = this.writer.alloc(N_TSQualifiedName, start);

			this.writer.set(node, NODE_A, name);
			this.writer.set(node, NODE_B, this.parseIdentifierName());
			name = this.writer.finish(node, this.lastEnd);
		}

		return name;
	}

	/**
	 * Parses a named type reference with optional type arguments.
	 * @returns The index of the `TSTypeReference` node.
	 */
	private parseTypeReference(): number {
		const node = this.writer.alloc(N_TSTypeReference, this.start);

		this.writer.set(node, NODE_A, this.parseEntityName());

		if (this.at(T_LT) && !this.newlineBefore) {
			this.writer.set(node, NODE_B, this.parseTypeArguments());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a tuple type, including named, optional, and rest members.
	 * @returns The index of the `TSTupleType` node.
	 */
	private parseTupleType(): number {
		const node = this.writer.alloc(N_TSTupleType, this.start);
		const mark = this.writer.startList();

		this.next();

		while (!this.at(T_BRACKET_CLOSE) && !this.at(T_EOF)) {
			this.writer.pushList(this.parseTupleMember());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expect(T_BRACKET_CLOSE);
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses one member of a tuple type.
	 * @returns The index of the member node.
	 */
	private parseTupleMember(): number {
		const start = this.start;

		if (this.at(T_ELLIPSIS)) {
			const node = this.writer.alloc(N_TSRestType, start);

			this.next();
			this.writer.set(node, NODE_A, this.parseTupleMember());

			return this.writer.finish(node, this.lastEnd);
		}

		// A label is an identifier followed by `?:` or `:`.
		if (this.atLabeledTupleMember()) {
			const node = this.writer.alloc(N_TSNamedTupleMember, start);

			this.writer.set(node, NODE_A, this.parseIdentifierName());

			if (this.eat(T_QUESTION)) {
				this.writer.addFlags(node, NF_OPTIONAL);
			}

			this.expect(T_COLON);
			this.writer.set(node, NODE_B, this.parseType());

			return this.writer.finish(node, this.lastEnd);
		}

		const type = this.parseType();

		if (this.at(T_QUESTION)) {
			const node = this.writer.alloc(N_TSOptionalType, start);

			this.next();
			this.writer.set(node, NODE_A, type);

			return this.writer.finish(node, this.lastEnd);
		}

		return type;
	}

	/**
	 * Determines whether the current tuple member carries a label.
	 * @returns `true` when an identifier is followed by `:` or `?:`.
	 */
	private atLabeledTupleMember(): boolean {
		if (!isIdentifierNameKind(this.kind)) {
			return false;
		}

		const state = this.tokenizer.save();

		this.next();

		const optional = this.eat(T_QUESTION);
		const labeled = this.at(T_COLON);

		void optional;
		this.tokenizer.restore(state);

		return labeled;
	}

	//-------------------------------------------------------------------------
	// Object Types
	//-------------------------------------------------------------------------

	/**
	 * Determines whether a `{` opens a mapped type.
	 * @returns `true` when the braces contain an `in` clause.
	 */
	private atMappedTypeStart(): boolean {
		const state = this.tokenizer.save();

		this.enterBrace(false);

		let result = false;

		if (this.at(T_PLUS) || this.at(T_MINUS)) {
			result = true;
		} else {
			if (this.at(T_readonly)) {
				this.next();
			}

			if (this.at(T_BRACKET_OPEN)) {
				this.next();

				if (this.atBindingName()) {
					this.next();
					result = this.at(T_in);
				}
			}
		}

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses a mapped type such as `{ readonly [K in Keys]?: T }`.
	 * @returns The index of the `TSMappedType` node.
	 */
	private parseMappedType(): number {
		const node = this.writer.alloc(N_TSMappedType, this.start);

		this.enterBrace(false);

		// `readonly`, `+readonly`, and `-readonly` are all spelled here.
		if (this.at(T_PLUS) || this.at(T_MINUS)) {
			const sign = this.kind;

			this.next();
			this.expect(T_readonly);
			this.writer.set(node, NODE_F, sign === T_PLUS ? 2 : 3);
		} else if (this.eat(T_readonly)) {
			this.writer.set(node, NODE_F, 1);
		}

		this.expect(T_BRACKET_OPEN);

		const key = this.writer.alloc(N_TSTypeParameter, this.start);

		this.writer.set(key, NODE_A, this.parseIdentifier());
		this.expect(T_in);
		this.writer.set(key, NODE_B, this.parseType());
		this.writer.set(node, NODE_A, this.writer.finish(key, this.lastEnd));

		if (this.eat(T_extends) || this.eatContextual(T_as)) {
			this.writer.set(node, NODE_C, this.parseType());
		}

		this.expect(T_BRACKET_CLOSE);

		if (this.at(T_PLUS) || this.at(T_MINUS)) {
			const sign = this.kind;

			this.next();
			this.expect(T_QUESTION);
			this.writer.set(node, NODE_E, sign === T_PLUS ? 2 : 3);
		} else if (this.eat(T_QUESTION)) {
			this.writer.set(node, NODE_E, 1);
		}

		if (this.at(T_COLON)) {
			this.next();
			this.writer.set(node, NODE_D, this.parseType());
		}

		this.eat(T_SEMICOLON);
		this.expect(T_BRACE_CLOSE);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Consumes a contextual keyword token.
	 * @param kind The contextual keyword kind to consume.
	 * @returns `true` when the token was consumed.
	 */
	private eatContextual(kind: number): boolean {
		return this.eat(kind);
	}

	/**
	 * Parses an object type literal.
	 * @returns The index of the `TSTypeLiteral` node.
	 */
	private parseTypeLiteral(): number {
		const node = this.writer.alloc(N_TSTypeLiteral, this.start);

		this.writer.set(node, NODE_A, this.parseObjectTypeMembers());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a brace-delimited list of type members.
	 * @returns A list handle holding the member nodes.
	 */
	parseObjectTypeMembers(): number {
		const mark = this.writer.startList();

		this.enterBrace(false);

		while (!this.at(T_BRACE_CLOSE) && !this.at(T_EOF)) {
			const member = this.parseTypeMember();

			this.writer.pushList(member);

			/*
			 * Members may be separated by `,` or `;`, or by nothing at all
			 * when a line break already separates them. A separator that is
			 * present belongs to the member before it.
			 */
			if (this.eat(T_COMMA) || this.eat(T_SEMICOLON)) {
				this.writer.finish(member, this.lastEnd);
			} else if (!this.newlineBefore) {
				break;
			}
		}

		this.expect(T_BRACE_CLOSE);

		return this.writer.endList(mark);
	}

	/**
	 * Parses a single member of an object type.
	 * @returns The index of the member node.
	 */
	private parseTypeMember(): number {
		const start = this.start;

		if (this.at(T_PAREN_OPEN) || this.at(T_LT)) {
			return this.parseSignatureMember(
				N_TSCallSignatureDeclaration,
				start,
			);
		}

		if (this.at(T_new) && this.nextStartsSignature()) {
			this.next();

			return this.parseSignatureMember(
				N_TSConstructSignatureDeclaration,
				start,
			);
		}

		let readonly = false;

		if (this.at(T_readonly) && this.nextStartsMemberName()) {
			this.next();
			readonly = true;
		}

		if (this.atIndexSignature()) {
			return this.parseIndexSignature(start, readonly);
		}

		let methodKind = 0;

		if (
			(this.at(T_get) || this.at(T_set)) &&
			this.nextStartsMemberName()
		) {
			methodKind = this.kind === T_get ? 1 : 2;
			this.next();
		}

		const computed = this.at(T_BRACKET_OPEN);
		const key = this.parseTypeMemberName();
		const optional = this.eat(T_QUESTION);

		if (this.at(T_PAREN_OPEN) || this.at(T_LT)) {
			const node = this.writer.alloc(N_TSMethodSignature, start);

			this.writer.set(node, NODE_A, key);
			this.writer.set(node, NODE_D, this.tryParseTypeParameters());
			this.writer.set(node, NODE_B, this.parseParameterList());
			this.writer.set(node, NODE_C, this.tryParseTypeAnnotation());

			if (computed) {
				this.writer.addFlags(node, NF_COMPUTED);
			}

			if (optional) {
				this.writer.addFlags(node, NF_OPTIONAL);
			}

			this.writer.addFlags(node, methodKind << MKIND_SHIFT);

			return this.writer.finish(node, this.lastEnd);
		}

		const node = this.writer.alloc(N_TSPropertySignature, start);

		this.writer.set(node, NODE_A, key);
		this.writer.set(node, NODE_B, this.tryParseTypeAnnotation());

		if (computed) {
			this.writer.addFlags(node, NF_COMPUTED);
		}

		if (optional) {
			this.writer.addFlags(node, NF_OPTIONAL);
		}

		if (readonly) {
			this.writer.addFlags(node, NF_READONLY);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a call or construct signature.
	 * @param nodeKind The node kind to build.
	 * @param start The offset at which the member began.
	 * @returns The index of the signature node.
	 */
	private parseSignatureMember(nodeKind: number, start: number): number {
		const node = this.writer.alloc(nodeKind, start);

		this.writer.set(node, NODE_C, this.tryParseTypeParameters());
		this.writer.set(node, NODE_A, this.parseParameterList());
		this.writer.set(node, NODE_B, this.tryParseTypeAnnotation());

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses an index signature such as `[key: string]: T`.
	 * @param start The offset at which the member began.
	 * @param readonly Whether the member was marked `readonly`.
	 * @returns The index of the `TSIndexSignature` node.
	 */
	protected parseIndexSignature(start: number, readonly: boolean): number {
		const node = this.writer.alloc(N_TSIndexSignature, start);

		this.expect(T_BRACKET_OPEN);

		const parameter = this.parseIdentifier();

		this.writer.set(parameter, NODE_B, this.parseTypeAnnotation());
		this.writer.finish(parameter, this.lastEnd);
		this.expect(T_BRACKET_CLOSE);
		this.writer.set(node, NODE_A, this.writer.singletonList(parameter));
		this.writer.set(node, NODE_B, this.tryParseTypeAnnotation());

		if (readonly) {
			this.writer.addFlags(node, NF_READONLY);
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines whether the current `[` opens an index signature rather than
	 * a computed member name.
	 * @returns `true` for `[name: Type]`.
	 */
	protected atIndexSignature(): boolean {
		if (!this.at(T_BRACKET_OPEN)) {
			return false;
		}

		const state = this.tokenizer.save();

		this.next();

		let result = false;

		if (this.atBindingName()) {
			this.next();
			result = this.at(T_COLON);
		}

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Looks ahead to see whether a signature follows the current token.
	 * @returns `true` when `(` or `<` comes next.
	 */
	private nextStartsSignature(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(T_PAREN_OPEN) || this.at(T_LT);

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Looks ahead to see whether a member name follows the current token,
	 * which distinguishes modifiers from members that happen to share a name.
	 * @returns `true` when the next token can start a member name.
	 */
	private nextStartsMemberName(): boolean {
		const state = this.tokenizer.save();

		this.next();

		const kind = this.kind;
		const result =
			isIdentifierNameKind(kind) ||
			kind === T_STRING ||
			kind === T_NUMBER ||
			kind === T_BRACKET_OPEN;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Parses the name of an object type member.
	 * @returns The index of the name node.
	 */
	private parseTypeMemberName(): number {
		if (this.at(T_BRACKET_OPEN)) {
			this.next();

			const key = this.parseAssignmentExpression();

			this.expect(T_BRACKET_CLOSE);

			return key;
		}

		if (this.at(T_STRING) || this.at(T_NUMBER)) {
			return this.parseLiteral();
		}

		return this.parseIdentifierName();
	}

	//-------------------------------------------------------------------------
	// Function Types
	//-------------------------------------------------------------------------

	/**
	 * Determines whether a function type starts at the current token, which
	 * requires looking for the `=>` that follows its parameter list.
	 * @returns `true` when the current token opens a function type.
	 */
	private atConstructorTypeStart(): boolean {
		return (
			this.at(T_new) || (this.at(T_abstract) && this.peekIs(T_new))
		);
	}

	/**
	 * Tests the kind of the token after the current one.
	 * @param kind The kind to look for.
	 * @returns `true` when the next token has that kind.
	 */
	protected peekIs(kind: number): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(kind);

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Tests the kind of the token after the current one, requiring that no
	 * line break separates them.
	 * @param kind The kind to look for.
	 * @returns `true` when the next token has that kind and is on this line.
	 */
	private peekIsOnSameLine(kind: number): boolean {
		const state = this.tokenizer.save();

		this.next();

		const result = this.at(kind) && !this.newlineBefore;

		this.tokenizer.restore(state);

		return result;
	}

	/**
	 * Determines whether a function type starts at the current token.
	 * @returns `true` when the current token opens a function type.
	 */
	private atFunctionTypeStart(): boolean {
		if (this.at(T_LT)) {
			return true;
		}

		if (!this.at(T_PAREN_OPEN)) {
			return false;
		}

		const state = this.tokenizer.save();

		this.next();

		// `()` can only be a parameter list.
		if (this.at(T_PAREN_CLOSE)) {
			this.tokenizer.restore(state);

			return true;
		}

		this.tokenizer.restore(state);

		return this.parenthesizedIsFollowedByArrow();
	}

	/**
	 * Scans forward from the current `(` to its match and reports whether an
	 * arrow follows.
	 * @returns `true` when the matching `)` is followed by `=>`.
	 */
	protected parenthesizedIsFollowedByArrow(): boolean {
		return this.kindAfterMatchingParen() === T_ARROW;
	}

	/**
	 * Scans forward from the current `(`, `[`, or `{` to its match and reports
	 * the kind of the token that follows it.
	 * @returns The kind of the token after the matching closer.
	 */
	protected kindAfterMatchingParen(): number {
		const state = this.tokenizer.save();
		let result: number;

		try {
			let depth = 0;

			for (;;) {
				const kind = this.kind;

				if (kind === T_EOF) {
					break;
				}

				if (
					kind === T_PAREN_OPEN ||
					kind === T_BRACKET_OPEN ||
					kind === T_BRACE_OPEN
				) {
					depth++;
				} else if (
					kind === T_PAREN_CLOSE ||
					kind === T_BRACKET_CLOSE ||
					kind === T_BRACE_CLOSE
				) {
					depth--;

					if (depth === 0) {
						this.next();
						break;
					}
				}

				this.next();
			}

			result = this.kind;
		} catch {
			/*
			 * This scan runs in ordinary JavaScript mode, so content that only
			 * makes sense in another mode - JSX, most often - can fail to
			 * tokenize. Whatever is in there, it is not an arrow's parameter
			 * list, which is all this lookahead needs to decide.
			 */
			result = T_EOF;
		} finally {
			this.tokenizer.restore(state);
		}

		return result;
	}

	/**
	 * Parses a function type or a constructor type.
	 * @returns The index of the type node.
	 */
	private parseFunctionOrConstructorType(): number {
		const start = this.start;
		const isAbstract = this.at(T_abstract) && this.peekIs(T_new);

		if (isAbstract) {
			this.next();
		}

		const isConstructor = this.eat(T_new);
		const node = this.writer.alloc(
			isConstructor ? N_TSConstructorType : N_TSFunctionType,
			start,
		);

		if (isAbstract) {
			this.writer.addFlags(node, NF_ABSTRACT);
		}

		this.writer.set(node, NODE_C, this.tryParseTypeParameters());
		this.writer.set(node, NODE_A, this.parseParameterList());

		const returnType = this.writer.alloc(N_TSTypeAnnotation, this.start);

		this.expect(T_ARROW);
		this.writer.set(returnType, NODE_A, this.parseTypeOrPredicate());
		this.writer.set(
			node,
			NODE_B,
			this.writer.finish(returnType, this.lastEnd),
		);

		return this.writer.finish(node, this.lastEnd);
	}

	//-------------------------------------------------------------------------
	// Template Literal Types
	//-------------------------------------------------------------------------

	/**
	 * Parses a template literal type such as `` `a${T}b` ``.
	 * @returns The index of the `TSTemplateLiteralType` node.
	 */
	private parseTemplateLiteralType(): number {
		const node = this.writer.alloc(N_TSTemplateLiteralType, this.start);
		const mark = this.writer.startList();

		if (this.at(T_TEMPLATE_FULL)) {
			this.writer.pushList(this.parseTemplateElement(true));
		} else {
			this.writer.pushList(this.parseTemplateElement(false));

			for (;;) {
				this.writer.pushList(this.parseType());

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

		const [quasis, types] = this.writer.endInterleavedLists(mark);

		this.writer.set(node, NODE_A, quasis);
		this.writer.set(node, NODE_B, types);

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses one `TemplateElement` from the current template token.
	 * @param tail Whether this element closes the template.
	 * @returns The index of the `TemplateElement` node.
	 */
	protected parseTemplateElement(tail: boolean): number {
		const start = this.start;
		const end = this.end;
		const node = this.writer.alloc(N_TemplateElement, start);

		/*
		 * The raw text excludes the delimiters: one character for a leading
		 * backtick or `}`, and one or two for the trailing backtick or `${`.
		 */
		this.writer.set(node, NODE_A, start + 1);
		this.writer.set(node, NODE_B, tail ? end - 1 : end - 2);

		if (tail) {
			this.writer.addFlags(node, NF_TAIL);
		}

		if ((this.tokenizer.flags & TF_INVALID_ESCAPE) !== 0) {
			this.writer.addFlags(node, NF_INVALID_ESCAPE);
		}

		this.next();

		return this.writer.finish(node, end);
	}

	//-------------------------------------------------------------------------
	// Type Parameters and Arguments
	//-------------------------------------------------------------------------

	/**
	 * Parses a `<...>` type parameter declaration when one is present.
	 * @returns The declaration node index, or `0` when absent.
	 */
	tryParseTypeParameters(): number {
		if (!this.at(T_LT)) {
			return 0;
		}

		const node = this.writer.alloc(
			N_TSTypeParameterDeclaration,
			this.start,
		);
		const mark = this.writer.startList();

		this.next();

		while (!this.atTypeListEnd()) {
			this.writer.pushList(this.parseTypeParameter());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expectTypeListEnd();
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a single type parameter, including its modifiers.
	 * @returns The index of the `TSTypeParameter` node.
	 */
	private parseTypeParameter(): number {
		const node = this.writer.alloc(N_TSTypeParameter, this.start);

		for (;;) {
			if (this.at(T_in) && this.nextStartsMemberName()) {
				this.writer.addFlags(node, NF_IN);
				this.next();
				continue;
			}

			if (this.at(T_out) && this.nextStartsMemberName()) {
				this.writer.addFlags(node, NF_STATIC);
				this.next();
				continue;
			}

			if (this.at(T_const) && this.nextStartsMemberName()) {
				this.writer.addFlags(node, NF_CONST);
				this.next();
				continue;
			}

			break;
		}

		this.writer.set(node, NODE_A, this.parseIdentifier());

		if (this.eat(T_extends)) {
			this.writer.set(node, NODE_B, this.parseType());
		}

		if (this.eat(T_ASSIGN)) {
			this.writer.set(node, NODE_C, this.parseType());
		}

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Parses a `<...>` type argument list.
	 * @returns The index of the `TSTypeParameterInstantiation` node.
	 */
	parseTypeArguments(): number {
		const node = this.writer.alloc(
			N_TSTypeParameterInstantiation,
			this.start,
		);
		const mark = this.writer.startList();

		this.expect(T_LT);

		while (!this.atTypeListEnd()) {
			this.writer.pushList(this.parseType());

			if (!this.eat(T_COMMA)) {
				break;
			}
		}

		this.expectTypeListEnd();
		this.writer.set(node, NODE_A, this.writer.endList(mark));

		return this.writer.finish(node, this.lastEnd);
	}

	/**
	 * Determines whether the current token closes a type list, splitting a
	 * multi-character shift operator when necessary.
	 * @returns `true` when a `>` closes the list here.
	 */
	private atTypeListEnd(): boolean {
		if (this.at(T_GT)) {
			return true;
		}

		if (this.at(T_EOF)) {
			return true;
		}

		return this.tokenizer.reScanGreaterThan() && this.at(T_GT);
	}

	/**
	 * Consumes the `>` that closes a type list.
	 * @returns Nothing.
	 * @throws {ParseError} When the list is not closed.
	 */
	private expectTypeListEnd(): void {
		if (!this.at(T_GT)) {
			this.tokenizer.reScanGreaterThan();
		}

		this.expect(T_GT);
	}
}
