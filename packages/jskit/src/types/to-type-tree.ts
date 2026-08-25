/**
 * @fileoverview A plain-JSON view of a type buffer, for debugging and golden
 * files.
 *
 * Nothing here is needed to consume the analysis — `Types` answers queries
 * straight off the words. This view exists so a person can look at what the
 * walk recorded: every type with its flags spelled out, every typed symbol
 * by name, every typed node by position. The result is fully
 * JSON-serializable and self-contained.
 */

import { AstReader, NODE_KIND_NAMES } from "../parse/index.js";
import { ScopeBufferReader, V_NAME } from "../scope/index.js";
import { typeNodeAtHandle } from "./handles.js";
import { TypesBufferReader } from "./types-buffer-reader.js";
import { Types } from "./types.js";
import {
	NT_NODE,
	NT_TYPE,
	SY_NAME,
	SY_ORIGIN,
	SY_SPECIFIER,
	TM_FLAGS,
	TM_NAME,
	TM_TYPE,
	TMF_GETTER,
	TMF_INDEX_NUMBER,
	TMF_INDEX_STRING,
	TMF_METHOD,
	TMF_OPTIONAL,
	TMF_READONLY,
	TMF_SETTER,
	TYF_ANY,
	TYF_BIGINT,
	TYF_BIGINT_LITERAL,
	TYF_BOOLEAN,
	TYF_BOOLEAN_LITERAL,
	TYF_ENUM,
	TYF_ENUM_LITERAL,
	TYF_INTERSECTION,
	TYF_NEVER,
	TYF_NON_PRIMITIVE,
	TYF_NULL,
	TYF_NUMBER,
	TYF_NUMBER_LITERAL,
	TYF_OBJECT,
	TYF_STRING,
	TYF_STRING_LITERAL,
	TYF_SYMBOL,
	TYF_TEMPLATE_LITERAL,
	TYF_TYPE_PARAMETER,
	TYF_UNDEFINED,
	TYF_UNION,
	TYF_UNIQUE_SYMBOL,
	TYF_UNKNOWN,
	TYF_VOID,
	TYO_LOCAL,
	TYPE_ORIGIN_NAMES,
	TY_DATA0,
	TY_DATA1,
	TY_FLAGS,
	TY_MEMBER_COUNT,
	TY_MEMBER_FIRST,
	TY_NODE,
	TY_SHAPE,
	TY_SYMBOL,
	TYS_ANONYMOUS,
	TYS_ARRAY,
	TYS_CALLABLE,
	TYS_CLASS,
	TYS_CONSTRUCTOR,
	TYS_DEFERRED,
	TYS_FOREIGN,
	TYS_FUNCTION,
	TYS_INEXACT,
	TYS_INTERFACE,
	TYS_NAMESPACE,
	TYS_REFERENCE,
	TYS_TUPLE,
	TYS_UNRESOLVED,
} from "./types-buffer.js";

/** The flag bits and their names, in bit order. */
const FLAG_NAMES: readonly [number, string][] = [
	[TYF_ANY, "any"],
	[TYF_UNKNOWN, "unknown"],
	[TYF_STRING, "string"],
	[TYF_NUMBER, "number"],
	[TYF_BOOLEAN, "boolean"],
	[TYF_ENUM, "enum"],
	[TYF_BIGINT, "bigint"],
	[TYF_STRING_LITERAL, "string-literal"],
	[TYF_NUMBER_LITERAL, "number-literal"],
	[TYF_BOOLEAN_LITERAL, "boolean-literal"],
	[TYF_ENUM_LITERAL, "enum-literal"],
	[TYF_BIGINT_LITERAL, "bigint-literal"],
	[TYF_SYMBOL, "symbol"],
	[TYF_UNIQUE_SYMBOL, "unique-symbol"],
	[TYF_VOID, "void"],
	[TYF_UNDEFINED, "undefined"],
	[TYF_NULL, "null"],
	[TYF_NEVER, "never"],
	[TYF_TYPE_PARAMETER, "type-parameter"],
	[TYF_OBJECT, "object"],
	[TYF_UNION, "union"],
	[TYF_INTERSECTION, "intersection"],
	[TYF_NON_PRIMITIVE, "non-primitive"],
	[TYF_TEMPLATE_LITERAL, "template-literal"],
];

/** The shape bits and their names, in bit order. */
const SHAPE_NAMES: readonly [number, string][] = [
	[TYS_REFERENCE, "reference"],
	[TYS_ANONYMOUS, "anonymous"],
	[TYS_CLASS, "class"],
	[TYS_INTERFACE, "interface"],
	[TYS_ARRAY, "array"],
	[TYS_TUPLE, "tuple"],
	[TYS_FUNCTION, "function"],
	[TYS_CONSTRUCTOR, "constructor"],
	[TYS_NAMESPACE, "namespace"],
	[TYS_DEFERRED, "deferred"],
	[TYS_UNRESOLVED, "unresolved"],
	[TYS_FOREIGN, "foreign"],
	[TYS_INEXACT, "inexact"],
	[TYS_CALLABLE, "callable"],
];

/** The member flag bits and their names, in bit order. */
const MEMBER_FLAG_NAMES: readonly [number, string][] = [
	[TMF_OPTIONAL, "optional"],
	[TMF_READONLY, "readonly"],
	[TMF_METHOD, "method"],
	[TMF_GETTER, "getter"],
	[TMF_SETTER, "setter"],
	[TMF_INDEX_STRING, "index-string"],
	[TMF_INDEX_NUMBER, "index-number"],
];

/**
 * A node, named by what and where it is.
 */
export interface TypeTreeNode {
	/** The ESTree node type. */
	type: string;

	/** The offset the node starts at. */
	start: number;

	/** The offset just past the node. */
	end: number;
}

/**
 * One member of an object-like type.
 */
export interface TypeTreeMember {
	/** The member's name, `null` for an index signature. */
	name: string | null;

	/** The member's type ID. */
	type: number;

	/** The member's flags, spelled out. */
	flags: string[];
}

/**
 * One type record, spelled out.
 */
export interface TypeTreeType {
	/** The type's ID. */
	typeId: number;

	/** The flags set on it, in bit order. */
	flags: string[];

	/** The shape bits set on it, in bit order. */
	shape: string[];

	/** The type's name, `null` for an unnamed one. */
	name: string | null;

	/** Where the name came from, `null` for an unnamed type. */
	origin: string | null;

	/** The package or file the name came from, when the origin has one. */
	specifier: string | null;

	/** Pooled data — constituents, arguments, elements, parameters. */
	related: number[];

	/** The second data word, when the kind gives it meaning. */
	data: number;

	/** The members, for object-like types. */
	members: TypeTreeMember[];

	/** The node the type was read from, `null` for none. */
	node: TypeTreeNode | null;

	/** The type, rendered readably. */
	text: string;
}

/**
 * One scope symbol with a recorded type.
 */
export interface TypeTreeSymbol {
	/** The scope buffer's symbol ID. */
	symbol: number;

	/** The symbol's name. */
	name: string;

	/** The recorded value type, `0` for none. */
	type: number;

	/** The recorded declared type, `0` for none. */
	declared: number;
}

/**
 * One typed node.
 */
export interface TypeTreeEntry {
	/** The node. */
	node: TypeTreeNode;

	/** Its recorded type ID. */
	type: number;
}

/**
 * The whole buffer, rendered to plain JSON.
 */
export interface TypeTree {
	/** Every type record. */
	types: TypeTreeType[];

	/** Every scope symbol with a recorded type, in symbol order. */
	symbols: TypeTreeSymbol[];

	/** Every typed node, in handle order. */
	nodes: TypeTreeEntry[];
}

/**
 * Names the bits set in a flags word.
 * @param flags The word.
 * @param table The bit-name table.
 * @returns The names, in table order.
 */
function namesOf(flags: number, table: readonly [number, string][]): string[] {
	const names: string[] = [];

	for (let i = 0; i < table.length; i++) {
		if ((flags & table[i][0]) !== 0) {
			names.push(table[i][1]);
		}
	}

	return names;
}

/**
 * Renders a type buffer as a plain JSON tree.
 * @param types The type buffer returned by `inferTypes()`.
 * @param parsed The parse buffer the analysis ran over.
 * @param scope The scope buffer the analysis ran over.
 * @returns The tree.
 * @throws {TypeError} When a buffer is not what its parameter claims.
 */
export function toTypeTree(
	types: ArrayBufferLike,
	parsed: ArrayBufferLike,
	scope: ArrayBufferLike,
): TypeTree {
	const buffer = new TypesBufferReader(types);
	const reader = new AstReader(parsed);
	const scopeReader = new ScopeBufferReader(scope);
	const queries = new Types(types, parsed);

	const nodeOf = (handle: number): TypeTreeNode | null => {
		if (handle === 0) {
			return null;
		}

		const node = typeNodeAtHandle(reader, handle);

		return {
			type: NODE_KIND_NAMES[reader.kind(node)],
			start: reader.start(node),
			end: reader.end(node),
		};
	};

	const typeList: TypeTreeType[] = [];

	for (let type = 0; type < buffer.typeCount; type++) {
		const flags = buffer.typeField(type, TY_FLAGS);
		const shape = buffer.typeField(type, TY_SHAPE);
		const symbol = buffer.typeField(type, TY_SYMBOL);
		const data0 = buffer.typeField(type, TY_DATA0);
		const memberFirst = buffer.typeField(type, TY_MEMBER_FIRST);
		const memberCount = buffer.typeField(type, TY_MEMBER_COUNT);

		/*
		 * `TY_DATA0` is a pool handle for exactly these kinds; everywhere
		 * else it is a value the `text` rendering already presents.
		 */
		const pooled =
			(flags & (TYF_UNION | TYF_INTERSECTION)) !== 0 ||
			(shape &
				(TYS_REFERENCE |
					TYS_TUPLE |
					TYS_FUNCTION |
					TYS_CLASS |
					TYS_INTERFACE)) !==
				0;

		const members: TypeTreeMember[] = [];

		for (let i = 0; i < memberCount; i++) {
			const memberFlags = buffer.memberField(memberFirst + i, TM_FLAGS);
			const nameId = buffer.memberField(memberFirst + i, TM_NAME);

			members.push({
				name:
					(memberFlags & (TMF_INDEX_STRING | TMF_INDEX_NUMBER)) !== 0
						? null
						: buffer.string(nameId),
				type: buffer.memberField(memberFirst + i, TM_TYPE),
				flags: namesOf(memberFlags, MEMBER_FLAG_NAMES),
			});
		}

		let origin: string | null = null;
		let specifier: string | null = null;

		if (symbol !== 0) {
			origin =
				TYPE_ORIGIN_NAMES[buffer.symbolField(symbol - 1, SY_ORIGIN)] ??
				TYPE_ORIGIN_NAMES[TYO_LOCAL];

			const specifierId = buffer.symbolField(symbol - 1, SY_SPECIFIER);

			if (specifierId !== 0) {
				specifier = buffer.string(specifierId - 1);
			}
		}

		typeList.push({
			typeId: type,
			flags: namesOf(flags, FLAG_NAMES),
			shape: namesOf(shape, SHAPE_NAMES),
			name:
				symbol === 0
					? null
					: buffer.string(buffer.symbolField(symbol - 1, SY_NAME)),
			origin,
			specifier,
			related: pooled ? buffer.listItems(data0) : [],
			data: buffer.typeField(type, TY_DATA1),
			members,
			node: nodeOf(buffer.typeField(type, TY_NODE)),
			text: queries.typeToStringById(type),
		});
	}

	const symbols: TypeTreeSymbol[] = [];

	for (let symbol = 0; symbol < buffer.scopeSymbolCount; symbol++) {
		const type = buffer.symbolType(symbol);
		const declared = buffer.declaredType(symbol);

		if (type === 0 && declared === 0) {
			continue;
		}

		symbols.push({
			symbol,
			name: scopeReader.string(scopeReader.symbolField(symbol, V_NAME)),
			type,
			declared,
		});
	}

	const nodes: TypeTreeEntry[] = [];

	for (let i = 0; i < buffer.nodeTypeCount; i++) {
		const node = nodeOf(buffer.nodeTypeField(i, NT_NODE));

		if (node !== null) {
			nodes.push({ node, type: buffer.nodeTypeField(i, NT_TYPE) });
		}
	}

	return { types: typeList, symbols, nodes };
}
