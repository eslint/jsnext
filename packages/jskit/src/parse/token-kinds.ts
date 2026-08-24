/**
 * @fileoverview Token kinds and the lookup tables that describe them.
 *
 * A "kind" is the fine-grained identity of a token: every punctuator and every
 * keyword has its own numeric kind. The parser dispatches on these numbers,
 * never on strings. Coarse ESLint-facing token types (`"Keyword"`,
 * `"Punctuator"`, ...) are derived from a kind through a lookup table when the
 * token buffer is decoded.
 *
 * Kind numbers are grouped into contiguous ranges so that common questions
 * ("is this an assignment operator?") reduce to a pair of integer comparisons.
 * New kinds are appended to the end of a range, which keeps the format open to
 * extension without invalidating existing consumers.
 */

//-----------------------------------------------------------------------------
// Literal and Trivia Kinds (0-19)
//-----------------------------------------------------------------------------

export const T_EOF = 0;
export const T_INVALID = 1;
export const T_IDENT = 2;
export const T_PRIVATE_IDENT = 3;
export const T_NUMBER = 4;
export const T_BIGINT = 5;
export const T_STRING = 6;
export const T_REGEXP = 7;

/** A template with no substitutions: `` `abc` ``. */
export const T_TEMPLATE_FULL = 8;

/** The opening piece of a template: `` `abc${ ``. */
export const T_TEMPLATE_HEAD = 9;

/** A middle piece of a template: `` }abc${ ``. */
export const T_TEMPLATE_MIDDLE = 10;

/** The closing piece of a template: `` }abc` ``. */
export const T_TEMPLATE_TAIL = 11;

export const T_LINE_COMMENT = 12;
export const T_BLOCK_COMMENT = 13;
export const T_HASHBANG = 14;

/** A run of literal text between JSX tags. */
export const T_JSX_TEXT = 15;

/** A JSX element or attribute name, which may contain `-`. */
export const T_JSX_IDENT = 16;

/** A JSX attribute value in quotes, which has no escape sequences. */
export const T_JSX_STRING = 17;

//-----------------------------------------------------------------------------
// Punctuator Kinds (20-79)
//-----------------------------------------------------------------------------

export const T_BRACE_OPEN = 20;
export const T_BRACE_CLOSE = 21;
export const T_PAREN_OPEN = 22;
export const T_PAREN_CLOSE = 23;
export const T_BRACKET_OPEN = 24;
export const T_BRACKET_CLOSE = 25;
export const T_SEMICOLON = 26;
export const T_COMMA = 27;
export const T_DOT = 28;
export const T_ELLIPSIS = 29;
export const T_QUESTION_DOT = 30;
export const T_COLON = 31;
export const T_QUESTION = 32;
export const T_ARROW = 33;
export const T_AT = 34;

/*
 * Assignment operators occupy a contiguous range so that `isAssignmentKind()`
 * is a range check.
 */
export const T_ASSIGN = 35;
export const T_ASSIGN_PLUS = 36;
export const T_ASSIGN_MINUS = 37;
export const T_ASSIGN_STAR = 38;
export const T_ASSIGN_SLASH = 39;
export const T_ASSIGN_PERCENT = 40;
export const T_ASSIGN_STARSTAR = 41;
export const T_ASSIGN_SHL = 42;
export const T_ASSIGN_SAR = 43;
export const T_ASSIGN_SHR = 44;
export const T_ASSIGN_AMP = 45;
export const T_ASSIGN_PIPE = 46;
export const T_ASSIGN_CARET = 47;
export const T_ASSIGN_AMPAMP = 48;
export const T_ASSIGN_PIPEPIPE = 49;
export const T_ASSIGN_QQ = 50;

export const ASSIGN_FIRST = T_ASSIGN;
export const ASSIGN_LAST = T_ASSIGN_QQ;

/*
 * Binary operators, ordered loosest-binding first. The precedence table below
 * gives each one its binding power.
 */
export const T_PIPEPIPE = 51;
export const T_AMPAMP = 52;
export const T_QQ = 53;
export const T_PIPE = 54;
export const T_CARET = 55;
export const T_AMP = 56;
export const T_EQ_EQ = 57;
export const T_NOT_EQ = 58;
export const T_EQ_EQ_EQ = 59;
export const T_NOT_EQ_EQ = 60;
export const T_LT = 61;
export const T_GT = 62;
export const T_LT_EQ = 63;
export const T_GT_EQ = 64;
export const T_SHL = 65;
export const T_SAR = 66;
export const T_SHR = 67;
export const T_PLUS = 68;
export const T_MINUS = 69;
export const T_STAR = 70;
export const T_SLASH = 71;
export const T_PERCENT = 72;
export const T_STARSTAR = 73;

export const T_NOT = 74;
export const T_TILDE = 75;
export const T_PLUS_PLUS = 76;
export const T_MINUS_MINUS = 77;

export const PUNCT_FIRST = T_BRACE_OPEN;
export const PUNCT_LAST = T_MINUS_MINUS;

//-----------------------------------------------------------------------------
// Keyword Kinds (100+)
//-----------------------------------------------------------------------------

export const T_await = 100;
export const T_break = 101;
export const T_case = 102;
export const T_catch = 103;
export const T_class = 104;
export const T_const = 105;
export const T_continue = 106;
export const T_debugger = 107;
export const T_default = 108;
export const T_delete = 109;
export const T_do = 110;
export const T_else = 111;
export const T_enum = 112;
export const T_export = 113;
export const T_extends = 114;
export const T_false = 115;
export const T_finally = 116;
export const T_for = 117;
export const T_function = 118;
export const T_if = 119;
export const T_import = 120;
export const T_in = 121;
export const T_instanceof = 122;
export const T_new = 123;
export const T_null = 124;
export const T_return = 125;
export const T_super = 126;
export const T_switch = 127;
export const T_this = 128;
export const T_throw = 129;
export const T_true = 130;
export const T_try = 131;
export const T_typeof = 132;
export const T_var = 133;
export const T_void = 134;
export const T_while = 135;
export const T_with = 136;
export const T_yield = 137;
export const T_let = 138;
export const T_static = 139;
export const T_implements = 140;
export const T_interface = 141;
export const T_package = 142;
export const T_private = 143;
export const T_protected = 144;
export const T_public = 145;
export const T_as = 146;
export const T_accessor = 147;
export const T_any = 148;
export const T_asserts = 149;
export const T_assert = 150;
export const T_async = 151;
export const T_bigint = 152;
export const T_boolean = 153;
export const T_constructor = 154;
export const T_declare = 155;
export const T_from = 156;
export const T_get = 157;
export const T_global = 158;
export const T_infer = 159;
export const T_is = 160;
export const T_keyof = 161;
export const T_module = 162;
export const T_namespace = 163;
export const T_never = 164;
export const T_number = 165;
export const T_object = 166;
export const T_of = 167;
export const T_out = 168;
export const T_override = 169;
export const T_readonly = 170;
export const T_require = 171;
export const T_satisfies = 172;
export const T_set = 173;
export const T_string = 174;
export const T_symbol = 175;
export const T_type = 176;
export const T_undefined = 177;
export const T_unique = 178;
export const T_unknown = 179;
export const T_using = 180;
export const T_abstract = 181;
export const T_intrinsic = 182;

export const KEYWORD_FIRST = T_await;
export const KEYWORD_LAST = T_intrinsic;

/** Total number of kinds currently defined; used to size lookup tables. */
export const KIND_COUNT = KEYWORD_LAST + 1;

/**
 * The spelling of every keyword, indexed by `kind - KEYWORD_FIRST`. The order
 * must match the constants above exactly.
 */
export const KEYWORD_NAMES: readonly string[] = [
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"let",
	"static",
	"implements",
	"interface",
	"package",
	"private",
	"protected",
	"public",
	"as",
	"accessor",
	"any",
	"asserts",
	"assert",
	"async",
	"bigint",
	"boolean",
	"constructor",
	"declare",
	"from",
	"get",
	"global",
	"infer",
	"is",
	"keyof",
	"module",
	"namespace",
	"never",
	"number",
	"object",
	"of",
	"out",
	"override",
	"readonly",
	"require",
	"satisfies",
	"set",
	"string",
	"symbol",
	"type",
	"undefined",
	"unique",
	"unknown",
	"using",
	"abstract",
	"intrinsic",
];

/** The spelling of every punctuator, indexed by `kind - PUNCT_FIRST`. */
export const PUNCTUATOR_NAMES: readonly string[] = [
	"{",
	"}",
	"(",
	")",
	"[",
	"]",
	";",
	",",
	".",
	"...",
	"?.",
	":",
	"?",
	"=>",
	"@",
	"=",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"**=",
	"<<=",
	">>=",
	">>>=",
	"&=",
	"|=",
	"^=",
	"&&=",
	"||=",
	"??=",
	"||",
	"&&",
	"??",
	"|",
	"^",
	"&",
	"==",
	"!=",
	"===",
	"!==",
	"<",
	">",
	"<=",
	">=",
	"<<",
	">>",
	">>>",
	"+",
	"-",
	"*",
	"/",
	"%",
	"**",
	"!",
	"~",
	"++",
	"--",
];

//-----------------------------------------------------------------------------
// Coarse ESLint Token Types
//-----------------------------------------------------------------------------

export const TT_EOF = 0;
export const TT_IDENTIFIER = 1;
export const TT_PRIVATE_IDENTIFIER = 2;
export const TT_KEYWORD = 3;
export const TT_PUNCTUATOR = 4;
export const TT_NUMERIC = 5;
export const TT_STRING = 6;
export const TT_REGEXP = 7;
export const TT_TEMPLATE = 8;
export const TT_BOOLEAN = 9;
export const TT_NULL = 10;
export const TT_LINE_COMMENT = 11;
export const TT_BLOCK_COMMENT = 12;
export const TT_HASHBANG = 13;
export const TT_JSX_IDENTIFIER = 14;
export const TT_JSX_TEXT = 15;

/** Names reported for each coarse token type, indexed by the type id. */
export const TOKEN_TYPE_NAMES: readonly string[] = [
	"<end>",
	"Identifier",
	"PrivateIdentifier",
	"Keyword",
	"Punctuator",
	"Numeric",
	"String",
	"RegularExpression",
	"Template",
	"Boolean",
	"Null",
	"Line",
	"Block",
	"Hashbang",
	"JSXIdentifier",
	"JSXText",
];

/**
 * Maps a fine-grained kind to the coarse token type ESLint consumers expect.
 *
 * The mapping intentionally reproduces `espree`'s behavior, which is not the
 * same as "every reserved word is a Keyword": `espree` reports contextual
 * keywords such as `async`, `of`, and `enum` as identifiers, but promotes
 * `let`, `static`, and `yield` to keywords.
 */
export const KIND_TOKEN_TYPE = new Uint8Array(KIND_COUNT);

/**
 * The exact source text of every fixed-spelling kind — the punctuators and
 * the keywords — and `""` for every kind whose text varies token by token.
 *
 * A keyword kind's spelling really is its text: a word written with escapes
 * is tokenized as `T_IDENT`, never as a keyword kind, so `T_return` can only
 * ever cover the seven characters `return`. The token decoder leans on this
 * to hand out one shared string per kind instead of slicing the source for
 * every punctuator and keyword.
 */
export const KIND_TOKEN_TEXT: readonly string[] = /* @__PURE__ */ (() => {
	const table: string[] = [];

	for (let kind = 0; kind < KIND_COUNT; kind++) {
		table.push("");
	}

	return table;
})();

//-----------------------------------------------------------------------------
// Parser Classification Tables
//-----------------------------------------------------------------------------

/**
 * Bit set when a `/` appearing immediately after a token of this kind must be
 * read as the start of a regular expression rather than as division.
 */
export const KIND_BEFORE_EXPR = new Uint8Array(KIND_COUNT);

/**
 * Bit set when a token of this kind can only *continue* an expression and can
 * never begin one — every binary and assignment operator, `.`, `?.`, and the
 * closers.
 *
 * This is not the complement of `KIND_BEFORE_EXPR`: `(`, `!`, `typeof`, and
 * `new` all expect an expression to follow *and* can start one themselves. It
 * is what tells `await = 1` from `await x`, so a kind left out of it is only
 * ever read as the more permissive of the two. Nothing may be added here that
 * can legally start an expression.
 */
export const KIND_CONTINUES_EXPR = new Uint8Array(KIND_COUNT);

/**
 * Binding power of each binary operator kind; `0` means "not a binary
 * operator". Higher numbers bind more tightly.
 */
export const KIND_PRECEDENCE = new Uint8Array(KIND_COUNT);

/** Keyword classification flags. */
export const KW_RESERVED = 1 << 0;
export const KW_STRICT_RESERVED = 1 << 1;
export const KW_CONTEXTUAL = 1 << 2;

/** Classification of each keyword kind; `0` for non-keywords. */
export const KIND_KEYWORD_FLAGS = new Uint8Array(KIND_COUNT);

//-----------------------------------------------------------------------------
// Table Construction
//-----------------------------------------------------------------------------

{
	// Every punctuator and keyword defaults to its obvious coarse type.
	for (let kind = PUNCT_FIRST; kind <= PUNCT_LAST; kind++) {
		KIND_TOKEN_TYPE[kind] = TT_PUNCTUATOR;
		(KIND_TOKEN_TEXT as string[])[kind] =
			PUNCTUATOR_NAMES[kind - PUNCT_FIRST];
	}

	for (let kind = KEYWORD_FIRST; kind <= KEYWORD_LAST; kind++) {
		KIND_TOKEN_TYPE[kind] = TT_IDENTIFIER;
		(KIND_TOKEN_TEXT as string[])[kind] =
			KEYWORD_NAMES[kind - KEYWORD_FIRST];
	}

	KIND_TOKEN_TYPE[T_IDENT] = TT_IDENTIFIER;
	KIND_TOKEN_TYPE[T_PRIVATE_IDENT] = TT_PRIVATE_IDENTIFIER;
	KIND_TOKEN_TYPE[T_NUMBER] = TT_NUMERIC;
	KIND_TOKEN_TYPE[T_BIGINT] = TT_NUMERIC;
	KIND_TOKEN_TYPE[T_STRING] = TT_STRING;
	KIND_TOKEN_TYPE[T_REGEXP] = TT_REGEXP;
	KIND_TOKEN_TYPE[T_TEMPLATE_FULL] = TT_TEMPLATE;
	KIND_TOKEN_TYPE[T_TEMPLATE_HEAD] = TT_TEMPLATE;
	KIND_TOKEN_TYPE[T_TEMPLATE_MIDDLE] = TT_TEMPLATE;
	KIND_TOKEN_TYPE[T_TEMPLATE_TAIL] = TT_TEMPLATE;
	KIND_TOKEN_TYPE[T_LINE_COMMENT] = TT_LINE_COMMENT;
	KIND_TOKEN_TYPE[T_BLOCK_COMMENT] = TT_BLOCK_COMMENT;
	KIND_TOKEN_TYPE[T_HASHBANG] = TT_HASHBANG;
	KIND_TOKEN_TYPE[T_JSX_IDENT] = TT_JSX_IDENTIFIER;
	KIND_TOKEN_TYPE[T_JSX_TEXT] = TT_JSX_TEXT;

	/*
	 * A quoted JSX attribute value is reported as `JSXText`, quotes included,
	 * which is what the reference parsers do.
	 */
	KIND_TOKEN_TYPE[T_JSX_STRING] = TT_JSX_TEXT;

	/*
	 * The exact set of words that surface as `"Keyword"` tokens. Contextual
	 * keywords are deliberately absent: they are ordinary identifiers as far
	 * as a token stream consumer is concerned.
	 */
	const KEYWORD_TOKEN_KINDS = [
		T_break,
		T_case,
		T_catch,
		T_continue,
		T_debugger,
		T_default,
		T_do,
		T_else,
		T_finally,
		T_for,
		T_function,
		T_if,
		T_return,
		T_switch,
		T_throw,
		T_try,
		T_var,
		T_const,
		T_while,
		T_with,
		T_new,
		T_this,
		T_super,
		T_class,
		T_extends,
		T_export,
		T_import,
		T_in,
		T_instanceof,
		T_typeof,
		T_void,
		T_delete,
		T_yield,
		T_let,
		T_static,
	];

	for (let i = 0; i < KEYWORD_TOKEN_KINDS.length; i++) {
		KIND_TOKEN_TYPE[KEYWORD_TOKEN_KINDS[i]] = TT_KEYWORD;
	}

	KIND_TOKEN_TYPE[T_true] = TT_BOOLEAN;
	KIND_TOKEN_TYPE[T_false] = TT_BOOLEAN;
	KIND_TOKEN_TYPE[T_null] = TT_NULL;

	/*
	 * Tokens after which an expression is expected. A `/` in that position
	 * opens a regular expression literal.
	 */
	const BEFORE_EXPR_KINDS = [
		T_BRACE_OPEN,
		T_PAREN_OPEN,
		T_BRACKET_OPEN,
		T_COMMA,
		T_SEMICOLON,
		T_COLON,
		T_QUESTION,
		T_ARROW,
		T_ELLIPSIS,
		T_AT,
		T_NOT,
		T_TILDE,
		T_PIPEPIPE,
		T_AMPAMP,
		T_QQ,
		T_PIPE,
		T_CARET,
		T_AMP,
		T_EQ_EQ,
		T_NOT_EQ,
		T_EQ_EQ_EQ,
		T_NOT_EQ_EQ,
		T_LT,
		T_GT,
		T_LT_EQ,
		T_GT_EQ,
		T_SHL,
		T_SAR,
		T_SHR,
		T_PLUS,
		T_MINUS,
		T_STAR,
		T_SLASH,
		T_PERCENT,
		T_STARSTAR,
		T_TEMPLATE_HEAD,
		T_TEMPLATE_MIDDLE,
		T_case,
		T_default,
		T_do,
		T_else,
		T_return,
		T_throw,
		T_new,
		T_extends,
		T_in,
		T_instanceof,
		T_typeof,
		T_void,
		T_delete,
		T_yield,
		T_await,
	];

	for (let i = 0; i < BEFORE_EXPR_KINDS.length; i++) {
		KIND_BEFORE_EXPR[BEFORE_EXPR_KINDS[i]] = 1;
	}

	for (let kind = ASSIGN_FIRST; kind <= ASSIGN_LAST; kind++) {
		KIND_BEFORE_EXPR[kind] = 1;
	}

	/*
	 * `+` and `-` are binary operators that are also prefix operators, and `<`
	 * opens JSX and a type assertion, so all three are left out. `/` is left
	 * out too: when a regular expression is what may appear, the scanner has
	 * already produced `T_REGEXP` rather than `T_SLASH`.
	 */
	const CONTINUES_EXPR_KINDS = [
		T_DOT,
		T_QUESTION_DOT,
		T_QUESTION,
		T_COLON,
		T_COMMA,
		T_SEMICOLON,
		T_ARROW,
		T_PAREN_CLOSE,
		T_BRACKET_CLOSE,
		T_BRACE_CLOSE,
		T_TEMPLATE_MIDDLE,
		T_TEMPLATE_TAIL,
		T_EOF,
		T_QQ,
		T_PIPEPIPE,
		T_AMPAMP,
		T_PIPE,
		T_CARET,
		T_AMP,
		T_EQ_EQ,
		T_NOT_EQ,
		T_EQ_EQ_EQ,
		T_NOT_EQ_EQ,
		T_GT,
		T_LT_EQ,
		T_GT_EQ,
		T_SHL,
		T_SAR,
		T_SHR,
		T_STAR,
		T_PERCENT,
		T_STARSTAR,
		T_in,
		T_instanceof,
		T_as,
		T_satisfies,
	];

	for (let i = 0; i < CONTINUES_EXPR_KINDS.length; i++) {
		KIND_CONTINUES_EXPR[CONTINUES_EXPR_KINDS[i]] = 1;
	}

	for (let kind = ASSIGN_FIRST; kind <= ASSIGN_LAST; kind++) {
		KIND_CONTINUES_EXPR[kind] = 1;
	}

	// Binary operator binding powers.
	KIND_PRECEDENCE[T_QQ] = 1;
	KIND_PRECEDENCE[T_PIPEPIPE] = 1;
	KIND_PRECEDENCE[T_AMPAMP] = 2;
	KIND_PRECEDENCE[T_PIPE] = 3;
	KIND_PRECEDENCE[T_CARET] = 4;
	KIND_PRECEDENCE[T_AMP] = 5;
	KIND_PRECEDENCE[T_EQ_EQ] = 6;
	KIND_PRECEDENCE[T_NOT_EQ] = 6;
	KIND_PRECEDENCE[T_EQ_EQ_EQ] = 6;
	KIND_PRECEDENCE[T_NOT_EQ_EQ] = 6;
	KIND_PRECEDENCE[T_LT] = 7;
	KIND_PRECEDENCE[T_GT] = 7;
	KIND_PRECEDENCE[T_LT_EQ] = 7;
	KIND_PRECEDENCE[T_GT_EQ] = 7;
	KIND_PRECEDENCE[T_in] = 7;
	KIND_PRECEDENCE[T_instanceof] = 7;
	KIND_PRECEDENCE[T_as] = 7;
	KIND_PRECEDENCE[T_satisfies] = 7;
	KIND_PRECEDENCE[T_SHL] = 8;
	KIND_PRECEDENCE[T_SAR] = 8;
	KIND_PRECEDENCE[T_SHR] = 8;
	KIND_PRECEDENCE[T_PLUS] = 9;
	KIND_PRECEDENCE[T_MINUS] = 9;
	KIND_PRECEDENCE[T_STAR] = 10;
	KIND_PRECEDENCE[T_SLASH] = 10;
	KIND_PRECEDENCE[T_PERCENT] = 10;
	KIND_PRECEDENCE[T_STARSTAR] = 11;

	// Words that can never be used as a binding identifier.
	const RESERVED_KINDS = [
		T_break,
		T_case,
		T_catch,
		T_class,
		T_const,
		T_continue,
		T_debugger,
		T_default,
		T_delete,
		T_do,
		T_else,
		T_enum,
		T_export,
		T_extends,
		T_false,
		T_finally,
		T_for,
		T_function,
		T_if,
		T_import,
		T_in,
		T_instanceof,
		T_new,
		T_null,
		T_return,
		T_super,
		T_switch,
		T_this,
		T_throw,
		T_true,
		T_try,
		T_typeof,
		T_var,
		T_void,
		T_while,
		T_with,
	];

	for (let i = 0; i < RESERVED_KINDS.length; i++) {
		KIND_KEYWORD_FLAGS[RESERVED_KINDS[i]] = KW_RESERVED;
	}

	// Words reserved only in strict mode (or only in certain contexts).
	const STRICT_RESERVED_KINDS = [
		T_implements,
		T_interface,
		T_package,
		T_private,
		T_protected,
		T_public,
		T_static,
		T_let,
		T_yield,
	];

	for (let i = 0; i < STRICT_RESERVED_KINDS.length; i++) {
		KIND_KEYWORD_FLAGS[STRICT_RESERVED_KINDS[i]] = KW_STRICT_RESERVED;
	}

	for (let kind = KEYWORD_FIRST; kind <= KEYWORD_LAST; kind++) {
		if (KIND_KEYWORD_FLAGS[kind] === 0) {
			KIND_KEYWORD_FLAGS[kind] = KW_CONTEXTUAL;
		}
	}
}

//-----------------------------------------------------------------------------
// Identifier Word Codes
//-----------------------------------------------------------------------------

/*
 * When the parser writes an `Identifier` node for a word the tokenizer
 * recognized as a keyword, it packs a small code into the node's flags saying
 * which word that was — see `IDWORD_SHIFT` in `node-kinds.ts`. The code spares
 * `validate()` re-hashing the text of every identifier to rediscover an answer
 * the tokenizer already had: whether the name is `yield`, `await`, `this`, a
 * word strict mode reserves, or a `ReservedWord` outright.
 *
 * Only the words `validate()` has a rule about get a code of their own; every
 * other `ReservedWord` shares `IDWORD_RESERVED`, whose spelling — needed only
 * for an error message — is still there in the source text. A word written
 * with an escape never gets a code at all, because the tokenizer reports it as
 * a plain identifier; the parser marks those `NF_IDENTIFIER_ESCAPED` instead
 * and `validate()` decodes them the slow way.
 */

/** The code of a `ReservedWord` with no rule of its own in `validate()`. */
export const IDWORD_RESERVED = 1;

/**
 * The keyword kind behind each identifier word code.
 *
 * Index `0` (no code) and index `IDWORD_RESERVED` both map to `0`, a value
 * outside the keyword range, so a reader looking for one particular word can
 * compare without special-casing either.
 */
export const IDWORD_KINDS: number[] = [0, 0];

/**
 * The identifier word code for each token kind; `0` for every kind that is
 * not a keyword `validate()` has a rule about.
 */
export const KIND_IDWORD_CODES = new Uint8Array(KIND_COUNT);

{
	for (let kind = KEYWORD_FIRST; kind <= KEYWORD_LAST; kind++) {
		const flags = KIND_KEYWORD_FLAGS[kind];

		if (
			(flags & KW_STRICT_RESERVED) !== 0 ||
			kind === T_await ||
			kind === T_this
		) {
			KIND_IDWORD_CODES[kind] = IDWORD_KINDS.length;
			IDWORD_KINDS.push(kind);
		} else if ((flags & KW_RESERVED) !== 0) {
			KIND_IDWORD_CODES[kind] = IDWORD_RESERVED;
		}
	}
}

//-----------------------------------------------------------------------------
// Keyword Recognition
//-----------------------------------------------------------------------------

/*
 * Keywords are recognized without ever materializing a substring. The scanner
 * accumulates a rolling hash of the identifier's character codes, then probes
 * an open-addressed table and confirms the hit by comparing character codes
 * against the stored spelling.
 */

const KEYWORD_TABLE_SIZE = 512;
const KEYWORD_TABLE_MASK = KEYWORD_TABLE_SIZE - 1;

/** Open-addressed table mapping a hashed spelling to a keyword kind. */
const KEYWORD_SLOTS = new Uint16Array(KEYWORD_TABLE_SIZE);

/**
 * Combines a character code into a rolling hash.
 * @param hash The hash accumulated so far.
 * @param code The next character code.
 * @returns The updated hash.
 */
export function hashChar(hash: number, code: number): number {
	return (hash * 31 + code) | 0;
}

/**
 * Computes the rolling hash of an entire string.
 * @param text The text to hash.
 * @returns The hash of the text.
 */
function hashString(text: string): number {
	let hash = 0;

	for (let i = 0; i < text.length; i++) {
		hash = hashChar(hash, text.charCodeAt(i));
	}

	return hash;
}

{
	for (let i = 0; i < KEYWORD_NAMES.length; i++) {
		const name = KEYWORD_NAMES[i];
		let slot = hashString(name) & KEYWORD_TABLE_MASK;

		// Linear probing; the table is far larger than the keyword count.
		while (KEYWORD_SLOTS[slot] !== 0) {
			slot = (slot + 1) & KEYWORD_TABLE_MASK;
		}

		KEYWORD_SLOTS[slot] = KEYWORD_FIRST + i;
	}
}

/**
 * Determines whether a range of source text spells a keyword.
 * @param source The full source text.
 * @param start The offset of the first character of the identifier.
 * @param end The offset just past the last character of the identifier.
 * @param hash The rolling hash of the identifier's character codes.
 * @returns The keyword kind, or `T_IDENT` when the text is not a keyword.
 */
export function lookupKeyword(
	source: string,
	start: number,
	end: number,
	hash: number,
): number {
	const length = end - start;

	// No keyword is shorter than two or longer than ten characters.
	if (length < 2 || length > 10) {
		return T_IDENT;
	}

	let slot = hash & KEYWORD_TABLE_MASK;

	for (;;) {
		const kind = KEYWORD_SLOTS[slot];

		if (kind === 0) {
			return T_IDENT;
		}

		const name = KEYWORD_NAMES[kind - KEYWORD_FIRST];

		if (name.length === length) {
			let index = 0;

			while (
				index < length &&
				name.charCodeAt(index) === source.charCodeAt(start + index)
			) {
				index++;
			}

			if (index === length) {
				return kind;
			}
		}

		slot = (slot + 1) & KEYWORD_TABLE_MASK;
	}
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Returns the human-readable spelling of a token kind, for error messages.
 * @param kind The token kind.
 * @returns The spelling, or a descriptive label for non-fixed tokens.
 */
export function describeKind(kind: number): string {
	if (kind >= PUNCT_FIRST && kind <= PUNCT_LAST) {
		return PUNCTUATOR_NAMES[kind - PUNCT_FIRST];
	}

	if (kind >= KEYWORD_FIRST && kind <= KEYWORD_LAST) {
		return KEYWORD_NAMES[kind - KEYWORD_FIRST];
	}

	switch (kind) {
		case T_EOF:
			return "end of input";

		case T_IDENT:
			return "identifier";

		case T_PRIVATE_IDENT:
			return "private identifier";

		case T_NUMBER:
		case T_BIGINT:
			return "number";

		case T_STRING:
			return "string";

		case T_REGEXP:
			return "regular expression";

		default:
			return "template";
	}
}

/**
 * Determines whether a kind is an assignment operator.
 * @param kind The token kind to test.
 * @returns `true` for `=` and every compound assignment operator.
 */
export function isAssignmentKind(kind: number): boolean {
	return kind >= ASSIGN_FIRST && kind <= ASSIGN_LAST;
}

/**
 * Determines whether a kind may be used as a property name or other position
 * that accepts any identifier-like word, including reserved words.
 * @param kind The token kind to test.
 * @returns `true` when the token spells an identifier name.
 */
export function isIdentifierNameKind(kind: number): boolean {
	return kind === T_IDENT || (kind >= KEYWORD_FIRST && kind <= KEYWORD_LAST);
}
