/**
 * @fileoverview Unit tests for the token kind tables.
 *
 * The tokenizer reaches `lookupKeyword()` on every identifier it scans, so
 * that path is well covered by everything else. `describeKind()` is the one
 * the corpus barely touches: it only runs when a parse fails, and the message
 * it produces is what a caller reads.
 */

import { describe, expect, it } from "vitest";
import {
	ASSIGN_FIRST,
	ASSIGN_LAST,
	describeKind,
	hashChar,
	isAssignmentKind,
	isIdentifierNameKind,
	lookupKeyword,
	T_ASSIGN,
	T_ASSIGN_PLUS,
	T_ASSIGN_QQ,
	T_BIGINT,
	T_BRACE_OPEN,
	T_EOF,
	T_IDENT,
	T_NUMBER,
	T_PLUS,
	T_PRIVATE_IDENT,
	T_REGEXP,
	T_STRING,
	T_TEMPLATE_FULL,
	T_TEMPLATE_HEAD,
	T_await,
	T_class,
	T_intrinsic,
} from "./token-kinds.js";

/**
 * Looks a whole word up in the keyword table.
 * @param text The word to look up.
 * @returns The keyword kind, or `T_IDENT`.
 */
function keyword(text: string): number {
	let hash = 0;

	for (let i = 0; i < text.length; i++) {
		hash = hashChar(hash, text.charCodeAt(i));
	}

	return lookupKeyword(text, 0, text.length, hash);
}

describe("lookupKeyword()", () => {
	it("finds a keyword", () => {
		expect(keyword("class")).toBe(T_class);
		expect(keyword("await")).toBe(T_await);
		expect(keyword("intrinsic")).toBe(T_intrinsic);
	});

	it("rejects a word that is not one", () => {
		expect(keyword("classy")).toBe(T_IDENT);
		expect(keyword("clasx")).toBe(T_IDENT);
	});

	it("rejects a word too short or too long to be one", () => {
		expect(keyword("a")).toBe(T_IDENT);
		expect(keyword("abcdefghijk")).toBe(T_IDENT);
	});

	it("reads the word out of a larger text", () => {
		const source = "xxclassxx";
		let hash = 0;

		for (let i = 2; i < 7; i++) {
			hash = hashChar(hash, source.charCodeAt(i));
		}

		expect(lookupKeyword(source, 2, 7, hash)).toBe(T_class);
	});
});

describe("describeKind()", () => {
	it("names a punctuator and a keyword by their spelling", () => {
		expect(describeKind(T_BRACE_OPEN)).toBe("{");
		expect(describeKind(T_PLUS)).toBe("+");
		expect(describeKind(T_class)).toBe("class");
	});

	it("describes every token kind that has no fixed spelling", () => {
		expect(describeKind(T_EOF)).toBe("end of input");
		expect(describeKind(T_IDENT)).toBe("identifier");
		expect(describeKind(T_PRIVATE_IDENT)).toBe("private identifier");
		expect(describeKind(T_NUMBER)).toBe("number");
		expect(describeKind(T_BIGINT)).toBe("number");
		expect(describeKind(T_STRING)).toBe("string");
		expect(describeKind(T_REGEXP)).toBe("regular expression");
		expect(describeKind(T_TEMPLATE_FULL)).toBe("template");
		expect(describeKind(T_TEMPLATE_HEAD)).toBe("template");
	});
});

describe("isAssignmentKind()", () => {
	it("accepts `=` and every compound assignment", () => {
		for (let kind = ASSIGN_FIRST; kind <= ASSIGN_LAST; kind++) {
			expect(isAssignmentKind(kind)).toBe(true);
		}

		expect(isAssignmentKind(T_ASSIGN)).toBe(true);
		expect(isAssignmentKind(T_ASSIGN_PLUS)).toBe(true);
		expect(isAssignmentKind(T_ASSIGN_QQ)).toBe(true);
	});

	it("rejects everything else", () => {
		expect(isAssignmentKind(T_PLUS)).toBe(false);
		expect(isAssignmentKind(T_IDENT)).toBe(false);
	});
});

describe("isIdentifierNameKind()", () => {
	it("accepts an identifier and every reserved word", () => {
		expect(isIdentifierNameKind(T_IDENT)).toBe(true);
		expect(isIdentifierNameKind(T_class)).toBe(true);
		expect(isIdentifierNameKind(T_await)).toBe(true);
		expect(isIdentifierNameKind(T_intrinsic)).toBe(true);
	});

	it("rejects a punctuator and a literal", () => {
		expect(isIdentifierNameKind(T_BRACE_OPEN)).toBe(false);
		expect(isIdentifierNameKind(T_NUMBER)).toBe(false);
		expect(isIdentifierNameKind(T_PRIVATE_IDENT)).toBe(false);
	});
});
