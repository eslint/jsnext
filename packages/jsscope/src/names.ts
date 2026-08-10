/**
 * @fileoverview Reading names straight out of the source text.
 *
 * Skipping the ESTree layer means the analyzer has to spell out what the
 * decoder would otherwise have done for it. Both functions here are on the hot
 * path — every identifier in a file goes through the first one — so both take
 * the cheap route whenever the text needs no interpretation, which is nearly
 * always.
 */

import { decodeEscapes, NODE_A, type AstReader } from "jsparse";

/**
 * The name an identifier spells.
 *
 * On an `Identifier` the node's `end` may reach past the name, because a type
 * annotation extends it, so the name ends where slot A says it does.
 * @param reader The reader over the AST buffer.
 * @param node The `Identifier` or `JSXIdentifier` node index.
 * @returns The name, with any unicode escapes resolved.
 */
export function identifierName(reader: AstReader, node: number): string {
	const start = reader.start(node);
	const nameEnd = reader.field(node, NODE_A);
	const raw = reader.source.slice(
		start,
		nameEnd === 0 ? reader.end(node) : nameEnd,
	);

	return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
}

/**
 * The value of a string literal, which is how an enum member written
 * `"a" = 1` gets its name.
 * @param reader The reader over the AST buffer.
 * @param node The `Literal` node index.
 * @returns The string the literal denotes.
 */
export function literalStringValue(reader: AstReader, node: number): string {
	const raw = reader.source.slice(
		reader.start(node) + 1,
		reader.end(node) - 1,
	);

	return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
}
