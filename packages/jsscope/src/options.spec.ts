/**
 * @fileoverview Unit tests for option resolution.
 */

import { describe, expect, it } from "vitest";
import { resolveOptions } from "./options.js";

describe("resolveOptions()", () => {
	it("fills in every default when given nothing", () => {
		expect(resolveOptions()).toEqual({
			sourceType: "module",
			dialect: "ts",
			jsx: true,
			impliedStrict: false,
			globalReturn: false,
			ignoreEval: false,
			globals: null,
			jsxPragma: null,
			jsxFragmentName: null,
		});
	});

	it("fills in every default when given an empty object", () => {
		expect(resolveOptions({})).toEqual(resolveOptions());
	});

	it("defaults the JSX names to what eslint-scope reports", () => {
		const resolved = resolveOptions();

		expect(resolved.jsxPragma).toBeNull();
		expect(resolved.jsxFragmentName).toBeNull();
	});

	it("keeps what the caller supplied", () => {
		expect(
			resolveOptions({
				sourceType: "script",
				dialect: "js",
				jsx: false,
				impliedStrict: true,
				globalReturn: true,
				ignoreEval: true,
				jsxPragma: "React",
				jsxFragmentName: "Fragment",
			}),
		).toEqual({
			sourceType: "script",
			dialect: "js",
			jsx: false,
			impliedStrict: true,
			globalReturn: true,
			ignoreEval: true,
			globals: null,
			jsxPragma: "React",
			jsxFragmentName: "Fragment",
		});
	});

	it("keeps a false that would otherwise look like an absent option", () => {
		expect(resolveOptions({ jsx: false }).jsx).toBe(false);
	});

	it("keeps the globals iterable as it was given", () => {
		const globals = ["window", "document"];

		expect(resolveOptions({ globals }).globals).toBe(globals);
	});

	it("accepts a Set of globals", () => {
		const globals = new Set(["window"]);

		expect(resolveOptions({ globals }).globals).toBe(globals);
	});

	it("does not read from the object it was given after resolving", () => {
		const options = { sourceType: "script" as const };
		const resolved = resolveOptions(options);

		options.sourceType = "module" as never;

		expect(resolved.sourceType).toBe("script");
	});
});
