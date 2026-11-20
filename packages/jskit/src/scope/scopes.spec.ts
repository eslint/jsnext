/**
 * @fileoverview Unit tests for the `Scopes` queries that read a symbol's
 * definition-type bits rather than its definition list.
 *
 * `tests/scope/binding-origins.test.ts` covers `getBindingOrigins()` the way
 * a consumer reaches it, by node. This file covers the ID-level methods
 * beneath it — `symbolOrigins()`, `referenceOrigins()`,
 * `symbolHasDefinitions()`, `resolveReference()` — and holds each to the
 * answer the definition list itself gives.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../parse/index.js";
import { analyze } from "./index.js";
import type { AnalyzeOptions } from "./options.js";
import {
	BINDING_ORIGIN_ARGUMENTS,
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_FUNCTION_NAME,
	BINDING_ORIGIN_IMPLICIT_GLOBAL,
	BINDING_ORIGIN_UNRESOLVED,
	BINDING_ORIGIN_VARIABLE,
	codeOfDefinitionType,
	VF_DEFINITION_SHIFT,
} from "./scope-buffer.js";
import { ScopeBufferReader } from "./scope-buffer-reader.js";
import { Scopes } from "./scopes.js";

interface Analyzed {
	scopes: Scopes;
	reader: ScopeBufferReader;
}

/**
 * Parses and analyzes one program on the binary path.
 * @param code The source text.
 * @param options The analysis options; `sourceType` also picks the parse.
 * @returns The `Scopes` view and a reader over the same buffer.
 */
function analyzed(code: string, options: AnalyzeOptions = {}): Analyzed {
	const sourceType = options.sourceType ?? "module";
	const parsed = parse(code, { sourceType });
	const buffer = analyze(parsed, { ...options, sourceType });

	return {
		scopes: new Scopes(buffer, parsed),
		reader: new ScopeBufferReader(buffer),
	};
}

/**
 * Every reference to a name, in recording order.
 * @param analysis The analyzed program.
 * @param name The name.
 * @returns The reference IDs.
 */
function referencesNamed({ scopes, reader }: Analyzed, name: string): number[] {
	const refs: number[] = [];

	for (let ref = 0; ref < reader.referenceCount; ref++) {
		if (scopes.referenceName(ref) === name) {
			refs.push(ref);
		}
	}

	return refs;
}

describe("Scopes#symbolOrigins()", () => {
	it("answers the union of the symbol's definition types", () => {
		const analysis = analyzed(
			"import d from 'm'; var v; function f(p) { var p; } class K {} var f;",
			{ sourceType: "script" },
		);
		const { scopes, reader } = analysis;

		for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
			const types = scopes.symbolDefinitionTypes(symbol);
			const expected = types.reduce(
				(bits, type) =>
					bits |
					(1 << (VF_DEFINITION_SHIFT + codeOfDefinitionType(type))),
				0,
			);

			if (types.length > 0) {
				expect(
					scopes.symbolOrigins(symbol),
					scopes.symbolName(symbol),
				).toBe(expected);
			}
		}

		const f = scopes.getOwnSymbolByName(scopes.globalScope, "f")!;

		expect(scopes.symbolOrigins(f)).toBe(
			BINDING_ORIGIN_VARIABLE | BINDING_ORIGIN_FUNCTION_NAME,
		);
	});

	it("answers CONFIGURED_GLOBAL for a global-scope symbol with no definitions", () => {
		const { scopes } = analyzed("Promise;", { globals: ["Promise"] });

		expect(scopes.symbolOrigins(scopes.globalSymbol("Promise")!)).toBe(
			BINDING_ORIGIN_CONFIGURED_GLOBAL,
		);
	});

	it("answers with the declaration for a configured global the file declares", () => {
		const { scopes } = analyzed("var Promise;", {
			sourceType: "script",
			globals: ["Promise"],
		});

		expect(scopes.symbolOrigins(scopes.globalSymbol("Promise")!)).toBe(
			BINDING_ORIGIN_VARIABLE,
		);
	});

	it("answers ARGUMENTS for a function's arguments symbol", () => {
		const analysis = analyzed("function f() { arguments; }");
		const [ref] = referencesNamed(analysis, "arguments");
		const symbol = analysis.scopes.referenceResolved(ref)!;

		expect(analysis.scopes.symbolOrigins(symbol)).toBe(
			BINDING_ORIGIN_ARGUMENTS,
		);
	});
});

describe("Scopes#referenceOrigins()", () => {
	it("follows a resolved reference to its symbol", () => {
		const analysis = analyzed("var v; v;", { sourceType: "script" });

		for (const ref of referencesNamed(analysis, "v")) {
			expect(analysis.scopes.referenceOrigins(ref)).toBe(
				BINDING_ORIGIN_VARIABLE,
			);
		}
	});

	it("answers IMPLICIT_GLOBAL for every reference to a sloppy-mode creation", () => {
		const analysis = analyzed("x; x = 1; x; y;", { sourceType: "script" });
		const xs = referencesNamed(analysis, "x");

		expect(xs).toHaveLength(3);

		for (const ref of xs) {
			expect(analysis.scopes.referenceOrigins(ref)).toBe(
				BINDING_ORIGIN_IMPLICIT_GLOBAL,
			);
		}

		expect(
			analysis.scopes.referenceOrigins(referencesNamed(analysis, "y")[0]),
		).toBe(BINDING_ORIGIN_UNRESOLVED);
	});

	it("answers UNRESOLVED when there is no implicit list to search", () => {
		const analysis = analyzed("x = 1; x;");

		for (const ref of referencesNamed(analysis, "x")) {
			expect(analysis.scopes.referenceOrigins(ref)).toBe(
				BINDING_ORIGIN_UNRESOLVED,
			);
		}
	});
});

describe("Scopes#symbolHasDefinitions()", () => {
	it("agrees with the definition list for every symbol", () => {
		const { scopes, reader } = analyzed(
			"x = 1; var v; function f(p) { arguments; }",
			{ sourceType: "script", globals: ["Promise"] },
		);

		for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
			expect(scopes.symbolHasDefinitions(symbol)).toBe(
				scopes.symbolDefinitionTypes(symbol).length > 0,
			);
		}
	});
});

describe("Scopes#resolveReference()", () => {
	it("returns the reference recorded at each identifier", () => {
		const { scopes, reader } = analyzed(
			"let a = 1; a += 2; f(a, missing);",
		);

		expect(reader.referenceCount).toBeGreaterThan(4);

		for (let ref = 0; ref < reader.referenceCount; ref++) {
			expect(
				scopes.resolveReference(scopes.referenceIdentifier(ref)),
			).toBe(ref);
		}
	});

	it("returns null for an identifier that is not a reference", () => {
		const code = "const o = {}; o.prop;";
		const { scopes } = analyzed(code);

		expect(
			scopes.resolveReference({
				type: "Identifier",
				start: code.indexOf("prop"),
			}),
		).toBe(null);
	});
});
