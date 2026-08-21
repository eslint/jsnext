/**
 * @fileoverview Shared parser state, token plumbing, and small helpers.
 *
 * The parser is split across a short inheritance chain so that each grammar
 * area lives in its own file while still sharing a single object and a single
 * set of hot fields:
 *
 * ```text
 * ParserBase  ->  TypeParser  ->  ExpressionParser  ->  Parser
 * ```
 *
 * Methods that a lower layer needs from a higher one are declared abstract
 * here, which lets the layers reference each other without circular imports.
 */

import { TF_HAS_ESCAPE, TF_LEGACY_OCTAL, TF_NEWLINE_BEFORE } from "./binary.js";
import { ParseError } from "./errors.js";
import { NodeWriter } from "./node-writer.js";
import {
	LIT_BIGINT,
	LIT_BOOLEAN,
	LIT_NULL,
	LIT_NUMBER,
	LIT_REGEXP,
	LIT_STRING,
	NF_IDENTIFIER_NAME,
	NF_LEGACY_OCTAL,
	NODE_A,
	NODE_B,
	N_Identifier,
	N_Literal,
	N_PrivateIdentifier,
} from "./node-kinds.js";
import { Tokenizer } from "./tokenizer.js";
import { decodeEscapes } from "./values.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KIND_KEYWORD_FLAGS,
	KW_RESERVED,
	T_BIGINT,
	T_EOF,
	T_await,
	T_IDENT,
	T_NUMBER,
	T_PRIVATE_IDENT,
	T_REGEXP,
	T_SEMICOLON,
	T_STRING,
	T_BRACE_CLOSE,
	T_false,
	T_null,
	T_true,
	describeKind,
	hashChar,
	lookupKeyword,
} from "./token-kinds.js";

/**
 * Common state and helpers for every layer of the parser.
 */
/*
 * What sits around a JSX element decides how the token after its final `>` is
 * scanned, and there is no way to recover from scanning it the wrong way: a
 * `/` read as the start of a regular expression consumes the rest of the line.
 */

/** The element stands in an ordinary expression, so the next token is code. */
export const AFTER_JSX_EXPRESSION = 0;

/** The element is a child of another, so what follows is more child text. */
export const AFTER_JSX_CHILDREN = 1;

/** The element is an attribute's value, so what follows is the rest of the tag. */
export const AFTER_JSX_ATTRIBUTE = 2;

export abstract class ParserBase {
	/** The scanner feeding this parser. */
	readonly tokenizer: Tokenizer;

	/** The binary node builder. */
	readonly writer: NodeWriter;

	/** The source text, hoisted for direct character access. */
	readonly source: string;

	/**
	 * Whether `await` is currently an operator rather than an identifier.
	 *
	 * At the top level this is the source type: `await` is a keyword in a
	 * module and an ordinary name in a script, which is why `parse()` has to
	 * be told which it is reading.
	 *
	 * Initialized here as well as in the constructor so that every field of a
	 * parser is installed in declaration order — see
	 * [`docs/performance.md`](../../../docs/performance.md) on object shape.
	 */
	inAsync = true;

	/** Whether `yield` is currently an operator rather than an identifier. */
	inGenerator = false;

	/** Whether the `in` operator may appear in the current expression. */
	allowIn = true;

	/** Whether `super.x` is currently legal. */
	allowSuperProperty = false;

	/** Whether `super()` is currently legal. */
	allowSuperCall = false;

	/**
	 * Creates a parser over a source text.
	 * @param source The source text to parse.
	 * @param isModule Whether to read the text as an ES module. CommonJS is
	 *      read as a script: the two differ in what is *allowed*, which is
	 *      phase two's question, not in what anything means.
	 */
	constructor(source: string, isModule: boolean) {
		this.source = source;
		this.tokenizer = new Tokenizer(source, isModule);
		this.writer = new NodeWriter(source.length);
		this.inAsync = isModule;
		this.tokenizer.inAsync = isModule;
		this.tokenizer.next();
	}

	//-------------------------------------------------------------------------
	// Token Access
	//-------------------------------------------------------------------------

	/** The kind of the current token. */
	get kind(): number {
		return this.tokenizer.kind;
	}

	/** The start offset of the current token. */
	get start(): number {
		return this.tokenizer.start;
	}

	/** The end offset of the current token. */
	get end(): number {
		return this.tokenizer.end;
	}

	/** The end offset of the token before the current one. */
	get lastEnd(): number {
		return this.tokenizer.prevEnd;
	}

	/** Whether a line terminator precedes the current token. */
	get newlineBefore(): boolean {
		return (this.tokenizer.flags & TF_NEWLINE_BEFORE) !== 0;
	}

	/**
	 * Advances to the next token.
	 * @returns Nothing.
	 */
	next(): void {
		this.tokenizer.next();
	}

	/**
	 * Tests the current token's kind.
	 * @param kind The kind to compare against.
	 * @returns `true` when the current token has that kind.
	 */
	at(kind: number): boolean {
		return this.tokenizer.kind === kind;
	}

	/**
	 * Consumes the current token when it has the expected kind.
	 * @param kind The kind to consume.
	 * @returns `true` when a token was consumed.
	 */
	eat(kind: number): boolean {
		if (this.tokenizer.kind === kind) {
			this.tokenizer.next();

			return true;
		}

		return false;
	}

	/**
	 * Consumes the current token, which must have the expected kind.
	 * @param kind The kind that is required here.
	 * @returns Nothing.
	 * @throws {ParseError} When the current token is of another kind.
	 */
	expect(kind: number): void {
		if (this.tokenizer.kind !== kind) {
			throw this.error(
				`Expected '${describeKind(kind)}' but found '${this.tokenText()}'`,
			);
		}

		this.tokenizer.next();
	}

	/**
	 * Consumes a `{` and tells the scanner whether it opened a block.
	 * @param isBlock `true` when the brace opens a statement block.
	 * @returns Nothing.
	 * @throws {ParseError} When the current token is not `{`.
	 */
	enterBrace(isBlock: boolean): void {
		this.tokenizer.markBrace(isBlock);
		this.tokenizer.next();
	}

	/**
	 * Consumes the `(` of a statement head, after which a regular expression
	 * may legally appear once the matching `)` is passed.
	 * @returns Nothing.
	 */
	enterStatementParen(): void {
		this.tokenizer.markStatementParen();
		this.tokenizer.next();
	}

	/**
	 * The text of the current token, used only for error messages.
	 * @returns The token's source text, or a description for end of input.
	 */
	tokenText(): string {
		if (this.tokenizer.kind === T_EOF) {
			return "end of input";
		}

		return this.source.slice(this.tokenizer.start, this.tokenizer.end);
	}

	//-------------------------------------------------------------------------
	// Errors
	//-------------------------------------------------------------------------

	/**
	 * Creates a fatal syntax error at the current token.
	 * @param message A description of the problem.
	 * @param index The offset to report; defaults to the current token start.
	 * @returns The error to throw.
	 */
	error(message: string, index = this.tokenizer.start): ParseError {
		return this.tokenizer.error(message, index);
	}

	/**
	 * Creates a fatal error for a token that cannot appear here.
	 *
	 * The one token worth naming specially is the one before it. Where `await`
	 * is not an operator it is an ordinary name, so `await x` is two
	 * expressions side by side and the complaint lands on the `x` — which
	 * describes the symptom and hides the cause. Saying which it is costs
	 * nothing, since this runs only on the way to throwing.
	 * @returns The error to throw.
	 */
	unexpected(): ParseError {
		if (this.tokenizer.prevKind === T_await && !this.inAsync) {
			return this.error(
				"'await' is only an operator inside an async function, or at the top level of a module.",
			);
		}

		return this.error(`Unexpected token '${this.tokenText()}'`);
	}

	//-------------------------------------------------------------------------
	// Automatic Semicolon Insertion
	//-------------------------------------------------------------------------

	/**
	 * Determines whether a semicolon may be inserted before the current token.
	 * @returns `true` when the grammar allows an inserted semicolon here.
	 */
	canInsertSemicolon(): boolean {
		return (
			this.tokenizer.kind === T_EOF ||
			this.tokenizer.kind === T_BRACE_CLOSE ||
			this.newlineBefore
		);
	}

	/**
	 * Consumes a statement-terminating semicolon, inserting one if allowed.
	 * @returns Nothing.
	 * @throws {ParseError} When a semicolon is required but missing.
	 */
	semicolon(): void {
		if (this.eat(T_SEMICOLON)) {
			return;
		}

		if (!this.canInsertSemicolon()) {
			throw this.unexpected();
		}
	}

	//-------------------------------------------------------------------------
	// Identifiers and Literals
	//-------------------------------------------------------------------------

	/**
	 * Determines whether the current token can be used as a binding name.
	 * @returns `true` when the token is an identifier or contextual keyword.
	 */
	atBindingName(): boolean {
		const kind = this.tokenizer.kind;

		if (kind === T_IDENT) {
			return true;
		}

		return (
			kind >= KEYWORD_FIRST &&
			kind <= KEYWORD_LAST &&
			(KIND_KEYWORD_FLAGS[kind] & KW_RESERVED) === 0
		);
	}

	/**
	 * Parses an identifier used as a binding or reference.
	 * @returns The index of the `Identifier` node.
	 * @throws {ParseError} When the current token cannot be an identifier.
	 */
	parseIdentifier(): number {
		if (!this.atBindingName()) {
			throw this.unexpected();
		}

		/*
		 * A reserved word written with an escape is still that word: the
		 * tokenizer skips the keyword table when it sees one, so `\u0073uper`
		 * arrives here as an ordinary identifier and `atBindingName()` lets it
		 * through. The specification does not — "a code point in a
		 * ReservedWord cannot be expressed by a UnicodeEscapeSequence" — so
		 * the word has to be spelled out and looked up again.
		 */
		if ((this.tokenizer.flags & TF_HAS_ESCAPE) !== 0) {
			this.checkEscapedWord(this.tokenizer.start, this.tokenizer.end);
		}

		const node = this.writer.alloc(N_Identifier, this.tokenizer.start);
		const end = this.tokenizer.end;

		this.writer.set(node, NODE_A, end);
		this.tokenizer.next();

		return this.writer.finish(node, end);
	}

	/**
	 * Rejects a reserved word that was written with an escape.
	 *
	 * `yield` and `await` are the two the rule leaves alone, and neither is a
	 * `ReservedWord` in the table — both are reserved by where they appear
	 * rather than outright, which `validate()` decides, so they fall through
	 * here whatever they are spelled with.
	 * @param start Where the word begins.
	 * @param end Where it ends.
	 * @returns Nothing.
	 * @throws {ParseError} When the word is a reserved word.
	 */
	protected checkEscapedWord(start: number, end: number): void {
		const raw = this.source.slice(start, end);
		const name = decodeEscapes(raw, false);
		let hash = 0;

		for (let i = 0; i < name.length; i++) {
			hash = hashChar(hash, name.charCodeAt(i));
		}

		const kind = lookupKeyword(name, 0, name.length, hash);

		if (
			kind >= KEYWORD_FIRST &&
			kind <= KEYWORD_LAST &&
			(KIND_KEYWORD_FLAGS[kind] & KW_RESERVED) !== 0
		) {
			throw this.error(
				`Keyword '${name}' cannot be written with an escape sequence.`,
				start,
			);
		}
	}

	/**
	 * Parses any identifier-like word, including reserved words, for use as a
	 * property name or member access.
	 * @returns The index of the `Identifier` node.
	 * @throws {ParseError} When the current token is not a word.
	 */
	parseIdentifierName(): number {
		const kind = this.tokenizer.kind;

		if (kind !== T_IDENT && (kind < KEYWORD_FIRST || kind > KEYWORD_LAST)) {
			throw this.unexpected();
		}

		this.tokenizer.demoteKeywordToIdentifier();

		return this.parseWordAsIdentifier();
	}

	/**
	 * Consumes the current word as an `Identifier` without changing how it is
	 * reported in the token stream. This is used for the `new` and `import`
	 * halves of a meta property, which stay keywords.
	 * @returns The index of the `Identifier` node.
	 */
	parseWordAsIdentifier(): number {
		const node = this.writer.alloc(N_Identifier, this.tokenizer.start);
		const end = this.tokenizer.end;

		/*
		 * A type annotation extends an identifier's range past its name, so
		 * the end of the name itself is recorded separately.
		 */
		this.writer.set(node, NODE_A, end);

		/*
		 * Every word that reaches here is an `IdentifierName` — a property
		 * name, a member access, an import or export name, or half of a meta
		 * property — and a reserved word is allowed to be any of those.
		 * `validate()` cannot tell that from the tree, so it is recorded.
		 */
		this.writer.addFlags(node, NF_IDENTIFIER_NAME);
		this.tokenizer.next();

		return this.writer.finish(node, end);
	}

	/**
	 * Parses a `#name` private identifier.
	 * @returns The index of the `PrivateIdentifier` node.
	 * @throws {ParseError} When the current token is not a private name.
	 */
	parsePrivateIdentifier(): number {
		if (this.tokenizer.kind !== T_PRIVATE_IDENT) {
			throw this.unexpected();
		}

		const node = this.writer.alloc(
			N_PrivateIdentifier,
			this.tokenizer.start,
		);
		const end = this.tokenizer.end;

		this.tokenizer.next();

		return this.writer.finish(node, end);
	}

	/**
	 * Determines whether the current token starts a literal value.
	 * @returns `true` for string, number, bigint, regexp, boolean, and null.
	 */
	atLiteral(): boolean {
		const kind = this.tokenizer.kind;

		return (
			kind === T_STRING ||
			kind === T_NUMBER ||
			kind === T_BIGINT ||
			kind === T_REGEXP ||
			kind === T_true ||
			kind === T_false ||
			kind === T_null
		);
	}

	/**
	 * Parses a literal token into a `Literal` node.
	 * @returns The index of the `Literal` node.
	 * @throws {ParseError} When the current token is not a literal.
	 */
	parseLiteral(): number {
		const kind = this.tokenizer.kind;
		let subtype: number;

		switch (kind) {
			case T_STRING:
				subtype = LIT_STRING;
				break;

			case T_NUMBER:
				subtype = LIT_NUMBER;
				break;

			case T_BIGINT:
				subtype = LIT_BIGINT;
				break;

			case T_REGEXP:
				subtype = LIT_REGEXP;
				break;

			case T_true:
			case T_false:
				subtype = LIT_BOOLEAN;
				break;

			case T_null:
				subtype = LIT_NULL;
				break;

			default:
				throw this.unexpected();
		}

		const node = this.writer.alloc(N_Literal, this.tokenizer.start);
		const end = this.tokenizer.end;

		this.writer.set(node, NODE_A, subtype);

		/*
		 * `01` and `"\1"` are legal in sloppy code and not in strict, and the
		 * tokenizer cannot tell which this is — a function's own `"use
		 * strict"` may still be ahead of it. So what it saw is carried across
		 * for `validate()` to judge.
		 */
		if ((this.tokenizer.flags & TF_LEGACY_OCTAL) !== 0) {
			this.writer.addFlags(node, NF_LEGACY_OCTAL);
		}

		// Regular expressions record where the pattern ends so that the
		// pattern and flags can be split apart without rescanning.
		if (subtype === LIT_REGEXP) {
			this.writer.set(node, NODE_B, this.tokenizer.extra);
		}

		this.tokenizer.next();

		return this.writer.finish(node, end);
	}

	//-------------------------------------------------------------------------
	// Layer Boundaries
	//-------------------------------------------------------------------------

	/**
	 * Parses a single assignment-level expression.
	 * @returns The index of the expression node.
	 */
	abstract parseAssignmentExpression(): number;

	/**
	 * Parses a comma-separated expression.
	 * @returns The index of the expression node.
	 */
	abstract parseExpression(): number;

	/**
	 * Parses a binding target: an identifier or a destructuring pattern.
	 * @returns The index of the pattern node.
	 */
	abstract parseBindingAtom(): number;

	/**
	 * Parses one parameter of a function, method, or function type.
	 * @returns The index of the parameter node.
	 */
	abstract parseParameter(): number;

	/**
	 * Parses a parenthesized parameter list.
	 * @returns A list handle holding the parameter nodes.
	 */
	abstract parseParameterList(
		isAsync?: boolean,
		isGenerator?: boolean,
	): number;

	/**
	 * Parses a `: Type` annotation.
	 * @returns The index of the `TSTypeAnnotation` node, or `0` if absent.
	 */
	abstract tryParseTypeAnnotation(): number;

	/**
	 * Parses a TypeScript type.
	 * @returns The index of the type node.
	 */
	abstract parseType(): number;

	/**
	 * Parses a `<...>` type parameter declaration.
	 * @returns The index of the declaration node, or `0` if absent.
	 */
	abstract tryParseTypeParameters(): number;

	/**
	 * Parses a `<...>` type argument list, assuming the current token is `<`.
	 * @returns The index of the instantiation node.
	 */
	abstract parseTypeArguments(): number;

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
}
