//! Token kinds and the lookup tables that describe them.
//!
//! Port of `packages/jskit/src/parse/token-kinds.ts`. Every table the parser
//! reads is built at compile time; the numbers must match the TypeScript
//! constants exactly, because token kinds are written into the binary token
//! records and node slots.

pub const T_EOF: u32 = 0;
pub const T_IDENT: u32 = 2;
pub const T_PRIVATE_IDENT: u32 = 3;
pub const T_NUMBER: u32 = 4;
pub const T_BIGINT: u32 = 5;
pub const T_STRING: u32 = 6;
pub const T_REGEXP: u32 = 7;
pub const T_TEMPLATE_FULL: u32 = 8;
pub const T_TEMPLATE_HEAD: u32 = 9;
pub const T_TEMPLATE_MIDDLE: u32 = 10;
pub const T_TEMPLATE_TAIL: u32 = 11;
pub const T_LINE_COMMENT: u32 = 12;
pub const T_BLOCK_COMMENT: u32 = 13;
pub const T_HASHBANG: u32 = 14;
pub const T_JSX_TEXT: u32 = 15;
pub const T_JSX_IDENT: u32 = 16;
pub const T_JSX_STRING: u32 = 17;

pub const T_BRACE_OPEN: u32 = 20;
pub const T_BRACE_CLOSE: u32 = 21;
pub const T_PAREN_OPEN: u32 = 22;
pub const T_PAREN_CLOSE: u32 = 23;
pub const T_BRACKET_OPEN: u32 = 24;
pub const T_BRACKET_CLOSE: u32 = 25;
pub const T_SEMICOLON: u32 = 26;
pub const T_COMMA: u32 = 27;
pub const T_DOT: u32 = 28;
pub const T_ELLIPSIS: u32 = 29;
pub const T_QUESTION_DOT: u32 = 30;
pub const T_COLON: u32 = 31;
pub const T_QUESTION: u32 = 32;
pub const T_ARROW: u32 = 33;
pub const T_AT: u32 = 34;

pub const T_ASSIGN: u32 = 35;
pub const T_ASSIGN_PLUS: u32 = 36;
pub const T_ASSIGN_MINUS: u32 = 37;
pub const T_ASSIGN_STAR: u32 = 38;
pub const T_ASSIGN_SLASH: u32 = 39;
pub const T_ASSIGN_PERCENT: u32 = 40;
pub const T_ASSIGN_STARSTAR: u32 = 41;
pub const T_ASSIGN_SHL: u32 = 42;
pub const T_ASSIGN_SAR: u32 = 43;
pub const T_ASSIGN_SHR: u32 = 44;
pub const T_ASSIGN_AMP: u32 = 45;
pub const T_ASSIGN_PIPE: u32 = 46;
pub const T_ASSIGN_CARET: u32 = 47;
pub const T_ASSIGN_AMPAMP: u32 = 48;
pub const T_ASSIGN_PIPEPIPE: u32 = 49;
pub const T_ASSIGN_QQ: u32 = 50;

pub const ASSIGN_FIRST: u32 = T_ASSIGN;
pub const ASSIGN_LAST: u32 = T_ASSIGN_QQ;

pub const T_PIPEPIPE: u32 = 51;
pub const T_AMPAMP: u32 = 52;
pub const T_QQ: u32 = 53;
pub const T_PIPE: u32 = 54;
pub const T_CARET: u32 = 55;
pub const T_AMP: u32 = 56;
pub const T_EQ_EQ: u32 = 57;
pub const T_NOT_EQ: u32 = 58;
pub const T_EQ_EQ_EQ: u32 = 59;
pub const T_NOT_EQ_EQ: u32 = 60;
pub const T_LT: u32 = 61;
pub const T_GT: u32 = 62;
pub const T_LT_EQ: u32 = 63;
pub const T_GT_EQ: u32 = 64;
pub const T_SHL: u32 = 65;
pub const T_SAR: u32 = 66;
pub const T_SHR: u32 = 67;
pub const T_PLUS: u32 = 68;
pub const T_MINUS: u32 = 69;
pub const T_STAR: u32 = 70;
pub const T_SLASH: u32 = 71;
pub const T_PERCENT: u32 = 72;
pub const T_STARSTAR: u32 = 73;

pub const T_NOT: u32 = 74;
pub const T_TILDE: u32 = 75;
pub const T_PLUS_PLUS: u32 = 76;
pub const T_MINUS_MINUS: u32 = 77;

pub const PUNCT_FIRST: u32 = T_BRACE_OPEN;
pub const PUNCT_LAST: u32 = T_MINUS_MINUS;

pub const T_AWAIT: u32 = 100;
pub const T_BREAK: u32 = 101;
pub const T_CASE: u32 = 102;
pub const T_CATCH: u32 = 103;
pub const T_CLASS: u32 = 104;
pub const T_CONST: u32 = 105;
pub const T_CONTINUE: u32 = 106;
pub const T_DEBUGGER: u32 = 107;
pub const T_DEFAULT: u32 = 108;
pub const T_DELETE: u32 = 109;
pub const T_DO: u32 = 110;
pub const T_ELSE: u32 = 111;
pub const T_ENUM: u32 = 112;
pub const T_EXPORT: u32 = 113;
pub const T_EXTENDS: u32 = 114;
pub const T_FALSE: u32 = 115;
pub const T_FINALLY: u32 = 116;
pub const T_FOR: u32 = 117;
pub const T_FUNCTION: u32 = 118;
pub const T_IF: u32 = 119;
pub const T_IMPORT: u32 = 120;
pub const T_IN: u32 = 121;
pub const T_INSTANCEOF: u32 = 122;
pub const T_NEW: u32 = 123;
pub const T_NULL: u32 = 124;
pub const T_RETURN: u32 = 125;
pub const T_SUPER: u32 = 126;
pub const T_SWITCH: u32 = 127;
pub const T_THIS: u32 = 128;
pub const T_THROW: u32 = 129;
pub const T_TRUE: u32 = 130;
pub const T_TRY: u32 = 131;
pub const T_TYPEOF: u32 = 132;
pub const T_VAR: u32 = 133;
pub const T_VOID: u32 = 134;
pub const T_WHILE: u32 = 135;
pub const T_WITH: u32 = 136;
pub const T_YIELD: u32 = 137;
pub const T_LET: u32 = 138;
pub const T_STATIC: u32 = 139;
pub const T_IMPLEMENTS: u32 = 140;
pub const T_INTERFACE: u32 = 141;
pub const T_PACKAGE: u32 = 142;
pub const T_PRIVATE: u32 = 143;
pub const T_PROTECTED: u32 = 144;
pub const T_PUBLIC: u32 = 145;
pub const T_AS: u32 = 146;
pub const T_ACCESSOR: u32 = 147;
pub const T_ANY: u32 = 148;
pub const T_ASSERTS: u32 = 149;
pub const T_ASSERT: u32 = 150;
pub const T_ASYNC: u32 = 151;
pub const T_BIGINT_KW: u32 = 152;
pub const T_BOOLEAN: u32 = 153;
pub const T_CONSTRUCTOR: u32 = 154;
pub const T_DECLARE: u32 = 155;
pub const T_FROM: u32 = 156;
pub const T_GET: u32 = 157;
pub const T_GLOBAL: u32 = 158;
pub const T_INFER: u32 = 159;
pub const T_IS: u32 = 160;
pub const T_KEYOF: u32 = 161;
pub const T_MODULE: u32 = 162;
pub const T_NAMESPACE: u32 = 163;
pub const T_NEVER: u32 = 164;
pub const T_NUMBER_KW: u32 = 165;
pub const T_OBJECT: u32 = 166;
pub const T_OF: u32 = 167;
pub const T_OUT: u32 = 168;
pub const T_OVERRIDE: u32 = 169;
pub const T_READONLY: u32 = 170;
pub const T_REQUIRE: u32 = 171;
pub const T_SATISFIES: u32 = 172;
pub const T_SET: u32 = 173;
pub const T_STRING_KW: u32 = 174;
pub const T_SYMBOL: u32 = 175;
pub const T_TYPE: u32 = 176;
pub const T_UNDEFINED: u32 = 177;
pub const T_UNIQUE: u32 = 178;
pub const T_UNKNOWN: u32 = 179;
pub const T_USING: u32 = 180;
pub const T_ABSTRACT: u32 = 181;
pub const T_INTRINSIC: u32 = 182;

pub const KEYWORD_FIRST: u32 = T_AWAIT;
pub const KEYWORD_LAST: u32 = T_INTRINSIC;

/// Total number of kinds currently defined; used to size lookup tables.
pub const KIND_COUNT: usize = KEYWORD_LAST as usize + 1;

/// The spelling of every keyword, indexed by `kind - KEYWORD_FIRST`.
pub const KEYWORD_NAMES: [&str; 83] = [
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

/// The spelling of every punctuator, indexed by `kind - PUNCT_FIRST`.
pub const PUNCTUATOR_NAMES: [&str; 58] = [
    "{", "}", "(", ")", "[", "]", ";", ",", ".", "...", "?.", ":", "?", "=>",
    "@", "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=",
    "|=", "^=", "&&=", "||=", "??=", "||", "&&", "??", "|", "^", "&", "==",
    "!=", "===", "!==", "<", ">", "<=", ">=", "<<", ">>", ">>>", "+", "-",
    "*", "/", "%", "**", "!", "~", "++", "--",
];

/// Bit set when a `/` after a token of this kind opens a regular expression.
pub const KIND_BEFORE_EXPR: [u8; KIND_COUNT] = build_before_expr();

/// Bit set when a token of this kind can only continue an expression.
pub const KIND_CONTINUES_EXPR: [u8; KIND_COUNT] = build_continues_expr();

/// Binding power of each binary operator kind; `0` means "not one".
pub const KIND_PRECEDENCE: [u8; KIND_COUNT] = build_precedence();

pub const KW_RESERVED: u8 = 1 << 0;
pub const KW_STRICT_RESERVED: u8 = 1 << 1;
pub const KW_CONTEXTUAL: u8 = 1 << 2;

/// Classification of each keyword kind; `0` for non-keywords.
pub const KIND_KEYWORD_FLAGS: [u8; KIND_COUNT] = build_keyword_flags();

/// The identifier word code for each token kind; `0` when there is none.
pub const KIND_IDWORD_CODES: [u8; KIND_COUNT] = build_idword_codes();

const fn build_before_expr() -> [u8; KIND_COUNT] {
    let mut table = [0u8; KIND_COUNT];
    let kinds = [
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
        T_CASE,
        T_DEFAULT,
        T_DO,
        T_ELSE,
        T_RETURN,
        T_THROW,
        T_NEW,
        T_EXTENDS,
        T_IN,
        T_INSTANCEOF,
        T_TYPEOF,
        T_VOID,
        T_DELETE,
        T_YIELD,
        T_AWAIT,
    ];
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = 1;
        i += 1;
    }

    let mut kind = ASSIGN_FIRST;

    while kind <= ASSIGN_LAST {
        table[kind as usize] = 1;
        kind += 1;
    }

    table
}

const fn build_continues_expr() -> [u8; KIND_COUNT] {
    let mut table = [0u8; KIND_COUNT];
    let kinds = [
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
        T_IN,
        T_INSTANCEOF,
        T_AS,
        T_SATISFIES,
    ];
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = 1;
        i += 1;
    }

    let mut kind = ASSIGN_FIRST;

    while kind <= ASSIGN_LAST {
        table[kind as usize] = 1;
        kind += 1;
    }

    table
}

const fn build_precedence() -> [u8; KIND_COUNT] {
    let mut table = [0u8; KIND_COUNT];

    table[T_QQ as usize] = 1;
    table[T_PIPEPIPE as usize] = 1;
    table[T_AMPAMP as usize] = 2;
    table[T_PIPE as usize] = 3;
    table[T_CARET as usize] = 4;
    table[T_AMP as usize] = 5;
    table[T_EQ_EQ as usize] = 6;
    table[T_NOT_EQ as usize] = 6;
    table[T_EQ_EQ_EQ as usize] = 6;
    table[T_NOT_EQ_EQ as usize] = 6;
    table[T_LT as usize] = 7;
    table[T_GT as usize] = 7;
    table[T_LT_EQ as usize] = 7;
    table[T_GT_EQ as usize] = 7;
    table[T_IN as usize] = 7;
    table[T_INSTANCEOF as usize] = 7;
    table[T_AS as usize] = 7;
    table[T_SATISFIES as usize] = 7;
    table[T_SHL as usize] = 8;
    table[T_SAR as usize] = 8;
    table[T_SHR as usize] = 8;
    table[T_PLUS as usize] = 9;
    table[T_MINUS as usize] = 9;
    table[T_STAR as usize] = 10;
    table[T_SLASH as usize] = 10;
    table[T_PERCENT as usize] = 10;
    table[T_STARSTAR as usize] = 11;

    table
}

const fn build_keyword_flags() -> [u8; KIND_COUNT] {
    let mut table = [0u8; KIND_COUNT];
    let reserved = [
        T_BREAK,
        T_CASE,
        T_CATCH,
        T_CLASS,
        T_CONST,
        T_CONTINUE,
        T_DEBUGGER,
        T_DEFAULT,
        T_DELETE,
        T_DO,
        T_ELSE,
        T_ENUM,
        T_EXPORT,
        T_EXTENDS,
        T_FALSE,
        T_FINALLY,
        T_FOR,
        T_FUNCTION,
        T_IF,
        T_IMPORT,
        T_IN,
        T_INSTANCEOF,
        T_NEW,
        T_NULL,
        T_RETURN,
        T_SUPER,
        T_SWITCH,
        T_THIS,
        T_THROW,
        T_TRUE,
        T_TRY,
        T_TYPEOF,
        T_VAR,
        T_VOID,
        T_WHILE,
        T_WITH,
    ];
    let strict_reserved = [
        T_IMPLEMENTS,
        T_INTERFACE,
        T_PACKAGE,
        T_PRIVATE,
        T_PROTECTED,
        T_PUBLIC,
        T_STATIC,
        T_LET,
        T_YIELD,
    ];
    let mut i = 0;

    while i < reserved.len() {
        table[reserved[i] as usize] = KW_RESERVED;
        i += 1;
    }

    i = 0;

    while i < strict_reserved.len() {
        table[strict_reserved[i] as usize] = KW_STRICT_RESERVED;
        i += 1;
    }

    let mut kind = KEYWORD_FIRST;

    while kind <= KEYWORD_LAST {
        if table[kind as usize] == 0 {
            table[kind as usize] = KW_CONTEXTUAL;
        }

        kind += 1;
    }

    table
}

const fn build_idword_codes() -> [u8; KIND_COUNT] {
    let flags = build_keyword_flags();
    let mut table = [0u8; KIND_COUNT];

    // `IDWORD_KINDS` starts as `[0, 0]`, so new codes count up from 2.
    const IDWORD_RESERVED: u8 = 1;
    let mut next_code = 2u8;
    let mut kind = KEYWORD_FIRST;

    while kind <= KEYWORD_LAST {
        let f = flags[kind as usize];

        if (f & KW_STRICT_RESERVED) != 0 || kind == T_AWAIT || kind == T_THIS {
            table[kind as usize] = next_code;
            next_code += 1;
        } else if (f & KW_RESERVED) != 0 {
            table[kind as usize] = IDWORD_RESERVED;
        }

        kind += 1;
    }

    table
}

const KEYWORD_TABLE_SIZE: usize = 512;
const KEYWORD_TABLE_MASK: i32 = (KEYWORD_TABLE_SIZE as i32) - 1;

/// Open-addressed table mapping a hashed spelling to a keyword kind.
pub const KEYWORD_SLOTS: [u16; KEYWORD_TABLE_SIZE] = build_keyword_slots();

/// Combines a character code into a rolling hash, matching JavaScript's
/// `(hash * 31 + code) | 0` 32-bit wraparound exactly.
#[inline]
pub const fn hash_char(hash: i32, code: i32) -> i32 {
    hash.wrapping_mul(31).wrapping_add(code)
}

const fn hash_bytes(text: &[u8]) -> i32 {
    let mut hash = 0i32;
    let mut i = 0;

    while i < text.len() {
        hash = hash_char(hash, text[i] as i32);
        i += 1;
    }

    hash
}

const fn build_keyword_slots() -> [u16; KEYWORD_TABLE_SIZE] {
    let mut slots = [0u16; KEYWORD_TABLE_SIZE];
    let mut i = 0;

    while i < KEYWORD_NAMES.len() {
        let name = KEYWORD_NAMES[i].as_bytes();
        let mut slot = (hash_bytes(name) & KEYWORD_TABLE_MASK) as usize;

        while slots[slot] != 0 {
            slot = (slot + 1) & (KEYWORD_TABLE_SIZE - 1);
        }

        slots[slot] = (KEYWORD_FIRST as u16) + (i as u16);
        i += 1;
    }

    slots
}

/// Determines whether a range of source text spells a keyword.
pub fn lookup_keyword(source: &[u16], start: usize, end: usize, hash: i32) -> u32 {
    let length = end - start;

    // No keyword is shorter than two or longer than ten characters.
    if !(2..=10).contains(&length) {
        return T_IDENT;
    }

    let mut slot = (hash & KEYWORD_TABLE_MASK) as usize;

    loop {
        let kind = KEYWORD_SLOTS[slot];

        if kind == 0 {
            return T_IDENT;
        }

        let name = KEYWORD_NAMES[kind as usize - KEYWORD_FIRST as usize].as_bytes();

        if name.len() == length {
            let mut index = 0;

            while index < length && (name[index] as u16) == source[start + index] {
                index += 1;
            }

            if index == length {
                return kind as u32;
            }
        }

        slot = (slot + 1) & (KEYWORD_TABLE_SIZE - 1);
    }
}

/// Returns the human-readable spelling of a token kind, for error messages.
pub fn describe_kind(kind: u32) -> &'static str {
    if (PUNCT_FIRST..=PUNCT_LAST).contains(&kind) {
        return PUNCTUATOR_NAMES[(kind - PUNCT_FIRST) as usize];
    }

    if (KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind) {
        return KEYWORD_NAMES[(kind - KEYWORD_FIRST) as usize];
    }

    match kind {
        T_EOF => "end of input",
        T_IDENT => "identifier",
        T_PRIVATE_IDENT => "private identifier",
        T_NUMBER | T_BIGINT => "number",
        T_STRING => "string",
        T_REGEXP => "regular expression",
        _ => "template",
    }
}

/// Whether a kind is an assignment operator.
#[inline]
pub fn is_assignment_kind(kind: u32) -> bool {
    (ASSIGN_FIRST..=ASSIGN_LAST).contains(&kind)
}

/// Whether a kind may be used as a property name or other position that
/// accepts any identifier-like word, including reserved words.
#[inline]
pub fn is_identifier_name_kind(kind: u32) -> bool {
    kind == T_IDENT || (KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind)
}

/// Whether a token kind can be used as a binding name.
#[inline]
pub fn is_binding_name_kind(kind: u32) -> bool {
    if kind == T_IDENT {
        return true;
    }

    (KEYWORD_FIRST..=KEYWORD_LAST).contains(&kind)
        && (KIND_KEYWORD_FLAGS[kind as usize] & KW_RESERVED) == 0
}
