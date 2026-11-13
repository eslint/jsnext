/**
 * @fileoverview Finds the recorded type under a position in the source, for
 * the editor's hover tooltip.
 */

import type { TypeTree } from "@eslint/jskit";

/**
 * What the tooltip shows: the type's ID and text, and the stretch of source
 * the hovered node covers.
 */
export interface TypeHover {
	start: number;
	end: number;
	typeId: number;
	text: string;
}

/**
 * Decides whether a node kind is one the tooltip reports. The type data
 * also records type annotations and declarations, but a hover is about the
 * value under the pointer, so only identifiers and expressions count.
 * @param type The ESTree node type.
 * @returns `true` for identifiers and expressions.
 */
function isHoverable(type: string): boolean {
	return (
		type === "Identifier" ||
		type === "Literal" ||
		type === "TemplateLiteral" ||
		type === "JSXElement" ||
		type === "JSXFragment" ||
		type.endsWith("Expression")
	);
}

/**
 * Finds the innermost identifier or expression with a recorded type that
 * covers a character of the source.
 * @param tree The type analysis's tree.
 * @param offset The offset of the character under the pointer.
 * @returns The hover, or `null` when nothing typed covers that character.
 */
export function typeAt(tree: TypeTree, offset: number): TypeHover | null {
	let best: TypeTree["nodes"][number] | null = null;

	/*
	 * The smallest covering node wins. Two can share a range — a chain
	 * expression and the member expression it wraps — and either one
	 * describes the same text, so a tie simply keeps the later entry.
	 */
	for (const entry of tree.nodes) {
		const { type, start, end } = entry.node;

		if (
			start <= offset &&
			offset < end &&
			isHoverable(type) &&
			(best === null || end - start <= best.node.end - best.node.start)
		) {
			best = entry;
		}
	}

	if (best === null) {
		return null;
	}

	return {
		start: best.node.start,
		end: best.node.end,
		typeId: best.type,
		text: tree.types[best.type]?.text ?? "",
	};
}
