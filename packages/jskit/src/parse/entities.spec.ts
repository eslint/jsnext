/**
 * @fileoverview Unit tests for JSX entity decoding.
 */

import { describe, expect, it } from "vitest";
import { decodeEntities } from "./entities.js";

describe("decodeEntities()", () => {
	it("returns text without an ampersand unchanged", () => {
		expect(decodeEntities("plain text")).toBe("plain text");
	});

	it("returns the same string instance when there is nothing to decode", () => {
		const raw = "plain text";

		expect(decodeEntities(raw)).toBe(raw);
	});

	it("decodes a named reference", () => {
		expect(decodeEntities("&amp;")).toBe("&");
		expect(decodeEntities("&lt;&gt;")).toBe("<>");
		expect(decodeEntities("&quot;&apos;")).toBe("\"'");
	});

	it("decodes a named reference from outside Latin-1", () => {
		expect(decodeEntities("&mdash;")).toBe("—");
		expect(decodeEntities("&hearts;")).toBe("♥");
	});

	it("decodes a decimal reference", () => {
		expect(decodeEntities("&#65;")).toBe("A");
		expect(decodeEntities("&#0065;")).toBe("A");
	});

	it("decodes a hexadecimal reference in either case", () => {
		expect(decodeEntities("&#x42;")).toBe("B");
		expect(decodeEntities("&#X42;")).toBe("B");
		expect(decodeEntities("&#xAb;")).toBe("«");
	});

	it("decodes a reference above the basic multilingual plane", () => {
		expect(decodeEntities("&#x1F600;")).toBe("\u{1f600}");
		expect(decodeEntities("&#128512;")).toBe("\u{1f600}");
	});

	it("keeps a numeric reference beyond the last code point as written", () => {
		expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
	});

	it("keeps an unknown named reference as written", () => {
		expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
	});

	it("keeps an unterminated reference as written", () => {
		expect(decodeEntities("&amp")).toBe("&amp");
		expect(decodeEntities("a & b")).toBe("a & b");
	});

	it("keeps a numeric reference with a non-digit as written", () => {
		expect(decodeEntities("&#12ab;")).toBe("&#12ab;");
		expect(decodeEntities("&#xzz;")).toBe("&#xzz;");
	});

	it("decodes every reference in a run of text", () => {
		expect(decodeEntities("a &amp; b &#65; c &#x42; d")).toBe(
			"a & b A c B d",
		);
	});

	it("keeps the text around a reference it could not decode", () => {
		expect(decodeEntities("one &bogus; two &amp; three")).toBe(
			"one &bogus; two & three",
		);
	});

	it("resumes scanning after a false start", () => {
		expect(decodeEntities("&& &amp;")).toBe("&& &");
	});

	it("decodes a reference whose body is an ampersand away", () => {
		expect(decodeEntities("&&amp;")).toBe("&&");
	});
});
