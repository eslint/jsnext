/**
 * @fileoverview The `text` option on the scope surface: analyzing and reading
 * a buffer that was parsed without `{ source: true }` outside the process
 * that parsed it.
 *
 * A transferred or persisted buffer is simulated with `slice(0)` — a copy is
 * a different object, so the in-process source cache misses, which is exactly
 * what a buffer looks like after any real crossing.
 */

import { describe, expect, it } from "vitest";
import {
	Scopes,
	analyze,
	analyzeTree,
	parse,
	toAST,
	toScopeManager,
	toScopeTree,
} from "../../src/index.js";

const CODE = "const answer = 42; use(answer);";

/**
 * The names the module scope binds — top-level `const` lands there, not in
 * the global scope.
 * @param manager The rehydrated scope graph.
 * @returns The bound names, in binding order.
 */
function moduleVariables(manager: {
	globalScope: { childScopes: { variables: { name: string }[] }[] };
}): string[] {
	return manager.globalScope.childScopes[0].variables.map(v => v.name);
}

/**
 * Parses the program without embedding its text and hands back a copy the
 * cache cannot reach.
 * @param code The source text.
 * @returns The foreign buffer.
 */
function foreign(code: string): ArrayBuffer {
	return parse(code).slice(0);
}

/**
 * Parses and analyzes in one process, then copies the parse buffer, so each
 * consumer receives the pair the way a worker would — the scope buffer's
 * handles are byte offsets, equally valid in the copy's identical bytes.
 * @returns The foreign parse buffer and its scope buffer.
 */
function transferred(): { parsed: ArrayBuffer; scopes: ArrayBuffer } {
	const parsed = parse(CODE);

	return { scopes: analyze(parsed), parsed: parsed.slice(0) };
}

describe("analyze({ text })", () => {
	it("analyzes a foreign, text-less buffer", () => {
		const buffer = foreign(CODE);
		const manager = toScopeManager(analyze(buffer, { text: CODE }), buffer);

		expect(moduleVariables(manager)).toEqual(["answer"]);
	});

	it("throws without the text", () => {
		expect(() => analyze(foreign(CODE))).toThrow(/carries no source text/u);
	});

	it("refuses text of the wrong length", () => {
		expect(() => analyze(foreign(CODE), { text: `${CODE} ` })).toThrow(
			/exact source/u,
		);
	});

	it("goes unread by analyzeTree(), whose nodes carry their own strings", () => {
		const program = toAST(parse(CODE, { tokens: true }));

		expect(() => analyzeTree(program, { text: CODE })).not.toThrow();
	});
});

describe("the buffer consumers' text option", () => {
	it("reaches Scopes", () => {
		const { parsed, scopes } = transferred();

		expect(
			new Scopes(scopes, parsed, { text: CODE }).globalScope,
		).toBeDefined();
		expect(() => new Scopes(scopes, transferred().parsed)).toThrow(
			/carries no source text/u,
		);
	});

	it("reaches toScopeManager()", () => {
		const { parsed, scopes } = transferred();
		const manager = toScopeManager(scopes, parsed, { text: CODE });

		expect(moduleVariables(manager)).toEqual(["answer"]);
	});

	it("reaches toScopeTree()", () => {
		const { parsed, scopes } = transferred();
		const tree = toScopeTree(scopes, parsed, { text: CODE });

		expect(tree.root?.childScopes[0].variables.map(v => v.name)).toEqual([
			"answer",
		]);
	});
});
