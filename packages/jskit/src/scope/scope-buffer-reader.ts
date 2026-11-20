/**
 * @fileoverview The low-level reader over a scope buffer.
 *
 * Everything that consumes the binary scope format — `Scopes`,
 * `toScopeManager()`, `toScopeTree()` — reads it through this class, so the
 * layout knowledge lives in exactly two places: the writer and here.
 *
 * Reads are cheap on purpose. A record field is one multiply, one add, and a
 * typed-array load; a point query against an index is a binary search over
 * sorted word pairs. Strings are decoded lazily and cached, because most
 * queries never need one.
 */

import {
	BINDING_ORIGIN_ARGUMENTS,
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_IMPLICIT_GLOBAL,
	BINDING_ORIGIN_UNRESOLVED,
	BUFFER_TREE_HANDLES,
	DEFINITION_WORDS,
	R_NAME,
	R_RESOLVED,
	S_IMPLICIT,
	V_FLAGS,
	V_NAME,
	V_SCOPE,
	VF_DEFINITION_MASK,
	SCOPE_H_DECLARED_BASE,
	SCOPE_H_DECLARED_COUNT,
	SCOPE_H_DEFINITION_COUNT,
	SCOPE_H_DEFINITIONS_BASE,
	SCOPE_H_FLAGS,
	SCOPE_H_IDENT_REF_BASE,
	SCOPE_H_IDENT_REF_COUNT,
	SCOPE_H_MAGIC,
	SCOPE_H_NODE_SCOPE_BASE,
	SCOPE_H_NODE_SCOPE_COUNT,
	SCOPE_H_POOL_BASE,
	SCOPE_H_REFERENCE_COUNT,
	SCOPE_H_REFERENCES_BASE,
	SCOPE_H_SCOPE_COUNT,
	SCOPE_H_SCOPES_BASE,
	SCOPE_H_STRING_BYTES,
	SCOPE_H_STRING_COUNT,
	SCOPE_H_STRINGS_BASE,
	SCOPE_H_SYMBOL_COUNT,
	SCOPE_H_SYMBOLS_BASE,
	SCOPE_H_VERSION,
	REFERENCE_WORDS,
	SCOPE_BUFFER_MAGIC,
	SCOPE_BUFFER_VERSION,
	SCOPE_WORDS,
	SYMBOL_WORDS,
} from "./scope-buffer.js";

/** Decodes UTF-8 out of the string section. */
const decoder = /* @__PURE__ */ new TextDecoder();

/**
 * Reads records, lists, indexes, and strings out of a scope buffer.
 */
export class ScopeBufferReader {
	/** The whole buffer, viewed as 32-bit words. */
	readonly words: Uint32Array;

	/** How many scopes the buffer holds. */
	readonly scopeCount: number;

	/** How many symbols the buffer holds. */
	readonly symbolCount: number;

	/** How many references the buffer holds. */
	readonly referenceCount: number;

	/** How many definitions the buffer holds. */
	readonly definitionCount: number;

	/** Whether handles are tree enumeration indexes rather than byte offsets. */
	readonly treeHandles: boolean;

	/** Word index at which the scope records begin. */
	private readonly scopesBase: number;

	/** Word index at which the symbol records begin. */
	private readonly symbolsBase: number;

	/** Word index at which the reference records begin. */
	private readonly referencesBase: number;

	/** Word index at which the definition records begin. */
	private readonly definitionsBase: number;

	/** Word index at which the list pool begins. */
	private readonly poolBase: number;

	/** The decoded strings, filled in as they are asked for. */
	private readonly strings: (string | undefined)[];

	/** The raw bytes of the string section. */
	private readonly stringBytes: Uint8Array;

	/** Word index of the string offset table. */
	private readonly stringOffsetsBase: number;

	/**
	 * Creates a reader over a scope buffer.
	 * @param buffer The buffer returned by `analyze()` or `analyzeTree()`.
	 * @throws {TypeError} When the buffer is not a jskit scope buffer.
	 */
	constructor(buffer: ArrayBufferLike) {
		const words = new Uint32Array(buffer);

		if (
			words.length < 2 ||
			words[SCOPE_H_MAGIC] !== SCOPE_BUFFER_MAGIC ||
			words[SCOPE_H_VERSION] !== SCOPE_BUFFER_VERSION
		) {
			throw new TypeError("Not a jskit scope buffer.");
		}

		this.words = words;
		this.scopeCount = words[SCOPE_H_SCOPE_COUNT];
		this.symbolCount = words[SCOPE_H_SYMBOL_COUNT];
		this.referenceCount = words[SCOPE_H_REFERENCE_COUNT];
		this.definitionCount = words[SCOPE_H_DEFINITION_COUNT];
		this.treeHandles = (words[SCOPE_H_FLAGS] & BUFFER_TREE_HANDLES) !== 0;
		this.scopesBase = words[SCOPE_H_SCOPES_BASE];
		this.symbolsBase = words[SCOPE_H_SYMBOLS_BASE];
		this.referencesBase = words[SCOPE_H_REFERENCES_BASE];
		this.definitionsBase = words[SCOPE_H_DEFINITIONS_BASE];
		this.poolBase = words[SCOPE_H_POOL_BASE];
		this.strings = new Array(words[SCOPE_H_STRING_COUNT]);
		this.stringOffsetsBase = words[SCOPE_H_STRINGS_BASE];

		const dataBase =
			(this.stringOffsetsBase + words[SCOPE_H_STRING_COUNT] + 1) * 4;

		this.stringBytes = new Uint8Array(
			buffer,
			dataBase,
			words[SCOPE_H_STRING_BYTES],
		);
	}

	//-------------------------------------------------------------------------
	// Records
	//-------------------------------------------------------------------------

	/**
	 * Reads one word of a scope record.
	 * @param scope The scope ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	scopeField(scope: number, field: number): number {
		return this.words[this.scopesBase + scope * SCOPE_WORDS + field];
	}

	/**
	 * Reads one word of a symbol record.
	 * @param symbol The symbol ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	symbolField(symbol: number, field: number): number {
		return this.words[this.symbolsBase + symbol * SYMBOL_WORDS + field];
	}

	/**
	 * Reads one word of a reference record.
	 * @param reference The reference ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	referenceField(reference: number, field: number): number {
		return this.words[
			this.referencesBase + reference * REFERENCE_WORDS + field
		];
	}

	/**
	 * Reads one word of a definition record.
	 * @param definition The definition ID.
	 * @param field The word offset within the record.
	 * @returns The stored value.
	 */
	definitionField(definition: number, field: number): number {
		return this.words[
			this.definitionsBase + definition * DEFINITION_WORDS + field
		];
	}

	//-------------------------------------------------------------------------
	// Lists
	//-------------------------------------------------------------------------

	/**
	 * How many items a pool list holds.
	 * @param handle The list handle.
	 * @returns The item count, or `0` for the empty list.
	 */
	listCount(handle: number): number {
		return handle === 0 ? 0 : this.words[this.poolBase + handle];
	}

	/**
	 * Reads one item of a pool list.
	 * @param handle The list handle.
	 * @param index The zero-based position within the list.
	 * @returns The stored word.
	 */
	listItem(handle: number, index: number): number {
		return this.words[this.poolBase + handle + 1 + index];
	}

	/**
	 * Reads a whole pool list.
	 * @param handle The list handle.
	 * @returns The items, or an empty array for the empty list.
	 */
	listItems(handle: number): number[] {
		const count = this.listCount(handle);
		const items = new Array<number>(count);
		const base = this.poolBase + handle + 1;

		for (let i = 0; i < count; i++) {
			items[i] = this.words[base + i];
		}

		return items;
	}

	//-------------------------------------------------------------------------
	// Indexes
	//-------------------------------------------------------------------------

	/**
	 * Finds the run of values stored for a key in a sorted pair section.
	 * @param base Word index at which the pairs begin.
	 * @param count How many pairs the section holds.
	 * @param key The key to search for.
	 * @returns The values stored under the key, in sorted order.
	 */
	#pairValues(base: number, count: number, key: number): number[] {
		const words = this.words;
		let low = this.#pairLowerBound(base, count, key);
		const values: number[] = [];

		while (low < count && words[base + low * 2] === key) {
			values.push(words[base + low * 2 + 1]);
			low++;
		}

		return values;
	}

	/**
	 * Binary-searches a sorted pair section for the first pair whose key is
	 * not below `key`.
	 * @param base Word index at which the pairs begin.
	 * @param count How many pairs the section holds.
	 * @param key The key to search for.
	 * @returns The pair index, `count` when every key is below `key`.
	 */
	#pairLowerBound(base: number, count: number, key: number): number {
		const words = this.words;
		let low = 0;
		let high = count;

		while (low < high) {
			const mid = (low + high) >>> 1;

			if (words[base + mid * 2] < key) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		return low;
	}

	/**
	 * The first reference recorded at an identifier, without allocating —
	 * the one per-node queries want, since an identifier almost always
	 * carries at most one.
	 * @param handle The identifier's handle.
	 * @returns The reference ID, or `-1` when none was recorded there.
	 */
	firstReferenceAtIdentifier(handle: number): number {
		const base = this.words[SCOPE_H_IDENT_REF_BASE];
		const count = this.words[SCOPE_H_IDENT_REF_COUNT];
		const at = this.#pairLowerBound(base, count, handle);

		return at < count && this.words[base + at * 2] === handle
			? this.words[base + at * 2 + 1]
			: -1;
	}

	/**
	 * The scopes a node opened.
	 * @param handle The node's handle.
	 * @returns The scope IDs, in creation order.
	 */
	scopesOfNode(handle: number): number[] {
		return this.#pairValues(
			this.words[SCOPE_H_NODE_SCOPE_BASE],
			this.words[SCOPE_H_NODE_SCOPE_COUNT],
			handle,
		);
	}

	/**
	 * The symbols a node declares.
	 * @param handle The node's handle.
	 * @returns The symbol IDs, in declaration order.
	 */
	declaredSymbolsOfNode(handle: number): number[] {
		const lists = this.#pairValues(
			this.words[SCOPE_H_DECLARED_BASE],
			this.words[SCOPE_H_DECLARED_COUNT],
			handle,
		);

		return lists.length === 0 ? lists : this.listItems(lists[0]);
	}

	/**
	 * The references recorded at an identifier.
	 * @param handle The identifier's handle.
	 * @returns The reference IDs, almost always zero or one of them.
	 */
	referencesAtIdentifier(handle: number): number[] {
		return this.#pairValues(
			this.words[SCOPE_H_IDENT_REF_BASE],
			this.words[SCOPE_H_IDENT_REF_COUNT],
			handle,
		);
	}

	/**
	 * Every node handle the indexes above store: the nodes that opened
	 * scopes, the nodes that declare symbols, and the identifiers that
	 * references were recorded at. These are exactly the nodes the point
	 * queries can say anything about — every one is in the program's tree by
	 * construction — which is what makes them worth finding by position.
	 * @returns The distinct handles, in no particular order.
	 */
	storedHandles(): number[] {
		const seen = new Set<number>();
		const sections: [number, number][] = [
			[SCOPE_H_NODE_SCOPE_BASE, SCOPE_H_NODE_SCOPE_COUNT],
			[SCOPE_H_DECLARED_BASE, SCOPE_H_DECLARED_COUNT],
			[SCOPE_H_IDENT_REF_BASE, SCOPE_H_IDENT_REF_COUNT],
		];

		for (const [baseWord, countWord] of sections) {
			const base = this.words[baseWord];
			const count = this.words[countWord];

			for (let i = 0; i < count; i++) {
				seen.add(this.words[base + i * 2]);
			}
		}

		return [...seen];
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
		let value = this.strings[id];

		if (value === undefined) {
			const start = this.words[this.stringOffsetsBase + id];
			const end = this.words[this.stringOffsetsBase + id + 1];

			value = decoder.decode(this.stringBytes.subarray(start, end));
			this.strings[id] = value;
		}

		return value;
	}

	//-------------------------------------------------------------------------
	// Binding origins
	//-------------------------------------------------------------------------

	/**
	 * Where a symbol comes from: the kinds of declaration that bind it, or,
	 * for a symbol nothing in code declares, a configured global (in the
	 * global scope) or `arguments` (anywhere else). One masked word read,
	 * plus the scope for the latter two.
	 * @param symbol The symbol ID.
	 * @returns The `BINDING_ORIGIN_*` bitmask.
	 */
	symbolOrigins(symbol: number): number {
		const definitions =
			this.symbolField(symbol, V_FLAGS) & VF_DEFINITION_MASK;

		if (definitions !== 0) {
			return definitions;
		}

		return this.symbolField(symbol, V_SCOPE) === 0
			? BINDING_ORIGIN_CONFIGURED_GLOBAL
			: BINDING_ORIGIN_ARGUMENTS;
	}

	/**
	 * Where the binding a reference refers to comes from: its symbol's
	 * origins when it resolved, and otherwise `IMPLICIT_GLOBAL` or
	 * `UNRESOLVED`, depending on whether a sloppy-mode assignment in the file
	 * creates the name.
	 * @param reference The reference ID.
	 * @returns The `BINDING_ORIGIN_*` bitmask.
	 */
	referenceOrigins(reference: number): number {
		const resolved = this.referenceField(reference, R_RESOLVED);

		if (resolved !== 0) {
			return this.symbolOrigins(resolved - 1);
		}

		return this.#isImplicitGlobalName(
			this.referenceField(reference, R_NAME),
		)
			? BINDING_ORIGIN_IMPLICIT_GLOBAL
			: BINDING_ORIGIN_UNRESOLVED;
	}

	/**
	 * Whether a sloppy-mode assignment in the file creates a global by this
	 * name. The global scope's implicit list holds one symbol per such name
	 * and is short in practice, and interned names compare as integers.
	 * @param nameId The name's string ID.
	 * @returns `true` when the name is an implicit global.
	 */
	#isImplicitGlobalName(nameId: number): boolean {
		const list = this.scopeField(0, S_IMPLICIT);
		const count = this.listCount(list);

		for (let i = 0; i < count; i++) {
			if (this.symbolField(this.listItem(list, i), V_NAME) === nameId) {
				return true;
			}
		}

		return false;
	}
}
