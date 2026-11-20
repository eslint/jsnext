/**
 * @fileoverview Unit tests for what the scope builder writes into a symbol's
 * flags word.
 *
 * The builder keeps working bits in the same word while the graph is built
 * and serializes only the `VF_*` subset, so this file pins both halves: the
 * definition-type bits it records as each definition is added, and the
 * working bits it must never let through.
 */

import { describe, expect, it } from "vitest";
import { parse, toAST } from "../parse/index.js";
import { analyze, analyzeTree } from "./index.js";
import {
	codeOfDefinitionType,
	D_TYPE,
	V_FLAGS,
	VF_DEFINITION_MASK,
	VF_DEFINITION_SHIFT,
	VF_IMPLICIT_GLOBAL,
	VF_STACK,
	VF_TAINTED,
	V_DEFINITIONS,
	V_NAME,
	V_SCOPE,
} from "./scope-buffer.js";
import { ScopeBufferReader } from "./scope-buffer-reader.js";
import type { EsTreeNode } from "./estree-ast.js";
import type { AnalyzeOptions } from "./options.js";

/**
 * Parses and analyzes one program on the binary path.
 * @param code The source text.
 * @param options The analysis options; `sourceType` also picks the parse.
 * @returns The reader over the scope buffer.
 */
function readerFor(
	code: string,
	options: AnalyzeOptions = {},
): ScopeBufferReader {
	const sourceType = options.sourceType ?? "module";

	return new ScopeBufferReader(
		analyze(parse(code, { sourceType }), { ...options, sourceType }),
	);
}

/**
 * The definition-type bits a symbol's definition list implies.
 * @param reader The reader over the buffer.
 * @param symbol The symbol ID.
 * @returns One bit per distinct definition type, at the format's positions.
 */
function bitsFromDefinitions(
	reader: ScopeBufferReader,
	symbol: number,
): number {
	let bits = 0;

	for (const definition of reader.listItems(
		reader.symbolField(symbol, V_DEFINITIONS),
	)) {
		bits |=
			1 <<
			(VF_DEFINITION_SHIFT + reader.definitionField(definition, D_TYPE));
	}

	return bits;
}

/**
 * Finds a symbol by name.
 * @param reader The reader over the buffer.
 * @param name The name.
 * @returns The first symbol with that name.
 */
function symbolNamed(reader: ScopeBufferReader, name: string): number {
	for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
		if (reader.string(reader.symbolField(symbol, V_NAME)) === name) {
			return symbol;
		}
	}

	throw new Error(`no symbol named ${name}`);
}

const PROGRAMS: [string, AnalyzeOptions][] = [
	[
		"import d, { n } from 'm'; var v; let l; const c = 1; function f(p, { q }) { var p; arguments; } class K {} try {} catch (e) {}",
		{},
	],
	[
		"var f; function f() {} function g() {} var g = 1;",
		{ sourceType: "script" },
	],
	[
		"type T = 1; interface I {} enum E { A, B = A } namespace N {} function o(): void; function o() {}",
		{},
	],
	["x = 1; Promise;", { sourceType: "script", globals: ["Promise"] }],
	["(function h() { h; }); (class J { m() { J; } });", {}],
];

describe("ScopeBuilder symbol flags", () => {
	it.each(PROGRAMS)(
		"records exactly the definition types of each symbol: %s",
		(code, options) => {
			const reader = readerFor(code, options);

			expect(reader.symbolCount).toBeGreaterThan(1);

			for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
				expect(
					reader.symbolField(symbol, V_FLAGS) & VF_DEFINITION_MASK,
					reader.string(reader.symbolField(symbol, V_NAME)),
				).toBe(bitsFromDefinitions(reader, symbol));
			}
		},
	);

	it.each(PROGRAMS)(
		"serializes no working bits outside the VF_* set: %s",
		(code, options) => {
			const reader = readerFor(code, options);
			const serialized =
				VF_TAINTED | VF_STACK | VF_IMPLICIT_GLOBAL | VF_DEFINITION_MASK;

			for (let symbol = 0; symbol < reader.symbolCount; symbol++) {
				expect(reader.symbolField(symbol, V_FLAGS) & ~serialized).toBe(
					0,
				);
			}
		},
	);

	it("sets one bit per kind on a name declared more than once", () => {
		const reader = readerFor("var f; function f() {} var f;", {
			sourceType: "script",
		});
		const flags = reader.symbolField(symbolNamed(reader, "f"), V_FLAGS);

		expect(flags & VF_DEFINITION_MASK).toBe(
			(1 << (VF_DEFINITION_SHIFT + codeOfDefinitionType("Variable"))) |
				(1 <<
					(VF_DEFINITION_SHIFT +
						codeOfDefinitionType("FunctionName"))),
		);
	});

	it("marks an implicit global with its own definition type", () => {
		const reader = readerFor("x = 1;", { sourceType: "script" });
		const flags = reader.symbolField(symbolNamed(reader, "x"), V_FLAGS);

		expect(flags & VF_IMPLICIT_GLOBAL).toBe(VF_IMPLICIT_GLOBAL);
		expect(flags & VF_DEFINITION_MASK).toBe(
			1 <<
				(VF_DEFINITION_SHIFT +
					codeOfDefinitionType("ImplicitGlobalVariable")),
		);
	});

	it("leaves the bits clear on symbols nothing in code declares", () => {
		const reader = readerFor("Promise; function f() { arguments; }", {
			globals: ["Promise"],
		});
		const promise = symbolNamed(reader, "Promise");
		const args = symbolNamed(reader, "arguments");

		expect(reader.symbolField(promise, V_SCOPE)).toBe(0);
		expect(reader.symbolField(promise, V_FLAGS) & VF_DEFINITION_MASK).toBe(
			0,
		);
		expect(reader.symbolField(args, V_SCOPE)).not.toBe(0);
		expect(reader.symbolField(args, V_FLAGS) & VF_DEFINITION_MASK).toBe(0);
	});

	it("writes the same flags on the tree path", () => {
		const code =
			"import d from 'm'; function o() { var f; function f(p) { var p; arguments; } } class K {} try {} catch (e) {}";
		const binary = readerFor(code);
		const tree = new ScopeBufferReader(
			analyzeTree(
				toAST(
					parse(code, { sourceType: "module" }),
				) as unknown as EsTreeNode,
				{ sourceType: "module" },
			),
		);

		expect(tree.symbolCount).toBe(binary.symbolCount);

		for (let symbol = 0; symbol < binary.symbolCount; symbol++) {
			expect(tree.symbolField(symbol, V_FLAGS)).toBe(
				binary.symbolField(symbol, V_FLAGS),
			);
		}
	});
});
