/**
 * @fileoverview Character code constants and classification tables.
 *
 * Character classification is the hottest code path in any tokenizer, so all
 * decisions for the ASCII range are answered by a single lookup into a
 * `Uint8Array` whose entries are bit masks. Non-ASCII characters fall back to
 * Unicode property regular expressions, which are only consulted for the rare
 * source file that actually contains them.
 */

//-----------------------------------------------------------------------------
// Character Codes
//-----------------------------------------------------------------------------

export const CH_NULL = 0x00;
export const CH_TAB = 0x09;
export const CH_LF = 0x0a;
export const CH_VT = 0x0b;
export const CH_FF = 0x0c;
export const CH_CR = 0x0d;
export const CH_SPACE = 0x20;
export const CH_BANG = 0x21;
export const CH_QUOTE_DOUBLE = 0x22;
export const CH_HASH = 0x23;
export const CH_DOLLAR = 0x24;
export const CH_PERCENT = 0x25;
export const CH_AMP = 0x26;
export const CH_QUOTE_SINGLE = 0x27;
export const CH_PAREN_OPEN = 0x28;
export const CH_PAREN_CLOSE = 0x29;
export const CH_STAR = 0x2a;
export const CH_PLUS = 0x2b;
export const CH_COMMA = 0x2c;
export const CH_MINUS = 0x2d;
export const CH_DOT = 0x2e;
export const CH_SLASH = 0x2f;
export const CH_0 = 0x30;
export const CH_1 = 0x31;
export const CH_7 = 0x37;
export const CH_8 = 0x38;
export const CH_9 = 0x39;
export const CH_COLON = 0x3a;
export const CH_SEMICOLON = 0x3b;
export const CH_LT = 0x3c;
export const CH_EQ = 0x3d;
export const CH_GT = 0x3e;
export const CH_QUESTION = 0x3f;
export const CH_AT = 0x40;
export const CH_A_UPPER = 0x41;
export const CH_B_UPPER = 0x42;
export const CH_E_UPPER = 0x45;
export const CH_F_UPPER = 0x46;
export const CH_O_UPPER = 0x4f;
export const CH_X_UPPER = 0x58;
export const CH_Z_UPPER = 0x5a;
export const CH_BRACKET_OPEN = 0x5b;
export const CH_BACKSLASH = 0x5c;
export const CH_BRACKET_CLOSE = 0x5d;
export const CH_CARET = 0x5e;
export const CH_UNDERSCORE = 0x5f;
export const CH_BACKTICK = 0x60;
export const CH_A_LOWER = 0x61;
export const CH_B_LOWER = 0x62;
export const CH_E_LOWER = 0x65;
export const CH_F_LOWER = 0x66;
export const CH_N_LOWER = 0x6e;
export const CH_O_LOWER = 0x6f;
export const CH_R_LOWER = 0x72;
export const CH_T_LOWER = 0x74;
export const CH_U_LOWER = 0x75;
export const CH_V_LOWER = 0x76;
export const CH_X_LOWER = 0x78;
export const CH_Z_LOWER = 0x7a;
export const CH_BRACE_OPEN = 0x7b;
export const CH_PIPE = 0x7c;
export const CH_BRACE_CLOSE = 0x7d;
export const CH_TILDE = 0x7e;
export const CH_NBSP = 0xa0;
export const CH_LINE_SEPARATOR = 0x2028;
export const CH_PARAGRAPH_SEPARATOR = 0x2029;
export const CH_BOM = 0xfeff;
export const CH_ZWNJ = 0x200c;
export const CH_ZWJ = 0x200d;

//-----------------------------------------------------------------------------
// Classification Bit Masks
//-----------------------------------------------------------------------------

/** The character may start an identifier. */
export const MASK_ID_START = 1 << 0;

/** The character may continue an identifier. */
export const MASK_ID_PART = 1 << 1;

/** The character is whitespace but not a line terminator. */
export const MASK_SPACE = 1 << 2;

/** The character terminates a line. */
export const MASK_NEWLINE = 1 << 3;

/** The character is a decimal digit. */
export const MASK_DIGIT = 1 << 4;

/** The character is a hexadecimal digit. */
export const MASK_HEX_DIGIT = 1 << 5;

/**
 * Classification table for the ASCII range. Index by character code; any code
 * point at or above `ASCII_LIMIT` must use the Unicode fallbacks below.
 */
export const ASCII_LIMIT = 128;

export const CHAR_FLAGS = new Uint8Array(ASCII_LIMIT);

// Build the table once at module load.
{
	for (let c = CH_0; c <= CH_9; c++) {
		CHAR_FLAGS[c] = MASK_DIGIT | MASK_HEX_DIGIT | MASK_ID_PART;
	}

	for (let c = CH_A_UPPER; c <= CH_Z_UPPER; c++) {
		CHAR_FLAGS[c] = MASK_ID_START | MASK_ID_PART;
	}

	for (let c = CH_A_LOWER; c <= CH_Z_LOWER; c++) {
		CHAR_FLAGS[c] = MASK_ID_START | MASK_ID_PART;
	}

	for (let c = CH_A_UPPER; c <= CH_F_UPPER; c++) {
		CHAR_FLAGS[c] |= MASK_HEX_DIGIT;
	}

	for (let c = CH_A_LOWER; c <= CH_F_LOWER; c++) {
		CHAR_FLAGS[c] |= MASK_HEX_DIGIT;
	}

	CHAR_FLAGS[CH_DOLLAR] = MASK_ID_START | MASK_ID_PART;
	CHAR_FLAGS[CH_UNDERSCORE] = MASK_ID_START | MASK_ID_PART;

	CHAR_FLAGS[CH_SPACE] = MASK_SPACE;
	CHAR_FLAGS[CH_TAB] = MASK_SPACE;
	CHAR_FLAGS[CH_VT] = MASK_SPACE;
	CHAR_FLAGS[CH_FF] = MASK_SPACE;

	CHAR_FLAGS[CH_LF] = MASK_NEWLINE;
	CHAR_FLAGS[CH_CR] = MASK_NEWLINE;
}

//-----------------------------------------------------------------------------
// Unicode Fallbacks
//-----------------------------------------------------------------------------

/*
 * These are only reached for code points outside of ASCII, which is the
 * uncommon case. Using the engine's own Unicode property data keeps the tables
 * correct without shipping megabytes of range data.
 */
const UNICODE_ID_START = /\p{ID_Start}/u;
const UNICODE_ID_PART = /\p{ID_Continue}/u;

/**
 * Determines whether a non-ASCII code point may start an identifier.
 * @param code The code point to test.
 * @returns `true` when the code point is a valid identifier start.
 */
export function isNonAsciiIdStart(code: number): boolean {
	if (code === CH_BOM) {
		return false;
	}

	return UNICODE_ID_START.test(String.fromCodePoint(code));
}

/**
 * Determines whether a non-ASCII code point may continue an identifier.
 * @param code The code point to test.
 * @returns `true` when the code point is a valid identifier part.
 */
export function isNonAsciiIdPart(code: number): boolean {
	if (code === CH_ZWNJ || code === CH_ZWJ) {
		return true;
	}

	if (code === CH_BOM) {
		return false;
	}

	return UNICODE_ID_PART.test(String.fromCodePoint(code));
}

/**
 * Determines whether a non-ASCII code point is whitespace.
 * @param code The code point to test.
 * @returns `true` when the code point counts as whitespace.
 */
export function isNonAsciiSpace(code: number): boolean {
	switch (code) {
		case CH_NBSP:
		case CH_BOM:
		case 0x1680:
		case 0x2000:
		case 0x2001:
		case 0x2002:
		case 0x2003:
		case 0x2004:
		case 0x2005:
		case 0x2006:
		case 0x2007:
		case 0x2008:
		case 0x2009:
		case 0x200a:
		case 0x202f:
		case 0x205f:
		case 0x3000:
			return true;

		default:
			return false;
	}
}

/**
 * Determines whether a code point terminates a line. Only `\n`, `\r`, U+2028,
 * and U+2029 do.
 * @param code The code point to test.
 * @returns `true` when the code point is a line terminator.
 */
export function isLineTerminator(code: number): boolean {
	return (
		code === CH_LF ||
		code === CH_CR ||
		code === CH_LINE_SEPARATOR ||
		code === CH_PARAGRAPH_SEPARATOR
	);
}
