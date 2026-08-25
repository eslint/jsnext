/**
 * @fileoverview The type table in binary form: recording and emission.
 *
 * The walk materializes no objects. A type, member, or symbol is a run of
 * words in a growable buffer, and `finish()` compacts them into one
 * `ArrayBuffer` in the type buffer format.
 *
 * Two kinds of record are interned rather than appended blindly. Types with
 * no members and no pooled data — intrinsics, literals, bare references —
 * are deduplicated by their five meaningful words, which is what pins the
 * intrinsic IDs: the constructor interns them first, in `TYPE_INTRINSIC_*`
 * order, before the walk can intern anything else. Symbols are deduplicated
 * by every field, so one `Promise` symbol serves every `Promise<T>` in the
 * program. Both internments are by exact key, never by structural
 * equivalence, so the TypeScript and Rust implementations agree word for
 * word.
 */

import {
	MEMBER_WORDS,
	NODE_TYPE_WORDS,
	SY_DECL,
	SY_NAME,
	SY_ORIGIN,
	SY_SPECIFIER,
	SY_TARGET,
	TM_FLAGS,
	TM_NAME,
	TM_TYPE,
	TYF_ANY,
	TYF_BIGINT,
	TYF_BOOLEAN,
	TYF_BOOLEAN_LITERAL,
	TYF_NEVER,
	TYF_NON_PRIMITIVE,
	TYF_NULL,
	TYF_NUMBER,
	TYF_STRING,
	TYF_SYMBOL,
	TYF_UNDEFINED,
	TYF_UNKNOWN,
	TYF_VOID,
	TYPES_BUFFER_MAGIC,
	TYPES_BUFFER_VERSION,
	TYPES_H_DECLARED_TYPES_BASE,
	TYPES_H_FLAGS,
	TYPES_H_IMPORTS_BASE,
	TYPES_H_IMPORT_COUNT,
	TYPES_H_MAGIC,
	TYPES_H_MEMBERS_BASE,
	TYPES_H_MEMBER_COUNT,
	TYPES_H_NODE_TYPE_BASE,
	TYPES_H_NODE_TYPE_COUNT,
	TYPES_H_POOL_BASE,
	TYPES_H_STRINGS_BASE,
	TYPES_H_STRING_BYTES,
	TYPES_H_STRING_COUNT,
	TYPES_H_SYMBOLS_BASE,
	TYPES_H_SYMBOL_COUNT,
	TYPES_H_SYMBOL_TYPES_BASE,
	TYPES_H_SYMBOL_TYPES_COUNT,
	TYPES_H_TYPES_BASE,
	TYPES_H_TYPE_COUNT,
	TYPES_H_VERSION,
	TYPES_HEADER_WORDS,
	TYPE_SYMBOL_WORDS,
	TYPE_WORDS,
	TY_DATA0,
	TY_DATA1,
	TY_FLAGS,
	TY_MEMBER_COUNT,
	TY_MEMBER_FIRST,
	TY_NODE,
	TY_SHAPE,
	TY_SYMBOL,
} from "./types-buffer.js";

/**
 * A growable run of 32-bit words.
 */
class WordList {
	/** The backing store, replaced as it grows. */
	data: Uint32Array;

	/** How many words are in use. */
	length = 0;

	/**
	 * Creates an empty list.
	 * @param capacity How many words to reserve up front.
	 */
	constructor(capacity: number) {
		this.data = new Uint32Array(capacity);
	}

	/**
	 * Makes room for more words, doubling as needed.
	 * @param extra How many words are about to be appended.
	 * @returns The write position for the first of them.
	 */
	reserve(extra: number): number {
		const start = this.length;
		let capacity = this.data.length;

		if (start + extra > capacity) {
			do {
				capacity *= 2;
			} while (start + extra > capacity);

			const next = new Uint32Array(capacity);

			next.set(this.data);
			this.data = next;
		}

		this.length = start + extra;

		return start;
	}

	/**
	 * Appends one word.
	 * @param value The word to append.
	 * @returns Nothing.
	 */
	push(value: number): void {
		this.data[this.reserve(1)] = value;
	}
}

/**
 * Sorts interleaved `(node handle, type ID)` word pairs, in place, by handle
 * and then by type ID.
 *
 * The pairs arrive in walk order, which is nearly sorted already, so this is
 * a quicksort with an insertion cutoff and a median-of-three pivot, iterative
 * to keep deep recursion off the stack — the same routine the flow builder
 * uses for its node-block index, and for the same reason. The tie-break by
 * type ID makes the ordering total, so the buffer does not depend on how the
 * partitioning happened to shuffle equal keys.
 * @param words The backing store holding the pairs.
 * @param count How many pairs there are, starting at word 0.
 * @returns Nothing.
 */
function sortPairs(words: Uint32Array, count: number): void {
	const stack: number[] = [0, count - 1];

	while (stack.length > 0) {
		const high = stack.pop()!;
		const low = stack.pop()!;

		if (high - low < 16) {
			// Insertion sort for short runs.
			for (let i = low + 1; i <= high; i++) {
				const key = words[i * 2];
				const value = words[i * 2 + 1];
				let j = i - 1;

				while (
					j >= low &&
					(words[j * 2] > key ||
						(words[j * 2] === key && words[j * 2 + 1] > value))
				) {
					words[j * 2 + 2] = words[j * 2];
					words[j * 2 + 3] = words[j * 2 + 1];
					j--;
				}

				words[j * 2 + 2] = key;
				words[j * 2 + 3] = value;
			}

			continue;
		}

		/*
		 * Median-of-three pivot. Both of its words are read out before
		 * partitioning starts, since the element itself moves once the
		 * swaps begin.
		 */
		const mid = (low + high) >>> 1;
		const a = words[low * 2];
		const b = words[mid * 2];
		const c = words[high * 2];
		let pivotAt = mid;

		if (a > b === a < c) {
			pivotAt = low;
		} else if (c > a === c < b) {
			pivotAt = high;
		}

		const pivotKey = words[pivotAt * 2];
		const pivotValue = words[pivotAt * 2 + 1];

		let i = low;
		let j = high;

		while (i <= j) {
			while (
				words[i * 2] < pivotKey ||
				(words[i * 2] === pivotKey && words[i * 2 + 1] < pivotValue)
			) {
				i++;
			}

			while (
				words[j * 2] > pivotKey ||
				(words[j * 2] === pivotKey && words[j * 2 + 1] > pivotValue)
			) {
				j--;
			}

			if (i <= j) {
				const key = words[i * 2];
				const value = words[i * 2 + 1];

				words[i * 2] = words[j * 2];
				words[i * 2 + 1] = words[j * 2 + 1];
				words[j * 2] = key;
				words[j * 2 + 1] = value;
				i++;
				j--;
			}
		}

		if (low < j) {
			stack.push(low, j);
		}

		if (i < high) {
			stack.push(i, high);
		}
	}
}

/**
 * Drops repeated pairs from a sorted run, in place.
 *
 * The walk records a node once per visit, and the two passes both reach the
 * nodes the declaration pass typed, so exact repeats are routine. After the
 * total ordering above they sit next to each other, and compacting before
 * the buffer is sized keeps them out of it.
 * @param words The backing store holding the pairs, sorted.
 * @param count How many pairs there are, starting at word 0.
 * @returns How many pairs survive, packed from word 0.
 */
function compactPairs(words: Uint32Array, count: number): number {
	if (count === 0) {
		return 0;
	}

	let kept = 1;

	for (let i = 1; i < count; i++) {
		const last = (kept - 1) * 2;

		if (
			words[i * 2] === words[last] &&
			words[i * 2 + 1] === words[last + 1]
		) {
			continue;
		}

		words[kept * 2] = words[i * 2];
		words[kept * 2 + 1] = words[i * 2 + 1];
		kept++;
	}

	return kept;
}

/**
 * Records types, members, and symbols as the walk discovers them, and
 * compacts them into a type buffer.
 */
export class TypesBuilder {
	/** Type records, `TYPE_WORDS` words each. */
	readonly #types = new WordList(256);

	/** Member records, `MEMBER_WORDS` words each, in creation order. */
	readonly #members = new WordList(128);

	/** Symbol records, `TYPE_SYMBOL_WORDS` words each. */
	readonly #symbols = new WordList(64);

	/** The list pool: `[count, items...]` runs. Word 0 is a padding word. */
	readonly #pool = new WordList(64);

	/** `(node handle, type ID)` pairs in visit order. */
	readonly #nodeTypes = new WordList(1024);

	/** Interned strings, in first-use order. */
	readonly #strings: string[] = [];

	/** String to its interned ID. */
	readonly #stringIds = new Map<string, number>();

	/** Intern key of a member-less type to its ID. */
	readonly #typeIds = new Map<string, number>();

	/** Intern key of a symbol to its ID. */
	readonly #symbolIds = new Map<string, number>();

	/** The value type of each scope symbol, `TYPE_NONE` when unknown. */
	readonly #symbolTypes: Uint32Array;

	/** The declared type of each scope symbol, `TYPE_NONE` for none. */
	readonly #declaredTypes: Uint32Array;

	/**
	 * Creates a builder and pins the intrinsic type records.
	 * @param scopeSymbolCount How many symbols the scope buffer holds.
	 */
	constructor(scopeSymbolCount: number) {
		// Pool handle 0 must mean "empty list", so word 0 is never a list.
		this.#pool.push(0);

		this.#symbolTypes = new Uint32Array(scopeSymbolCount);
		this.#declaredTypes = new Uint32Array(scopeSymbolCount);

		/*
		 * The intrinsics, in `TYPE_INTRINSIC_*` order. Interning them first
		 * is what pins their IDs; the walk's own internments land after.
		 */
		this.internType(0, 0, 0, 0, 0); // TYPE_NONE
		this.internType(TYF_ANY, 0, 0, 0, 0);
		this.internType(TYF_UNKNOWN, 0, 0, 0, 0);
		this.internType(TYF_NEVER, 0, 0, 0, 0);
		this.internType(TYF_VOID, 0, 0, 0, 0);
		this.internType(TYF_UNDEFINED, 0, 0, 0, 0);
		this.internType(TYF_NULL, 0, 0, 0, 0);
		this.internType(TYF_STRING, 0, 0, 0, 0);
		this.internType(TYF_NUMBER, 0, 0, 0, 0);
		this.internType(TYF_BIGINT, 0, 0, 0, 0);
		this.internType(TYF_BOOLEAN, 0, 0, 0, 0);
		this.internType(TYF_SYMBOL, 0, 0, 0, 0);
		this.internType(TYF_NON_PRIMITIVE, 0, 0, 0, 0);
		this.internType(TYF_BOOLEAN_LITERAL, 0, 0, 1, 0); // TYPE_TRUE
		this.internType(TYF_BOOLEAN_LITERAL, 0, 0, 0, 0); // TYPE_FALSE
	}

	/** How many types exist so far. */
	get typeCount(): number {
		return this.#types.length / TYPE_WORDS;
	}

	/** How many members exist so far. */
	get memberCount(): number {
		return this.#members.length / MEMBER_WORDS;
	}

	//-------------------------------------------------------------------------
	// Strings
	//-------------------------------------------------------------------------

	/**
	 * Interns a string, reusing the ID of an equal one.
	 * @param value The string to intern.
	 * @returns The string's ID.
	 */
	intern(value: string): number {
		let id = this.#stringIds.get(value);

		if (id === undefined) {
			id = this.#strings.length;
			this.#strings.push(value);
			this.#stringIds.set(value, id);
		}

		return id;
	}

	/**
	 * The ID a string was interned under, without interning it.
	 * @param value The string to look up.
	 * @returns The ID, or `-1` when the string was never interned.
	 */
	stringId(value: string): number {
		const id = this.#stringIds.get(value);

		return id === undefined ? -1 : id;
	}

	/**
	 * The string an ID was interned for.
	 * @param id The string's ID.
	 * @returns The string.
	 */
	stringAt(id: number): string {
		return this.#strings[id];
	}

	//-------------------------------------------------------------------------
	// Types
	//-------------------------------------------------------------------------

	/**
	 * Interns a type with no members and no source node, reusing the ID of an
	 * identical one. For the record kinds whose words identify them — the
	 * intrinsics, literals, and bare references — this is what keeps one
	 * `"a"` literal type serving every `"a"` in the program.
	 * @param flags The `TYF_*` flags.
	 * @param shape The `TYS_*` shape bits.
	 * @param symbol The symbol ID plus one, or `0` for none.
	 * @param data0 The first data word.
	 * @param data1 The second data word.
	 * @returns The type's ID.
	 */
	internType(
		flags: number,
		shape: number,
		symbol: number,
		data0: number,
		data1: number,
	): number {
		const key = `${flags},${shape},${symbol},${data0},${data1}`;
		let id = this.#typeIds.get(key);

		if (id === undefined) {
			id = this.addType(flags, shape, symbol, data0, data1, 0, 0, 0);
			this.#typeIds.set(key, id);
		}

		return id;
	}

	/**
	 * Appends a type record.
	 * @param flags The `TYF_*` flags.
	 * @param shape The `TYS_*` shape bits.
	 * @param symbol The symbol ID plus one, or `0` for none.
	 * @param data0 The first data word.
	 * @param data1 The second data word.
	 * @param memberFirst The first member ID, `0` with no members.
	 * @param memberCount How many contiguous members belong to the type.
	 * @param node The handle of the node the type was read from, or `0`.
	 * @returns The type's ID.
	 */
	addType(
		flags: number,
		shape: number,
		symbol: number,
		data0: number,
		data1: number,
		memberFirst: number,
		memberCount: number,
		node: number,
	): number {
		const id = this.typeCount;
		const base = this.#types.reserve(TYPE_WORDS);
		const words = this.#types.data;

		words[base + TY_FLAGS] = flags;
		words[base + TY_SHAPE] = shape;
		words[base + TY_SYMBOL] = symbol;
		words[base + TY_DATA0] = data0;
		words[base + TY_DATA1] = data1;
		words[base + TY_MEMBER_FIRST] = memberFirst;
		words[base + TY_MEMBER_COUNT] = memberCount;
		words[base + TY_NODE] = node;

		return id;
	}

	/**
	 * Reads a field back from a type already recorded.
	 * @param type The type's ID.
	 * @param field The `TY_*` field index.
	 * @returns The word.
	 */
	typeField(type: number, field: number): number {
		return this.#types.data[type * TYPE_WORDS + field];
	}

	/**
	 * Rewrites a field of a type already recorded, for the two records —
	 * enums and class instances — whose member runs can only be counted
	 * after the record exists.
	 * @param type The type's ID.
	 * @param field The `TY_*` field index.
	 * @param value The word to store.
	 * @returns Nothing.
	 */
	patchType(type: number, field: number, value: number): void {
		this.#types.data[type * TYPE_WORDS + field] = value;
	}

	/**
	 * Reads a field back from a member already recorded.
	 * @param member The member's ID.
	 * @param field The `TM_*` field index.
	 * @returns The word.
	 */
	memberField(member: number, field: number): number {
		return this.#members.data[member * MEMBER_WORDS + field];
	}

	/**
	 * Reads a field back from a symbol already recorded.
	 * @param symbol The symbol's ID.
	 * @param field The `SY_*` field index.
	 * @returns The word.
	 */
	symbolField(symbol: number, field: number): number {
		return this.#symbols.data[symbol * TYPE_SYMBOL_WORDS + field];
	}

	/**
	 * How many items a pooled list holds.
	 * @param handle The pool handle.
	 * @returns The item count, `0` for the empty list.
	 */
	poolCount(handle: number): number {
		return handle === 0 ? 0 : this.#pool.data[handle];
	}

	/**
	 * One item of a pooled list.
	 * @param handle The pool handle.
	 * @param index The item's position.
	 * @returns The item.
	 */
	poolItem(handle: number, index: number): number {
		return this.#pool.data[handle + 1 + index];
	}

	/**
	 * Appends a member record. A type's members must be appended contiguously,
	 * between computing its `memberFirst` and its `addType()` call.
	 * @param name The member name's string ID, `0` for an index signature.
	 * @param type The member's type ID.
	 * @param flags The `TMF_*` flags.
	 * @returns The member's ID.
	 */
	addMember(name: number, type: number, flags: number): number {
		const id = this.memberCount;
		const base = this.#members.reserve(MEMBER_WORDS);
		const words = this.#members.data;

		words[base + TM_NAME] = name;
		words[base + TM_TYPE] = type;
		words[base + TM_FLAGS] = flags;

		return id;
	}

	//-------------------------------------------------------------------------
	// Symbols
	//-------------------------------------------------------------------------

	/**
	 * Interns a symbol, reusing the ID of an identical one.
	 * @param name The name's string ID.
	 * @param origin The `TYO_*` origin code.
	 * @param specifier The specifier's string ID plus one, or `0` for none.
	 * @param decl The handle of the declaring node, or `0`.
	 * @param target The scope symbol ID plus one, or `0` for none.
	 * @returns The symbol's ID.
	 */
	internSymbol(
		name: number,
		origin: number,
		specifier: number,
		decl: number,
		target: number,
	): number {
		const key = `${name},${origin},${specifier},${decl},${target}`;
		let id = this.#symbolIds.get(key);

		if (id === undefined) {
			id = this.#symbols.length / TYPE_SYMBOL_WORDS;

			const base = this.#symbols.reserve(TYPE_SYMBOL_WORDS);
			const words = this.#symbols.data;

			words[base + SY_NAME] = name;
			words[base + SY_ORIGIN] = origin;
			words[base + SY_SPECIFIER] = specifier;
			words[base + SY_DECL] = decl;
			words[base + SY_TARGET] = target;
			this.#symbolIds.set(key, id);
		}

		return id;
	}

	//-------------------------------------------------------------------------
	// Lists and lookups
	//-------------------------------------------------------------------------

	/**
	 * Stores a list in the pool.
	 * @param items The items to store.
	 * @returns The pool handle, `0` for an empty list.
	 */
	poolList(items: number[]): number {
		if (items.length === 0) {
			return 0;
		}

		const handle = this.#pool.length;
		const base = this.#pool.reserve(items.length + 1);
		const words = this.#pool.data;

		words[base] = items.length;

		for (let i = 0; i < items.length; i++) {
			words[base + 1 + i] = items[i];
		}

		return handle;
	}

	/**
	 * Records the type of a node.
	 * @param node The node's handle.
	 * @param type The type's ID.
	 * @returns Nothing.
	 */
	addNodeType(node: number, type: number): void {
		const base = this.#nodeTypes.reserve(2);

		this.#nodeTypes.data[base] = node;
		this.#nodeTypes.data[base + 1] = type;
	}

	/**
	 * Records the type of a scope symbol's value, keeping the first answer
	 * when the walk produces two.
	 * @param symbol The scope symbol's ID.
	 * @param type The type's ID.
	 * @returns Nothing.
	 */
	setSymbolType(symbol: number, type: number): void {
		if (this.#symbolTypes[symbol] === 0) {
			this.#symbolTypes[symbol] = type;
		}
	}

	/**
	 * The recorded value type of a scope symbol.
	 * @param symbol The scope symbol's ID.
	 * @returns The type ID, `TYPE_NONE` when unknown.
	 */
	symbolType(symbol: number): number {
		return this.#symbolTypes[symbol];
	}

	/**
	 * Records the type a scope symbol declares, keeping the first answer.
	 * @param symbol The scope symbol's ID.
	 * @param type The type's ID.
	 * @returns Nothing.
	 */
	setDeclaredType(symbol: number, type: number): void {
		if (this.#declaredTypes[symbol] === 0) {
			this.#declaredTypes[symbol] = type;
		}
	}

	/**
	 * The recorded declared type of a scope symbol.
	 * @param symbol The scope symbol's ID.
	 * @returns The type ID, `TYPE_NONE` for none.
	 */
	declaredType(symbol: number): number {
		return this.#declaredTypes[symbol];
	}

	//-------------------------------------------------------------------------
	// Emission
	//-------------------------------------------------------------------------

	/**
	 * Compacts everything recorded into one type buffer.
	 * @returns The buffer, in the format `types-buffer.ts` describes.
	 */
	finish(): ArrayBuffer {
		const typeCount = this.typeCount;
		const memberCount = this.memberCount;
		const symbolCount = this.#symbols.length / TYPE_SYMBOL_WORDS;
		const poolWords = this.#pool.length;
		const scopeSymbolCount = this.#symbolTypes.length;

		/*
		 * The node-type index is put in order and compacted here rather than
		 * after the copy below, so that the buffer is sized for what
		 * survives.
		 */
		const recorded = this.#nodeTypes.length / 2;

		sortPairs(this.#nodeTypes.data, recorded);

		const pairCount = compactPairs(this.#nodeTypes.data, recorded);

		const encoder = new TextEncoder();
		const encoded = this.#strings.map(value => encoder.encode(value));
		const stringOffsets = new Uint32Array(encoded.length + 1);
		let byteLength = 0;

		for (let i = 0; i < encoded.length; i++) {
			stringOffsets[i] = byteLength;
			byteLength += encoded[i].length;
		}

		stringOffsets[encoded.length] = byteLength;

		const typesBase = TYPES_HEADER_WORDS;
		const membersBase = typesBase + typeCount * TYPE_WORDS;
		const poolBase = membersBase + memberCount * MEMBER_WORDS;
		const symbolsBase = poolBase + poolWords;
		const symbolTypesBase = symbolsBase + symbolCount * TYPE_SYMBOL_WORDS;
		const declaredTypesBase = symbolTypesBase + scopeSymbolCount;
		const nodeTypeBase = declaredTypesBase + scopeSymbolCount;
		const stringsBase = nodeTypeBase + pairCount * NODE_TYPE_WORDS;
		const stringDataBase = stringsBase + stringOffsets.length;
		const totalWords = stringDataBase + Math.ceil(byteLength / 4);

		const buffer = new ArrayBuffer(totalWords * 4);
		const out = new Uint32Array(buffer);

		out[TYPES_H_MAGIC] = TYPES_BUFFER_MAGIC;
		out[TYPES_H_VERSION] = TYPES_BUFFER_VERSION;
		out[TYPES_H_FLAGS] = 0;
		out[TYPES_H_TYPE_COUNT] = typeCount;
		out[TYPES_H_MEMBER_COUNT] = memberCount;
		out[TYPES_H_SYMBOL_COUNT] = symbolCount;
		out[TYPES_H_TYPES_BASE] = typesBase;
		out[TYPES_H_MEMBERS_BASE] = membersBase;
		out[TYPES_H_POOL_BASE] = poolBase;
		out[TYPES_H_SYMBOLS_BASE] = symbolsBase;
		out[TYPES_H_SYMBOL_TYPES_BASE] = symbolTypesBase;
		out[TYPES_H_SYMBOL_TYPES_COUNT] = scopeSymbolCount;
		out[TYPES_H_DECLARED_TYPES_BASE] = declaredTypesBase;
		out[TYPES_H_NODE_TYPE_BASE] = nodeTypeBase;
		out[TYPES_H_NODE_TYPE_COUNT] = pairCount;
		out[TYPES_H_STRINGS_BASE] = stringsBase;
		out[TYPES_H_STRING_COUNT] = this.#strings.length;
		out[TYPES_H_STRING_BYTES] = byteLength;
		out[TYPES_H_IMPORTS_BASE] = 0;
		out[TYPES_H_IMPORT_COUNT] = 0;

		out.set(this.#types.data.subarray(0, this.#types.length), typesBase);
		out.set(
			this.#members.data.subarray(0, this.#members.length),
			membersBase,
		);
		out.set(this.#pool.data.subarray(0, poolWords), poolBase);
		out.set(
			this.#symbols.data.subarray(0, this.#symbols.length),
			symbolsBase,
		);
		out.set(this.#symbolTypes, symbolTypesBase);
		out.set(this.#declaredTypes, declaredTypesBase);
		out.set(this.#nodeTypes.data.subarray(0, pairCount * 2), nodeTypeBase);
		out.set(stringOffsets, stringsBase);

		const bytes = new Uint8Array(buffer, stringDataBase * 4, byteLength);
		let written = 0;

		for (let i = 0; i < encoded.length; i++) {
			bytes.set(encoded[i], written);
			written += encoded[i].length;
		}

		return buffer;
	}
}
