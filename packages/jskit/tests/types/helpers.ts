/**
 * @fileoverview Shared setup for the integration tests: parse, analyze,
 * infer the types, and find nodes to ask about.
 */

import {
	analyze,
	AstReader,
	inferTypes,
	NODE_KIND_NAMES,
	parse,
	toTypeTree,
	Types,
	TypesBufferReader,
	type AnalyzeOptions,
	type ParseResult,
	type TypeTree,
} from "../../src/index.js";

/** Everything a test needs about one program. */
export interface TypesFixture {
	parsed: ParseResult;
	scope: ArrayBuffer;
	types: ArrayBuffer;
	tree: TypeTree;
	queries: Types;
	reader: TypesBufferReader;
	ast: AstReader;
}

/**
 * Parses, analyzes, and infers the types of one program.
 * @param code The source text.
 * @param options How the program should be interpreted.
 * @returns The buffers and views over them.
 */
export function typesOf(
	code: string,
	options: AnalyzeOptions = {},
): TypesFixture {
	const parsed = parse(code);
	const scope = analyze(parsed, { sourceType: "module", ...options });
	const types = inferTypes(parsed, scope);

	return {
		parsed,
		scope,
		types,
		tree: toTypeTree(types, parsed, scope),
		queries: new Types(types, parsed),
		reader: new TypesBufferReader(types),
		ast: new AstReader(parsed),
	};
}

/**
 * The node index of the nth node of a type, in node creation order.
 * @param fixture The fixture holding the program.
 * @param type The ESTree type name.
 * @param nth Which match to take.
 * @returns The node's index.
 * @throws {Error} When no such node exists.
 */
export function nodeOf(fixture: TypesFixture, type: string, nth = 0): number {
	const ast = fixture.ast;
	let seen = 0;

	for (let node = 1; node < ast.nodeCount; node++) {
		if (NODE_KIND_NAMES[ast.kind(node)] === type && seen++ === nth) {
			return node;
		}
	}

	throw new Error(`No ${type} node ${nth} in the program.`);
}

/**
 * The `NodeRef` of the nth occurrence of a source snippet, as a node of a
 * type — the way an ESLint rule holding an ESTree node would ask.
 * @param fixture The fixture holding the program.
 * @param code The source text the fixture was built from.
 * @param type The ESTree type name.
 * @param snippet The source text of the node.
 * @returns A positional reference to the node.
 * @throws {Error} When the snippet does not occur.
 */
export function refAt(
	fixture: TypesFixture,
	code: string,
	type: string,
	snippet: string,
): { type: string; start: number; end: number } {
	const start = code.indexOf(snippet);

	if (start === -1) {
		throw new Error(`No occurrence of ${JSON.stringify(snippet)}.`);
	}

	return { type, start, end: start + snippet.length };
}
