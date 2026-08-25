/**
 * @fileoverview The query surface itself: node resolution, symbol-keyed
 * lookups, the JSON view, and what the entry point refuses.
 */

import { describe, expect, it } from "vitest";
import {
	analyze,
	analyzeTree,
	inferTypes,
	parse,
	toAST,
	toTypeTree,
	Types,
	TypesBufferReader,
	TYPE_INTRINSIC_COUNT,
	TYPE_NONE,
	TYPE_STRING,
	TYPES_BUFFER_MAGIC,
	TYPES_H_MAGIC,
	TYPES_H_VERSION,
} from "../../src/index.js";
import { typesOf } from "./helpers.js";

describe("node resolution", () => {
	it("answers by node index and by NodeRef alike", () => {
		const code = `let x: string; x;`;
		const fixture = typesOf(code);
		const start = code.indexOf("x;");
		const byRef = fixture.queries.getTypeId({
			type: "Identifier",
			start,
		});

		expect(byRef).toBe(TYPE_STRING);

		// The same identifier found by index answers identically.
		let found = false;

		for (let node = 1; node < fixture.ast.nodeCount; node++) {
			if (
				fixture.ast.start(node) === start &&
				fixture.ast.end(node) === start + 1
			) {
				expect(fixture.queries.getTypeId(node)).toBe(byRef);
				found = true;
			}
		}

		expect(found).toBe(true);
	});

	it("distinguishes co-located nodes by type and end", () => {
		const code = `let x: string; (x);`;
		const fixture = typesOf(code);
		const start = code.indexOf("x)");

		expect(
			fixture.queries.getTypeId({
				type: "Identifier",
				start,
				end: start + 1,
			}),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId({ type: "CallExpression", start }),
		).toBe(TYPE_NONE);
	});

	it("answers TYPE_NONE for a node nothing was recorded for", () => {
		const code = `let x; x;`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId({ type: "Identifier", start: 4 }),
		).toBe(TYPE_NONE);
		expect(
			fixture.queries.getTypeId({ type: "Identifier", start: 9999 }),
		).toBe(TYPE_NONE);
	});
});

describe("symbol-keyed lookups", () => {
	it("exposes value and declared types by scope symbol", () => {
		const code = `interface Box { v: number; } const b: Box = { v: 1 };`;
		const fixture = typesOf(code);
		const tree = fixture.tree;
		const boxSymbol = tree.symbols.find(entry => entry.name === "Box")!;
		const bSymbol = tree.symbols.find(entry => entry.name === "b")!;

		expect(boxSymbol.declared).not.toBe(TYPE_NONE);
		expect(fixture.queries.getDeclaredTypeId(boxSymbol.symbol)).toBe(
			boxSymbol.declared,
		);
		expect(fixture.queries.getSymbolTypeId(bSymbol.symbol)).toBe(
			bSymbol.type,
		);
		expect(fixture.queries.getSymbolTypeId(9999)).toBe(TYPE_NONE);
		expect(fixture.queries.getDeclaredTypeId(9999)).toBe(TYPE_NONE);
	});
});

describe("the JSON view", () => {
	it("starts with the pinned intrinsics and stays serializable", () => {
		const fixture = typesOf(`let x: string;`);

		expect(fixture.tree.types.length).toBeGreaterThanOrEqual(
			TYPE_INTRINSIC_COUNT,
		);
		// Record 0 is the sentinel; it renders as no knowledge.
		expect(fixture.tree.types[0].text).toBe("unknown");
		expect(fixture.tree.types[1].text).toBe("any");
		expect(fixture.tree.types[7].text).toBe("string");
		expect(() => JSON.stringify(fixture.tree)).not.toThrow();
	});

	it("lists typed nodes with their positions", () => {
		const code = `const n = 1;`;
		const fixture = typesOf(code);
		const literal = fixture.tree.nodes.find(
			entry => entry.node.type === "Literal",
		);

		expect(literal).toBeDefined();
		expect(literal!.node.start).toBe(code.indexOf("1"));
	});
});

describe("input validation", () => {
	it("refuses a scope buffer from analyzeTree()", () => {
		const parsed = parse(`let x = 1;`);
		const program = toAST(parsed);
		const scope = analyzeTree(program);

		expect(() => inferTypes(parsed, scope)).toThrow(/tree handles/u);
	});

	it("refuses a buffer that is not a type buffer", () => {
		expect(() => new TypesBufferReader(new ArrayBuffer(8))).toThrow(
			TypeError,
		);

		const parsed = parse(`let x = 1;`);

		expect(() => new TypesBufferReader(parsed)).toThrow(
			/not a type buffer/u,
		);
	});

	it("refuses a version it does not read", () => {
		const fixture = typesOf(`let x = 1;`);
		const copy = fixture.types.slice(0);
		const words = new Uint32Array(copy);

		expect(words[TYPES_H_MAGIC]).toBe(TYPES_BUFFER_MAGIC);
		words[TYPES_H_VERSION] = 999;

		expect(() => new TypesBufferReader(copy)).toThrow(/version/u);
	});

	it("analyzes a transferred buffer when the text is supplied", () => {
		const code = `let x: string; x;`;
		const parsed = parse(code);
		const scope = analyze(parsed, { sourceType: "module" });

		// A structural copy has no cached source to read names from.
		const transferred = parsed.slice(0);

		expect(() => inferTypes(transferred, scope)).toThrow();

		const types = inferTypes(transferred, scope, { text: code });
		const queries = new Types(types, transferred);

		expect(
			queries.getTypeId({
				type: "Identifier",
				start: code.indexOf("x;"),
			}),
		).toBe(TYPE_STRING);
	});
});
