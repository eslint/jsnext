/**
 * @fileoverview The regular expression pattern grammar.
 *
 * A regular expression literal is one token, and the tokenizer reads all of
 * it: `RegularExpressionBody` is `/`, then characters, with `\` escaping the
 * next one and `[…]` suspending the meaning of `/`, then the closing `/`. That
 * is the whole of the lexical grammar, and finding the token's end is the
 * whole of what `parse()` owns here.
 *
 * The pattern *between* the slashes is not part of that grammar at all. It
 * arrives in §22.2.1 as a Static Semantics: Early Errors clause on the
 * literal — "It is a Syntax Error if BodyText cannot be recognized using the
 * goal symbol Pattern" — beside the rules about flags. So it lands on the
 * `validate()` side of the phase split by the specification's own
 * classification, not by an approximation of it. See
 * [AGENTS.md](../../../AGENTS.md#the-rule-that-decides-where-code-goes).
 *
 * Three things make this bigger than a single grammar:
 *
 * - **The `u`/`v` flag changes the language.** Without it, Annex B's
 *   extensions apply: a `{` that begins nothing is a literal brace, `\8` is
 *   the character `8`, and an unmatched `]` is allowed. With it, all three are
 *   errors. `v` goes further and replaces character classes wholesale with set
 *   expressions that nest, intersect, and subtract.
 * - **Two goal symbols.** Whether `\k` introduces a named backreference or
 *   matches a literal `k` depends on whether the pattern contains a group name
 *   *anywhere*, which is not known until it has been read. The specification
 *   answers this by parsing with `Pattern[~U, ~N]` and reparsing with
 *   `Pattern[~U, +N]` if a `GroupName` turned up, and so does this.
 * - **Forward references are legal.** `\1` may name a group that appears later
 *   and `\k<a>` may name one that never appears, so references are collected
 *   during the walk and resolved against the totals afterward.
 */

import {
	ASCII_LIMIT,
	CHAR_FLAGS,
	CH_0,
	CH_1,
	CH_7,
	CH_9,
	CH_AMP,
	CH_AT,
	CH_A_LOWER,
	CH_A_UPPER,
	CH_BACKSLASH,
	CH_BACKTICK,
	CH_BANG,
	CH_BRACE_CLOSE,
	CH_BRACE_OPEN,
	CH_BRACKET_CLOSE,
	CH_BRACKET_OPEN,
	CH_B_LOWER,
	CH_B_UPPER,
	CH_CARET,
	CH_COLON,
	CH_COMMA,
	CH_DOLLAR,
	CH_DOT,
	CH_EQ,
	CH_F_LOWER,
	CH_GT,
	CH_HASH,
	CH_LT,
	CH_MINUS,
	CH_N_LOWER,
	CH_PAREN_CLOSE,
	CH_PAREN_OPEN,
	CH_PERCENT,
	CH_PIPE,
	CH_PLUS,
	CH_QUESTION,
	CH_R_LOWER,
	CH_SLASH,
	CH_STAR,
	CH_TILDE,
	CH_T_LOWER,
	CH_UNDERSCORE,
	CH_U_LOWER,
	CH_V_LOWER,
	CH_ZWJ,
	CH_ZWNJ,
	CH_Z_LOWER,
	CH_Z_UPPER,
	MASK_DIGIT,
	MASK_HEX_DIGIT,
	MASK_ID_PART,
	MASK_ID_START,
	isNonAsciiIdPart,
	isNonAsciiIdStart,
} from "./chars.js";
import {
	BINARY_PROPERTIES,
	BINARY_PROPERTIES_OF_STRINGS,
	GENERAL_CATEGORY_VALUES,
	SCRIPT_VALUES,
} from "./unicode-properties.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/** A problem found in a regular expression literal. */
export interface RegExpProblem {
	/** What is wrong. */
	message: string;

	/** Where it is, as an offset into the program text. */
	start: number;
}

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

/** Nothing was parsed. */
const SET_NONE = 0;

/** A construct was parsed, and it matches single code points only. */
const SET_CHARS = 1;

/**
 * A construct was parsed, and it can match a sequence of code points.
 *
 * Only `v` mode has these — `\q{abc}` and the emoji sequence properties — and
 * they are what makes negation an error, since a set of strings has no
 * complement.
 */
const SET_STRINGS = 2;

/** The flags a regular expression literal may carry, in no particular order. */
const VALID_FLAGS = "dgimsuvy";

/** The property names that take a value, mapped to the values they take. */
const NON_BINARY_PROPERTIES = /* @__PURE__ */ new Map([
	["General_Category", GENERAL_CATEGORY_VALUES],
	["gc", GENERAL_CATEGORY_VALUES],
	["Script", SCRIPT_VALUES],
	["sc", SCRIPT_VALUES],
	["Script_Extensions", SCRIPT_VALUES],
	["scx", SCRIPT_VALUES],
]);

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Determines whether a code point may start an identifier.
 * @param code The code point to test.
 * @returns `true` when it may start one.
 */
function isIdStart(code: number): boolean {
	return code < ASCII_LIMIT
		? code >= 0 && (CHAR_FLAGS[code] & MASK_ID_START) !== 0
		: isNonAsciiIdStart(code);
}

/**
 * Determines whether a code point may continue an identifier.
 * @param code The code point to test.
 * @returns `true` when it may continue one.
 */
function isIdPart(code: number): boolean {
	return code < ASCII_LIMIT
		? code >= 0 && (CHAR_FLAGS[code] & MASK_ID_PART) !== 0
		: isNonAsciiIdPart(code);
}

/**
 * Determines whether a code point is a decimal digit.
 * @param code The code point to test.
 * @returns `true` when it is one.
 */
function isDigit(code: number): boolean {
	return code >= CH_0 && code <= CH_9;
}

/**
 * Determines whether a code point is a hexadecimal digit.
 * @param code The code point to test.
 * @returns `true` when it is one.
 */
function isHexDigit(code: number): boolean {
	return (
		code >= 0 &&
		code < ASCII_LIMIT &&
		(CHAR_FLAGS[code] & MASK_HEX_DIGIT) !== 0
	);
}

/**
 * Converts a hexadecimal digit to its value.
 * @param code The digit's code point.
 * @returns The value it stands for.
 */
function hexValue(code: number): number {
	if ((CHAR_FLAGS[code] & MASK_DIGIT) !== 0) {
		return code - CH_0;
	}

	// Lowercase both cases at once; `a` and `A` differ only in bit 5.
	return (code | 0x20) - CH_A_LOWER + 10;
}

/**
 * Determines whether a code point is an ASCII letter.
 * @param code The code point to test.
 * @returns `true` when it is one.
 */
function isControlLetter(code: number): boolean {
	return (
		(code >= CH_A_UPPER && code <= CH_Z_UPPER) ||
		(code >= CH_A_LOWER && code <= CH_Z_LOWER)
	);
}

/**
 * Determines whether a code point is a `SyntaxCharacter`.
 *
 * These are the twelve characters that mean something in a pattern, and so the
 * twelve that `\` may precede as an identity escape under `u`.
 * @param code The code point to test.
 * @returns `true` when it is one.
 */
function isSyntaxCharacter(code: number): boolean {
	return (
		code === CH_DOLLAR ||
		(code >= CH_PAREN_OPEN && code <= CH_PLUS) ||
		code === CH_DOT ||
		code === CH_QUESTION ||
		(code >= CH_BRACKET_OPEN && code <= CH_CARET) ||
		(code >= CH_BRACE_OPEN && code <= CH_BRACE_CLOSE)
	);
}

/**
 * Determines whether a code point is a `ClassSetSyntaxCharacter`.
 *
 * `v` mode reserves these inside a class, so a pattern that wants one
 * literally must escape it. This is the source of most of the difference
 * between a `u`-mode class and a `v`-mode one.
 * @param code The code point to test.
 * @returns `true` when it is one.
 */
function isClassSetSyntaxCharacter(code: number): boolean {
	return (
		code === CH_PAREN_OPEN ||
		code === CH_PAREN_CLOSE ||
		code === CH_MINUS ||
		code === CH_SLASH ||
		(code >= CH_BRACKET_OPEN && code <= CH_BRACKET_CLOSE) ||
		(code >= CH_BRACE_OPEN && code <= CH_BRACE_CLOSE)
	);
}

/**
 * Determines whether a code point may be escaped inside a `v`-mode class.
 * @param code The code point to test.
 * @returns `true` when it is a `ClassSetReservedPunctuator`.
 */
function isClassSetReservedPunctuator(code: number): boolean {
	return (
		code === CH_BANG ||
		code === CH_HASH ||
		code === CH_PERCENT ||
		code === CH_AMP ||
		code === CH_COMMA ||
		code === CH_MINUS ||
		(code >= CH_COLON && code <= CH_GT) ||
		code === CH_AT ||
		code === CH_BACKTICK ||
		code === CH_TILDE
	);
}

/**
 * Determines whether a code point may not be doubled inside a `v`-mode class.
 *
 * `&&` and `--` are operators, and the rest are reserved so that they can
 * become operators later without breaking a pattern that used them literally.
 * @param code The code point to test.
 * @returns `true` when two of it in a row are an error.
 */
function isClassSetReservedDoublePunctuator(code: number): boolean {
	return (
		code === CH_BANG ||
		(code >= CH_HASH && code <= CH_AMP) ||
		(code >= CH_STAR && code <= CH_COMMA) ||
		code === CH_DOT ||
		(code >= CH_COLON && code <= CH_AT) ||
		code === CH_CARET ||
		code === CH_BACKTICK ||
		code === CH_TILDE
	);
}

/**
 * One branch of one disjunction, used to tell duplicate group names apart.
 *
 * Two groups may share a name when they cannot both take part in a single
 * match, which is to say when they sit in different alternatives of the same
 * disjunction: `(?<a>x)|(?<a>y)` is legal and `(?<a>x)(?<a>y)` is not. A
 * branch therefore records the disjunction it belongs to (`base`, shared by
 * every alternative of that disjunction) and the branch that encloses it.
 */
class Branch {
	/** The branch this one is nested inside, or `null` at the top. */
	parent: Branch | null;

	/** The object shared by every alternative of this disjunction. */
	base: Branch;

	/**
	 * @param parent The enclosing branch, or `null`.
	 * @param base The disjunction's shared identity, or `null` to start one.
	 */
	constructor(parent: Branch | null, base: Branch | null) {
		this.parent = parent;
		this.base = base ?? this;
	}

	/**
	 * Determines whether two branches are alternatives of one disjunction.
	 * @param other The branch to compare against.
	 * @returns `true` when the two can never both participate in a match.
	 */
	separatedFrom(other: Branch | null): boolean {
		for (let self: Branch | null = this; self; self = self.parent) {
			for (let node = other; node; node = node.parent) {
				if (self.base === node.base && self !== node) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Starts the next alternative of the same disjunction.
	 * @returns A branch beside this one.
	 */
	sibling(): Branch {
		return new Branch(this.parent, this.base);
	}
}

/** Thrown to unwind out of the walk when a pattern is malformed. */
class PatternError extends Error {
	/** Where the problem is, as an offset into the program text. */
	start: number;

	/**
	 * @param message What is wrong.
	 * @param start Where it is.
	 */
	constructor(message: string, start: number) {
		super(message);
		this.start = start;
	}
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Checks the pattern and flags of a regular expression literal.
 *
 * One instance is reused for every literal in a program, so the arrays and the
 * map it keeps are allocated once rather than per pattern. Nothing survives a
 * call: `validate()` resets everything it touches.
 */
export class RegExpValidator {
	/** The program text. Patterns are read in place rather than sliced out. */
	#source = "";

	/** How far reading has got, as an offset into the program text. */
	#pos = 0;

	/** The first character of the pattern. */
	#patternStart = 0;

	/** One past the last character of the pattern — the closing slash. */
	#patternEnd = 0;

	/** Whether the `u` or the `v` flag is set, which is most of the grammar. */
	#unicode = false;

	/** Whether the `v` flag is set, which replaces character classes. */
	#unicodeSets = false;

	/** Whether `\k` introduces a named backreference rather than a `k`. */
	#namedGroups = false;

	/** How many capturing groups have been seen. */
	#capturingParens = 0;

	/** The largest numeric backreference seen, which may run ahead. */
	#maxBackReference = 0;

	/** Every group name, mapped to the branches that declare it. */
	readonly #groupNames = new Map<string, Branch[]>();

	/** The names `\k<…>` referred to, resolved once the walk is done. */
	readonly #backReferenceNames: string[] = [];

	/** Where each of those references was written. */
	readonly #backReferenceStarts: number[] = [];

	/** The branch being parsed, or `null` outside any disjunction. */
	#branch: Branch | null = null;

	/** The value of the last thing read, for range and reference checks. */
	#lastValue = 0;

	/** The text of the last name read. */
	#lastName = "";

	/** Whether the last assertion read may carry a quantifier under Annex B. */
	#quantifiable = false;

	/**
	 * Checks one regular expression literal.
	 * @param source The program text.
	 * @param start The offset of the opening slash.
	 * @param patternEnd The offset of the closing slash.
	 * @param end One past the last flag.
	 * @returns The first problem found, or `null` when the literal is valid.
	 */
	validate(
		source: string,
		start: number,
		patternEnd: number,
		end: number,
	): RegExpProblem | null {
		this.#source = source;
		this.#patternStart = start + 1;
		this.#patternEnd = patternEnd;

		try {
			this.#readFlags(patternEnd + 1, end);
			this.#parse(this.#unicode);

			/*
			 * The goal symbol is `Pattern[~U, ~N]`, and a `GroupName` anywhere
			 * in the result means the whole pattern must be read again as
			 * `Pattern[~U, +N]` instead. Under `u` or `v` the second goal was
			 * the first one, so this never runs.
			 */
			if (!this.#namedGroups && this.#groupNames.size > 0) {
				this.#parse(true);
			}
		} catch (error) {
			if (error instanceof PatternError) {
				return { message: error.message, start: error.start };
			}

			/* c8 ignore next 2 -- nothing else is thrown from the walk. */
			throw error;
		}

		return null;
	}

	//-------------------------------------------------------------------------
	// Reading
	//-------------------------------------------------------------------------

	/**
	 * Reports a problem at the current position and abandons the walk.
	 * @param message What is wrong.
	 * @returns Never; the call always throws.
	 * @throws {PatternError} Always.
	 */
	#raise(message: string): never {
		throw new PatternError(message, this.#pos);
	}

	/**
	 * Reads the code point at an offset.
	 *
	 * Under `u` or `v` a surrogate pair is one character, so `\u{1F600}` and
	 * the emoji itself are the same atom. Without the flag they are two, which
	 * is the older behavior a pattern may still be relying on.
	 * @param index The offset to read.
	 * @param forceUnicode Whether to pair surrogates whatever the flags say.
	 * @returns The code point, or `-1` past the end of the pattern.
	 */
	#at(index: number, forceUnicode: boolean): number {
		if (index >= this.#patternEnd) {
			return -1;
		}

		const code = this.#source.charCodeAt(index);

		if (
			!(forceUnicode || this.#unicode) ||
			code < 0xd800 ||
			code > 0xdbff ||
			index + 1 >= this.#patternEnd
		) {
			return code;
		}

		const next = this.#source.charCodeAt(index + 1);

		return next >= 0xdc00 && next <= 0xdfff
			? (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
			: code;
	}

	/**
	 * Finds the offset after the character at an offset.
	 * @param index The offset to step from.
	 * @param forceUnicode Whether to pair surrogates whatever the flags say.
	 * @returns The next offset.
	 */
	#next(index: number, forceUnicode: boolean): number {
		if (index >= this.#patternEnd) {
			return this.#patternEnd;
		}

		const code = this.#source.charCodeAt(index);

		if (
			!(forceUnicode || this.#unicode) ||
			code < 0xd800 ||
			code > 0xdbff ||
			index + 1 >= this.#patternEnd
		) {
			return index + 1;
		}

		const next = this.#source.charCodeAt(index + 1);

		return next >= 0xdc00 && next <= 0xdfff ? index + 2 : index + 1;
	}

	/**
	 * Reads the code point at the current position without consuming it.
	 * @param forceUnicode Whether to pair surrogates whatever the flags say.
	 * @returns The code point, or `-1` at the end.
	 */
	#current(forceUnicode = false): number {
		return this.#at(this.#pos, forceUnicode);
	}

	/**
	 * Reads the code point after the current one without consuming either.
	 * @returns The code point, or `-1` at the end.
	 */
	#lookahead(): number {
		return this.#at(this.#next(this.#pos, false), false);
	}

	/**
	 * Consumes the character at the current position.
	 * @param forceUnicode Whether to pair surrogates whatever the flags say.
	 * @returns Nothing.
	 */
	#advance(forceUnicode = false): void {
		this.#pos = this.#next(this.#pos, forceUnicode);
	}

	/**
	 * Consumes the character at the current position when it is the one given.
	 * @param code The code point to match.
	 * @param forceUnicode Whether to pair surrogates whatever the flags say.
	 * @returns `true` when it matched and was consumed.
	 */
	#eat(code: number, forceUnicode = false): boolean {
		if (this.#current(forceUnicode) !== code) {
			return false;
		}

		this.#advance(forceUnicode);
		return true;
	}

	/**
	 * Consumes two characters when both match.
	 * @param first The first code point to match.
	 * @param second The second code point to match.
	 * @returns `true` when both matched and were consumed.
	 */
	#eatPair(first: number, second: number): boolean {
		if (
			this.#pos + 2 > this.#patternEnd ||
			this.#source.charCodeAt(this.#pos) !== first ||
			this.#source.charCodeAt(this.#pos + 1) !== second
		) {
			return false;
		}

		this.#pos += 2;
		return true;
	}

	//-------------------------------------------------------------------------
	// Flags
	//-------------------------------------------------------------------------

	/**
	 * Checks the flags, which decide which language the pattern is written in.
	 * @param start The offset of the first flag.
	 * @param end One past the last flag.
	 * @returns Nothing.
	 * @throws {PatternError} When a flag is unknown, repeated, or exclusive.
	 */
	#readFlags(start: number, end: number): void {
		const source = this.#source;
		let unicode = false;
		let unicodeSets = false;

		for (let i = start; i < end; i++) {
			const flag = source[i];

			if (VALID_FLAGS.indexOf(flag) === -1) {
				throw new PatternError("Invalid regular expression flag.", i);
			}

			const repeat = source.indexOf(flag, i + 1);

			if (repeat !== -1 && repeat < end) {
				throw new PatternError("Duplicate regular expression flag.", i);
			}

			unicode ||= flag === "u";
			unicodeSets ||= flag === "v";
		}

		/*
		 * `v` is a superset of `u` rather than a variation on it, so asking
		 * for both is asking for two different grammars at once.
		 */
		if (unicode && unicodeSets) {
			throw new PatternError(
				"The 'u' and 'v' flags are mutually exclusive.",
				start,
			);
		}

		this.#unicode = unicode || unicodeSets;
		this.#unicodeSets = unicodeSets;
	}

	//-------------------------------------------------------------------------
	// Pattern
	//-------------------------------------------------------------------------

	/**
	 * Reads the whole pattern once and resolves what the walk deferred.
	 * @param namedGroups Whether `\k` introduces a named backreference.
	 * @returns Nothing.
	 * @throws {PatternError} When the pattern is malformed.
	 */
	#parse(namedGroups: boolean): void {
		this.#pos = this.#patternStart;
		this.#namedGroups = namedGroups;
		this.#capturingParens = 0;
		this.#maxBackReference = 0;
		this.#groupNames.clear();
		this.#backReferenceNames.length = 0;
		this.#backReferenceStarts.length = 0;
		this.#branch = null;

		this.#disjunction();

		/*
		 * Anything left over closes something that was never opened. The
		 * disjunction stops at `)` because a group ends there, so reaching one
		 * here means there was no group.
		 */
		if (this.#pos !== this.#patternEnd) {
			if (this.#eat(CH_PAREN_CLOSE)) {
				this.#raise("Unmatched ')'.");
			}

			if (this.#eat(CH_BRACKET_CLOSE) || this.#eat(CH_BRACE_CLOSE)) {
				this.#raise("Lone quantifier brackets.");
			}
		}

		/*
		 * References are resolved here rather than where they were written,
		 * because a pattern may refer forward: `/\1(a)/` and `/\k<a>(?<a>x)/`
		 * are both legal.
		 */
		if (this.#maxBackReference > this.#capturingParens) {
			this.#raise("Invalid backreference.");
		}

		for (let i = 0; i < this.#backReferenceNames.length; i++) {
			if (!this.#groupNames.has(this.#backReferenceNames[i])) {
				throw new PatternError(
					"Invalid named capture referenced.",
					this.#backReferenceStarts[i],
				);
			}
		}
	}

	/**
	 * Reads `Disjunction`, the alternatives separated by `|`.
	 * @returns Nothing.
	 * @throws {PatternError} When the pattern is malformed.
	 */
	#disjunction(): void {
		this.#branch = new Branch(this.#branch, null);
		this.#alternative();

		while (this.#eat(CH_PIPE)) {
			this.#branch = this.#branch.sibling();
			this.#alternative();
		}

		this.#branch = this.#branch.parent;

		/*
		 * An alternative stops at whatever it cannot read, so a quantifier
		 * here is one with nothing in front of it.
		 */
		if (this.#eatQuantifier(true)) {
			this.#raise("Nothing to repeat.");
		}

		if (this.#eat(CH_BRACE_OPEN)) {
			this.#raise("Lone quantifier brackets.");
		}
	}

	/**
	 * Reads `Alternative`, a run of terms.
	 * @returns Nothing.
	 * @throws {PatternError} When the pattern is malformed.
	 */
	#alternative(): void {
		while (this.#pos < this.#patternEnd && this.#term()) {
			// Every term is read for its side effects.
		}
	}

	/**
	 * Reads one `Term`: an assertion, or an atom with an optional quantifier.
	 * @returns `true` when a term was read.
	 * @throws {PatternError} When the pattern is malformed.
	 */
	#term(): boolean {
		if (this.#eatAssertion()) {
			/*
			 * Annex B lets a lookahead carry a quantifier, which is useless
			 * but was allowed for long enough to be relied on. A lookbehind
			 * never may, and under `u` neither may.
			 */
			if (this.#quantifiable && this.#eatQuantifier(false)) {
				if (this.#unicode) {
					this.#raise("Invalid quantifier.");
				}
			}

			return true;
		}

		if (this.#unicode ? this.#eatAtom() : this.#eatExtendedAtom()) {
			this.#eatQuantifier(false);
			return true;
		}

		return false;
	}

	/**
	 * Reads `Assertion`: an anchor, a word boundary, or a lookaround.
	 * @returns `true` when an assertion was read.
	 * @throws {PatternError} When a lookaround is unterminated.
	 */
	#eatAssertion(): boolean {
		const start = this.#pos;

		this.#quantifiable = false;

		if (this.#eat(CH_CARET) || this.#eat(CH_DOLLAR)) {
			return true;
		}

		if (this.#eat(CH_BACKSLASH)) {
			if (this.#eat(CH_B_UPPER) || this.#eat(CH_B_LOWER)) {
				return true;
			}

			this.#pos = start;
		}

		if (this.#eat(CH_PAREN_OPEN) && this.#eat(CH_QUESTION)) {
			const behind = this.#eat(CH_LT);

			if (this.#eat(CH_EQ) || this.#eat(CH_BANG)) {
				this.#disjunction();

				if (!this.#eat(CH_PAREN_CLOSE)) {
					this.#raise("Unterminated group.");
				}

				this.#quantifiable = !behind;
				return true;
			}
		}

		this.#pos = start;
		return false;
	}

	/**
	 * Reads `Quantifier`, greedy or lazy.
	 * @param silent Whether to leave a malformed brace alone rather than
	 *      reporting it, used when only the presence of a quantifier matters.
	 * @returns `true` when a quantifier was read.
	 * @throws {PatternError} When a braced quantifier is malformed.
	 */
	#eatQuantifier(silent: boolean): boolean {
		if (
			this.#eat(CH_STAR) ||
			this.#eat(CH_PLUS) ||
			this.#eat(CH_QUESTION) ||
			this.#eatBracedQuantifier(silent)
		) {
			this.#eat(CH_QUESTION);
			return true;
		}

		return false;
	}

	/**
	 * Reads `{n}`, `{n,}`, or `{n,m}`.
	 * @param silent Whether to leave a malformed brace alone.
	 * @returns `true` when a braced quantifier was read.
	 * @throws {PatternError} When the bounds are out of order, or when `u` is
	 *      set and the brace begins something that is not a quantifier.
	 */
	#eatBracedQuantifier(silent: boolean): boolean {
		const start = this.#pos;

		if (this.#eat(CH_BRACE_OPEN)) {
			if (this.#eatDecimalDigits()) {
				const min = this.#lastValue;
				let max = -1;

				if (this.#eat(CH_COMMA) && this.#eatDecimalDigits()) {
					max = this.#lastValue;
				}

				if (this.#eat(CH_BRACE_CLOSE)) {
					if (max !== -1 && max < min && !silent) {
						this.#raise("Numbers out of order in {} quantifier.");
					}

					return true;
				}
			}

			/*
			 * Without `u`, a brace that begins no quantifier is just a brace,
			 * which is why `/a{/` matches the two characters `a{`.
			 */
			if (this.#unicode && !silent) {
				this.#raise("Incomplete quantifier.");
			}

			this.#pos = start;
		}

		return false;
	}

	/**
	 * Reads `Atom` under `u` or `v`.
	 * @returns `true` when an atom was read.
	 * @throws {PatternError} When the atom is malformed.
	 */
	#eatAtom(): boolean {
		return (
			this.#eatPatternCharacters() ||
			this.#eat(CH_DOT) ||
			this.#eatAtomEscape() ||
			this.#eatCharacterClass() ||
			this.#eatGroup(false) ||
			this.#eatGroup(true)
		);
	}

	/**
	 * Reads `ExtendedAtom`, the Annex B atom for a pattern without `u`.
	 *
	 * The difference is at the end: a brace that begins no quantifier, and a
	 * character that `Atom` reserves, are both ordinary characters here.
	 * @returns `true` when an atom was read.
	 * @throws {PatternError} When the atom is malformed.
	 */
	#eatExtendedAtom(): boolean {
		return (
			this.#eat(CH_DOT) ||
			this.#eatAtomEscape() ||
			this.#eatCharacterClass() ||
			this.#eatGroup(false) ||
			this.#eatGroup(true) ||
			this.#eatInvalidBracedQuantifier() ||
			this.#eatExtendedPatternCharacter()
		);
	}

	/**
	 * Reports a quantifier that follows nothing.
	 * @returns `false`, when the position held no quantifier at all.
	 * @throws {PatternError} When it held one.
	 */
	#eatInvalidBracedQuantifier(): boolean {
		if (this.#eatBracedQuantifier(true)) {
			this.#raise("Nothing to repeat.");
		}

		return false;
	}

	/**
	 * Reads a run of ordinary characters, as many as there are.
	 * @returns `true` when at least one was read.
	 */
	#eatPatternCharacters(): boolean {
		const start = this.#pos;
		let code = this.#current();

		while (code !== -1 && !isSyntaxCharacter(code)) {
			this.#advance();
			code = this.#current();
		}

		return this.#pos !== start;
	}

	/**
	 * Reads one `ExtendedPatternCharacter`.
	 *
	 * Wider than `PatternCharacter` by exactly `]`, `{`, and `}`, which is why
	 * `/]{}/ ` is a pattern rather than an error when `u` is not set.
	 * @returns `true` when one was read.
	 */
	#eatExtendedPatternCharacter(): boolean {
		const code = this.#current();

		if (
			code !== -1 &&
			code !== CH_DOLLAR &&
			!(code >= CH_PAREN_OPEN && code <= CH_PLUS) &&
			code !== CH_DOT &&
			code !== CH_QUESTION &&
			code !== CH_BRACKET_OPEN &&
			code !== CH_CARET &&
			code !== CH_PIPE
		) {
			this.#advance();
			return true;
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Groups
	//-------------------------------------------------------------------------

	/**
	 * Reads a group, capturing or not.
	 *
	 * The two are one production split by a `?`, and the non-capturing side
	 * carries the modifiers that `(?i:…)` and `(?-i:…)` set and clear.
	 * @param capturing Whether to read the capturing form.
	 * @returns `true` when a group was read.
	 * @throws {PatternError} When the group is malformed.
	 */
	#eatGroup(capturing: boolean): boolean {
		const start = this.#pos;

		if (!this.#eat(CH_PAREN_OPEN)) {
			return false;
		}

		if (!capturing) {
			if (this.#eat(CH_QUESTION)) {
				this.#readModifiers();

				if (this.#eat(CH_COLON)) {
					this.#disjunction();

					if (this.#eat(CH_PAREN_CLOSE)) {
						return true;
					}

					this.#raise("Unterminated group.");
				}
			}

			this.#pos = start;
			return false;
		}

		this.#readGroupSpecifier();
		this.#disjunction();

		if (!this.#eat(CH_PAREN_CLOSE)) {
			this.#raise("Unterminated group.");
		}

		this.#capturingParens++;
		return true;
	}

	/**
	 * Reads the modifiers of `(?ims-ims:…)`, if there are any.
	 *
	 * A modifier may be added or removed but not both, may not be repeated,
	 * and `(?-:…)` names nothing on either side, which is an error rather than
	 * a way of writing `(?:…)`.
	 * @returns Nothing.
	 * @throws {PatternError} When the modifiers repeat or cancel each other.
	 */
	#readModifiers(): void {
		const added = this.#readModifierRun();
		const hyphen = this.#eat(CH_MINUS);

		if (added === "" && !hyphen) {
			return;
		}

		for (let i = 0; i < added.length; i++) {
			if (added.indexOf(added[i], i + 1) !== -1) {
				this.#raise("Duplicate regular expression modifiers.");
			}
		}

		if (!hyphen) {
			return;
		}

		const removed = this.#readModifierRun();

		if (added === "" && removed === "" && this.#current() === CH_COLON) {
			this.#raise("Invalid regular expression modifiers.");
		}

		for (let i = 0; i < removed.length; i++) {
			if (
				removed.indexOf(removed[i], i + 1) !== -1 ||
				added.indexOf(removed[i]) !== -1
			) {
				this.#raise("Duplicate regular expression modifiers.");
			}
		}
	}

	/**
	 * Reads a run of modifier letters.
	 * @returns The letters read, which may be none.
	 */
	#readModifierRun(): string {
		const start = this.#pos;
		let code = this.#current();

		while (
			code === 0x69 /* i */ ||
			code === 0x6d /* m */ ||
			code === 0x73 /* s */
		) {
			this.#advance();
			code = this.#current();
		}

		return this.#source.slice(start, this.#pos);
	}

	/**
	 * Reads the `?<name>` of a named capturing group, if there is one.
	 * @returns Nothing.
	 * @throws {PatternError} When the name is malformed or already taken.
	 */
	#readGroupSpecifier(): void {
		if (!this.#eat(CH_QUESTION)) {
			return;
		}

		const start = this.#pos;

		if (!this.#eatGroupName()) {
			this.#raise("Invalid group.");
		}

		const name = this.#lastName;
		const declared = this.#groupNames.get(name);

		if (declared !== undefined) {
			for (let i = 0; i < declared.length; i++) {
				if (!declared[i].separatedFrom(this.#branch)) {
					throw new PatternError(
						"Duplicate capture group name.",
						start,
					);
				}
			}

			declared.push(this.#branch!);
		} else {
			this.#groupNames.set(name, [this.#branch!]);
		}
	}

	/**
	 * Reads `<name>`, leaving the name in `#lastName`.
	 * @returns `true` when a group name was read.
	 * @throws {PatternError} When `<` opens something that is not a name.
	 */
	#eatGroupName(): boolean {
		this.#lastName = "";

		if (!this.#eat(CH_LT)) {
			return false;
		}

		if (this.#eatIdentifierName() && this.#eat(CH_GT)) {
			return true;
		}

		this.#raise("Invalid capture group name.");
	}

	/**
	 * Reads a `RegExpIdentifierName`, leaving it in `#lastName`.
	 *
	 * The escapes are always read as if `u` were set, so `\u{1F600}` names a
	 * group whatever the flags say.
	 * @returns `true` when a name was read.
	 * @throws {PatternError} When an escape in the name is malformed.
	 */
	#eatIdentifierName(): boolean {
		this.#lastName = "";

		if (!this.#eatIdentifierCharacter(true)) {
			return false;
		}

		this.#lastName += String.fromCodePoint(this.#lastValue);

		while (this.#eatIdentifierCharacter(false)) {
			this.#lastName += String.fromCodePoint(this.#lastValue);
		}

		return true;
	}

	/**
	 * Reads one character of a group name, escaped or not.
	 * @param first Whether this is the first character, which is narrower.
	 * @returns `true` when a character was read.
	 * @throws {PatternError} When an escape is malformed.
	 */
	#eatIdentifierCharacter(first: boolean): boolean {
		const start = this.#pos;
		let code = this.#current(true);

		this.#advance(true);

		if (code === CH_BACKSLASH && this.#eatUnicodeEscape(true)) {
			code = this.#lastValue;
		}

		/*
		 * A zero-width joiner is not an identifier character anywhere else,
		 * but a group name may contain one so that names in scripts that need
		 * it can be written.
		 */
		if (
			first
				? isIdStart(code)
				: isIdPart(code) || code === CH_ZWNJ || code === CH_ZWJ
		) {
			this.#lastValue = code;
			return true;
		}

		this.#pos = start;
		return false;
	}

	//-------------------------------------------------------------------------
	// Escapes
	//-------------------------------------------------------------------------

	/**
	 * Reads `\` followed by an `AtomEscape`.
	 * @returns `true` when an escape was read.
	 * @throws {PatternError} When the escape is malformed under `u`.
	 */
	#eatAtomEscape(): boolean {
		const start = this.#pos;

		if (!this.#eat(CH_BACKSLASH)) {
			return false;
		}

		if (
			this.#eatBackReference() ||
			this.#eatCharacterClassEscape() !== SET_NONE ||
			this.#eatCharacterEscape() ||
			(this.#namedGroups && this.#eatNamedBackReference())
		) {
			return true;
		}

		if (this.#unicode) {
			if (this.#current() === 0x63 /* c */) {
				this.#raise("Invalid unicode escape.");
			}

			this.#raise("Invalid escape.");
		}

		this.#pos = start;
		return false;
	}

	/**
	 * Reads a numeric backreference.
	 *
	 * Without `u`, a number larger than the group count is not a reference at
	 * all — it falls through to a legacy octal escape or an identity escape,
	 * so `/\8/` matches the digit. Under `u` it is an error, but not until the
	 * total is known.
	 * @returns `true` when a backreference was read.
	 */
	#eatBackReference(): boolean {
		const start = this.#pos;

		if (!this.#eatDecimalEscape()) {
			return false;
		}

		const value = this.#lastValue;

		if (this.#unicode) {
			if (value > this.#maxBackReference) {
				this.#maxBackReference = value;
			}

			return true;
		}

		if (value <= this.#capturingParens) {
			return true;
		}

		this.#pos = start;
		return false;
	}

	/**
	 * Reads `\k<name>`.
	 * @returns `true` when a named backreference was read.
	 * @throws {PatternError} When `\k` is not followed by a name.
	 */
	#eatNamedBackReference(): boolean {
		const start = this.#pos;

		if (!this.#eat(0x6b /* k */)) {
			return false;
		}

		if (this.#eatGroupName()) {
			this.#backReferenceNames.push(this.#lastName);
			this.#backReferenceStarts.push(start);
			return true;
		}

		this.#raise("Invalid named reference.");
	}

	/**
	 * Reads `\1` through `\9…`, leaving the value in `#lastValue`.
	 * @returns `true` when a decimal escape was read.
	 */
	#eatDecimalEscape(): boolean {
		let code = this.#current();

		if (code < CH_1 || code > CH_9) {
			return false;
		}

		let value = 0;

		do {
			value = value * 10 + (code - CH_0);
			this.#advance();
			code = this.#current();
		} while (isDigit(code));

		this.#lastValue = value;
		return true;
	}

	/**
	 * Reads `\d`, `\s`, `\w`, their negations, and `\p{…}`.
	 * @returns What the escape matches, or `SET_NONE` when it read nothing.
	 * @throws {PatternError} When a property escape names nothing.
	 */
	#eatCharacterClassEscape(): number {
		const code = this.#current();

		if (
			code === 0x64 /* d */ ||
			code === 0x44 /* D */ ||
			code === 0x73 /* s */ ||
			code === 0x53 /* S */ ||
			code === 0x77 /* w */ ||
			code === 0x57 /* W */
		) {
			this.#lastValue = -1;
			this.#advance();
			return SET_CHARS;
		}

		/*
		 * Without `u` there is no property escape: `\p` is the letter `p`, and
		 * making it an error would reject patterns that predate the syntax.
		 */
		if (
			!this.#unicode ||
			(code !== 0x70 /* p */ && code !== 0x50) /* P */
		) {
			return SET_NONE;
		}

		const negated = code === 0x50;

		this.#lastValue = -1;
		this.#advance();

		if (this.#eat(CH_BRACE_OPEN)) {
			const result = this.#eatPropertyExpression();

			if (result !== SET_NONE && this.#eat(CH_BRACE_CLOSE)) {
				/*
				 * A property that matches sequences has no complement, so
				 * `\P{RGI_Emoji}` names something that cannot exist.
				 */
				if (negated && result === SET_STRINGS) {
					this.#raise("Invalid property name.");
				}

				return result;
			}
		}

		this.#raise("Invalid property name.");
	}

	/**
	 * Reads the inside of `\p{…}`: either `Name=Value` or a lone name.
	 * @returns What the property matches, or `SET_NONE` when it read nothing.
	 * @throws {PatternError} When the name or the value is not a real one.
	 */
	#eatPropertyExpression(): number {
		const start = this.#pos;

		if (this.#eatPropertyCharacters(false) && this.#eat(CH_EQ)) {
			const name = this.#lastName;

			if (this.#eatPropertyCharacters(true)) {
				const values = NON_BINARY_PROPERTIES.get(name);

				if (values === undefined) {
					this.#raise("Invalid property name.");
				}

				if (!values.has(this.#lastName)) {
					this.#raise("Invalid property value.");
				}

				return SET_CHARS;
			}
		}

		this.#pos = start;

		if (!this.#eatPropertyCharacters(true)) {
			return SET_NONE;
		}

		const name = this.#lastName;

		if (BINARY_PROPERTIES.has(name) || GENERAL_CATEGORY_VALUES.has(name)) {
			return SET_CHARS;
		}

		if (this.#unicodeSets && BINARY_PROPERTIES_OF_STRINGS.has(name)) {
			return SET_STRINGS;
		}

		this.#raise("Invalid property name.");
	}

	/**
	 * Reads a run of property name or value characters into `#lastName`.
	 * @param digits Whether digits are allowed, as they are in a value.
	 * @returns `true` when at least one character was read.
	 */
	#eatPropertyCharacters(digits: boolean): boolean {
		const start = this.#pos;
		let code = this.#current();

		while (
			isControlLetter(code) ||
			code === CH_UNDERSCORE ||
			(digits && isDigit(code))
		) {
			this.#advance();
			code = this.#current();
		}

		this.#lastName = this.#source.slice(start, this.#pos);
		return this.#pos !== start;
	}

	/**
	 * Reads a `CharacterEscape`, leaving the character in `#lastValue`.
	 * @returns `true` when an escape was read.
	 * @throws {PatternError} When an escape is malformed under `u`.
	 */
	#eatCharacterEscape(): boolean {
		return (
			this.#eatControlEscape() ||
			this.#eatControlLetterEscape() ||
			this.#eatNul() ||
			this.#eatHexEscape() ||
			this.#eatUnicodeEscape(false) ||
			(!this.#unicode && this.#eatLegacyOctalEscape()) ||
			this.#eatIdentityEscape()
		);
	}

	/**
	 * Reads `\f`, `\n`, `\r`, `\t`, or `\v`.
	 * @returns `true` when one was read.
	 */
	#eatControlEscape(): boolean {
		switch (this.#current()) {
			case CH_T_LOWER:
				this.#lastValue = 0x09;
				break;

			case CH_N_LOWER:
				this.#lastValue = 0x0a;
				break;

			case CH_V_LOWER:
				this.#lastValue = 0x0b;
				break;

			case CH_F_LOWER:
				this.#lastValue = 0x0c;
				break;

			case CH_R_LOWER:
				this.#lastValue = 0x0d;
				break;

			default:
				return false;
		}

		this.#advance();
		return true;
	}

	/**
	 * Reads `\cX`, the control character named by a letter.
	 * @returns `true` when one was read.
	 */
	#eatControlLetterEscape(): boolean {
		const start = this.#pos;

		if (this.#eat(0x63 /* c */)) {
			if (isControlLetter(this.#current())) {
				this.#lastValue = this.#current() % 0x20;
				this.#advance();
				return true;
			}

			this.#pos = start;
		}

		return false;
	}

	/**
	 * Reads `\0`, which is the null character only when no digit follows.
	 * @returns `true` when it was read.
	 */
	#eatNul(): boolean {
		if (this.#current() === CH_0 && !isDigit(this.#lookahead())) {
			this.#lastValue = 0;
			this.#advance();
			return true;
		}

		return false;
	}

	/**
	 * Reads `\xHH`.
	 * @returns `true` when it was read.
	 * @throws {PatternError} When `u` is set and the digits are missing.
	 */
	#eatHexEscape(): boolean {
		const start = this.#pos;

		if (this.#eat(0x78 /* x */)) {
			if (this.#eatFixedHexDigits(2)) {
				return true;
			}

			if (this.#unicode) {
				this.#raise("Invalid escape.");
			}

			this.#pos = start;
		}

		return false;
	}

	/**
	 * Reads `\uHHHH`, a surrogate pair, or `\u{…}`.
	 *
	 * The braced form and the pairing of surrogates both need `u`, which is
	 * why `/\u{3}/` without it is the letter `u` repeated three times.
	 * @param forceUnicode Whether to read as if `u` were set.
	 * @returns `true` when an escape was read.
	 * @throws {PatternError} When `u` is set and the escape is malformed.
	 */
	#eatUnicodeEscape(forceUnicode: boolean): boolean {
		const start = this.#pos;
		const unicode = forceUnicode || this.#unicode;

		if (!this.#eat(CH_U_LOWER)) {
			return false;
		}

		if (this.#eatFixedHexDigits(4)) {
			const lead = this.#lastValue;

			if (unicode && lead >= 0xd800 && lead <= 0xdbff) {
				const afterLead = this.#pos;

				if (
					this.#eat(CH_BACKSLASH) &&
					this.#eat(CH_U_LOWER) &&
					this.#eatFixedHexDigits(4)
				) {
					const trail = this.#lastValue;

					if (trail >= 0xdc00 && trail <= 0xdfff) {
						this.#lastValue =
							(lead - 0xd800) * 0x400 +
							(trail - 0xdc00) +
							0x10000;
						return true;
					}
				}

				this.#pos = afterLead;
				this.#lastValue = lead;
			}

			return true;
		}

		if (
			unicode &&
			this.#eat(CH_BRACE_OPEN) &&
			this.#eatHexDigits() &&
			this.#eat(CH_BRACE_CLOSE) &&
			this.#lastValue <= 0x10ffff
		) {
			return true;
		}

		if (unicode) {
			this.#raise("Invalid unicode escape.");
		}

		this.#pos = start;
		return false;
	}

	/**
	 * Reads a legacy octal escape, which only a pattern without `u` may have.
	 * @returns `true` when one was read.
	 */
	#eatLegacyOctalEscape(): boolean {
		if (!this.#eatOctalDigit()) {
			return false;
		}

		const first = this.#lastValue;

		if (!this.#eatOctalDigit()) {
			this.#lastValue = first;
			return true;
		}

		const second = this.#lastValue;

		// Only `\0` through `\377` — a third digit past that is a character.
		if (first <= 3 && this.#eatOctalDigit()) {
			this.#lastValue = first * 64 + second * 8 + this.#lastValue;
		} else {
			this.#lastValue = first * 8 + second;
		}

		return true;
	}

	/**
	 * Reads one octal digit into `#lastValue`.
	 * @returns `true` when one was read.
	 */
	#eatOctalDigit(): boolean {
		const code = this.#current();

		if (code >= CH_0 && code <= CH_7) {
			this.#lastValue = code - CH_0;
			this.#advance();
			return true;
		}

		return false;
	}

	/**
	 * Reads `IdentityEscape`, a `\` in front of a character that means itself.
	 *
	 * Under `u` this is only the syntax characters and `/`, which is what
	 * makes `/\a/u` an error where `/\a/` is the letter `a`.
	 * @returns `true` when one was read.
	 */
	#eatIdentityEscape(): boolean {
		const code = this.#current();

		if (this.#unicode) {
			if (isSyntaxCharacter(code) || code === CH_SLASH) {
				this.#lastValue = code;
				this.#advance();
				return true;
			}

			return false;
		}

		/*
		 * `\c` is held back for the control escapes, and `\k` for named
		 * backreferences wherever the pattern has a group name to reference.
		 */
		if (
			code !== -1 &&
			code !== 0x63 /* c */ &&
			!(this.#namedGroups && code === 0x6b /* k */)
		) {
			this.#lastValue = code;
			this.#advance();
			return true;
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Character classes
	//-------------------------------------------------------------------------

	/**
	 * Reads `[…]`.
	 * @returns `true` when a class was read.
	 * @throws {PatternError} When the class is unterminated or malformed.
	 */
	#eatCharacterClass(): boolean {
		if (!this.#eat(CH_BRACKET_OPEN)) {
			return false;
		}

		const negated = this.#eat(CH_CARET);
		const result = this.#classContents();

		if (!this.#eat(CH_BRACKET_CLOSE)) {
			this.#raise("Unterminated character class.");
		}

		if (negated && result === SET_STRINGS) {
			this.#raise("Negated character class may contain strings.");
		}

		return true;
	}

	/**
	 * Reads the inside of a class, in whichever of the two grammars applies.
	 * @returns What the class matches.
	 * @throws {PatternError} When the contents are malformed.
	 */
	#classContents(): number {
		if (this.#current() === CH_BRACKET_CLOSE) {
			return SET_CHARS;
		}

		if (this.#unicodeSets) {
			return this.#classSetExpression();
		}

		this.#classRanges();
		return SET_CHARS;
	}

	/**
	 * Reads the ranges and atoms of a class without `v`.
	 * @returns Nothing.
	 * @throws {PatternError} When a range is backwards or has a set for an end.
	 */
	#classRanges(): void {
		while (this.#eatClassAtom()) {
			const left = this.#lastValue;

			if (this.#eat(CH_MINUS) && this.#eatClassAtom()) {
				const right = this.#lastValue;

				/*
				 * `[\d-a]` has no meaning — a range needs two characters, and
				 * `\d` is a set. Annex B keeps it, reading the dash as a
				 * literal, so this is an error only under `u`.
				 */
				if (this.#unicode && (left === -1 || right === -1)) {
					this.#raise("Invalid character class.");
				}

				if (left !== -1 && right !== -1 && left > right) {
					this.#raise("Range out of order in character class.");
				}
			}
		}
	}

	/**
	 * Reads one atom of a class without `v`.
	 * @returns `true` when an atom was read.
	 * @throws {PatternError} When an escape is malformed under `u`.
	 */
	#eatClassAtom(): boolean {
		const start = this.#pos;

		if (this.#eat(CH_BACKSLASH)) {
			if (this.#eatClassEscape()) {
				return true;
			}

			if (this.#unicode) {
				const code = this.#current();

				if (code === 0x63 /* c */ || (code >= CH_0 && code <= CH_7)) {
					this.#raise("Invalid class escape.");
				}

				this.#raise("Invalid escape.");
			}

			this.#pos = start;
		}

		const code = this.#current();

		if (code !== CH_BRACKET_CLOSE && code !== -1) {
			this.#lastValue = code;
			this.#advance();
			return true;
		}

		return false;
	}

	/**
	 * Reads what may follow `\` inside a class without `v`.
	 * @returns `true` when an escape was read.
	 * @throws {PatternError} When a property escape names nothing.
	 */
	#eatClassEscape(): boolean {
		const start = this.#pos;

		// `\b` is a backspace inside a class and a word boundary outside one.
		if (this.#eat(CH_B_LOWER)) {
			this.#lastValue = 0x08;
			return true;
		}

		if (this.#unicode && this.#eat(CH_MINUS)) {
			this.#lastValue = CH_MINUS;
			return true;
		}

		// Annex B's `\c1` and `\c_`, which are control escapes off the letters.
		if (!this.#unicode && this.#eat(0x63 /* c */)) {
			const code = this.#current();

			if (isDigit(code) || code === CH_UNDERSCORE) {
				this.#lastValue = code % 0x20;
				this.#advance();
				return true;
			}

			this.#pos = start;
		}

		return (
			this.#eatCharacterClassEscape() !== SET_NONE ||
			this.#eatCharacterEscape()
		);
	}

	//-------------------------------------------------------------------------
	// Character classes under `v`
	//-------------------------------------------------------------------------

	/**
	 * Reads a `ClassSetExpression`: a union, an intersection, or a difference.
	 *
	 * The three are exclusive — `[\w&&\d--a]` mixes two operators and is an
	 * error — so whichever one appears first decides how the rest is read.
	 * @returns What the expression matches.
	 * @throws {PatternError} When the expression is malformed.
	 */
	#classSetExpression(): number {
		let result = SET_CHARS;

		if (this.#eatClassSetRange()) {
			// A range opens a union, handled below.
		} else {
			const operand = this.#eatClassSetOperand();

			if (operand === SET_NONE) {
				this.#raise("Invalid character in character class.");
			}

			if (operand === SET_STRINGS) {
				result = SET_STRINGS;
			}

			const start = this.#pos;

			while (this.#eatPair(CH_AMP, CH_AMP)) {
				if (this.#current() === CH_AMP) {
					this.#raise("Invalid character in character class.");
				}

				const next = this.#eatClassSetOperand();

				if (next === SET_NONE) {
					this.#raise("Invalid character in character class.");
				}

				/*
				 * An intersection is only as wide as its narrowest side, so
				 * one operand that holds no strings settles the whole thing.
				 */
				if (next !== SET_STRINGS) {
					result = SET_CHARS;
				}
			}

			if (start !== this.#pos) {
				return result;
			}

			while (this.#eatPair(CH_MINUS, CH_MINUS)) {
				if (this.#eatClassSetOperand() === SET_NONE) {
					this.#raise("Invalid character in character class.");
				}
			}

			if (start !== this.#pos) {
				return result;
			}
		}

		for (;;) {
			if (this.#eatClassSetRange()) {
				continue;
			}

			const operand = this.#eatClassSetOperand();

			if (operand === SET_NONE) {
				return result;
			}

			if (operand === SET_STRINGS) {
				result = SET_STRINGS;
			}
		}
	}

	/**
	 * Reads `a-z` inside a `v`-mode class.
	 * @returns `true` when a range was read.
	 * @throws {PatternError} When the range is backwards.
	 */
	#eatClassSetRange(): boolean {
		const start = this.#pos;

		if (this.#eatClassSetCharacter()) {
			const left = this.#lastValue;

			if (this.#eat(CH_MINUS) && this.#eatClassSetCharacter()) {
				if (
					left !== -1 &&
					this.#lastValue !== -1 &&
					left > this.#lastValue
				) {
					this.#raise("Range out of order in character class.");
				}

				return true;
			}

			this.#pos = start;
		}

		return false;
	}

	/**
	 * Reads one operand of a `v`-mode set expression.
	 * @returns What the operand matches, or `SET_NONE` when it read nothing.
	 * @throws {PatternError} When the operand is malformed.
	 */
	#eatClassSetOperand(): number {
		if (this.#eatClassSetCharacter()) {
			return SET_CHARS;
		}

		const strings = this.#eatClassStringDisjunction();

		if (strings !== SET_NONE) {
			return strings;
		}

		return this.#eatNestedClass();
	}

	/**
	 * Reads a class nested inside another, or a `\p{…}` standing alone.
	 * @returns What it matches, or `SET_NONE` when nothing was read.
	 * @throws {PatternError} When the nested class is malformed.
	 */
	#eatNestedClass(): number {
		const start = this.#pos;

		if (this.#eat(CH_BRACKET_OPEN)) {
			const negated = this.#eat(CH_CARET);
			const result = this.#classContents();

			if (this.#eat(CH_BRACKET_CLOSE)) {
				if (negated && result === SET_STRINGS) {
					this.#raise("Negated character class may contain strings.");
				}

				return result;
			}

			this.#pos = start;
		}

		if (this.#eat(CH_BACKSLASH)) {
			const result = this.#eatCharacterClassEscape();

			if (result !== SET_NONE) {
				return result;
			}

			this.#pos = start;
		}

		return SET_NONE;
	}

	/**
	 * Reads `\q{a|bc}`, the literal strings a `v`-mode class may hold.
	 * @returns What it matches, or `SET_NONE` when nothing was read.
	 * @throws {PatternError} When the disjunction is unterminated.
	 */
	#eatClassStringDisjunction(): number {
		const start = this.#pos;

		if (!this.#eatPair(CH_BACKSLASH, 0x71 /* q */)) {
			return SET_NONE;
		}

		if (!this.#eat(CH_BRACE_OPEN)) {
			this.#raise("Invalid escape.");
		}

		let result = this.#classString();

		while (this.#eat(CH_PIPE)) {
			if (this.#classString() === SET_STRINGS) {
				result = SET_STRINGS;
			}
		}

		if (this.#eat(CH_BRACE_CLOSE)) {
			return result;
		}

		this.#pos = start;
		return SET_NONE;
	}

	/**
	 * Reads one alternative of a `\q{…}`.
	 *
	 * Exactly one character is a character; none or several is a string, which
	 * is what makes `[^\q{ab}]` an error and `[^\q{a}]` fine.
	 * @returns Whether the alternative is a string.
	 */
	#classString(): number {
		let count = 0;

		while (this.#eatClassSetCharacter()) {
			count++;
		}

		return count === 1 ? SET_CHARS : SET_STRINGS;
	}

	/**
	 * Reads one character of a `v`-mode class.
	 * @returns `true` when a character was read.
	 * @throws {PatternError} When an escape is malformed.
	 */
	#eatClassSetCharacter(): boolean {
		const start = this.#pos;

		if (this.#eat(CH_BACKSLASH)) {
			if (this.#eatCharacterEscape() || this.#eatClassSetPunctuator()) {
				return true;
			}

			if (this.#eat(CH_B_LOWER)) {
				this.#lastValue = 0x08;
				return true;
			}

			this.#pos = start;
			return false;
		}

		const code = this.#current();

		if (code === -1) {
			return false;
		}

		/*
		 * A doubled punctuator is reserved even where it means nothing today,
		 * so that `&&` and `--` can gain company without changing what an
		 * existing pattern matches.
		 */
		if (
			code === this.#lookahead() &&
			isClassSetReservedDoublePunctuator(code)
		) {
			return false;
		}

		if (isClassSetSyntaxCharacter(code)) {
			return false;
		}

		this.#advance();
		this.#lastValue = code;
		return true;
	}

	/**
	 * Reads a punctuator that `v` mode requires be escaped.
	 * @returns `true` when one was read.
	 */
	#eatClassSetPunctuator(): boolean {
		const code = this.#current();

		if (isClassSetReservedPunctuator(code)) {
			this.#lastValue = code;
			this.#advance();
			return true;
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Digits
	//-------------------------------------------------------------------------

	/**
	 * Reads a run of decimal digits into `#lastValue`.
	 * @returns `true` when at least one was read.
	 */
	#eatDecimalDigits(): boolean {
		const start = this.#pos;
		let value = 0;
		let code = this.#current();

		while (isDigit(code)) {
			value = value * 10 + (code - CH_0);
			this.#advance();
			code = this.#current();
		}

		this.#lastValue = value;
		return this.#pos !== start;
	}

	/**
	 * Reads a run of hexadecimal digits into `#lastValue`.
	 * @returns `true` when at least one was read.
	 */
	#eatHexDigits(): boolean {
		const start = this.#pos;
		let value = 0;
		let code = this.#current();

		while (isHexDigit(code)) {
			value = value * 16 + hexValue(code);
			this.#advance();
			code = this.#current();
		}

		this.#lastValue = value;
		return this.#pos !== start;
	}

	/**
	 * Reads exactly as many hexadecimal digits as asked for.
	 * @param count How many digits to read.
	 * @returns `true` when that many were there.
	 */
	#eatFixedHexDigits(count: number): boolean {
		const start = this.#pos;
		let value = 0;

		for (let i = 0; i < count; i++) {
			const code = this.#current();

			if (!isHexDigit(code)) {
				this.#pos = start;
				return false;
			}

			value = value * 16 + hexValue(code);
			this.#advance();
		}

		this.#lastValue = value;
		return true;
	}
}
