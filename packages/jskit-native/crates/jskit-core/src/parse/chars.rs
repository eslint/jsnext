//! Character code constants and classification tables.
//!
//! Port of `packages/jskit/src/parse/chars.ts`. Character classification for
//! the ASCII range is a single table lookup; non-ASCII code points fall back
//! to Unicode property checks, which `unicode-id-start` answers with the same
//! ID_Start / ID_Continue sets ECMAScript specifies.

pub const CH_TAB: i32 = 0x09;
pub const CH_LF: i32 = 0x0a;
pub const CH_VT: i32 = 0x0b;
pub const CH_FF: i32 = 0x0c;
pub const CH_CR: i32 = 0x0d;
pub const CH_SPACE: i32 = 0x20;
pub const CH_BANG: i32 = 0x21;
pub const CH_QUOTE_DOUBLE: i32 = 0x22;
pub const CH_HASH: i32 = 0x23;
pub const CH_DOLLAR: i32 = 0x24;
pub const CH_PERCENT: i32 = 0x25;
pub const CH_AMP: i32 = 0x26;
pub const CH_QUOTE_SINGLE: i32 = 0x27;
pub const CH_PAREN_OPEN: i32 = 0x28;
pub const CH_PAREN_CLOSE: i32 = 0x29;
pub const CH_STAR: i32 = 0x2a;
pub const CH_PLUS: i32 = 0x2b;
pub const CH_COMMA: i32 = 0x2c;
pub const CH_MINUS: i32 = 0x2d;
pub const CH_DOT: i32 = 0x2e;
pub const CH_SLASH: i32 = 0x2f;
pub const CH_0: i32 = 0x30;
pub const CH_7: i32 = 0x37;
pub const CH_9: i32 = 0x39;
pub const CH_COLON: i32 = 0x3a;
pub const CH_SEMICOLON: i32 = 0x3b;
pub const CH_LT: i32 = 0x3c;
pub const CH_EQ: i32 = 0x3d;
pub const CH_GT: i32 = 0x3e;
pub const CH_QUESTION: i32 = 0x3f;
pub const CH_AT: i32 = 0x40;
pub const CH_A_UPPER: i32 = 0x41;
pub const CH_B_UPPER: i32 = 0x42;
pub const CH_E_UPPER: i32 = 0x45;
pub const CH_F_UPPER: i32 = 0x46;
pub const CH_O_UPPER: i32 = 0x4f;
pub const CH_X_UPPER: i32 = 0x58;
pub const CH_Z_UPPER: i32 = 0x5a;
pub const CH_BRACKET_OPEN: i32 = 0x5b;
pub const CH_BACKSLASH: i32 = 0x5c;
pub const CH_BRACKET_CLOSE: i32 = 0x5d;
pub const CH_CARET: i32 = 0x5e;
pub const CH_UNDERSCORE: i32 = 0x5f;
pub const CH_BACKTICK: i32 = 0x60;
pub const CH_A_LOWER: i32 = 0x61;
pub const CH_B_LOWER: i32 = 0x62;
pub const CH_E_LOWER: i32 = 0x65;
pub const CH_F_LOWER: i32 = 0x66;
pub const CH_N_LOWER: i32 = 0x6e;
pub const CH_O_LOWER: i32 = 0x6f;
pub const CH_R_LOWER: i32 = 0x72;
pub const CH_T_LOWER: i32 = 0x74;
pub const CH_U_LOWER: i32 = 0x75;
pub const CH_V_LOWER: i32 = 0x76;
pub const CH_X_LOWER: i32 = 0x78;
pub const CH_Z_LOWER: i32 = 0x7a;
pub const CH_BRACE_OPEN: i32 = 0x7b;
pub const CH_PIPE: i32 = 0x7c;
pub const CH_BRACE_CLOSE: i32 = 0x7d;
pub const CH_TILDE: i32 = 0x7e;
pub const CH_NBSP: i32 = 0xa0;
pub const CH_LINE_SEPARATOR: i32 = 0x2028;
pub const CH_PARAGRAPH_SEPARATOR: i32 = 0x2029;
pub const CH_BOM: i32 = 0xfeff;
pub const CH_ZWNJ: i32 = 0x200c;
pub const CH_ZWJ: i32 = 0x200d;

pub const MASK_ID_START: u8 = 1 << 0;
pub const MASK_ID_PART: u8 = 1 << 1;
pub const MASK_SPACE: u8 = 1 << 2;
pub const MASK_NEWLINE: u8 = 1 << 3;
pub const MASK_DIGIT: u8 = 1 << 4;
pub const MASK_HEX_DIGIT: u8 = 1 << 5;

pub const ASCII_LIMIT: i32 = 128;

pub const CHAR_FLAGS: [u8; 128] = build_char_flags();

const fn build_char_flags() -> [u8; 128] {
    let mut table = [0u8; 128];
    let mut c = CH_0 as usize;

    while c <= CH_9 as usize {
        table[c] = MASK_DIGIT | MASK_HEX_DIGIT | MASK_ID_PART;
        c += 1;
    }

    c = CH_A_UPPER as usize;
    while c <= CH_Z_UPPER as usize {
        table[c] = MASK_ID_START | MASK_ID_PART;
        c += 1;
    }

    c = CH_A_LOWER as usize;
    while c <= CH_Z_LOWER as usize {
        table[c] = MASK_ID_START | MASK_ID_PART;
        c += 1;
    }

    c = CH_A_UPPER as usize;
    while c <= CH_F_UPPER as usize {
        table[c] |= MASK_HEX_DIGIT;
        c += 1;
    }

    c = CH_A_LOWER as usize;
    while c <= CH_F_LOWER as usize {
        table[c] |= MASK_HEX_DIGIT;
        c += 1;
    }

    table[CH_DOLLAR as usize] = MASK_ID_START | MASK_ID_PART;
    table[CH_UNDERSCORE as usize] = MASK_ID_START | MASK_ID_PART;

    table[CH_SPACE as usize] = MASK_SPACE;
    table[CH_TAB as usize] = MASK_SPACE;
    table[CH_VT as usize] = MASK_SPACE;
    table[CH_FF as usize] = MASK_SPACE;

    table[CH_LF as usize] = MASK_NEWLINE;
    table[CH_CR as usize] = MASK_NEWLINE;

    table
}

/// Classification flags for a character code; `0` outside the ASCII range and
/// for the `-1` that stands in for reading past the end of the input, exactly
/// as `CHAR_FLAGS[NaN]` and `CHAR_FLAGS[nonAscii]` answer in JavaScript.
#[inline]
pub fn char_flags(code: i32) -> u8 {
    if (0..ASCII_LIMIT).contains(&code) {
        CHAR_FLAGS[code as usize]
    } else {
        0
    }
}

/// Whether a non-ASCII code point may start an identifier.
pub fn is_non_ascii_id_start(code: u32) -> bool {
    if code == CH_BOM as u32 {
        return false;
    }

    match char::from_u32(code) {
        Some(c) => unicode_id_start::is_id_start_unicode(c),
        None => false,
    }
}

/// Whether a non-ASCII code point may continue an identifier.
pub fn is_non_ascii_id_part(code: u32) -> bool {
    if code == CH_ZWNJ as u32 || code == CH_ZWJ as u32 {
        return true;
    }

    if code == CH_BOM as u32 {
        return false;
    }

    match char::from_u32(code) {
        Some(c) => unicode_id_start::is_id_continue_unicode(c),
        None => false,
    }
}

/// Whether a non-ASCII code point is whitespace.
pub fn is_non_ascii_space(code: i32) -> bool {
    matches!(
        code,
        0xa0 | 0xfeff
            | 0x1680
            | 0x2000..=0x200a
            | 0x202f
            | 0x205f
            | 0x3000
    )
}
