/**
 * @fileoverview The scanner that turns source text into binary token records.
 *
 * The tokenizer is driven by the parser one token at a time rather than run to
 * completion up front. That is what allows `/` to be resolved into either
 * division or a regular expression literal, and `}` into either a punctuator
 * or the continuation of a template literal, without guessing.
 *
 * Every token that is scanned - including comments - is appended to a growable
 * word buffer in source order. The parser never re-reads that buffer; it works
 * from the "current token" fields, which avoids a second pass over the data.
 */

import {
	ASCII_LIMIT,
	CHAR_FLAGS,
	CH_0,
	CH_7,
	CH_9,
	CH_AMP,
	CH_AT,
	CH_A_LOWER,
	CH_BACKSLASH,
	CH_BACKTICK,
	CH_BANG,
	CH_BOM,
	CH_BRACE_CLOSE,
	CH_BRACE_OPEN,
	CH_BRACKET_CLOSE,
	CH_BRACKET_OPEN,
	CH_B_LOWER,
	CH_B_UPPER,
	CH_CARET,
	CH_COLON,
	CH_COMMA,
	CH_CR,
	CH_DOLLAR,
	CH_DOT,
	CH_E_LOWER,
	CH_E_UPPER,
	CH_EQ,
	CH_GT,
	CH_HASH,
	CH_LF,
	CH_LINE_SEPARATOR,
	CH_LT,
	CH_MINUS,
	CH_N_LOWER,
	CH_O_LOWER,
	CH_O_UPPER,
	CH_PARAGRAPH_SEPARATOR,
	CH_PAREN_CLOSE,
	CH_PAREN_OPEN,
	CH_PERCENT,
	CH_PIPE,
	CH_PLUS,
	CH_QUESTION,
	CH_QUOTE_DOUBLE,
	CH_QUOTE_SINGLE,
	CH_SEMICOLON,
	CH_SLASH,
	CH_STAR,
	CH_TILDE,
	CH_U_LOWER,
	CH_UNDERSCORE,
	CH_X_LOWER,
	CH_X_UPPER,
	MASK_DIGIT,
	MASK_HEX_DIGIT,
	MASK_ID_PART,
	MASK_ID_START,
	MASK_NEWLINE,
	MASK_SPACE,
	isNonAsciiIdPart,
	isNonAsciiIdStart,
	isNonAsciiSpace,
} from "./chars.js";
import {
	TF_HAS_ESCAPE,
	TF_INVALID_ESCAPE,
	TF_LEGACY_OCTAL,
	TF_NEWLINE_BEFORE,
	WordBuffer,
} from "./binary.js";
import { ParseError, locate } from "./errors.js";
import {
	KEYWORD_FIRST,
	KEYWORD_LAST,
	KIND_BEFORE_EXPR,
	T_AMP,
	T_AMPAMP,
	T_ARROW,
	T_ASSIGN,
	T_ASSIGN_AMP,
	T_ASSIGN_AMPAMP,
	T_ASSIGN_CARET,
	T_ASSIGN_MINUS,
	T_ASSIGN_PERCENT,
	T_ASSIGN_PIPE,
	T_ASSIGN_PIPEPIPE,
	T_ASSIGN_PLUS,
	T_ASSIGN_QQ,
	T_ASSIGN_SAR,
	T_ASSIGN_SHL,
	T_ASSIGN_SHR,
	T_ASSIGN_SLASH,
	T_ASSIGN_STAR,
	T_ASSIGN_STARSTAR,
	T_AT,
	T_BIGINT,
	T_BLOCK_COMMENT,
	T_BRACE_CLOSE,
	T_BRACE_OPEN,
	T_BRACKET_CLOSE,
	T_BRACKET_OPEN,
	T_CARET,
	T_COLON,
	T_COMMA,
	T_DOT,
	T_ELLIPSIS,
	T_EOF,
	T_EQ_EQ,
	T_EQ_EQ_EQ,
	T_GT,
	T_GT_EQ,
	T_HASHBANG,
	T_IDENT,
	T_JSX_IDENT,
	T_JSX_STRING,
	T_JSX_TEXT,
	T_LINE_COMMENT,
	T_LT,
	T_LT_EQ,
	T_MINUS,
	T_MINUS_MINUS,
	T_NOT,
	T_NOT_EQ,
	T_NOT_EQ_EQ,
	T_NUMBER,
	T_PAREN_CLOSE,
	T_PAREN_OPEN,
	T_PERCENT,
	T_PIPE,
	T_PIPEPIPE,
	T_PLUS,
	T_PLUS_PLUS,
	T_PRIVATE_IDENT,
	T_QQ,
	T_QUESTION,
	T_QUESTION_DOT,
	T_REGEXP,
	T_SAR,
	T_SEMICOLON,
	T_SHL,
	T_SHR,
	T_SLASH,
	T_STAR,
	T_STARSTAR,
	T_STRING,
	T_TEMPLATE_FULL,
	T_TEMPLATE_HEAD,
	T_TEMPLATE_MIDDLE,
	T_TEMPLATE_TAIL,
	T_TILDE,
	T_await,
	T_let,
	T_of,
	T_static,
	T_yield,
	hashChar,
	lookupKeyword,
} from "./token-kinds.js";

//-----------------------------------------------------------------------------
// Lexical Contexts
//-----------------------------------------------------------------------------

/** A `{` that opened a statement block; an expression may follow its `}`. */
const CTX_BLOCK = 1;

/** A `{` that opened an object literal or class body. */
const CTX_OBJECT = 2;

/** A `(` that belongs to `if`, `while`, `for`, `with`, or `switch`. */
const CTX_PAREN_STMT = 3;

/** A `(` that opened a parenthesized expression or argument list. */
const CTX_PAREN_EXPR = 4;

/** A `${` inside a template literal. */
const CTX_TEMPLATE = 5;

//-----------------------------------------------------------------------------
// Tokenizer
//-----------------------------------------------------------------------------

/** Words per token record. */
const TOKEN_WORDS = 4;

/**
 * The token kinds `updateContext()` treats specially, indexed by kind. Every
 * other kind takes its answer straight from `KIND_BEFORE_EXPR`. **A new case
 * in `updateContext()`'s switch must be added here too.**
 */
const CONTEXT_SPECIAL = /* @__PURE__ */ buildContextSpecial();

/**
 * Builds the table of token kinds `updateContext()` has a case for.
 * @returns The table, indexed by token kind.
 */
function buildContextSpecial(): Uint8Array {
	const table = new Uint8Array(256);

	for (const kind of [
		T_PAREN_CLOSE,
		T_BRACE_CLOSE,
		T_PLUS_PLUS,
		T_MINUS_MINUS,
		T_yield,
		T_await,
		T_of,
	]) {
		table[kind] = 1;
	}

	return table;
}

/**
 * Token kinds for the punctuators that are one character long no matter what
 * follows, indexed by character code. Zero means the character needs the full
 * dispatch: it may pair with the next one, or it moves the context stack the
 * way `{`, `}`, and `(` do. The characters here are the bones of every
 * program — `: , ( ) [ ] ;` make up a third of a TypeScript file's tokens —
 * and one table read replaces a walk through `scanPunctuator`'s cases.
 */
const SIMPLE_PUNCTUATORS = /* @__PURE__ */ buildSimplePunctuators();

/**
 * Builds the single-character punctuator table.
 * @returns The table, indexed by character code.
 */
function buildSimplePunctuators(): Uint8Array {
	const table = new Uint8Array(128);

	table[CH_PAREN_CLOSE] = T_PAREN_CLOSE;
	table[CH_BRACKET_OPEN] = T_BRACKET_OPEN;
	table[CH_BRACKET_CLOSE] = T_BRACKET_CLOSE;
	table[CH_SEMICOLON] = T_SEMICOLON;
	table[CH_COMMA] = T_COMMA;
	table[CH_COLON] = T_COLON;
	table[CH_AT] = T_AT;
	table[CH_TILDE] = T_TILDE;

	return table;
}

/** The largest code point a `\u{...}` escape may name. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Reads one hexadecimal digit, which the caller has already classified.
 * @param code The character code of the digit.
 * @returns The value it stands for.
 */
function hexValue(code: number): number {
	/*
	 * Setting bit five folds `A`-`F` onto `a`-`f`, and leaves `0`-`9` where
	 * they are, so one comparison separates the letters from the digits.
	 */
	return code <= CH_9 ? code - CH_0 : (code | 0x20) - CH_A_LOWER + 10;
}

/**
 * A snapshot of tokenizer state, used to rewind after speculative scanning.
 */
export interface TokenizerState {
	pos: number;
	count: number;
	kind: number;
	start: number;
	end: number;
	flags: number;
	extra: number;
	prevKind: number;
	prevEnd: number;
	exprAllowed: boolean;
	contextDepth: number;
	lineCount: number;
}

/**
 * Scans source text into binary token records.
 */
export class Tokenizer {
	/** The source text being scanned. */
	readonly source: string;

	/** Length of the source text, hoisted out of the string object. */
	readonly length: number;

	/** The offset of the next character to read. */
	pos = 0;

	/** Token records, four words each. */
	readonly records: WordBuffer;

	/** Number of complete token records written. */
	count = 0;

	/** Offsets at which each line begins. */
	lineStarts: Uint32Array;

	/** Number of valid entries in `lineStarts`. */
	lineCount = 1;

	/** Kind of the current token. */
	kind = T_EOF;

	/** Start offset of the current token. */
	start = 0;

	/** End offset of the current token. */
	end = 0;

	/** Flags of the current token. */
	flags = 0;

	/** Auxiliary data for the current token; meaning depends on the kind. */
	extra = 0;

	/** Kind of the token before the current one, ignoring comments. */
	prevKind = T_EOF;

	/** End offset of the token before the current one. */
	prevEnd = 0;

	/** Whether a `/` at the current position begins a regular expression. */
	exprAllowed = true;

	/**
	 * Whether the scanner is inside the angle brackets of a JSX tag, where a
	 * `/` always closes the tag.
	 *
	 * Only the type arguments of `<Foo<T>/>` need this. They are read by the
	 * ordinary type grammar, which scans one token past the closing `>` with
	 * an expression allowed, and would otherwise read the `/` that closes the
	 * tag as the start of a regular expression.
	 */
	inJsxTag = false;

	/** Whether the parser is currently inside a generator function body. */
	inGenerator = false;

	/** Whether the parser is currently inside an async function body. */
	inAsync = false;

	/**
	 * Whether the text is being read as an ES module.
	 *
	 * The only thing the scanner does with it is Annex B's HTML-like comments,
	 * which exist in script code and are an operator sequence in a module.
	 * Set before the first token is scanned, and never after.
	 */
	isModule = true;

	/** Stack of open braces, parentheses, and template substitutions. */
	private context = new Uint8Array(256);

	/** Number of entries on the context stack. */
	private contextDepth = 0;

	/**
	 * How many speculative parses are in flight.
	 *
	 * While it is above zero, every error is about to be caught, rewound, and
	 * discarded, so `error()` hands back one shared placeholder instead of
	 * building a real diagnostic. Constructing an `Error` makes V8 capture the
	 * call stack, which costs more than the speculative parse around it — a
	 * JSX-heavy file used to spend nearly half its parse time doing it.
	 */
	backtracking = 0;

	/**
	 * The placeholder `error()` returns while backtracking, created the first
	 * time a speculative parse fails.
	 */
	private backtrackError: ParseError | null = null;

	/**
	 * Whether a line terminator preceded the token `peek()` last scanned.
	 * Meaningful only directly after a `peek()` call.
	 */
	peekNewlineBefore = false;

	/*
	 * The one-token lookahead cache. A `peek()` scans the next token and
	 * rolls the scanner back; without a cache the same characters are
	 * scanned again the moment the parser advances, and the parser peeks
	 * ahead of thousands of tokens in an ordinary file — after every name
	 * that might open an arrow function, for one. The cache holds everything
	 * `next()` would have produced, so advancing becomes a dozen field moves.
	 *
	 * Validity is decided at consumption, not by invalidation hooks: the
	 * cache is used only when every input the scan depended on — `pos`,
	 * `exprAllowed`, the context stack, `inJsxTag` — still matches what it
	 * was when the peek ran. Anything that could change what the next token
	 * *is* — a rescan, a JSX-mode read, a `restore()` to somewhere else —
	 * either moves `pos` or changes one of those, so a stale cache can never
	 * pass the guards. `peekPos` of `-1` means no cache.
	 */

	/** Where the scanner stood when the cached peek ran, or `-1`. */
	private peekPos = -1;

	/** The value of `exprAllowed` when the cached peek ran. */
	private peekExprAllowed = false;

	/** The context depth when the cached peek ran. */
	private peekContextDepth = 0;

	/** The context entry on top of the stack when the cached peek ran. */
	private peekContextTop = 0;

	/** The value of `inJsxTag` when the cached peek ran. */
	private peekInJsxTag = false;

	/** The cached token's kind. */
	private peekKind = T_EOF;

	/** The cached token's start offset. */
	private peekStart = 0;

	/** The cached token's flags. */
	private peekFlags = 0;

	/** The cached token's auxiliary data. */
	private peekExtra = 0;

	/** Where the scanner stood after the cached token. */
	private peekEndPos = 0;

	/** The line count after the cached token was scanned. */
	private peekLineCount = 0;

	/** The token record count after the cached token's leading comments. */
	private peekCount = 0;

	/** The record region length after the cached token's leading comments. */
	private peekRecordsLength = 0;

	/** The context depth after the cached token was scanned. */
	private peekContextAfterDepth = 0;

	/** The context entry on top of the stack after the cached token. */
	private peekContextAfterTop = 0;

	/**
	 * Creates a tokenizer for a source text and scans the first token.
	 * @param source The source text to scan.
	 * @param isModule Whether the text is being read as an ES module, which
	 *      decides whether Annex B's HTML-like comments are comments.
	 */
	constructor(source: string, isModule = true) {
		this.source = source;
		this.isModule = isModule;
		this.length = source.length;
		/*
		 * One token per three characters or so is what real code runs, with
		 * JSX the densest — sized so the buffer covers that without the
		 * doubling-and-copying a growth costs on a large file.
		 */
		this.records = new WordBuffer(
			Math.max(1024, ((source.length * 3) >> 3) * TOKEN_WORDS),
		);
		this.lineStarts = new Uint32Array(Math.max(64, source.length >> 4));
		this.lineStarts[0] = 0;

		// A byte order mark is not part of the program text.
		if (source.charCodeAt(0) === CH_BOM) {
			this.pos = 1;
		}

		this.scanHashbang();
	}

	//-------------------------------------------------------------------------
	// Errors
	//-------------------------------------------------------------------------

	/**
	 * Creates a fatal syntax error positioned at a source offset.
	 * @param message A description of the problem.
	 * @param index The offset at which the problem was found.
	 * @returns The error to throw.
	 */
	error(message: string, index: number): ParseError {
		/*
		 * A speculative parse only ever throws to be caught and rewound, so
		 * the message and position would never be read — and building them
		 * would make V8 capture a call stack, which costs more than the parse
		 * being abandoned. The one path that surfaces a speculative failure
		 * to the caller re-parses outside speculation to get the real
		 * diagnostic; see `parseAngleBracketExpression()`.
		 */
		if (this.backtracking > 0) {
			return (this.backtrackError ??= new ParseError(
				"Speculative parse failed",
				0,
				1,
				1,
			));
		}

		const [line, column] = locate(this.lineStarts, this.lineCount, index);

		return new ParseError(message, index, line, column);
	}

	//-------------------------------------------------------------------------
	// State Management
	//-------------------------------------------------------------------------

	/**
	 * Captures the current state so that speculative scanning can be undone.
	 * @returns A snapshot that can be handed to `restore()`.
	 */
	save(): TokenizerState {
		return {
			pos: this.pos,
			count: this.count,
			kind: this.kind,
			start: this.start,
			end: this.end,
			flags: this.flags,
			extra: this.extra,
			prevKind: this.prevKind,
			prevEnd: this.prevEnd,
			exprAllowed: this.exprAllowed,
			contextDepth: this.contextDepth,
			lineCount: this.lineCount,
		};
	}

	/**
	 * Restores a snapshot taken by `save()`, discarding any tokens recorded
	 * after it.
	 * @param state The snapshot to restore.
	 * @returns Nothing.
	 */
	restore(state: TokenizerState): void {
		this.pos = state.pos;
		this.count = state.count;
		this.records.length = state.count * TOKEN_WORDS;
		this.kind = state.kind;
		this.start = state.start;
		this.end = state.end;
		this.flags = state.flags;
		this.extra = state.extra;
		this.prevKind = state.prevKind;
		this.prevEnd = state.prevEnd;
		this.exprAllowed = state.exprAllowed;
		this.contextDepth = state.contextDepth;
		this.lineCount = state.lineCount;
	}

	/**
	 * Reads the kind of the token after the current one without advancing.
	 *
	 * This is `save()`, `next()`, `restore()` collapsed into one scan with no
	 * state object, no token record left behind, and no context update — the
	 * scalars the scan moves are put back from locals. The parser peeks at
	 * the next token for every name that might open an arrow function and
	 * every type annotation that might be a predicate, so the shortcut is
	 * paid for thousands of times in an ordinary file.
	 *
	 * Whether a line terminator preceded the peeked token lands in
	 * `peekNewlineBefore`, which is only meaningful directly after a call.
	 * @returns The kind of the next token.
	 * @throws {ParseError} When no valid token can be read, exactly as
	 *      advancing would.
	 */
	peek(): number {
		// A second peek from the same spot reads the cache like next() does.
		if (this.peekUsable()) {
			this.peekNewlineBefore = (this.peekFlags & TF_NEWLINE_BEFORE) !== 0;

			return this.peekKind;
		}

		const pos = this.pos;
		const count = this.count;
		const recordsLength = this.records.length;
		const lineCount = this.lineCount;
		const kind = this.kind;
		const start = this.start;
		const end = this.end;
		const flags = this.flags;
		const extra = this.extra;
		const contextDepth = this.contextDepth;

		this.peekPos = -1;

		const tokenFlags = this.skipTrivia();
		let peeked = T_EOF;

		if (this.pos < this.length) {
			this.flags = tokenFlags;
			this.extra = 0;
			this.start = this.pos;
			this.scanToken();
			peeked = this.kind;

			/*
			 * Everything `next()` would have produced, captured before the
			 * rollback. The token's record — and any comments' — are rolled
			 * back with `records.length` but not erased, and nothing can
			 * write over them without moving `pos` first, so consuming the
			 * cache only has to put the length back.
			 */
			this.peekPos = pos;
			this.peekExprAllowed = this.exprAllowed;
			this.peekContextDepth = contextDepth;
			this.peekContextTop =
				contextDepth === 0 ? 0 : this.context[contextDepth - 1];
			this.peekInJsxTag = this.inJsxTag;
			this.peekKind = peeked;
			this.peekStart = this.start;
			this.peekFlags = this.flags;
			this.peekExtra = this.extra;
			this.peekEndPos = this.pos;
			this.peekLineCount = this.lineCount;

			/*
			 * Scanning can move the context stack — a template head with a
			 * substitution pushes the entry its `}` will look for — and the
			 * rollback below undoes that, so the consumer has to replay it.
			 * One scan moves the depth by at most one, so the depth and the
			 * top entry describe the change completely.
			 */
			this.peekContextAfterDepth = this.contextDepth;
			this.peekContextAfterTop =
				this.contextDepth === 0
					? 0
					: this.context[this.contextDepth - 1];

			/*
			 * Comments between the two tokens were recorded by the trivia
			 * scan; the token itself is only recorded by `next()`, so the
			 * consumer restores up to the comments and records the token.
			 */
			this.peekCount = this.count;
			this.peekRecordsLength = this.records.length;
		}

		this.peekNewlineBefore = (tokenFlags & TF_NEWLINE_BEFORE) !== 0;

		this.pos = pos;
		this.count = count;
		this.records.length = recordsLength;
		this.lineCount = lineCount;
		this.kind = kind;
		this.start = start;
		this.end = end;
		this.flags = flags;
		this.extra = extra;
		this.contextDepth = contextDepth;

		return peeked;
	}

	/**
	 * Determines whether the cached peek still describes the next token.
	 * @returns `true` when every input the cached scan depended on matches.
	 */
	private peekUsable(): boolean {
		return (
			this.peekPos === this.pos &&
			this.peekExprAllowed === this.exprAllowed &&
			this.peekContextDepth === this.contextDepth &&
			(this.contextDepth === 0 ||
				this.peekContextTop === this.context[this.contextDepth - 1]) &&
			this.peekInJsxTag === this.inJsxTag
		);
	}

	/**
	 * Tells the tokenizer that the `{` just consumed opened a statement block
	 * rather than an object literal, or the reverse.
	 * @param isBlock `true` when the brace opened a statement block.
	 * @returns Nothing.
	 */
	markBrace(isBlock: boolean): void {
		if (this.contextDepth > 0) {
			this.context[this.contextDepth - 1] = isBlock
				? CTX_BLOCK
				: CTX_OBJECT;
		}
	}

	/**
	 * Tells the tokenizer that the `(` just consumed belongs to a statement
	 * head such as `if (...)`, after which a regular expression may appear.
	 * @returns Nothing.
	 */
	markStatementParen(): void {
		if (this.contextDepth > 0) {
			this.context[this.contextDepth - 1] = CTX_PAREN_STMT;
		}
	}

	//-------------------------------------------------------------------------
	// Line Tracking
	//-------------------------------------------------------------------------

	/**
	 * Records the start of a new line.
	 * @param offset The offset of the first character on the new line.
	 * @returns Nothing.
	 */
	private addLine(offset: number): void {
		if (this.lineCount === this.lineStarts.length) {
			const grown = new Uint32Array(this.lineStarts.length * 2);

			grown.set(this.lineStarts);
			this.lineStarts = grown;
		}

		this.lineStarts[this.lineCount++] = offset;
	}

	//-------------------------------------------------------------------------
	// Token Recording
	//-------------------------------------------------------------------------

	/**
	 * Appends a token record to the buffer.
	 * @param kind The token kind.
	 * @param start The start offset of the token.
	 * @param end The end offset of the token.
	 * @param flags The token flags.
	 * @param extra Auxiliary data for the token.
	 * @returns Nothing.
	 */
	private record(
		kind: number,
		start: number,
		end: number,
		flags: number,
		extra: number,
	): void {
		const index = this.records.reserve(TOKEN_WORDS);
		const words = this.records.words;

		words[index] = start;
		words[index + 1] = end;
		words[index + 2] = kind | (flags << 16);
		words[index + 3] = extra;

		this.count++;
	}

	//-------------------------------------------------------------------------
	// Scanning
	//-------------------------------------------------------------------------

	/**
	 * Scans a `#!` comment, which is only legal as the very first thing in a
	 * source text.
	 * @returns Nothing.
	 */
	private scanHashbang(): void {
		if (
			this.pos + 1 < this.length &&
			this.source.charCodeAt(this.pos) === CH_HASH &&
			this.source.charCodeAt(this.pos + 1) === CH_BANG
		) {
			const start = this.pos;

			this.pos += 2;

			while (this.pos < this.length) {
				const code = this.source.charCodeAt(this.pos);

				if (
					code === CH_LF ||
					code === CH_CR ||
					code === CH_LINE_SEPARATOR ||
					code === CH_PARAGRAPH_SEPARATOR
				) {
					break;
				}

				this.pos++;
			}

			this.record(T_HASHBANG, start, this.pos, 0, 0);
		}
	}

	/**
	 * Skips whitespace and comments, recording comment tokens as it goes.
	 * @returns The flags that apply to the next token, which is currently only
	 *      whether a line terminator was crossed.
	 */
	private skipTrivia(): number {
		const source = this.source;
		let tokenFlags = 0;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (code < ASCII_LIMIT) {
				const classification = CHAR_FLAGS[code];

				if ((classification & MASK_SPACE) !== 0) {
					this.pos++;
					continue;
				}

				if ((classification & MASK_NEWLINE) !== 0) {
					this.pos++;

					// Treat CRLF as a single line break.
					if (
						code === CH_CR &&
						source.charCodeAt(this.pos) === CH_LF
					) {
						this.pos++;
					}

					this.addLine(this.pos);
					tokenFlags |= TF_NEWLINE_BEFORE;
					continue;
				}

				if (code === CH_SLASH) {
					const next = source.charCodeAt(this.pos + 1);

					if (next === CH_SLASH) {
						this.scanLineComment(2);
						continue;
					}

					if (next === CH_STAR) {
						if (this.scanBlockComment()) {
							tokenFlags |= TF_NEWLINE_BEFORE;
						}

						continue;
					}
				}

				/*
				 * Annex B's HTML-like comments, which exist only in script
				 * code — in a module `<!--` is three operators and `-->` is
				 * two. `-->` closes a comment only where one could have been
				 * opened on an earlier line, so it has to be the first thing
				 * on its own line; `<!--` may appear anywhere, which is what
				 * makes `a <!--b` an `a` and a comment rather than
				 * `a < !(--b)`.
				 *
				 * The character is tested before the source type so that the
				 * common path out of this loop — a token starting with
				 * anything else — costs two compares against constants rather
				 * than a field load.
				 */
				if ((code === CH_LT || code === CH_MINUS) && !this.isModule) {
					if (
						code === CH_LT &&
						source.charCodeAt(this.pos + 1) === CH_BANG &&
						source.charCodeAt(this.pos + 2) === CH_MINUS &&
						source.charCodeAt(this.pos + 3) === CH_MINUS
					) {
						this.scanLineComment(4);
						continue;
					}

					if (
						code === CH_MINUS &&
						source.charCodeAt(this.pos + 1) === CH_MINUS &&
						source.charCodeAt(this.pos + 2) === CH_GT &&
						(this.prevEnd === 0 ||
							(tokenFlags & TF_NEWLINE_BEFORE) !== 0)
					) {
						this.scanLineComment(3);
						continue;
					}
				}

				break;
			}

			if (code === CH_LINE_SEPARATOR || code === CH_PARAGRAPH_SEPARATOR) {
				this.pos++;
				this.addLine(this.pos);
				tokenFlags |= TF_NEWLINE_BEFORE;
				continue;
			}

			if (isNonAsciiSpace(code)) {
				this.pos++;
				continue;
			}

			break;
		}

		return tokenFlags;
	}

	/**
	 * Scans a comment that ends at the next line terminator.
	 * @param openerLength How long the delimiter that opened it is: two for
	 *      `//`, four for Annex B's `<!--`, three for its `-->`.
	 * @returns Nothing.
	 */
	private scanLineComment(openerLength: number): void {
		const source = this.source;
		const start = this.pos;

		this.pos += openerLength;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (
				code === CH_LF ||
				code === CH_CR ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				break;
			}

			this.pos++;
		}

		this.record(T_LINE_COMMENT, start, this.pos, 0, 0);
	}

	/**
	 * Scans a `/* *\/` comment.
	 * @returns `true` when the comment contained a line terminator.
	 * @throws {ParseError} When the comment is never closed.
	 */
	private scanBlockComment(): boolean {
		const source = this.source;
		const start = this.pos;
		let sawNewline = false;

		this.pos += 2;

		for (;;) {
			if (this.pos >= this.length) {
				throw this.error("Unterminated comment", start);
			}

			const code = source.charCodeAt(this.pos);

			if (
				code === CH_STAR &&
				source.charCodeAt(this.pos + 1) === CH_SLASH
			) {
				this.pos += 2;
				break;
			}

			if (
				code === CH_LF ||
				code === CH_CR ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				this.pos++;

				if (code === CH_CR && source.charCodeAt(this.pos) === CH_LF) {
					this.pos++;
				}

				this.addLine(this.pos);
				sawNewline = true;
				continue;
			}

			this.pos++;
		}

		this.record(T_BLOCK_COMMENT, start, this.pos, 0, 0);

		return sawNewline;
	}

	/**
	 * Advances to the next significant token, recording it and any comments
	 * that precede it.
	 * @returns Nothing.
	 * @throws {ParseError} When the input cannot be tokenized.
	 */
	next(): void {
		this.prevKind = this.kind;
		this.prevEnd = this.end;

		/*
		 * When a `peek()` already scanned this very token — same position,
		 * same scanner mode — advancing is a matter of moving its result
		 * into place. See the cache fields for why the guards are complete.
		 */
		if (this.peekUsable()) {
			this.pos = this.peekEndPos;
			this.count = this.peekCount;
			this.records.length = this.peekRecordsLength;
			this.lineCount = this.peekLineCount;
			this.kind = this.peekKind;
			this.start = this.peekStart;
			this.end = this.peekEndPos;
			this.flags = this.peekFlags;
			this.extra = this.peekExtra;
			this.contextDepth = this.peekContextAfterDepth;

			if (this.peekContextAfterDepth > 0) {
				this.context[this.peekContextAfterDepth - 1] =
					this.peekContextAfterTop;
			}

			this.peekPos = -1;
			this.record(
				this.kind,
				this.start,
				this.end,
				this.flags,
				this.extra,
			);
			this.updateContext();
			return;
		}

		this.peekPos = -1;

		const tokenFlags = this.skipTrivia();

		this.flags = tokenFlags;
		this.extra = 0;
		this.start = this.pos;

		if (this.pos >= this.length) {
			this.kind = T_EOF;
			this.end = this.pos;
			this.record(T_EOF, this.pos, this.pos, this.flags, 0);
			this.exprAllowed = false;
			return;
		}

		this.scanToken();
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.updateContext();
	}

	/**
	 * Reads a single token starting at the current position, leaving the
	 * result in the current-token fields.
	 * @returns Nothing.
	 * @throws {ParseError} When no valid token can be read.
	 */
	private scanToken(): void {
		const source = this.source;
		const code = source.charCodeAt(this.pos);

		// Identifiers and keywords are by far the most common tokens.
		if (code < ASCII_LIMIT) {
			const classification = CHAR_FLAGS[code];

			if ((classification & MASK_ID_START) !== 0) {
				this.scanIdentifier();
				return;
			}

			if ((classification & MASK_DIGIT) !== 0) {
				this.scanNumber();
				return;
			}

			const simple = SIMPLE_PUNCTUATORS[code];

			if (simple !== 0) {
				this.pos++;
				this.kind = simple;
				return;
			}
		} else if (isNonAsciiIdStart(source.codePointAt(this.pos)!)) {
			/*
			 * An identifier may start above the basic plane, where the first
			 * code unit is a lone surrogate and classifies as nothing at all.
			 * Only this branch pays for assembling the code point, so the
			 * ASCII path above is untouched.
			 */
			this.scanIdentifier();
			return;
		}

		switch (code) {
			case CH_QUOTE_DOUBLE:
			case CH_QUOTE_SINGLE:
				this.scanString(code);
				return;

			case CH_BACKTICK:
				this.pos++;
				this.scanTemplatePart(this.start, true);
				return;

			case CH_DOT: {
				const next = source.charCodeAt(this.pos + 1);

				if ((CHAR_FLAGS[next] & MASK_DIGIT) !== 0) {
					this.scanNumber();
					return;
				}

				if (
					next === CH_DOT &&
					source.charCodeAt(this.pos + 2) === CH_DOT
				) {
					this.pos += 3;
					this.kind = T_ELLIPSIS;
					return;
				}

				this.pos++;
				this.kind = T_DOT;
				return;
			}

			case CH_SLASH:
				this.scanSlash();
				return;

			case CH_HASH:
				this.scanPrivateIdentifier();
				return;

			// An identifier may begin with a unicode escape sequence.
			case CH_BACKSLASH:
				this.scanIdentifier();
				return;

			default:
				this.scanPunctuator(code);
		}
	}

	/**
	 * Scans an identifier, keyword, or escaped identifier.
	 * @returns Nothing.
	 * @throws {ParseError} When a unicode escape sequence is malformed.
	 */
	private scanIdentifier(): void {
		const source = this.source;
		const start = this.pos;
		let hash = 0;
		let hasEscape = false;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (code < ASCII_LIMIT) {
				if ((CHAR_FLAGS[code] & MASK_ID_PART) !== 0) {
					hash = hashChar(hash, code);
					this.pos++;
					continue;
				}

				if (code === CH_BACKSLASH) {
					hasEscape = true;
					this.scanIdentifierEscape(this.pos === start);
					continue;
				}

				break;
			}

			const point = source.codePointAt(this.pos)!;

			if (!isNonAsciiIdPart(point)) {
				break;
			}

			hash = hashChar(hash, code);
			this.pos += point > 0xffff ? 2 : 1;
		}

		if (hasEscape) {
			/*
			 * A word written with escapes is never a keyword, so the keyword
			 * table is skipped entirely.
			 */
			this.flags |= TF_HAS_ESCAPE;
			this.kind = T_IDENT;
			return;
		}

		this.kind = lookupKeyword(source, start, this.pos, hash);
	}

	/**
	 * Consumes a `\uXXXX` or `\u{...}` escape inside an identifier.
	 *
	 * An escape here stands for a letter and only for a letter: what it names
	 * has to be a character the identifier could have been written with
	 * directly, so `\u0023field` is not a way to spell `#field` and
	 * `\u200D_ZWJ` is not a way to open a name with a joiner. Which of the two
	 * tables applies is the ordinary `IdentifierStart` / `IdentifierPart`
	 * split, decided by where in the word the escape sits.
	 * @param atStart Whether the escape opens the identifier.
	 * @returns Nothing.
	 * @throws {ParseError} When the escape is malformed or names a character
	 *      an identifier may not contain.
	 */
	private scanIdentifierEscape(atStart: boolean): void {
		const source = this.source;
		const escapeStart = this.pos;

		if (source.charCodeAt(this.pos + 1) !== CH_U_LOWER) {
			throw this.error(
				"Invalid escape sequence in identifier",
				escapeStart,
			);
		}

		this.pos += 2;

		let point = 0;

		if (source.charCodeAt(this.pos) === CH_BRACE_OPEN) {
			this.pos++;

			const digitsStart = this.pos;

			while (
				this.pos < this.length &&
				(CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_HEX_DIGIT) !== 0
			) {
				point = point * 16 + hexValue(source.charCodeAt(this.pos));

				// Held down so that a long run of digits cannot lose precision.
				if (point > MAX_CODE_POINT) {
					point = MAX_CODE_POINT + 1;
				}

				this.pos++;
			}

			if (
				this.pos === digitsStart ||
				source.charCodeAt(this.pos) !== CH_BRACE_CLOSE
			) {
				throw this.error(
					"Invalid escape sequence in identifier",
					escapeStart,
				);
			}

			this.pos++;
		} else {
			for (let i = 0; i < 4; i++) {
				const code = source.charCodeAt(this.pos);

				if (
					code >= ASCII_LIMIT ||
					(CHAR_FLAGS[code] & MASK_HEX_DIGIT) === 0
				) {
					throw this.error(
						"Invalid escape sequence in identifier",
						escapeStart,
					);
				}

				point = point * 16 + hexValue(code);
				this.pos++;
			}
		}

		const legal =
			point < ASCII_LIMIT
				? (CHAR_FLAGS[point] &
						(atStart ? MASK_ID_START : MASK_ID_PART)) !==
					0
				: point <= MAX_CODE_POINT &&
					(atStart
						? isNonAsciiIdStart(point)
						: isNonAsciiIdPart(point));

		if (!legal) {
			throw this.error(
				"Invalid escape sequence in identifier",
				escapeStart,
			);
		}
	}

	/**
	 * Scans a `#name` private identifier.
	 * @returns Nothing.
	 * @throws {ParseError} When `#` is not followed by an identifier.
	 */
	private scanPrivateIdentifier(): void {
		const start = this.pos;

		this.pos++;

		const code = this.source.charCodeAt(this.pos);
		const isStart =
			code < ASCII_LIMIT
				? (CHAR_FLAGS[code] & MASK_ID_START) !== 0 ||
					code === CH_BACKSLASH
				: isNonAsciiIdStart(this.source.codePointAt(this.pos)!);

		if (!isStart) {
			throw this.error("Unexpected character '#'", start);
		}

		this.scanIdentifier();
		this.kind = T_PRIVATE_IDENT;
	}

	/**
	 * Scans a numeric literal, including binary, octal, hexadecimal, legacy
	 * octal, and BigInt forms.
	 * @returns Nothing.
	 * @throws {ParseError} When the literal is malformed.
	 */
	private scanNumber(): void {
		const source = this.source;
		const start = this.pos;
		let code = source.charCodeAt(this.pos);

		this.kind = T_NUMBER;

		if (code === CH_0) {
			const next = source.charCodeAt(this.pos + 1);

			if (next === CH_X_LOWER || next === CH_X_UPPER) {
				this.pos += 2;
				this.scanDigits(MASK_HEX_DIGIT, 16);
				this.finishNumber();
				return;
			}

			if (next === CH_O_LOWER || next === CH_O_UPPER) {
				this.pos += 2;
				this.scanDigits(MASK_DIGIT, 8);
				this.finishNumber();
				return;
			}

			if (next === CH_B_LOWER || next === CH_B_UPPER) {
				this.pos += 2;
				this.scanDigits(MASK_DIGIT, 2);
				this.finishNumber();
				return;
			}

			/*
			 * `DecimalIntegerLiteral` admits a separator only after a
			 * `NonZeroDigit`, so a lone `0` ends the integer part and nothing
			 * may join it to what follows. The other bases are unaffected —
			 * `0x1_0` separates hex digits, not the leading zero — and so is
			 * `0.1_1`, where the separator is inside the fraction.
			 */
			if (next === CH_UNDERSCORE) {
				throw this.error(
					"Numeric separator is not allowed after a leading 0",
					this.pos + 1,
				);
			}

			/*
			 * A leading zero followed by more digits is one of two literals,
			 * and which one decides where the literal ends. Digits that are
			 * all octal make a `LegacyOctalIntegerLiteral`, which has no
			 * fraction and no exponent — `0123.a` is a property access on the
			 * number 83, and `01e2` is a number with an identifier stuck to
			 * it. An `8` or a `9` anywhere in them makes a
			 * `NonOctalDecimalIntegerLiteral` instead, which is a
			 * `DecimalIntegerLiteral` and takes both.
			 *
			 * Both are errors only in strict mode, so the fact is recorded
			 * and left to the validation phase.
			 *
			 * Neither production admits a separator or a `BigIntLiteralSuffix`
			 * anywhere in those digits, which is why the run is consumed here
			 * rather than by `scanDecimalDigits()`: `08_0` and `08n` are
			 * errors, and the `_` or the `n` is left for the boundary check to
			 * report as the identifier it starts.
			 */
			if ((CHAR_FLAGS[next] & MASK_DIGIT) !== 0) {
				let octal = true;

				this.pos++;

				while (
					(CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_DIGIT) !==
					0
				) {
					if (source.charCodeAt(this.pos) > CH_7) {
						octal = false;
					}

					this.pos++;
				}

				this.flags |= TF_LEGACY_OCTAL;

				if (!octal) {
					this.scanFractionAndExponent(start);
				}

				this.checkNumberBoundary();
				return;
			}
		}

		this.scanDecimalDigits();

		if (source.charCodeAt(this.pos) === CH_N_LOWER) {
			this.pos++;
			this.kind = T_BIGINT;
			this.checkNumberBoundary();
			return;
		}

		this.scanFractionAndExponent(start);
		this.checkNumberBoundary();
	}

	/**
	 * Consumes the fraction and the exponent of a decimal literal, if it has
	 * either.
	 * @param start Where the literal begins, for the error position.
	 * @returns Nothing.
	 * @throws {ParseError} When an exponent has no digits.
	 */
	private scanFractionAndExponent(start: number): void {
		const source = this.source;
		let code = source.charCodeAt(this.pos);

		if (code === CH_DOT) {
			this.pos++;
			this.scanDecimalDigits();

			code = source.charCodeAt(this.pos);
		}

		if (code !== CH_E_LOWER && code !== CH_E_UPPER) {
			return;
		}

		this.pos++;

		const sign = source.charCodeAt(this.pos);

		if (sign === CH_PLUS || sign === CH_MINUS) {
			this.pos++;
		}

		if ((CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_DIGIT) === 0) {
			throw this.error("Invalid number", start);
		}

		this.scanDecimalDigits();
	}

	/**
	 * Consumes a run of decimal digits, with `_` allowed between two of them.
	 *
	 * A separator with no digit after it has to be rejected here rather than
	 * left to `checkNumberBoundary()`: that reports the character *after* the
	 * literal, and `1_` ends the literal at the end of the input, where there
	 * is no character to complain about.
	 * @returns Nothing.
	 * @throws {ParseError} When a separator is not between two digits.
	 */
	private scanDecimalDigits(): void {
		const source = this.source;

		while ((CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_DIGIT) !== 0) {
			this.pos++;

			if (source.charCodeAt(this.pos) !== CH_UNDERSCORE) {
				continue;
			}

			this.pos++;

			if ((CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_DIGIT) === 0) {
				throw this.error(
					"Numeric separator must be between two digits",
					this.pos - 1,
				);
			}
		}
	}

	/**
	 * Consumes the digits of a radix-prefixed numeric literal.
	 * @param mask The character classification mask digits must satisfy.
	 * @param radix The radix, used to reject out-of-range decimal digits.
	 * @returns Nothing.
	 * @throws {ParseError} When no valid digit follows the radix prefix.
	 */
	private scanDigits(mask: number, radix: number): void {
		const source = this.source;
		const start = this.pos;

		for (;;) {
			const code = source.charCodeAt(this.pos);

			/*
			 * A separator has to sit between two digits, so one that opens the
			 * run, doubles, or ends it stops the scan where it is. The literal
			 * then ends on a `_`, which `finishNumber()` reports as an
			 * identifier running into the number.
			 */
			if (code === CH_UNDERSCORE) {
				const next = source.charCodeAt(this.pos + 1);

				if (
					this.pos === start ||
					next >= ASCII_LIMIT ||
					(CHAR_FLAGS[next] & mask) === 0 ||
					(radix < 10 && next - CH_0 >= radix)
				) {
					break;
				}

				this.pos++;
				continue;
			}

			if (code >= ASCII_LIMIT || (CHAR_FLAGS[code] & mask) === 0) {
				break;
			}

			if (radix < 10 && code - CH_0 >= radix) {
				break;
			}

			this.pos++;
		}

		if (this.pos === start) {
			throw this.error("Invalid number", start - 2);
		}
	}

	/**
	 * Applies the optional `n` suffix and checks the character that follows a
	 * radix-prefixed numeric literal.
	 * @returns Nothing.
	 * @throws {ParseError} When the literal is followed by an identifier.
	 */
	private finishNumber(): void {
		if (this.source.charCodeAt(this.pos) === CH_N_LOWER) {
			this.pos++;
			this.kind = T_BIGINT;
		}

		this.checkNumberBoundary();
	}

	/**
	 * Rejects a numeric literal that runs directly into an identifier, such as
	 * `3in` or `0x1z`.
	 * @returns Nothing.
	 * @throws {ParseError} When an identifier character follows the literal.
	 */
	private checkNumberBoundary(): void {
		const code = this.source.charCodeAt(this.pos);

		if (Number.isNaN(code)) {
			return;
		}

		/*
		 * The rule is `IdentifierStart` or a decimal digit, not
		 * `IdentifierPart`, which is why the ASCII mask covers the digits and
		 * the fallback asks about a start.
		 */
		const isIdentifierChar =
			code < ASCII_LIMIT
				? (CHAR_FLAGS[code] & MASK_ID_PART) !== 0
				: isNonAsciiIdStart(this.source.codePointAt(this.pos)!);

		if (isIdentifierChar) {
			throw this.error("Identifier directly after number", this.pos);
		}
	}

	/**
	 * Scans a single- or double-quoted string literal.
	 * @param quote The character code of the opening quote.
	 * @returns Nothing.
	 * @throws {ParseError} When the string is unterminated.
	 */
	private scanString(quote: number): void {
		const source = this.source;
		const start = this.pos;

		this.pos++;

		for (;;) {
			if (this.pos >= this.length) {
				throw this.error("Unterminated string constant", start);
			}

			const code = source.charCodeAt(this.pos);

			if (code === quote) {
				this.pos++;
				break;
			}

			if (code === CH_BACKSLASH) {
				this.flags |= TF_HAS_ESCAPE;
				this.scanStringEscape();
				continue;
			}

			if (code === CH_LF || code === CH_CR) {
				throw this.error("Unterminated string constant", start);
			}

			this.pos++;
		}

		this.kind = T_STRING;
	}

	/**
	 * Consumes one escape sequence inside a string literal.
	 * @returns Nothing.
	 * @throws {ParseError} When the escape runs past the end of the input.
	 */
	private scanStringEscape(): void {
		const source = this.source;
		const escapeStart = this.pos;

		this.pos++;

		if (this.pos >= this.length) {
			throw this.error("Unterminated string constant", this.pos);
		}

		const code = source.charCodeAt(this.pos);

		// A backslash before a line terminator continues the string.
		if (code === CH_CR) {
			this.pos++;

			if (source.charCodeAt(this.pos) === CH_LF) {
				this.pos++;
			}

			this.addLine(this.pos);
			return;
		}

		if (
			code === CH_LF ||
			code === CH_LINE_SEPARATOR ||
			code === CH_PARAGRAPH_SEPARATOR
		) {
			this.pos++;
			this.addLine(this.pos);
			return;
		}

		/*
		 * Legacy octal escapes such as `\1`, and the two `\8` and `\9` that
		 * the grammar keeps beside them, are only errors in strict mode, so
		 * they are recorded rather than rejected here. `\0` not followed by a
		 * digit is always allowed.
		 */
		if (code >= CH_0 && code <= CH_9) {
			const next = source.charCodeAt(this.pos + 1);

			if (code !== CH_0 || (CHAR_FLAGS[next] & MASK_DIGIT) !== 0) {
				this.flags |= TF_LEGACY_OCTAL;
			}
		}

		this.pos++;

		/*
		 * A string has no reading in which a malformed `\x` or `\u` is legal,
		 * so this is a lexical error rather than something for `validate()`.
		 * A template is the other case, and the difference is a tag: one
		 * receives the raw text and `undefined` for the cooked value.
		 */
		if (
			(code === CH_X_LOWER || code === CH_U_LOWER) &&
			!this.scanCharacterEscape(code)
		) {
			throw this.error("Invalid escape sequence in string", escapeStart);
		}
	}

	/**
	 * Consumes a `\x` or `\u` escape, starting just past the `x` or the `u`.
	 *
	 * The two callers differ only in what they do with the answer: a string
	 * throws, and a template records a flag, because a tagged template is
	 * handed the raw text and takes `undefined` for its cooked value.
	 * @param code The character that opened the escape, `x` or `u`.
	 * @returns `true` when the escape was well formed.
	 */
	private scanCharacterEscape(code: number): boolean {
		const source = this.source;

		if (code === CH_X_LOWER) {
			return this.consumeHexDigits(2);
		}

		if (source.charCodeAt(this.pos) !== CH_BRACE_OPEN) {
			return this.consumeHexDigits(4);
		}

		this.pos++;

		const digitsStart = this.pos;

		while (
			this.pos < this.length &&
			(CHAR_FLAGS[source.charCodeAt(this.pos)] & MASK_HEX_DIGIT) !== 0
		) {
			this.pos++;
		}

		if (
			this.pos === digitsStart ||
			source.charCodeAt(this.pos) !== CH_BRACE_CLOSE
		) {
			return false;
		}

		const digits = this.pos - digitsStart;

		this.pos++;

		/*
		 * `\u{...}` names a code point, so it stops at `0x10FFFF` however it is
		 * written. Five digits cannot reach that, and leading zeros can carry
		 * a small one past five, so the text is read only when it is long
		 * enough to be out of range.
		 */
		return (
			digits < 6 ||
			Number.parseInt(
				source.slice(digitsStart, digitsStart + digits),
				16,
			) <= MAX_CODE_POINT
		);
	}

	/**
	 * Scans one piece of a template literal, starting just past the `` ` `` or
	 * `}` that opened it.
	 * @param start The offset of the `` ` `` or `}` that opened the piece.
	 * @param isHead `true` when the piece began with a backtick.
	 * @returns Nothing.
	 * @throws {ParseError} When the template is unterminated.
	 */
	private scanTemplatePart(start: number, isHead: boolean): void {
		const source = this.source;

		for (;;) {
			if (this.pos >= this.length) {
				throw this.error("Unterminated template", start);
			}

			const code = source.charCodeAt(this.pos);

			if (code === CH_BACKTICK) {
				this.pos++;
				this.kind = isHead ? T_TEMPLATE_FULL : T_TEMPLATE_TAIL;
				return;
			}

			if (
				code === CH_DOLLAR &&
				source.charCodeAt(this.pos + 1) === CH_BRACE_OPEN
			) {
				this.pos += 2;
				this.kind = isHead ? T_TEMPLATE_HEAD : T_TEMPLATE_MIDDLE;
				this.pushContext(CTX_TEMPLATE);
				return;
			}

			if (code === CH_BACKSLASH) {
				this.flags |= TF_HAS_ESCAPE;
				this.scanTemplateEscape();
				continue;
			}

			if (code === CH_CR) {
				this.pos++;

				if (source.charCodeAt(this.pos) === CH_LF) {
					this.pos++;
				}

				this.addLine(this.pos);
				continue;
			}

			if (
				code === CH_LF ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				this.pos++;
				this.addLine(this.pos);
				continue;
			}

			this.pos++;
		}
	}

	/**
	 * Consumes one escape sequence inside a template literal, marking escapes
	 * that are only legal in tagged templates.
	 * @returns Nothing.
	 * @throws {ParseError} When the escape runs past the end of the input.
	 */
	private scanTemplateEscape(): void {
		const source = this.source;

		this.pos++;

		if (this.pos >= this.length) {
			throw this.error("Unterminated template", this.pos);
		}

		const code = source.charCodeAt(this.pos);

		if (code === CH_CR) {
			this.pos++;

			if (source.charCodeAt(this.pos) === CH_LF) {
				this.pos++;
			}

			this.addLine(this.pos);
			return;
		}

		if (
			code === CH_LF ||
			code === CH_LINE_SEPARATOR ||
			code === CH_PARAGRAPH_SEPARATOR
		) {
			this.pos++;
			this.addLine(this.pos);
			return;
		}

		this.pos++;

		switch (code) {
			case CH_X_LOWER:
			case CH_U_LOWER:
				if (!this.scanCharacterEscape(code)) {
					this.flags |= TF_INVALID_ESCAPE;
				}

				return;

			default:
				if (code >= CH_0 && code <= CH_9) {
					const next = source.charCodeAt(this.pos);

					if (
						code !== CH_0 ||
						(CHAR_FLAGS[next] & MASK_DIGIT) !== 0
					) {
						this.flags |= TF_INVALID_ESCAPE;
					}
				}
		}
	}

	/**
	 * Consumes an exact number of hexadecimal digits.
	 * @param count How many digits are required.
	 * @returns `true` when that many digits were present.
	 */
	private consumeHexDigits(count: number): boolean {
		const source = this.source;

		for (let i = 0; i < count; i++) {
			const code = source.charCodeAt(this.pos);

			if (
				code >= ASCII_LIMIT ||
				(CHAR_FLAGS[code] & MASK_HEX_DIGIT) === 0
			) {
				return false;
			}

			this.pos++;
		}

		return true;
	}

	/**
	 * Scans a token that begins with `/`, choosing between a regular
	 * expression literal and the division operators based on whether an
	 * expression may start at this position.
	 * @returns Nothing.
	 * @throws {ParseError} When a regular expression literal is unterminated.
	 */
	private scanSlash(): void {
		if (this.exprAllowed && !this.inJsxTag) {
			this.scanRegExp();
			return;
		}

		if (this.source.charCodeAt(this.pos + 1) === CH_EQ) {
			this.pos += 2;
			this.kind = T_ASSIGN_SLASH;
			return;
		}

		this.pos++;
		this.kind = T_SLASH;
	}

	/**
	 * Rescans the current token as a regular expression literal. The parser
	 * calls this when its own context proves that a `/` cannot be division.
	 * @returns Nothing.
	 * @throws {ParseError} When the literal is unterminated.
	 */
	reScanAsRegExp(): void {
		this.pos = this.start;
		this.count--;
		this.records.length = this.count * TOKEN_WORDS;
		this.flags &= ~(TF_HAS_ESCAPE | TF_INVALID_ESCAPE);

		this.scanRegExp();
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.updateContext();
	}

	//-------------------------------------------------------------------------
	// JSX Scanning
	//-------------------------------------------------------------------------

	/*
	 * JSX has its own lexical grammar, so the parser asks for the next token
	 * in a specific mode rather than letting the scanner guess. Each of these
	 * falls back to ordinary scanning when the text at the current position is
	 * not the JSX-specific form, which is what lets the parser call them
	 * without first checking what comes next.
	 */

	/**
	 * Reads the next child of a JSX element: a run of literal text, or an
	 * ordinary token when the next character opens a tag or an expression.
	 * @returns Nothing.
	 * @throws {ParseError} When the input cannot be tokenized.
	 */
	nextJsxText(): void {
		const code = this.source.charCodeAt(this.pos);

		if (
			this.pos >= this.length ||
			code === CH_LT ||
			code === CH_BRACE_OPEN
		) {
			this.next();
			return;
		}

		this.prevKind = this.kind;
		this.prevEnd = this.end;

		// Whitespace is part of the text, so no trivia is skipped here.
		this.flags = 0;
		this.extra = 0;
		this.start = this.pos;
		this.scanJsxText();
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.exprAllowed = false;
	}

	/**
	 * Reads the next JSX element or attribute name, or an ordinary token when
	 * the next character cannot start one.
	 * @returns Nothing.
	 * @throws {ParseError} When the input cannot be tokenized.
	 */
	nextJsxName(): void {
		this.prevKind = this.kind;
		this.prevEnd = this.end;

		const tokenFlags = this.skipTrivia();
		const code = this.source.charCodeAt(this.pos);
		const isNameStart =
			code < ASCII_LIMIT
				? (CHAR_FLAGS[code] & MASK_ID_START) !== 0
				: isNonAsciiIdStart(this.source.codePointAt(this.pos)!);

		if (this.pos >= this.length || !isNameStart) {
			this.finishSkippedToken(tokenFlags);

			/*
			 * A `>` inside a tag always closes it, so a run of them can never
			 * be the shift operator the ordinary scanner just produced.
			 */
			this.reScanGreaterThan();
			return;
		}

		this.flags = tokenFlags;
		this.extra = 0;
		this.start = this.pos;
		this.scanJsxIdentifier();
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.exprAllowed = false;
	}

	/**
	 * Reads the value of a JSX attribute: a quoted string with no escape
	 * processing, or an ordinary token when the value is an expression.
	 * @returns Nothing.
	 * @throws {ParseError} When the string is unterminated.
	 */
	nextJsxAttributeValue(): void {
		this.prevKind = this.kind;
		this.prevEnd = this.end;

		const tokenFlags = this.skipTrivia();
		const code = this.source.charCodeAt(this.pos);

		if (code !== CH_QUOTE_DOUBLE && code !== CH_QUOTE_SINGLE) {
			this.finishSkippedToken(tokenFlags);
			return;
		}

		this.flags = tokenFlags;
		this.extra = 0;
		this.start = this.pos;
		this.scanJsxString(code);
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.exprAllowed = false;
	}

	/**
	 * Re-reads the current token as a JSX name.
	 *
	 * Type arguments in a JSX tag, as in `<Foo<T> bar/>`, are parsed by the
	 * ordinary type grammar, which leaves the scanner one token past the `>`
	 * in the wrong mode. This puts it back.
	 * @returns Nothing.
	 * @throws {ParseError} When the input cannot be tokenized.
	 */
	reScanAsJsxName(): void {
		const prevKind = this.prevKind;
		const prevEnd = this.prevEnd;

		this.pos = this.start;
		this.count--;
		this.records.length = this.count * TOKEN_WORDS;
		this.nextJsxName();
		this.prevKind = prevKind;
		this.prevEnd = prevEnd;
	}

	/**
	 * Finishes an ordinary token after trivia has already been skipped, which
	 * is how the JSX modes fall back to the normal grammar.
	 * @param tokenFlags The flags gathered while skipping trivia.
	 * @returns Nothing.
	 * @throws {ParseError} When the input cannot be tokenized.
	 */
	private finishSkippedToken(tokenFlags: number): void {
		/*
		 * Inside JSX a `/` always closes a tag, so the regular expression
		 * rule that would otherwise apply after `<` is turned off first.
		 */
		this.exprAllowed = false;
		this.flags = tokenFlags;
		this.extra = 0;
		this.start = this.pos;

		if (this.pos >= this.length) {
			this.kind = T_EOF;
			this.end = this.pos;
			this.record(T_EOF, this.pos, this.pos, this.flags, 0);
			this.exprAllowed = false;
			return;
		}

		this.scanToken();
		this.end = this.pos;
		this.record(this.kind, this.start, this.end, this.flags, this.extra);
		this.updateContext();
	}

	/**
	 * Scans a run of literal text between JSX tags.
	 * @returns Nothing.
	 */
	private scanJsxText(): void {
		const source = this.source;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (code === CH_LT || code === CH_BRACE_OPEN) {
				break;
			}

			if (code === CH_CR) {
				this.pos++;

				if (source.charCodeAt(this.pos) === CH_LF) {
					this.pos++;
				}

				this.addLine(this.pos);
				continue;
			}

			if (
				code === CH_LF ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				this.pos++;
				this.addLine(this.pos);
				continue;
			}

			this.pos++;
		}

		this.kind = T_JSX_TEXT;
	}

	/**
	 * Scans a JSX element or attribute name, which unlike a JavaScript
	 * identifier may contain `-`.
	 * @returns Nothing.
	 */
	private scanJsxIdentifier(): void {
		const source = this.source;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (code < ASCII_LIMIT) {
				if (
					(CHAR_FLAGS[code] & MASK_ID_PART) !== 0 ||
					code === CH_MINUS
				) {
					this.pos++;
					continue;
				}

				break;
			}

			const point = source.codePointAt(this.pos)!;

			if (!isNonAsciiIdPart(point)) {
				break;
			}

			this.pos += point > 0xffff ? 2 : 1;
		}

		this.kind = T_JSX_IDENT;
	}

	/**
	 * Scans a quoted JSX attribute value. Backslashes are literal here; only
	 * entity references are meaningful, and those are resolved when the value
	 * is decoded rather than while scanning.
	 * @param quote The character code of the opening quote.
	 * @returns Nothing.
	 * @throws {ParseError} When the value is unterminated.
	 */
	private scanJsxString(quote: number): void {
		const source = this.source;
		const start = this.pos;

		this.pos++;

		for (;;) {
			if (this.pos >= this.length) {
				throw this.error("Unterminated JSX attribute value", start);
			}

			const code = source.charCodeAt(this.pos);

			if (code === quote) {
				this.pos++;
				break;
			}

			if (code === CH_CR) {
				this.pos++;

				if (source.charCodeAt(this.pos) === CH_LF) {
					this.pos++;
				}

				this.addLine(this.pos);
				continue;
			}

			if (
				code === CH_LF ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				this.pos++;
				this.addLine(this.pos);
				continue;
			}

			this.pos++;
		}

		this.kind = T_JSX_STRING;
	}

	/**
	 * Records that the current keyword token is being used as a plain
	 * identifier, which is how `n.default` and `{ if: 1 }` end up reported as
	 * identifiers rather than keywords.
	 *
	 * `let`, `static`, and `yield` keep their keyword identity because that is
	 * what consumers of the token stream expect.
	 * @returns Nothing.
	 */
	demoteKeywordToIdentifier(): void {
		const kind = this.kind;

		if (
			kind < KEYWORD_FIRST ||
			kind > KEYWORD_LAST ||
			kind === T_let ||
			kind === T_static ||
			kind === T_yield
		) {
			return;
		}

		this.kind = T_IDENT;

		const index = (this.count - 1) * TOKEN_WORDS;

		this.records.words[index + 2] = T_IDENT | (this.flags << 16);

		// An identifier is never followed by a regular expression literal.
		this.exprAllowed = false;
	}

	/**
	 * Splits a token that starts with `>` so that only a single `>` remains.
	 * Type argument lists such as `Array<Array<T>>` are scanned as shift
	 * operators, and the parser undoes that when it closes a type list.
	 * @returns `true` when the current token was split.
	 */
	reScanGreaterThan(): boolean {
		const kind = this.kind;

		if (
			kind !== T_SAR &&
			kind !== T_SHR &&
			kind !== T_GT_EQ &&
			kind !== T_ASSIGN_SAR &&
			kind !== T_ASSIGN_SHR
		) {
			return false;
		}

		this.pos = this.start + 1;
		this.end = this.pos;
		this.kind = T_GT;

		// Rewrite the record in place rather than appending a new one.
		const index = (this.count - 1) * TOKEN_WORDS;
		const words = this.records.words;

		words[index + 1] = this.end;
		words[index + 2] = T_GT | (this.flags << 16);

		this.updateContext();

		return true;
	}

	/**
	 * Scans a regular expression literal, including its flags.
	 * @returns Nothing.
	 * @throws {ParseError} When the literal is unterminated.
	 */
	private scanRegExp(): void {
		const source = this.source;
		const start = this.pos;
		let inClass = false;

		this.pos++;

		for (;;) {
			if (this.pos >= this.length) {
				throw this.error("Unterminated regular expression", start);
			}

			const code = source.charCodeAt(this.pos);

			if (
				code === CH_LF ||
				code === CH_CR ||
				code === CH_LINE_SEPARATOR ||
				code === CH_PARAGRAPH_SEPARATOR
			) {
				throw this.error("Unterminated regular expression", start);
			}

			/*
			 * A backslash escapes the next character, but only a
			 * `RegularExpressionNonTerminator`. A line terminator after one is
			 * not escaped by it, so the literal ends there, unterminated.
			 */
			if (code === CH_BACKSLASH) {
				const next = source.charCodeAt(this.pos + 1);

				if (
					this.pos + 1 >= this.length ||
					next === CH_LF ||
					next === CH_CR ||
					next === CH_LINE_SEPARATOR ||
					next === CH_PARAGRAPH_SEPARATOR
				) {
					throw this.error("Unterminated regular expression", start);
				}

				this.pos += 2;
				continue;
			}

			if (code === CH_BRACKET_OPEN) {
				inClass = true;
			} else if (code === CH_BRACKET_CLOSE) {
				inClass = false;
			} else if (code === CH_SLASH && !inClass) {
				break;
			}

			this.pos++;
		}

		// Remember where the pattern ended so the flags can be split out.
		this.extra = this.pos;
		this.pos++;

		while (this.pos < this.length) {
			const code = source.charCodeAt(this.pos);

			if (
				code >= ASCII_LIMIT ||
				(CHAR_FLAGS[code] & MASK_ID_PART) === 0
			) {
				break;
			}

			this.pos++;
		}

		this.kind = T_REGEXP;
	}

	/**
	 * Scans an operator or delimiter.
	 * @param code The character code the token starts with.
	 * @returns Nothing.
	 * @throws {ParseError} When the character cannot start a token.
	 */
	private scanPunctuator(code: number): void {
		const source = this.source;
		const next = source.charCodeAt(this.pos + 1);

		switch (code) {
			case CH_BRACE_OPEN:
				this.pos++;
				this.kind = T_BRACE_OPEN;
				this.pushContext(this.exprAllowed ? CTX_OBJECT : CTX_BLOCK);
				return;

			case CH_BRACE_CLOSE:
				if (
					this.contextDepth > 0 &&
					this.context[this.contextDepth - 1] === CTX_TEMPLATE
				) {
					this.contextDepth--;
					this.pos++;
					this.scanTemplatePart(this.start, false);
					return;
				}

				this.pos++;
				this.kind = T_BRACE_CLOSE;
				return;

			case CH_PAREN_OPEN:
				this.pos++;
				this.kind = T_PAREN_OPEN;
				this.pushContext(CTX_PAREN_EXPR);
				return;

			case CH_PAREN_CLOSE:
				this.pos++;
				this.kind = T_PAREN_CLOSE;
				return;

			case CH_BRACKET_OPEN:
				this.pos++;
				this.kind = T_BRACKET_OPEN;
				return;

			case CH_BRACKET_CLOSE:
				this.pos++;
				this.kind = T_BRACKET_CLOSE;
				return;

			case CH_SEMICOLON:
				this.pos++;
				this.kind = T_SEMICOLON;
				return;

			case CH_COMMA:
				this.pos++;
				this.kind = T_COMMA;
				return;

			case CH_COLON:
				this.pos++;
				this.kind = T_COLON;
				return;

			case CH_AT:
				this.pos++;
				this.kind = T_AT;
				return;

			case CH_TILDE:
				this.pos++;
				this.kind = T_TILDE;
				return;

			case CH_QUESTION:
				if (next === CH_DOT) {
					/*
					 * `?.5` is a conditional followed by a number, not an
					 * optional chain.
					 */
					const after = source.charCodeAt(this.pos + 2);

					if ((CHAR_FLAGS[after] & MASK_DIGIT) === 0) {
						this.pos += 2;
						this.kind = T_QUESTION_DOT;
						return;
					}
				}

				if (next === CH_QUESTION) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_QQ;
						return;
					}

					this.pos += 2;
					this.kind = T_QQ;
					return;
				}

				this.pos++;
				this.kind = T_QUESTION;
				return;

			case CH_PLUS:
				if (next === CH_PLUS) {
					this.pos += 2;
					this.kind = T_PLUS_PLUS;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_PLUS;
					return;
				}

				this.pos++;
				this.kind = T_PLUS;
				return;

			case CH_MINUS:
				if (next === CH_MINUS) {
					this.pos += 2;
					this.kind = T_MINUS_MINUS;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_MINUS;
					return;
				}

				this.pos++;
				this.kind = T_MINUS;
				return;

			case CH_STAR:
				if (next === CH_STAR) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_STARSTAR;
						return;
					}

					this.pos += 2;
					this.kind = T_STARSTAR;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_STAR;
					return;
				}

				this.pos++;
				this.kind = T_STAR;
				return;

			case CH_PERCENT:
				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_PERCENT;
					return;
				}

				this.pos++;
				this.kind = T_PERCENT;
				return;

			case CH_CARET:
				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_CARET;
					return;
				}

				this.pos++;
				this.kind = T_CARET;
				return;

			case CH_AMP:
				if (next === CH_AMP) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_AMPAMP;
						return;
					}

					this.pos += 2;
					this.kind = T_AMPAMP;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_AMP;
					return;
				}

				this.pos++;
				this.kind = T_AMP;
				return;

			case CH_PIPE:
				if (next === CH_PIPE) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_PIPEPIPE;
						return;
					}

					this.pos += 2;
					this.kind = T_PIPEPIPE;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_ASSIGN_PIPE;
					return;
				}

				this.pos++;
				this.kind = T_PIPE;
				return;

			case CH_EQ:
				if (next === CH_EQ) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_EQ_EQ_EQ;
						return;
					}

					this.pos += 2;
					this.kind = T_EQ_EQ;
					return;
				}

				if (next === CH_GT) {
					this.pos += 2;
					this.kind = T_ARROW;
					return;
				}

				this.pos++;
				this.kind = T_ASSIGN;
				return;

			case CH_BANG:
				if (next === CH_EQ) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_NOT_EQ_EQ;
						return;
					}

					this.pos += 2;
					this.kind = T_NOT_EQ;
					return;
				}

				this.pos++;
				this.kind = T_NOT;
				return;

			case CH_LT:
				if (next === CH_LT) {
					if (source.charCodeAt(this.pos + 2) === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_SHL;
						return;
					}

					this.pos += 2;
					this.kind = T_SHL;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_LT_EQ;
					return;
				}

				this.pos++;
				this.kind = T_LT;
				return;

			case CH_GT:
				if (next === CH_GT) {
					const third = source.charCodeAt(this.pos + 2);

					if (third === CH_GT) {
						if (source.charCodeAt(this.pos + 3) === CH_EQ) {
							this.pos += 4;
							this.kind = T_ASSIGN_SHR;
							return;
						}

						this.pos += 3;
						this.kind = T_SHR;
						return;
					}

					if (third === CH_EQ) {
						this.pos += 3;
						this.kind = T_ASSIGN_SAR;
						return;
					}

					this.pos += 2;
					this.kind = T_SAR;
					return;
				}

				if (next === CH_EQ) {
					this.pos += 2;
					this.kind = T_GT_EQ;
					return;
				}

				this.pos++;
				this.kind = T_GT;
				return;

			default: {
				const point = source.codePointAt(this.pos)!;

				throw this.error(
					`Unexpected character '${String.fromCodePoint(point)}'`,
					this.pos,
				);
			}
		}
	}

	//-------------------------------------------------------------------------
	// Context Tracking
	//-------------------------------------------------------------------------

	/**
	 * Pushes an entry onto the lexical context stack.
	 * @param context The context constant to push.
	 * @returns Nothing.
	 */
	private pushContext(context: number): void {
		if (this.contextDepth === this.context.length) {
			const grown = new Uint8Array(this.context.length * 2);

			grown.set(this.context);
			this.context = grown;
		}

		this.context[this.contextDepth++] = context;
	}

	/**
	 * Updates whether a regular expression may begin at the new position,
	 * based on the token that was just scanned.
	 * @returns Nothing.
	 */
	private updateContext(): void {
		const kind = this.kind;

		/*
		 * Only seven kinds do anything but read the table, and the switch
		 * below compiles to a chain of compares, so the ordinary token —
		 * a name, a number, a comma — answers with one table read instead
		 * of walking the chain to its default arm.
		 */
		if (CONTEXT_SPECIAL[kind] === 0) {
			this.exprAllowed = KIND_BEFORE_EXPR[kind] !== 0;
			return;
		}

		switch (kind) {
			case T_PAREN_CLOSE: {
				let closed = CTX_PAREN_EXPR;

				if (this.contextDepth > 0) {
					closed = this.context[--this.contextDepth];
				}

				this.exprAllowed = closed === CTX_PAREN_STMT;
				return;
			}

			case T_BRACE_CLOSE: {
				let closed = CTX_OBJECT;

				if (this.contextDepth > 0) {
					closed = this.context[--this.contextDepth];
				}

				this.exprAllowed = closed === CTX_BLOCK;
				return;
			}

			/*
			 * Increment and decrement leave the previous decision alone:
			 * `a++ / b` is division, and nothing useful follows a prefix form.
			 */
			case T_PLUS_PLUS:
			case T_MINUS_MINUS:
				return;

			/*
			 * These words are ordinary identifiers most of the time, so they
			 * only allow a regular expression to follow in the contexts where
			 * they act as operators.
			 */
			case T_yield:
				this.exprAllowed = this.inGenerator && this.prevKind !== T_DOT;
				return;

			case T_await:
				this.exprAllowed = this.inAsync && this.prevKind !== T_DOT;
				return;

			case T_of:
				this.exprAllowed = !this.exprAllowed && this.prevKind !== T_DOT;
				return;

			default:
				this.exprAllowed = KIND_BEFORE_EXPR[kind] !== 0;
		}
	}
}
