/**
 * @fileoverview `Types`: the classification queries, keyed by node.
 *
 * `TypesBufferReader` reads words; this class answers questions. It resolves
 * a node — an index, or a `NodeRef` any ESTree node satisfies — to its
 * recorded type, chases references to the types their symbols declare, and
 * answers the classification family: `isNullish()`, `isTypeOf()`,
 * `isAwaitable()`, and the rest.
 *
 * Every predicate is conservative. A node the analysis recorded nothing for,
 * a type it deferred on, a name it could not resolve — all answer `false`,
 * never a guess. `getTypeId()` returning `TYPE_NONE` is how a caller tells
 * "no" from "no idea".
 */

import { AstReader, NODE_KIND_NAMES } from "../parse/index.js";
import { type NodeRef } from "../scope/index.js";
import { typeNodeAtHandle, typeNodeHandle } from "./handles.js";
import { TypesBufferReader } from "./types-buffer-reader.js";
import {
	NT_NODE,
	SY_NAME,
	SY_ORIGIN,
	SY_SPECIFIER,
	SY_TARGET,
	TM_FLAGS,
	TM_NAME,
	TM_TYPE,
	TMF_INDEX_NUMBER,
	TMF_INDEX_STRING,
	TYF_ANY,
	TYF_BIGINT_LIKE,
	TYF_BIGINT_LITERAL,
	TYF_BOOLEAN_LIKE,
	TYF_ENUM,
	TYF_ENUM_LIKE,
	TYF_ENUM_LITERAL,
	TYF_INTERSECTION,
	TYF_NON_PRIMITIVE,
	TYF_NULL,
	TYF_NULLISH,
	TYF_NUMBER_LIKE,
	TYF_NUMBER_LITERAL,
	TYF_OBJECT,
	TYF_STRING_LIKE,
	TYF_STRING_LITERAL,
	TYF_SYMBOL_LIKE,
	TYF_TEMPLATE_LITERAL,
	TYF_TYPE_PARAMETER,
	TYF_UNDEFINED,
	TYF_UNION,
	TYF_UNKNOWN,
	TYF_VOID,
	TYO_LIB,
	TYPE_INTRINSIC_COUNT,
	TYPE_INTRINSIC_NAMES,
	TYPE_NONE,
	TYPE_ORIGIN_NAMES,
	TY_DATA0,
	TY_DATA1,
	TY_FLAGS,
	TY_MEMBER_COUNT,
	TY_MEMBER_FIRST,
	TY_SHAPE,
	TY_SYMBOL,
	TYS_ARRAY,
	TYS_CALLABLE,
	TYS_CLASS,
	TYS_CONSTRUCTOR,
	TYS_DEFERRED,
	TYS_FOREIGN,
	TYS_FUNCTION,
	TYS_INTERFACE,
	TYS_REFERENCE,
	TYS_TUPLE,
	TYS_UNRESOLVED,
} from "./types-buffer.js";

/** How deep queries follow references and heritage before giving up. */
const LOOKUP_DEPTH = 8;

/** How deep `typeToString()` renders nested structure before eliding. */
const RENDER_DEPTH = 3;

/** The answers `typeof` can produce, as `isTypeOf()` accepts them. */
export type TypeOfName =
	| "string"
	| "number"
	| "bigint"
	| "boolean"
	| "symbol"
	| "undefined"
	| "object"
	| "function";

/**
 * Where a type's name was declared.
 */
export interface TypeOrigin {
	/** The origin kind: `local`, `lib`, `package`, `file`, or `global`. */
	kind: string;

	/** The package name or file path, `null` for the other kinds. */
	specifier: string | null;
}

/**
 * Classification queries over one program's type buffer.
 *
 * The parse buffer must be the one `inferTypes()` ran over: node references
 * in the type buffer are byte offsets into it, and `NodeRef` resolution
 * reads node kinds and extents from it.
 */
export class Types<TNode extends number = number> {
	/** The reader over the type buffer. */
	readonly #buffer: TypesBufferReader;

	/** The reader over the parse buffer. */
	readonly #reader: AstReader;

	/** Typed nodes by start offset, built on the first `NodeRef` query. */
	#handlesByStart: Map<number, number[]> | null = null;

	/**
	 * Creates the query interface over a program's buffers.
	 * @param types The type buffer returned by `inferTypes()`.
	 * @param parsed The parse buffer the analysis ran over.
	 * @throws {TypeError} When either buffer is not what its parameter
	 *      claims.
	 */
	constructor(types: ArrayBufferLike, parsed: ArrayBufferLike) {
		this.#buffer = new TypesBufferReader(types);
		this.#reader = new AstReader(parsed);
	}

	//-------------------------------------------------------------------------
	// Resolution
	//-------------------------------------------------------------------------

	/**
	 * The handle a node or reference resolves to.
	 * @param node The node index or reference.
	 * @returns The handle, `0` when nothing matches.
	 */
	#resolveHandle(node: TNode | NodeRef): number {
		if (typeof node === "number") {
			return typeNodeHandle(this.#reader, node);
		}

		return this.#handleAt(node);
	}

	/**
	 * The handle of the recorded node a reference names.
	 * @param ref The positional reference.
	 * @returns The handle, `0` when nothing recorded matches.
	 */
	#handleAt(ref: NodeRef): number {
		let map = this.#handlesByStart;

		if (map === null) {
			map = new Map();

			for (let i = 0; i < this.#buffer.nodeTypeCount; i++) {
				const handle = this.#buffer.nodeTypeField(i, NT_NODE);
				const node = typeNodeAtHandle(this.#reader, handle);
				const start = this.#reader.start(node);
				const handles = map.get(start);

				if (handles === undefined) {
					map.set(start, [handle]);
				} else if (handles.indexOf(handle) === -1) {
					handles.push(handle);
				}
			}

			this.#handlesByStart = map;
		}

		const candidates = map.get(ref.start);

		if (candidates === undefined) {
			return 0;
		}

		for (let i = 0; i < candidates.length; i++) {
			const node = typeNodeAtHandle(this.#reader, candidates[i]);

			if (NODE_KIND_NAMES[this.#reader.kind(node)] !== ref.type) {
				continue;
			}

			if (ref.end !== undefined && this.#reader.end(node) !== ref.end) {
				continue;
			}

			return candidates[i];
		}

		return 0;
	}

	/**
	 * The type recorded for a node.
	 * @param node The node index or reference.
	 * @returns The type ID, `TYPE_NONE` when the analysis recorded nothing.
	 */
	getTypeId(node: TNode | NodeRef): number {
		const handle = this.#resolveHandle(node);

		return handle === 0 ? TYPE_NONE : this.#buffer.typeOfNode(handle);
	}

	/**
	 * The value type recorded for a scope symbol.
	 * @param symbol The scope buffer's symbol ID.
	 * @returns The type ID, `TYPE_NONE` when nothing was recorded.
	 */
	getSymbolTypeId(symbol: number): number {
		return this.#buffer.symbolType(symbol);
	}

	/**
	 * The type a scope symbol declares — an interface's structure, a class's
	 * instance type, an alias's target, an enum's type.
	 * @param symbol The scope buffer's symbol ID.
	 * @returns The type ID, `TYPE_NONE` for a symbol that declares none.
	 */
	getDeclaredTypeId(symbol: number): number {
		return this.#buffer.declaredType(symbol);
	}

	/**
	 * A reference chased to the type its symbol declares, to a fixed depth.
	 * An alias reaches its target; an unresolved or foreign name stays put.
	 * @param type The type ID.
	 * @returns The resolved type ID.
	 */
	#resolved(type: number): number {
		for (let hop = 0; hop < LOOKUP_DEPTH; hop++) {
			if (
				type === TYPE_NONE ||
				(this.#buffer.typeField(type, TY_SHAPE) & TYS_REFERENCE) === 0
			) {
				return type;
			}

			const symbol = this.#buffer.typeField(type, TY_SYMBOL);

			if (symbol === 0) {
				return type;
			}

			const target = this.#buffer.symbolField(symbol - 1, SY_TARGET);

			if (target === 0) {
				return type;
			}

			const declared = this.#buffer.declaredType(target - 1);

			if (declared === TYPE_NONE || declared === type) {
				return type;
			}

			type = declared;
		}

		return type;
	}

	//-------------------------------------------------------------------------
	// Flags
	//-------------------------------------------------------------------------

	/**
	 * The `TYF_*` flags of a node's type.
	 * @param node The node index or reference.
	 * @returns The flags, `0` when nothing was recorded.
	 */
	getTypeFlags(node: TNode | NodeRef): number {
		return this.typeFlagsById(this.getTypeId(node));
	}

	/**
	 * The `TYF_*` flags of a type.
	 * @param type The type ID.
	 * @returns The flags, `0` for `TYPE_NONE`.
	 */
	typeFlagsById(type: number): number {
		return type === TYPE_NONE ? 0 : this.#buffer.typeField(type, TY_FLAGS);
	}

	/**
	 * The constituents of a union or intersection type.
	 * @param type The type ID.
	 * @returns The constituent type IDs, or the type itself alone.
	 */
	constituentTypeIds(type: number): number[] {
		if (type === TYPE_NONE) {
			return [];
		}

		const flags = this.#buffer.typeField(type, TY_FLAGS);

		if ((flags & (TYF_UNION | TYF_INTERSECTION)) === 0) {
			return [type];
		}

		return this.#buffer.listItems(this.#buffer.typeField(type, TY_DATA0));
	}

	//-------------------------------------------------------------------------
	// Classification
	//-------------------------------------------------------------------------

	/**
	 * Whether a node's value is definitely `null` or `undefined`.
	 * @param node The node index or reference.
	 * @returns `true` when every constituent of the type is nullish.
	 */
	isNullish(node: TNode | NodeRef): boolean {
		return this.isNullishById(this.getTypeId(node));
	}

	/**
	 * Whether a type is definitely nullish.
	 * @param type The type ID.
	 * @returns `true` when every constituent is nullish.
	 */
	isNullishById(type: number): boolean {
		if (type === TYPE_NONE) {
			return false;
		}

		const value =
			this.typeFlagsById(this.#resolved(type)) &
			~(TYF_UNION | TYF_INTERSECTION);

		return value !== 0 && (value & ~TYF_NULLISH) === 0;
	}

	/**
	 * Whether a node's value can be `null` or `undefined` — because the type
	 * admits it, or because the type is `any` or `unknown` and cannot rule
	 * it out.
	 * @param node The node index or reference.
	 * @returns `true` when nullishness cannot be excluded. A node with no
	 *      recorded type answers `false`: no claim either way.
	 */
	mayBeNullish(node: TNode | NodeRef): boolean {
		return this.mayBeNullishById(this.getTypeId(node));
	}

	/**
	 * Whether a type admits a nullish value.
	 * @param type The type ID.
	 * @returns `true` when nullishness cannot be excluded.
	 */
	mayBeNullishById(type: number): boolean {
		if (type === TYPE_NONE) {
			return false;
		}

		const flags = this.typeFlagsById(this.#resolved(type));

		return (flags & (TYF_NULLISH | TYF_ANY | TYF_UNKNOWN)) !== 0;
	}

	/**
	 * Whether `typeof` on a node's value definitely produces a name.
	 * @param node The node index or reference.
	 * @param name The `typeof` answer to test.
	 * @returns `true` when every constituent produces that answer.
	 */
	isTypeOf(node: TNode | NodeRef, name: TypeOfName): boolean {
		return this.isTypeOfById(this.getTypeId(node), name);
	}

	/**
	 * Whether `typeof` on a value of a type definitely produces a name.
	 * @param type The type ID.
	 * @param name The `typeof` answer to test.
	 * @returns `true` when every constituent produces that answer.
	 */
	isTypeOfById(type: number, name: TypeOfName): boolean {
		if (type === TYPE_NONE) {
			return false;
		}

		type = this.#resolved(type);

		const flags = this.#buffer.typeField(type, TY_FLAGS);

		if ((flags & TYF_UNION) !== 0) {
			const parts = this.constituentTypeIds(type);

			for (let i = 0; i < parts.length; i++) {
				if (!this.isTypeOfById(parts[i], name)) {
					return false;
				}
			}

			return parts.length > 0;
		}

		if ((flags & TYF_INTERSECTION) !== 0) {
			return this.#intersectionTypeOf(type) === name;
		}

		switch (name) {
			case "string":
				if ((flags & TYF_ENUM) !== 0) {
					return this.#enumBase(type) === "string";
				}

				return (flags & TYF_STRING_LIKE) !== 0;
			case "number":
				if ((flags & TYF_ENUM) !== 0) {
					return this.#enumBase(type) === "number";
				}

				return (flags & TYF_NUMBER_LIKE) !== 0;
			case "bigint":
				return (flags & TYF_BIGINT_LIKE) !== 0;
			case "boolean":
				return (flags & TYF_BOOLEAN_LIKE) !== 0;
			case "symbol":
				return (flags & TYF_SYMBOL_LIKE) !== 0;
			case "undefined":
				return (flags & (TYF_UNDEFINED | TYF_VOID)) !== 0;
			case "object": {
				if ((flags & TYF_NULL) !== 0) {
					return true;
				}

				if ((flags & TYF_ENUM) !== 0) {
					return false;
				}

				if ((flags & TYF_OBJECT) === 0) {
					return (flags & TYF_NON_PRIMITIVE) !== 0;
				}

				const shape = this.#buffer.typeField(type, TY_SHAPE);

				if (
					shape === 0 ||
					(shape &
						(TYS_FUNCTION | TYS_CONSTRUCTOR | TYS_CALLABLE)) !==
						0 ||
					(shape & TYS_REFERENCE) !== 0
				) {
					return false;
				}

				return (
					(shape & TYS_INTERFACE) === 0 ||
					this.#heritageCallability(type, LOOKUP_DEPTH) === "plain"
				);
			}
			case "function": {
				const shape = this.#buffer.typeField(type, TY_SHAPE);

				if (
					(shape &
						(TYS_FUNCTION | TYS_CONSTRUCTOR | TYS_CALLABLE)) !==
					0
				) {
					return true;
				}

				return (
					(shape & TYS_INTERFACE) !== 0 &&
					this.#heritageCallability(type, LOOKUP_DEPTH) === "callable"
				);
			}
			default:
				return false;
		}
	}

	/**
	 * Whether an interface describes callable values, judged through its
	 * `extends` bases: an interface inheriting a call signature describes
	 * functions, and one with a base whose structure is out of reach —
	 * foreign, unresolved, deferred — might, so it earns no `typeof` claim
	 * in either direction.
	 * @param type The interface or class type's ID.
	 * @param depth How many hops remain.
	 * @returns `"callable"`, `"plain"`, or `"unknown"`.
	 */
	#heritageCallability(
		type: number,
		depth: number,
	): "callable" | "plain" | "unknown" {
		if ((this.#buffer.typeField(type, TY_SHAPE) & TYS_CALLABLE) !== 0) {
			return "callable";
		}

		if (depth === 0) {
			return "unknown";
		}

		const pool = this.#buffer.typeField(type, TY_DATA0);
		const count = this.#buffer.listCount(pool);

		for (let i = 0; i < count; i++) {
			const base = this.#resolved(this.#buffer.listItem(pool, i));
			const shape = this.#buffer.typeField(base, TY_SHAPE);

			if (
				(shape & (TYS_FUNCTION | TYS_CONSTRUCTOR | TYS_CALLABLE)) !==
				0
			) {
				return "callable";
			}

			if (
				(shape &
					(TYS_REFERENCE |
						TYS_DEFERRED |
						TYS_UNRESOLVED |
						TYS_FOREIGN)) !==
				0
			) {
				return "unknown";
			}

			if ((shape & (TYS_INTERFACE | TYS_CLASS)) !== 0) {
				const inherited = this.#heritageCallability(base, depth - 1);

				if (inherited !== "plain") {
					return inherited;
				}
			}
		}

		return "plain";
	}

	/**
	 * The one `typeof` answer an intersection commits to. All constituents
	 * describe one value, so a primitive constituent decides — `string &
	 * Brand` is a string at runtime — then a callable one, then a plain
	 * object one.
	 * @param type The intersection type's ID.
	 * @returns The answer, or `null` when no constituent commits to one.
	 */
	#intersectionTypeOf(type: number): TypeOfName | null {
		const parts = this.constituentTypeIds(type);
		const primitives: TypeOfName[] = [
			"string",
			"number",
			"bigint",
			"boolean",
			"symbol",
			"undefined",
		];

		for (const name of primitives) {
			for (let i = 0; i < parts.length; i++) {
				if (this.isTypeOfById(parts[i], name)) {
					return name;
				}
			}
		}

		/*
		 * No primitive constituent pins the answer, so it is a choice
		 * between `"object"` and `"function"` — and a constituent that
		 * commits to neither, an unresolved reference say, could carry
		 * the call signature that flips the answer. Every constituent
		 * has to commit before the intersection can.
		 */
		let sawFunction = false;
		let sawObject = false;

		for (let i = 0; i < parts.length; i++) {
			if (this.isTypeOfById(parts[i], "function")) {
				sawFunction = true;
			} else if (this.isTypeOfById(parts[i], "object")) {
				sawObject = true;
			} else {
				return null;
			}
		}

		if (sawFunction) {
			return "function";
		}

		return sawObject ? "object" : null;
	}

	/**
	 * Whether every member of an enum shares one runtime base.
	 * @param type The enum type's ID.
	 * @returns `"string"`, `"number"`, or `null` for a mixed enum.
	 */
	#enumBase(type: number): string | null {
		const first = this.#buffer.typeField(type, TY_MEMBER_FIRST);
		const count = this.#buffer.typeField(type, TY_MEMBER_COUNT);
		let strings = 0;
		let numbers = 0;

		for (let i = 0; i < count; i++) {
			const memberType = this.#buffer.memberField(first + i, TM_TYPE);
			const flags = this.typeFlagsById(memberType);

			if ((flags & TYF_STRING_LITERAL) !== 0) {
				strings++;
			} else if ((flags & TYF_NUMBER_LITERAL) !== 0) {
				numbers++;
			}
		}

		if (count > 0 && strings === count) {
			return "string";
		}

		if (count > 0 && numbers === count) {
			return "number";
		}

		return null;
	}

	/**
	 * Whether a node's value is definitely a thenable — a `Promise` or
	 * `PromiseLike` from the standard library, or a type carrying a `then`
	 * member.
	 * @param node The node index or reference.
	 * @returns `true` when every constituent is awaitable.
	 */
	isAwaitable(node: TNode | NodeRef): boolean {
		return this.isAwaitableById(this.getTypeId(node));
	}

	/**
	 * Whether a type is definitely a thenable.
	 * @param type The type ID.
	 * @returns `true` when every constituent is awaitable.
	 */
	isAwaitableById(type: number): boolean {
		return this.#awaitable(type, LOOKUP_DEPTH);
	}

	/**
	 * The recursive core of `isAwaitableById()`.
	 * @param type The type ID.
	 * @param depth How many hops remain.
	 * @returns `true` for a definite thenable.
	 */
	#awaitable(type: number, depth: number): boolean {
		if (type === TYPE_NONE || depth === 0) {
			return false;
		}

		const flags = this.#buffer.typeField(type, TY_FLAGS);

		if ((flags & TYF_UNION) !== 0) {
			const parts = this.constituentTypeIds(type);

			for (let i = 0; i < parts.length; i++) {
				if (!this.#awaitable(parts[i], depth - 1)) {
					return false;
				}
			}

			return parts.length > 0;
		}

		if (this.#isLibReference(type, "Promise", "PromiseLike")) {
			return true;
		}

		return this.#findMember(this.#resolved(type), "then", depth) !== -1;
	}

	/**
	 * Whether a type is a reference to one of two standard-library names.
	 * @param type The type ID.
	 * @param first One name.
	 * @param second The other.
	 * @returns `true` for a library reference to either.
	 */
	#isLibReference(type: number, first: string, second: string): boolean {
		if ((this.#buffer.typeField(type, TY_SHAPE) & TYS_REFERENCE) === 0) {
			return false;
		}

		const symbol = this.#buffer.typeField(type, TY_SYMBOL);

		if (
			symbol === 0 ||
			this.#buffer.symbolField(symbol - 1, SY_ORIGIN) !== TYO_LIB
		) {
			return false;
		}

		const name = this.#buffer.string(
			this.#buffer.symbolField(symbol - 1, SY_NAME),
		);

		return name === first || name === second;
	}

	/**
	 * Whether a node's value is an array.
	 * @param node The node index or reference.
	 * @returns `true` for an array type.
	 */
	isArray(node: TNode | NodeRef): boolean {
		return this.isArrayById(this.getTypeId(node));
	}

	/**
	 * Whether a type is an array.
	 * @param type The type ID.
	 * @returns `true` for an array type.
	 */
	isArrayById(type: number): boolean {
		return (
			type !== TYPE_NONE &&
			(this.#buffer.typeField(type, TY_SHAPE) & TYS_ARRAY) !== 0
		);
	}

	/**
	 * Whether a node's value is a tuple.
	 * @param node The node index or reference.
	 * @returns `true` for a tuple type.
	 */
	isTuple(node: TNode | NodeRef): boolean {
		return this.isTupleById(this.getTypeId(node));
	}

	/**
	 * Whether a type is a tuple.
	 * @param type The type ID.
	 * @returns `true` for a tuple type.
	 */
	isTupleById(type: number): boolean {
		return (
			type !== TYPE_NONE &&
			(this.#buffer.typeField(type, TY_SHAPE) & TYS_TUPLE) !== 0
		);
	}

	/**
	 * Whether a node's value belongs to an enum.
	 * @param node The node index or reference.
	 * @returns `true` for an enum or enum member type.
	 */
	isEnumLike(node: TNode | NodeRef): boolean {
		const type = this.getTypeId(node);

		return (
			type !== TYPE_NONE &&
			(this.typeFlagsById(this.#resolved(type)) & TYF_ENUM_LIKE) !== 0
		);
	}

	//-------------------------------------------------------------------------
	// Names, origins, and properties
	//-------------------------------------------------------------------------

	/**
	 * The name a node's type was written with, unresolved names included.
	 * @param node The node index or reference.
	 * @returns The name, or `null` for an unnamed type.
	 */
	getTypeName(node: TNode | NodeRef): string | null {
		return this.typeNameById(this.getTypeId(node));
	}

	/**
	 * The name of a type.
	 * @param type The type ID.
	 * @returns The name, or `null` for an unnamed type.
	 */
	typeNameById(type: number): string | null {
		if (type === TYPE_NONE) {
			return null;
		}

		const symbol = this.#buffer.typeField(type, TY_SYMBOL);

		if (symbol === 0) {
			return null;
		}

		return this.#buffer.string(
			this.#buffer.symbolField(symbol - 1, SY_NAME),
		);
	}

	/**
	 * Where a node's type's name was declared — the split a
	 * `TypeOrValueSpecifier` matches on.
	 * @param node The node index or reference.
	 * @returns The origin, or `null` for an unnamed type.
	 */
	getTypeOrigin(node: TNode | NodeRef): TypeOrigin | null {
		return this.typeOriginById(this.getTypeId(node));
	}

	/**
	 * Where a type's name was declared.
	 * @param type The type ID.
	 * @returns The origin, or `null` for an unnamed type.
	 */
	typeOriginById(type: number): TypeOrigin | null {
		if (type === TYPE_NONE) {
			return null;
		}

		const symbol = this.#buffer.typeField(type, TY_SYMBOL);

		if (symbol === 0) {
			return null;
		}

		const specifier = this.#buffer.symbolField(symbol - 1, SY_SPECIFIER);

		return {
			kind: TYPE_ORIGIN_NAMES[
				this.#buffer.symbolField(symbol - 1, SY_ORIGIN)
			],
			specifier:
				specifier === 0 ? null : this.#buffer.string(specifier - 1),
		};
	}

	/**
	 * The type of a property on a node's value.
	 * @param node The node index or reference.
	 * @param name The property's name.
	 * @returns The property's type ID, `TYPE_NONE` when unknown.
	 */
	getPropertyTypeId(node: TNode | NodeRef, name: string): number {
		return this.propertyTypeIdById(this.getTypeId(node), name);
	}

	/**
	 * The type of a property on a type.
	 * @param type The type ID.
	 * @param name The property's name.
	 * @returns The property's type ID, `TYPE_NONE` when unknown.
	 */
	propertyTypeIdById(type: number, name: string): number {
		const member = this.#findMember(
			this.#resolved(type),
			name,
			LOOKUP_DEPTH,
		);

		return member === -1
			? TYPE_NONE
			: this.#buffer.memberField(member, TM_TYPE);
	}

	/**
	 * Finds a named member on a type, following heritage.
	 * @param type The type ID.
	 * @param name The member's name.
	 * @param depth How many hops remain.
	 * @returns The member's ID, or `-1`.
	 */
	#findMember(type: number, name: string, depth: number): number {
		if (type === TYPE_NONE || depth === 0) {
			return -1;
		}

		type = this.#resolved(type);

		const first = this.#buffer.typeField(type, TY_MEMBER_FIRST);
		const count = this.#buffer.typeField(type, TY_MEMBER_COUNT);

		for (let i = 0; i < count; i++) {
			if (
				(this.#buffer.memberField(first + i, TM_FLAGS) &
					(TMF_INDEX_STRING | TMF_INDEX_NUMBER)) !==
				0
			) {
				continue;
			}

			if (
				this.#buffer.string(
					this.#buffer.memberField(first + i, TM_NAME),
				) === name
			) {
				return first + i;
			}
		}

		const shape = this.#buffer.typeField(type, TY_SHAPE);

		if ((shape & (TYS_CLASS | TYS_INTERFACE)) !== 0) {
			const pool = this.#buffer.typeField(type, TY_DATA0);
			const bases = this.#buffer.listItems(pool);

			for (let i = 0; i < bases.length; i++) {
				const found = this.#findMember(bases[i], name, depth - 1);

				if (found !== -1) {
					return found;
				}
			}
		}

		return -1;
	}

	/**
	 * The element type of an array-typed node.
	 * @param node The node index or reference.
	 * @returns The element's type ID, `TYPE_NONE` when unknown.
	 */
	getElementTypeId(node: TNode | NodeRef): number {
		const type = this.getTypeId(node);

		if (!this.isArrayById(type)) {
			return TYPE_NONE;
		}

		const pool = this.#buffer.typeField(type, TY_DATA0);

		return this.#buffer.listCount(pool) > 0
			? this.#buffer.listItem(pool, 0)
			: TYPE_NONE;
	}

	//-------------------------------------------------------------------------
	// Rendering
	//-------------------------------------------------------------------------

	/**
	 * A readable spelling of a node's type, for messages and debugging.
	 * @param node The node index or reference.
	 * @returns The rendered type; `"unknown"` when nothing was recorded.
	 */
	typeToString(node: TNode | NodeRef): string {
		return this.typeToStringById(this.getTypeId(node));
	}

	/**
	 * A readable spelling of a type.
	 * @param type The type ID.
	 * @returns The rendered type.
	 */
	typeToStringById(type: number): string {
		return this.#render(type, RENDER_DEPTH);
	}

	/**
	 * The recursive core of `typeToStringById()`.
	 * @param type The type ID.
	 * @param depth How much nesting remains before eliding.
	 * @returns The rendered type.
	 */
	#render(type: number, depth: number): string {
		if (type === TYPE_NONE) {
			return "unknown";
		}

		if (type < TYPE_INTRINSIC_COUNT) {
			return TYPE_INTRINSIC_NAMES[type];
		}

		const buffer = this.#buffer;
		const flags = buffer.typeField(type, TY_FLAGS);
		const shape = buffer.typeField(type, TY_SHAPE);

		if ((flags & TYF_STRING_LITERAL) !== 0) {
			const text = buffer.string(buffer.typeField(type, TY_DATA0));

			return (flags & TYF_ENUM_LITERAL) !== 0
				? this.#renderEnumMember(type, text)
				: `"${text}"`;
		}

		if ((flags & TYF_NUMBER_LITERAL) !== 0) {
			const text = buffer.string(buffer.typeField(type, TY_DATA0));

			return (flags & TYF_ENUM_LITERAL) !== 0
				? this.#renderEnumMember(type, text)
				: text;
		}

		if ((flags & TYF_BIGINT_LITERAL) !== 0) {
			// The stored text is the source spelling, `n` suffix included.
			return buffer.string(buffer.typeField(type, TY_DATA0));
		}

		if ((flags & TYF_TEMPLATE_LITERAL) !== 0) {
			return "string";
		}

		if ((flags & TYF_UNION) !== 0) {
			return this.#renderList(type, " | ", depth);
		}

		if ((flags & TYF_INTERSECTION) !== 0) {
			return this.#renderList(type, " & ", depth);
		}

		if ((flags & TYF_TYPE_PARAMETER) !== 0) {
			return this.typeNameById(type) ?? "T";
		}

		if ((flags & TYF_ENUM) !== 0) {
			return this.typeNameById(type) ?? "enum";
		}

		if ((shape & TYS_ARRAY) !== 0) {
			const pool = buffer.typeField(type, TY_DATA0);
			const element =
				buffer.listCount(pool) > 0
					? this.#render(buffer.listItem(pool, 0), depth - 1)
					: "unknown";

			return element.indexOf(" ") === -1
				? `${element}[]`
				: `(${element})[]`;
		}

		if ((shape & TYS_TUPLE) !== 0) {
			const pool = buffer.typeField(type, TY_DATA0);
			const parts: string[] = [];

			for (let i = 0; i < buffer.listCount(pool); i++) {
				parts.push(this.#render(buffer.listItem(pool, i), depth - 1));
			}

			return `[${parts.join(", ")}]`;
		}

		if ((shape & TYS_REFERENCE) !== 0) {
			const name = this.typeNameById(type) ?? "unknown";
			const pool = buffer.typeField(type, TY_DATA0);
			const count = buffer.listCount(pool);

			if (count === 0) {
				return name;
			}

			const args: string[] = [];

			for (let i = 0; i < count; i++) {
				args.push(this.#render(buffer.listItem(pool, i), depth - 1));
			}

			return `${name}<${args.join(", ")}>`;
		}

		if ((shape & TYS_CONSTRUCTOR) !== 0) {
			return `new () => ${this.#render(
				buffer.typeField(type, TY_DATA1),
				depth - 1,
			)}`;
		}

		if ((shape & TYS_FUNCTION) !== 0) {
			const pool = buffer.typeField(type, TY_DATA0);
			const parts: string[] = [];

			for (let i = 0; i < buffer.listCount(pool); i++) {
				parts.push(this.#render(buffer.listItem(pool, i), depth - 1));
			}

			return `(${parts.join(", ")}) => ${this.#render(
				buffer.typeField(type, TY_DATA1),
				depth - 1,
			)}`;
		}

		const named = this.typeNameById(type);

		if (named !== null) {
			return named;
		}

		if (depth <= 0) {
			return "object";
		}

		const first = buffer.typeField(type, TY_MEMBER_FIRST);
		const count = buffer.typeField(type, TY_MEMBER_COUNT);
		const parts: string[] = [];

		for (let i = 0; i < count; i++) {
			const nameId = buffer.memberField(first + i, TM_NAME);
			const name =
				(buffer.memberField(first + i, TM_FLAGS) &
					(TMF_INDEX_STRING | TMF_INDEX_NUMBER)) !==
				0
					? "[index]"
					: buffer.string(nameId);

			parts.push(
				`${name}: ${this.#render(
					buffer.memberField(first + i, TM_TYPE),
					depth - 1,
				)}`,
			);
		}

		return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
	}

	/**
	 * Renders `Enum.Member` for an enum literal type.
	 * @param type The enum literal type's ID.
	 * @param member The member's name.
	 * @returns The rendered name.
	 */
	#renderEnumMember(type: number, member: string): string {
		const owner = this.typeNameById(type);

		return owner === null ? member : `${owner}.${member}`;
	}

	/**
	 * Joins a union or intersection's constituents.
	 * @param type The type ID.
	 * @param separator The separator between parts.
	 * @param depth How much nesting remains.
	 * @returns The rendered list.
	 */
	#renderList(type: number, separator: string, depth: number): string {
		const parts = this.constituentTypeIds(type);
		const rendered: string[] = [];

		for (let i = 0; i < parts.length; i++) {
			rendered.push(this.#render(parts[i], depth - 1));
		}

		return rendered.join(separator);
	}
}
