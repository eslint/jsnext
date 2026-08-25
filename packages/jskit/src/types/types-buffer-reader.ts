/**
 * @fileoverview Point queries against a type buffer's words.
 *
 * This and `types-builder.ts` are the only two modules that know the layout.
 * Everything here is a one-multiply-one-add typed-array load; the semantic
 * layer — flag tests, reference chasing, `NodeRef` resolution — lives in
 * `Types`, which reads through this class.
 */

import {
	MEMBER_WORDS,
	NODE_TYPE_WORDS,
	NT_NODE,
	NT_TYPE,
	TYPES_BUFFER_MAGIC,
	TYPES_BUFFER_VERSION,
	TYPES_H_DECLARED_TYPES_BASE,
	TYPES_H_MAGIC,
	TYPES_H_MEMBERS_BASE,
	TYPES_H_MEMBER_COUNT,
	TYPES_H_NODE_TYPE_BASE,
	TYPES_H_NODE_TYPE_COUNT,
	TYPES_H_POOL_BASE,
	TYPES_H_STRINGS_BASE,
	TYPES_H_STRING_COUNT,
	TYPES_H_SYMBOLS_BASE,
	TYPES_H_SYMBOL_COUNT,
	TYPES_H_SYMBOL_TYPES_BASE,
	TYPES_H_SYMBOL_TYPES_COUNT,
	TYPES_H_TYPES_BASE,
	TYPES_H_TYPE_COUNT,
	TYPES_H_VERSION,
	TYPE_NONE,
	TYPE_SYMBOL_WORDS,
	TYPE_WORDS,
} from "./types-buffer.js";

/** Decodes the string table lazily. */
const decoder = /* @__PURE__ */ new TextDecoder();

/**
 * Reads a type buffer.
 */
export class TypesBufferReader {
	/** The words of the whole buffer. */
	readonly words: Uint32Array;

	/** How many type records the buffer holds. */
	readonly typeCount: number;

	/** How many member records the buffer holds. */
	readonly memberCount: number;

	/** How many symbol records the buffer holds. */
	readonly symbolCount: number;

	/** How many scope symbols the two dense arrays cover. */
	readonly scopeSymbolCount: number;

	/** How many node-type pairs the index holds. */
	readonly nodeTypeCount: number;

	/** Word index of the type records. */
	readonly #typesBase: number;

	/** Word index of the member records. */
	readonly #membersBase: number;

	/** Word index of the pool. */
	readonly #poolBase: number;

	/** Word index of the symbol records. */
	readonly #symbolsBase: number;

	/** Word index of the symbol value-type array. */
	readonly #symbolTypesBase: number;

	/** Word index of the symbol declared-type array. */
	readonly #declaredTypesBase: number;

	/** Word index of the node-type pairs. */
	readonly #nodeTypeBase: number;

	/** Word index of the string offset table. */
	readonly #stringsBase: number;

	/** The string table's bytes. */
	readonly #stringBytes: Uint8Array;

	/** Strings already decoded, by ID. */
	readonly #strings: (string | undefined)[];

	/**
	 * Creates a reader over one buffer.
	 * @param buffer The type buffer.
	 * @throws {TypeError} When the buffer is not a type buffer this version
	 *      reads.
	 */
	constructor(buffer: ArrayBufferLike) {
		const words = new Uint32Array(buffer);

		if (
			words.length < TYPES_H_TYPE_COUNT ||
			words[TYPES_H_MAGIC] !== TYPES_BUFFER_MAGIC
		) {
			throw new TypeError("The buffer is not a type buffer.");
		}

		if (words[TYPES_H_VERSION] !== TYPES_BUFFER_VERSION) {
			throw new TypeError(
				`The type buffer is version ${words[TYPES_H_VERSION]}; this reader reads version ${TYPES_BUFFER_VERSION}.`,
			);
		}

		this.words = words;
		this.typeCount = words[TYPES_H_TYPE_COUNT];
		this.memberCount = words[TYPES_H_MEMBER_COUNT];
		this.symbolCount = words[TYPES_H_SYMBOL_COUNT];
		this.scopeSymbolCount = words[TYPES_H_SYMBOL_TYPES_COUNT];
		this.nodeTypeCount = words[TYPES_H_NODE_TYPE_COUNT];
		this.#typesBase = words[TYPES_H_TYPES_BASE];
		this.#membersBase = words[TYPES_H_MEMBERS_BASE];
		this.#poolBase = words[TYPES_H_POOL_BASE];
		this.#symbolsBase = words[TYPES_H_SYMBOLS_BASE];
		this.#symbolTypesBase = words[TYPES_H_SYMBOL_TYPES_BASE];
		this.#declaredTypesBase = words[TYPES_H_DECLARED_TYPES_BASE];
		this.#nodeTypeBase = words[TYPES_H_NODE_TYPE_BASE];
		this.#stringsBase = words[TYPES_H_STRINGS_BASE];

		const stringDataBase =
			this.#stringsBase + words[TYPES_H_STRING_COUNT] + 1;

		this.#stringBytes = new Uint8Array(buffer, stringDataBase * 4);
		this.#strings = new Array<string | undefined>(
			words[TYPES_H_STRING_COUNT],
		);
	}

	//-------------------------------------------------------------------------
	// Records
	//-------------------------------------------------------------------------

	/**
	 * Reads one field of a type record.
	 * @param type The type's ID.
	 * @param field The `TY_*` field index.
	 * @returns The word.
	 */
	typeField(type: number, field: number): number {
		return this.words[this.#typesBase + type * TYPE_WORDS + field];
	}

	/**
	 * Reads one field of a member record.
	 * @param member The member's ID.
	 * @param field The `TM_*` field index.
	 * @returns The word.
	 */
	memberField(member: number, field: number): number {
		return this.words[this.#membersBase + member * MEMBER_WORDS + field];
	}

	/**
	 * Reads one field of a symbol record.
	 * @param symbol The symbol's ID.
	 * @param field The `SY_*` field index.
	 * @returns The word.
	 */
	symbolField(symbol: number, field: number): number {
		return this.words[
			this.#symbolsBase + symbol * TYPE_SYMBOL_WORDS + field
		];
	}

	/**
	 * The value type recorded for a scope symbol.
	 * @param symbol The scope symbol's ID.
	 * @returns The type ID, `TYPE_NONE` when nothing was recorded.
	 */
	symbolType(symbol: number): number {
		return symbol < this.scopeSymbolCount
			? this.words[this.#symbolTypesBase + symbol]
			: TYPE_NONE;
	}

	/**
	 * The declared type recorded for a scope symbol.
	 * @param symbol The scope symbol's ID.
	 * @returns The type ID, `TYPE_NONE` for a symbol that declares none.
	 */
	declaredType(symbol: number): number {
		return symbol < this.scopeSymbolCount
			? this.words[this.#declaredTypesBase + symbol]
			: TYPE_NONE;
	}

	//-------------------------------------------------------------------------
	// Lists
	//-------------------------------------------------------------------------

	/**
	 * How many items a pooled list holds.
	 * @param handle The pool handle.
	 * @returns The item count, `0` for the empty list.
	 */
	listCount(handle: number): number {
		return handle === 0 ? 0 : this.words[this.#poolBase + handle];
	}

	/**
	 * One item of a pooled list.
	 * @param handle The pool handle.
	 * @param index The item's position.
	 * @returns The item.
	 */
	listItem(handle: number, index: number): number {
		return this.words[this.#poolBase + handle + 1 + index];
	}

	/**
	 * A pooled list as an array.
	 * @param handle The pool handle.
	 * @returns The items, empty for handle `0`.
	 */
	listItems(handle: number): number[] {
		const count = this.listCount(handle);
		const items: number[] = [];

		for (let i = 0; i < count; i++) {
			items.push(this.listItem(handle, i));
		}

		return items;
	}

	//-------------------------------------------------------------------------
	// The node-type index
	//-------------------------------------------------------------------------

	/**
	 * Reads one field of a node-type index entry.
	 * @param entry The entry's position.
	 * @param field `NT_NODE` or `NT_TYPE`.
	 * @returns The word.
	 */
	nodeTypeField(entry: number, field: number): number {
		return this.words[this.#nodeTypeBase + entry * NODE_TYPE_WORDS + field];
	}

	/**
	 * The type recorded for a node, by binary search over the sorted pairs.
	 *
	 * When a node was recorded more than once, the entry with the lowest
	 * type ID answers — the total ordering makes the answer independent of
	 * how the sort ran.
	 * @param handle The node's handle.
	 * @returns The type ID, `TYPE_NONE` when the node has no entry.
	 */
	typeOfNode(handle: number): number {
		const words = this.words;
		const base = this.#nodeTypeBase;
		let low = 0;
		let high = this.nodeTypeCount;

		while (low < high) {
			const mid = (low + high) >>> 1;

			if (words[base + mid * NODE_TYPE_WORDS + NT_NODE] < handle) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		if (
			low < this.nodeTypeCount &&
			words[base + low * NODE_TYPE_WORDS + NT_NODE] === handle
		) {
			return words[base + low * NODE_TYPE_WORDS + NT_TYPE];
		}

		return TYPE_NONE;
	}

	//-------------------------------------------------------------------------
	// Strings
	//-------------------------------------------------------------------------

	/**
	 * The string with an ID, decoding it the first time it is asked for.
	 * @param id The string ID.
	 * @returns The string.
	 */
	string(id: number): string {
		let value = this.#strings[id];

		if (value === undefined) {
			const start = this.words[this.#stringsBase + id];
			const end = this.words[this.#stringsBase + id + 1];

			value = decoder.decode(this.#stringBytes.subarray(start, end));
			this.#strings[id] = value;
		}

		return value;
	}
}
