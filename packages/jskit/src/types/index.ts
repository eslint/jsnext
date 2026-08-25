/**
 * @fileoverview The public API: one entry point onto the analysis, and two
 * ways to read what it produces.
 *
 * `inferTypes()` reads the parser's binary parse buffer and the scope
 * analyzer's binary scope buffer and returns one `ArrayBuffer` in the binary
 * type format (`types-buffer.ts`), where every type, member, and symbol has
 * a stable integer ID and every node reference is a byte offset into the
 * parse buffer.
 *
 * Two consumers read that buffer:
 *
 * - `Types` answers the classification questions rules ask — `isNullish()`,
 *   `isTypeOf()`, `isAwaitable()` — keyed by a node index or a `NodeRef`.
 * - `toTypeTree()` renders a plain JSON tree, for debugging and golden
 *   files.
 */

import { AstReader, native, supplySource } from "../parse/index.js";
import { ScopeBufferReader } from "../scope/index.js";
import { TypesBuilder } from "./types-builder.js";
import { TypesWalker } from "./types-walker.js";

export { TypesBufferReader } from "./types-buffer-reader.js";
export { Types } from "./types.js";
export type { TypeOfName, TypeOrigin } from "./types.js";
export { toTypeTree } from "./to-type-tree.js";
export type {
	TypeTree,
	TypeTreeEntry,
	TypeTreeMember,
	TypeTreeNode,
	TypeTreeSymbol,
	TypeTreeType,
} from "./to-type-tree.js";
export * from "./types-buffer.js";

/**
 * Options for `inferTypes()`.
 */
export interface InferTypesOptions {
	/**
	 * The program text the parse buffer was parsed from, for a buffer that
	 * cannot otherwise reach it — one parsed without `{ source: true }` and
	 * then read outside the process that parsed it. A fallback, never an
	 * override. The walk reads text throughout — names, literal values,
	 * member keys all come from it — so a buffer whose text is unreachable
	 * cannot be analyzed at all.
	 */
	text?: string;
}

/**
 * Infers what types a parsed program states, without checking anything.
 *
 * The analysis runs on the binary buffers directly, so nothing is decoded
 * into ESTree objects along the way, and the result is itself binary: an
 * `ArrayBuffer` in the type buffer format. Hand it to `Types` for
 * classification queries or `toTypeTree()` for a JSON-ready debugging view.
 *
 * The scope buffer must come from `analyze()` over the same parse result —
 * both buffers name nodes by the same byte offsets, and that is also how
 * the type buffer binds a symbol's type to its scope symbol. A buffer from
 * `analyzeTree()` names nodes another way and is refused.
 * @param parsed The parse buffer returned by `parse()`.
 * @param scope The scope buffer returned by `analyze()`.
 * @param options How the program should be read.
 * @returns The type buffer.
 * @throws {TypeError} When either buffer is not what its parameter claims,
 *      or the scope buffer was produced by `analyzeTree()`, or the source
 *      text is unreachable and `options.text` does not supply it.
 */
export function inferTypes(
	parsed: ArrayBufferLike,
	scope: ArrayBufferLike,
	options: InferTypesOptions = {},
): ArrayBuffer {
	if (options.text !== undefined) {
		supplySource(parsed, options.text);
	}

	const reader = new AstReader(parsed);
	const scopeReader = new ScopeBufferReader(scope);

	if (scopeReader.treeHandles) {
		throw new TypeError(
			"The scope buffer stores tree handles; inferTypes() needs a buffer from analyze() over the same parse result.",
		);
	}

	/*
	 * The native implementation writes the same buffer, so when a binding is
	 * registered the TypeScript walk below never runs. Both need the source
	 * text — names and literal values are slices of it — so reaching it is
	 * not optional here the way it is for `createGraph()`.
	 */
	if (native !== null && native.inferTypes !== undefined) {
		return native.inferTypes(
			parsed as ArrayBuffer,
			scope as ArrayBuffer,
			reader.source,
		);
	}

	const builder = new TypesBuilder(scopeReader.symbolCount);

	new TypesWalker(reader, scopeReader, builder).build();

	return builder.finish();
}
