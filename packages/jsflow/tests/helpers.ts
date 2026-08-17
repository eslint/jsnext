/**
 * @fileoverview Shared setup for the integration tests: parse, analyze,
 * build the graph, and find nodes to ask about.
 */

import {
	AstReader,
	NODE_KIND_NAMES,
	parse,
	type ParseResult,
} from "@eslint/jsparse";
import { analyze, type AnalyzeOptions } from "@eslint/jsscope";
import {
	FlowBufferReader,
	createGraph,
	nodeHandle,
	toGraphTree,
	type FlowTree,
	type FlowTreeBlock,
	type FlowTreeGraph,
} from "../src/index.js";

/** Everything a test needs about one program. */
export interface GraphFixture {
	parsed: ParseResult;
	scope: ArrayBuffer;
	flow: ArrayBuffer;
	tree: FlowTree;
	reader: FlowBufferReader;
	ast: AstReader;
}

/**
 * Parses, analyzes, and graphs one program.
 * @param code The source text.
 * @param options How the program should be interpreted.
 * @returns The buffers and views over them.
 */
export function graphOf(
	code: string,
	options: AnalyzeOptions = {},
): GraphFixture {
	const parsed = parse(code);
	const scope = analyze(parsed, { sourceType: "module", ...options });
	const flow = createGraph(parsed, scope);

	return {
		parsed,
		scope,
		flow,
		tree: toGraphTree(flow, parsed, scope),
		reader: new FlowBufferReader(flow),
		ast: new AstReader(parsed),
	};
}

/**
 * The handle of the nth node of a type, in node creation order.
 * @param fixture The fixture holding the program.
 * @param type The ESTree type name.
 * @param nth Which match to take.
 * @returns The node's handle.
 * @throws {Error} When no such node exists.
 */
export function handleOf(
	fixture: GraphFixture,
	type: string,
	nth = 0,
): number {
	const ast = fixture.ast;
	let seen = 0;

	for (let node = 1; node < ast.nodeCount; node++) {
		if (NODE_KIND_NAMES[ast.kind(node)] === type && seen++ === nth) {
			return nodeHandle(ast, node);
		}
	}

	throw new Error(`No ${type} node #${nth} in the program.`);
}

/**
 * The handle of the node of a type starting at an offset.
 * @param fixture The fixture holding the program.
 * @param type The ESTree type name.
 * @param start The node's start offset.
 * @returns The node's handle.
 * @throws {Error} When no such node exists.
 */
export function handleAt(
	fixture: GraphFixture,
	type: string,
	start: number,
): number {
	const ast = fixture.ast;

	for (let node = 1; node < ast.nodeCount; node++) {
		if (
			ast.start(node) === start &&
			NODE_KIND_NAMES[ast.kind(node)] === type
		) {
			return nodeHandle(ast, node);
		}
	}

	throw new Error(`No ${type} node at offset ${start}.`);
}

/**
 * A graph's block by its global ID.
 * @param graph The rendered graph.
 * @param blockId The block's ID.
 * @returns The rendered block.
 */
export function blockById(
	graph: FlowTreeGraph,
	blockId: number,
): FlowTreeBlock {
	return graph.blocks[blockId - graph.blocks[0].blockId];
}

/**
 * Every edge in a rendered graph, flattened.
 * @param graph The rendered graph.
 * @returns The edges of every block, in block order.
 */
export function edgesOf(graph: FlowTreeGraph): {
	from: number;
	to: number;
	kind: string;
	back: boolean;
	condition: { type: string; start: number; end: number } | null;
}[] {
	return graph.blocks.flatMap(block =>
		block.successors.map(edge => ({
			from: block.blockId,
			to: edge.to,
			kind: edge.kind,
			back: edge.back,
			condition: edge.condition,
		})),
	);
}

/**
 * Every write in a rendered graph, flattened in block order.
 * @param graph The rendered graph.
 * @returns The writes with the block each sits in.
 */
export function writesOf(graph: FlowTreeGraph): {
	blockId: number;
	symbol: string | null;
	init: boolean;
	compound: boolean;
	update: boolean;
	member: boolean;
	target: { type: string; start: number; end: number };
	value: { type: string; start: number; end: number } | null;
}[] {
	return graph.blocks.flatMap(block =>
		block.writes.map(write => ({ blockId: block.blockId, ...write })),
	);
}
