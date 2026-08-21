/**
 * @fileoverview Tests for the regular expression pattern grammar.
 *
 * Going through `parse()` and `validate()` would work, but the interesting
 * cases here are all inside one literal and there are hundreds of them, so
 * they go straight at the module. The integration side — that a bad pattern
 * is reported at all, and where — is in `tests/test262.test.ts`.
 *
 * Every case in the two big tables was checked against `espree` before it was
 * written down, so a disagreement here is a disagreement with `acorn`.
 */

import { describe, expect, it } from "vitest";
import { RegExpValidator } from "./regexp.js";

const validator = new RegExpValidator();

/**
 * Checks one pattern, as if it had been written as a literal.
 * @param pattern The pattern, without the slashes.
 * @param flags The flags, if any.
 * @returns The problem's message, or `null` when the pattern is valid.
 */
function check(pattern: string, flags = ""): string | null {
	const source = `/${pattern}/${flags}`;
	const problem = validator.validate(
		source,
		0,
		pattern.length + 1,
		source.length,
	);

	return problem === null ? null : problem.message;
}

/**
 * Declares one `it()` per pattern, asserting all of them are accepted.
 * @param cases The patterns and their flags.
 * @returns Nothing.
 */
function accepts(cases: [string, string?][]): void {
	for (const [pattern, flags = ""] of cases) {
		it(`accepts /${pattern}/${flags}`, () => {
			expect(check(pattern, flags)).toBeNull();
		});
	}
}

/**
 * Declares one `it()` per pattern, asserting all of them are rejected.
 * @param cases The patterns, their flags, and the message expected.
 * @returns Nothing.
 */
function rejects(cases: [string, string, string][]): void {
	for (const [pattern, flags, message] of cases) {
		it(`rejects /${pattern}/${flags}`, () => {
			expect(check(pattern, flags)).toBe(message);
		});
	}
}

describe("RegExpValidator", () => {
	describe("flags", () => {
		accepts([
			["a"],
			["a", "d"],
			["a", "g"],
			["a", "i"],
			["a", "m"],
			["a", "s"],
			["a", "u"],
			["a", "v"],
			["a", "y"],
			["a", "dgimsy"],
		]);

		rejects([
			["a", "q", "Invalid regular expression flag."],
			["a", "gG", "Invalid regular expression flag."],
			["a", "gg", "Duplicate regular expression flag."],
			["a", "uu", "Duplicate regular expression flag."],
			["a", "gug", "Duplicate regular expression flag."],
			["a", "uv", "The 'u' and 'v' flags are mutually exclusive."],
		]);
	});

	describe("quantifiers", () => {
		accepts([
			["a*"],
			["a+"],
			["a?"],
			["a+?"],
			["a{2}"],
			["a{2,}"],
			["a{2,3}"],
			["a{2,3}?"],

			// Without `u`, a brace that opens no quantifier is a brace.
			["a{"],
			["a{2"],
			["a{2,"],
			["a{2}x"],
		]);

		rejects([
			["a{3,2}", "", "Numbers out of order in {} quantifier."],
			["a{3,2}", "u", "Numbers out of order in {} quantifier."],
			["a{", "u", "Incomplete quantifier."],
			["a{2", "u", "Incomplete quantifier."],
			["*", "", "Nothing to repeat."],
			["+", "", "Nothing to repeat."],
			["?", "", "Nothing to repeat."],
			["{2}", "", "Nothing to repeat."],
			["{2}", "u", "Nothing to repeat."],
			["{2}x", "", "Nothing to repeat."],
			["a**", "", "Nothing to repeat."],
		]);
	});

	describe("assertions", () => {
		accepts([
			["^a$"],
			["\\ba\\B"],
			["(?=a)"],
			["(?!a)"],
			["(?<=a)"],
			["(?<!a)"],

			// Annex B lets a lookahead — and only a lookahead — be quantified.
			["(?=a)*"],
			["(?!a)+"],
		]);

		rejects([
			["(?=a)*", "u", "Invalid quantifier."],
			["(?<=a)*", "", "Nothing to repeat."],
			["(?<!a)*", "u", "Nothing to repeat."],
			["(?=a", "", "Unterminated group."],
		]);
	});

	describe("groups", () => {
		accepts([
			["(a)"],
			["(?:a)"],
			["(?<n>a)"],
			["(?<n>a)", "u"],
			["(?<$_>a)"],
			["(?<\\u0041>a)"],
			["(?<\\u{41}>a)"],

			// A group name may hold a joiner, which no other identifier may.
			["(?<a\\u200c>x)"],

			/*
			 * Two groups may share a name when they are alternatives, since
			 * only one of them can take part in any single match.
			 */
			["(?<n>a)|(?<n>b)"],
			["((?<n>a)|(?<n>b))"],
			["(?:(?<n>a))|(?<n>b)"],
		]);

		rejects([
			["(a", "", "Unterminated group."],
			["a)", "", "Unmatched ')'."],
			["(?)", "", "Invalid group."],
			["(?<>a)", "", "Invalid capture group name."],
			["(?<1n>a)", "", "Invalid capture group name."],
			["(?<n->a)", "", "Invalid capture group name."],
			["(?<n>a)(?<n>b)", "", "Duplicate capture group name."],
			["((?<n>a)|(?<n>b))(?<n>c)", "", "Duplicate capture group name."],
		]);
	});

	describe("backreferences", () => {
		accepts([
			["(a)\\1"],

			// A reference may run ahead of the group it names.
			["\\1(a)"],
			["\\1(a)", "u"],
			["(a)(b)(c)\\3"],
			["(?<n>a)\\k<n>"],
			["\\k<n>(?<n>a)"],

			/*
			 * With no group name anywhere, the goal symbol is the one where
			 * `\k` is an identity escape and `\8` is the digit — which is why
			 * neither of these is a reference at all.
			 */
			["\\k<n>"],
			["\\k"],
			["\\8"],
			["\\9"],
		]);

		rejects([
			["\\1", "u", "Invalid backreference."],
			["\\2(a)", "u", "Invalid backreference."],
			["\\8", "u", "Invalid backreference."],
			["\\k", "u", "Invalid named reference."],
			["\\k<n>", "u", "Invalid named capture referenced."],

			/*
			 * One group name switches the whole pattern to the other goal
			 * symbol, so the `\k<m>` that would have been three characters
			 * becomes a reference to a group that is not there.
			 */
			["\\k<m>(?<n>a)", "", "Invalid named capture referenced."],
		]);
	});

	describe("escapes", () => {
		accepts([
			["\\t\\n\\v\\f\\r"],
			["\\cA"],
			["\\cz"],
			["\\0"],
			["\\0", "u"],
			["\\x41"],
			["\\u0041"],
			["\\u{41}", "u"],
			["\\u{10ffff}", "u"],
			["\\ud83d\\ude00", "u"],
			["\\$", "u"],
			["\\/", "u"],

			// Without `u`, a backslash in front of anything is that thing.
			["\\a"],
			["\\c1"],
			["\\00"],
			["\\x4"],
			["\\u004"],
			["\\p"],
			["\\-"],

			// `\u{41}` without `u` is the letter `u` repeated 65 times.
			["\\u{41}"],
		]);

		rejects([
			["\\a", "u", "Invalid escape."],
			["\\-", "u", "Invalid escape."],
			["\\x4", "u", "Invalid escape."],
			["\\00", "u", "Invalid escape."],
			["\\u004", "u", "Invalid unicode escape."],
			["\\u{110000}", "u", "Invalid unicode escape."],
			["\\c1", "u", "Invalid unicode escape."],
			["\\p", "u", "Invalid property name."],
		]);
	});

	describe("property escapes", () => {
		accepts([
			["\\p{Lu}", "u"],
			["\\p{Letter}", "u"],
			["\\P{Lu}", "u"],
			["\\p{General_Category=Letter}", "u"],
			["\\p{gc=Lu}", "u"],
			["\\p{Script=Greek}", "u"],
			["\\p{sc=Grek}", "u"],
			["\\p{Script_Extensions=Greek}", "u"],
			["\\p{scx=Grek}", "u"],
			["\\p{Alphabetic}", "u"],
			["\\p{Alpha}", "u"],
			["\\p{Any}", "u"],
			["\\p{ASCII}", "u"],
			["\\p{Assigned}", "u"],

			// A property of strings, which only `v` has and only unnegated.
			["\\p{RGI_Emoji}", "v"],
			["\\p{Basic_Emoji}", "v"],
		]);

		rejects([
			["\\p{Nope}", "u", "Invalid property name."],
			["\\p{Nope=Lu}", "u", "Invalid property name."],
			["\\p{Lu=x}", "u", "Invalid property name."],
			["\\p{}", "u", "Invalid property name."],
			["\\p{Lu", "u", "Invalid property name."],
			["\\pLu", "u", "Invalid property name."],
			["\\p{Script=Nope}", "u", "Invalid property value."],

			// A property of strings is not a property outside `v`.
			["\\p{RGI_Emoji}", "u", "Invalid property name."],

			// A set of strings has no complement.
			["\\P{RGI_Emoji}", "v", "Invalid property name."],
		]);
	});

	describe("character classes", () => {
		accepts([
			["[a-z]"],
			["[a-]"],
			["[-a]"],
			["[]"],
			["[^]"],
			["[\\b]"],
			["[\\d]"],
			["[a-b-c]"],
			["[\\u0041-\\u005a]"],
			["[\\-]", "u"],

			// Annex B keeps these, reading the dash as an ordinary character.
			["[\\d-a]"],
			["[a-\\d]"],
			["[\\c1]"],
			["[\\c_]"],

			// `]` and `}` alone are characters until `u` says otherwise.
			["]"],
			["}"],
		]);

		rejects([
			["[z-a]", "", "Range out of order in character class."],
			["[z-a]", "u", "Range out of order in character class."],
			["[\\d-a]", "u", "Invalid character class."],
			["[a-\\d]", "u", "Invalid character class."],
			["[a", "", "Unterminated character class."],
			["[\\c1]", "u", "Invalid class escape."],
			["[\\a]", "u", "Invalid escape."],
			["]", "u", "Lone quantifier brackets."],
			["}", "u", "Lone quantifier brackets."],
			["{", "u", "Lone quantifier brackets."],
		]);
	});

	describe("set expressions under v", () => {
		accepts([
			["[a]", "v"],
			["[[a]]", "v"],
			["[[a]--[b]]", "v"],
			["[[a]&&[b]]", "v"],
			["[\\w--\\d]", "v"],
			["[a--b--c]", "v"],
			["[a&&b&&c]", "v"],
			["[\\q{abc}]", "v"],
			["[\\q{a|bc}]", "v"],
			["[\\q{}]", "v"],
			["[^\\q{a}]", "v"],
			["[\\p{RGI_Emoji}]", "v"],

			/*
			 * The syntax characters, escaped, which is the only way `v` mode
			 * takes them. `|` is one of them, which surprises: `[|]` is an
			 * ordinary class everywhere else and an error here.
			 */
			["[\\(]", "v"],
			["[\\[]", "v"],
			["[\\|]", "v"],
			["[\\!]", "v"],
			["[\\~]", "v"],
			["[a&b]", "v"],
		]);

		rejects([
			// The three operators are exclusive; mixing two is not a nesting.
			["[a&&b--c]", "v", "Unterminated character class."],
			["[a--b&&c]", "v", "Unterminated character class."],

			// Reserved so that they can be given a meaning later.
			["[a^^b]", "v", "Unterminated character class."],
			["[a~~b]", "v", "Unterminated character class."],
			["[a!!b]", "v", "Unterminated character class."],

			// A syntax character has to be escaped in `v` mode.
			["[(]", "v", "Invalid character in character class."],
			["[)]", "v", "Invalid character in character class."],
			["[{]", "v", "Invalid character in character class."],
			["[|]", "v", "Invalid character in character class."],
			["[[]", "v", "Unterminated character class."],
			["[&&]", "v", "Invalid character in character class."],

			// Negating anything that can match a sequence.
			["[^\\q{ab}]", "v", "Negated character class may contain strings."],
			[
				"[^\\q{a|bc}]",
				"v",
				"Negated character class may contain strings.",
			],
			[
				"[^\\p{RGI_Emoji}]",
				"v",
				"Negated character class may contain strings.",
			],

			// `\q` is only ever the opener of a string disjunction.
			["\\q{a}", "v", "Invalid escape."],
			["[\\q]", "v", "Invalid escape."],
		]);
	});

	describe("modifiers", () => {
		accepts([
			["(?i:a)"],
			["(?m:a)"],
			["(?s:a)"],
			["(?ims:a)"],
			["(?-i:a)"],
			["(?i-m:a)"],
			["(?-ims:a)"],
			["(?i:a)", "u"],
		]);

		rejects([
			["(?ii:a)", "", "Duplicate regular expression modifiers."],
			["(?i-i:a)", "", "Duplicate regular expression modifiers."],
			["(?i-mm:a)", "", "Duplicate regular expression modifiers."],
			["(?-:a)", "", "Invalid regular expression modifiers."],

			// Not a modifier, so not a group either.
			["(?x:a)", "", "Invalid group."],
		]);
	});

	describe("problem positions", () => {
		it("points at the flag that is wrong", () => {
			const source = "/a/gq";

			expect(validator.validate(source, 0, 2, 5)).toEqual({
				message: "Invalid regular expression flag.",
				start: 4,
			});
		});

		it("points at the second of two group names", () => {
			const source = "/(?<n>a)(?<n>b)/";

			expect(validator.validate(source, 0, 15, 16)).toEqual({
				message: "Duplicate capture group name.",
				start: 10,
			});
		});

		it("points at the reference, not the end of the pattern", () => {
			const source = "/\\k<m>(?<n>a)/";

			expect(validator.validate(source, 0, 13, 14)).toEqual({
				message: "Invalid named capture referenced.",
				start: 2,
			});
		});

		it("is offset by where the literal starts", () => {
			const source = "let x = 1; /a{3,2}/;";
			const problem = validator.validate(source, 11, 18, 18);

			expect(problem?.message).toBe(
				"Numbers out of order in {} quantifier.",
			);
			expect(source.slice(11, problem!.start)).toBe("/a{3,2}");
		});
	});

	describe("the v flag's class set grammar", () => {
		accepts([
			// Nested classes, unions, and the two set operators.
			["[[a][b]]", "v"],
			["[[a]&&[b]]", "v"],
			["[[a]&&\\d]", "v"],
			["[a&&b&&c]", "v"],
			["[[a]--[b]]", "v"],
			["[a--b]", "v"],
			["[\\d--\\w]", "v"],
			["[\\p{ASCII}--\\p{Letter}]", "v"],
			["[^[a]]", "v"],

			// String literals, and the one-character case that is not a string.
			["[\\q{ab}]", "v"],
			["[\\q{ab|cd}]", "v"],
			["[\\q{}]", "v"],
			["[^\\q{a}]", "v"],
			["[\\q{a}--\\q{b}]", "v"],

			// `\\b` means a backspace inside a class, in both modes.
			["[\\b]", "v"],
			["[\\b]", ""],
		]);

		rejects([
			["[^\\q{ab}]", "v", "Negated character class may contain strings."],
			[
				"[[^\\q{ab}]]",
				"v",
				"Negated character class may contain strings.",
			],
			["[z-a]", "v", "Range out of order in character class."],
			["[&&]", "v", "Invalid character in character class."],
			["[a&&]", "v", "Invalid character in character class."],
			["[[a]&&&]", "v", "Invalid character in character class."],
			["[--]", "v", "Invalid character in character class."],
			["[a---b]", "v", "Invalid character in character class."],
			["[\\z]", "v", "Invalid character in character class."],
			["[[]", "v", "Unterminated character class."],
		]);
	});

	describe("code points above the basic plane", () => {
		accepts([
			// A surrogate pair is one code point under `u`, written either way.
			["\\u{1F600}", "u"],
			["\\uD83D\\uDE00", "u"],
			["😀", "u"],
			["[😀]", "u"],
			["[\\u{1F600}-\\u{1F601}]", "u"],
			["[😀-😁]", "u"],

			// A lead surrogate with nothing after it stays a lone code unit.
			["\\uD800", "u"],
			["\\uD800a", "u"],

			// A non-ASCII group name, which needs the same code point reading.
			["(?<é>a)\\k<é>", "u"],
			["(?<\\u{10400}>a)\\\\k<\\u{10400}>", "u"],
		]);
	});

	describe("unterminated constructs", () => {
		rejects([
			["(a", "", "Unterminated group."],
			["(?:a", "", "Unterminated group."],
			["(?<n>a", "", "Unterminated group."],
		]);
	});

	describe("Annex B escapes outside unicode mode", () => {
		accepts([
			// Legacy octal escapes, one to three digits.
			["\\1", ""],
			["\\12", ""],
			["\\123", ""],
			["\\0", ""],
			["[\\123]", ""],
		]);
	});

	describe("reuse", () => {
		it("does not carry state from one pattern to the next", () => {
			expect(check("(?<n>a)")).toBeNull();
			expect(check("\\k<n>")).toBeNull();
			expect(check("(?<n>a)\\k<n>")).toBeNull();
			expect(check("(?<n>a)(?<n>b)")).toBe(
				"Duplicate capture group name.",
			);
			expect(check("(?<n>a)")).toBeNull();
		});
	});
});
