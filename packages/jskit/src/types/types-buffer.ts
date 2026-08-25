/**
 * @fileoverview The binary type format, field by field.
 *
 * `inferTypes()` returns one `ArrayBuffer` in this format. Everything in it
 * is a little-endian 32-bit word, the same convention the parse, scope, and
 * flow buffers use, and every consumer — `Types`, `TypesBufferReader`,
 * `toTypeTree()` — reads it through the constants below rather than through
 * magic numbers of its own.
 *
 * The format is shaped by how type-aware ESLint rules actually consume a type
 * checker, which starts with classification: "what kind of thing is this, in
 * one word?" So a type is first a **flags bitfield** whose values match
 * `ts.TypeFlags` where the two overlap, answered off one word, with composed
 * masks (`TYF_STRING_LIKE`, `TYF_NULLISH`) for the tests rules write. The
 * rest of a record carries what the deeper questions need: a shape word for
 * the object kinds, pooled union constituents and type arguments, member runs
 * for object properties, and a symbol naming the type and its **origin** —
 * local, the TypeScript standard library, a package, or a file — the same
 * three-way provenance `typescript-eslint`'s `TypeOrValueSpecifier` matches
 * types by.
 *
 * Node references are **handles**: the byte offset of the node's record in
 * the parse buffer the analysis ran over, exactly as the scope and flow
 * buffers store them. Handle `0` means "no node". Scope symbols are
 * referenced by their scope-buffer IDs; the two dense arrays indexed by them
 * are sized by the scope buffer's symbol count.
 *
 * IDs are stable and immutable: a type, member, or symbol is its zero-based
 * index into its own record section. Type ID `0` is the "no type recorded"
 * sentinel — record 0 is written but never meaningful — and the first
 * `TYPE_INTRINSIC_COUNT` records are the pinned intrinsic types listed at the
 * bottom, in that order, so `any` is type `1` in every buffer ever written.
 * Where a record field holds an optional ID, it is stored as `id + 1` so that
 * `0` can mean "none".
 *
 * The flag values, shape bits, origin codes, and intrinsic order are part of
 * the format and are **append-only**: repositioning an entry changes what
 * every previously written buffer means.
 */

//-----------------------------------------------------------------------------
// Header
//-----------------------------------------------------------------------------

/** The first word of every type buffer: "JSTY" read as little-endian bytes. */
export const TYPES_BUFFER_MAGIC = 0x5954534a;

/** The format version this module writes and reads. */
export const TYPES_BUFFER_VERSION = 1;

export const TYPES_H_MAGIC = 0;
export const TYPES_H_VERSION = 1;
export const TYPES_H_FLAGS = 2;
export const TYPES_H_TYPE_COUNT = 3;
export const TYPES_H_MEMBER_COUNT = 4;
export const TYPES_H_SYMBOL_COUNT = 5;
export const TYPES_H_TYPES_BASE = 6;
export const TYPES_H_MEMBERS_BASE = 7;
export const TYPES_H_POOL_BASE = 8;
export const TYPES_H_SYMBOLS_BASE = 9;
export const TYPES_H_SYMBOL_TYPES_BASE = 10;
export const TYPES_H_SYMBOL_TYPES_COUNT = 11;
export const TYPES_H_DECLARED_TYPES_BASE = 12;
export const TYPES_H_NODE_TYPE_BASE = 13;
export const TYPES_H_NODE_TYPE_COUNT = 14;
export const TYPES_H_STRINGS_BASE = 15;
export const TYPES_H_STRING_COUNT = 16;
export const TYPES_H_STRING_BYTES = 17;

/*
 * Reserved for a future imports section: a table linking symbols whose
 * origin is another file to the type buffer of that file, so a multi-file
 * store can resolve a foreign type without a format break. Both words are
 * written `0` today.
 */
export const TYPES_H_IMPORTS_BASE = 18;
export const TYPES_H_IMPORT_COUNT = 19;

/** How many words the header occupies. */
export const TYPES_HEADER_WORDS = 20;

//-----------------------------------------------------------------------------
// Records
//-----------------------------------------------------------------------------

/*
 * Every list-valued field holds a **pool handle**: a word offset into the
 * pool section where `[count, item0, item1, ...]` sits. Handle `0` is the
 * empty list.
 */

/** Words per type record. */
export const TYPE_WORDS = 8;
export const TY_FLAGS = 0; // TYF_* bitfield
export const TY_SHAPE = 1; // TYS_* bitfield
export const TY_SYMBOL = 2; // symbol ID + 1, 0 for none
export const TY_DATA0 = 3; // meaning depends on flags and shape; see below
export const TY_DATA1 = 4;
export const TY_MEMBER_FIRST = 5; // first member ID; members are contiguous
export const TY_MEMBER_COUNT = 6;
export const TY_NODE = 7; // node handle the type was read from, 0 for none

/*
 * What the two data words hold, by kind:
 *
 * - union, intersection: `TY_DATA0` is the pool handle of the constituent
 *   type IDs, in source order, flattened and deduplicated.
 * - reference (`TYS_REFERENCE`): `TY_DATA0` is the pool handle of the type
 *   argument IDs, `0` for none.
 * - tuple: `TY_DATA0` is the pool handle of the element type IDs.
 * - function, constructor: `TY_DATA0` is the pool handle of the parameter
 *   type IDs (`0` in a slot for an unannotated parameter is impossible — the
 *   pool stores type IDs, and an unannotated parameter stores `TYPE_NONE`),
 *   and `TY_DATA1` is the return type ID, `TYPE_NONE` for unannotated. A
 *   constructor's `TY_DATA1` is the instance type it constructs.
 * - class, interface: `TY_DATA0` is the pool handle of the base type IDs —
 *   `extends` heritage — and member lookup recurses through them.
 * - string, number, and bigint literals: `TY_DATA0` is the string ID of the
 *   value — the cooked text for strings, the raw source text for numbers and
 *   bigints, so no numeric formatting is baked into the buffer.
 * - boolean literals: `TY_DATA0` is `1` for `true`, `0` for `false`.
 * - enum literals: `TY_DATA0` is the string ID of the member name and
 *   `TY_DATA1` is the enum type's ID.
 * - type parameters: `TY_DATA0` is the constraint type ID and `TY_DATA1` the
 *   default type ID, `TYPE_NONE` for absent.
 */

/** Words per member record. Members are grouped by type, in source order. */
export const MEMBER_WORDS = 3;
export const TM_NAME = 0; // string ID, 0 for an index signature
export const TM_TYPE = 1; // type ID
export const TM_FLAGS = 2;

export const TMF_OPTIONAL = 1;
export const TMF_READONLY = 2;
export const TMF_METHOD = 4;
export const TMF_GETTER = 8;
export const TMF_SETTER = 16;

/** The member is a string index signature; `TM_NAME` is `0`. */
export const TMF_INDEX_STRING = 32;

/** The member is a number index signature; `TM_NAME` is `0`. */
export const TMF_INDEX_NUMBER = 64;

/** Words per symbol record. */
export const TYPE_SYMBOL_WORDS = 5;
export const SY_NAME = 0; // string ID
export const SY_ORIGIN = 1; // origin code
export const SY_SPECIFIER = 2; // string ID + 1: package name or file path
export const SY_DECL = 3; // node handle of the declaration, 0 for none
export const SY_TARGET = 4; // scope symbol ID + 1, 0 for none

//-----------------------------------------------------------------------------
// Type flags
//-----------------------------------------------------------------------------

/*
 * The values match `ts.TypeFlags` bit for bit on every flag both define, so
 * a rule ported from a `ts.TypeChecker` keeps its constants. Flags TypeScript
 * defines that this analysis never produces are not defined here, but their
 * bit positions are considered taken.
 */

export const TYF_ANY = 1 << 0;
export const TYF_UNKNOWN = 1 << 1;
export const TYF_STRING = 1 << 2;
export const TYF_NUMBER = 1 << 3;
export const TYF_BOOLEAN = 1 << 4;
export const TYF_ENUM = 1 << 5;
export const TYF_BIGINT = 1 << 6;
export const TYF_STRING_LITERAL = 1 << 7;
export const TYF_NUMBER_LITERAL = 1 << 8;
export const TYF_BOOLEAN_LITERAL = 1 << 9;
export const TYF_ENUM_LITERAL = 1 << 10;
export const TYF_BIGINT_LITERAL = 1 << 11;
export const TYF_SYMBOL = 1 << 12;
export const TYF_UNIQUE_SYMBOL = 1 << 13;
export const TYF_VOID = 1 << 14;
export const TYF_UNDEFINED = 1 << 15;
export const TYF_NULL = 1 << 16;
export const TYF_NEVER = 1 << 17;
export const TYF_TYPE_PARAMETER = 1 << 18;
export const TYF_OBJECT = 1 << 19;
export const TYF_UNION = 1 << 20;
export const TYF_INTERSECTION = 1 << 21;

/** The `object` keyword: anything that is not a primitive. */
export const TYF_NON_PRIMITIVE = 1 << 26;

export const TYF_TEMPLATE_LITERAL = 1 << 27;

/*
 * The composed masks rules actually test. `TYF_STRING_LIKE` differs from
 * `ts.TypeFlags.StringLike` only by the `StringMapping` bit, which this
 * analysis never produces.
 */
export const TYF_STRING_LIKE =
	TYF_STRING | TYF_STRING_LITERAL | TYF_TEMPLATE_LITERAL;
export const TYF_NUMBER_LIKE = TYF_NUMBER | TYF_NUMBER_LITERAL | TYF_ENUM;
export const TYF_BIGINT_LIKE = TYF_BIGINT | TYF_BIGINT_LITERAL;
export const TYF_BOOLEAN_LIKE = TYF_BOOLEAN | TYF_BOOLEAN_LITERAL;
export const TYF_ENUM_LIKE = TYF_ENUM | TYF_ENUM_LITERAL;
export const TYF_SYMBOL_LIKE = TYF_SYMBOL | TYF_UNIQUE_SYMBOL;
export const TYF_VOID_LIKE = TYF_VOID | TYF_UNDEFINED;
export const TYF_NULLISH = TYF_NULL | TYF_UNDEFINED | TYF_VOID;
export const TYF_LITERAL =
	TYF_STRING_LITERAL |
	TYF_NUMBER_LITERAL |
	TYF_BOOLEAN_LITERAL |
	TYF_BIGINT_LITERAL;

//-----------------------------------------------------------------------------
// Shapes
//-----------------------------------------------------------------------------

/*
 * The shape word plays the role `ts.ObjectFlags` plays: it distinguishes the
 * object kinds one flags word cannot. The values are this format's own.
 */

/** A named reference to another type: `Foo`, `Promise<T>`, `Array<T>`. */
export const TYS_REFERENCE = 1 << 0;

/** An anonymous object type: an object literal or a type literal. */
export const TYS_ANONYMOUS = 1 << 1;

/** A class's instance type. */
export const TYS_CLASS = 1 << 2;

/** An interface's declared type. */
export const TYS_INTERFACE = 1 << 3;

/** An array: `T[]`, `Array<T>`, `ReadonlyArray<T>`, an array literal. */
export const TYS_ARRAY = 1 << 4;

/** A tuple: `[A, B]`. */
export const TYS_TUPLE = 1 << 5;

/** A function. */
export const TYS_FUNCTION = 1 << 6;

/** A constructor; `TY_DATA1` is the instance type. */
export const TYS_CONSTRUCTOR = 1 << 7;

/** A TypeScript namespace or module declaration. */
export const TYS_NAMESPACE = 1 << 8;

/**
 * A construct this analysis reads past rather than models — a conditional,
 * mapped, indexed-access, `keyof`, or `typeof` type. The record says where it
 * came from; it claims nothing about what it is.
 */
export const TYS_DEFERRED = 1 << 9;

/** A reference whose name resolved to nothing known. */
export const TYS_UNRESOLVED = 1 << 10;

/**
 * A name whose structure lives in another file — an imported binding. The
 * symbol's origin says where; the reserved imports section is where a future
 * multi-file store would resolve it.
 */
export const TYS_FOREIGN = 1 << 11;

/**
 * An object type whose member list is incomplete: a spread, a computed key,
 * or a call signature kept it from being fully recorded. Absence of a member
 * proves nothing on an inexact type.
 */
export const TYS_INEXACT = 1 << 12;

/**
 * An object type with a call or construct signature among its members — a
 * callable interface or type literal. The signature itself is not recorded
 * (such a type is also inexact), but callability decides `typeof`: values
 * of the type answer `"function"`, never `"object"`.
 */
export const TYS_CALLABLE = 1 << 13;

//-----------------------------------------------------------------------------
// Origins
//-----------------------------------------------------------------------------

/*
 * Where a symbol's declaration lives, the split `TypeOrValueSpecifier`
 * matches on. Append-only.
 */

/** Declared in the file that was analyzed. */
export const TYO_LOCAL = 0;

/** A global this analysis knows the TypeScript standard library declares. */
export const TYO_LIB = 1;

/** Imported from a package; the specifier is the package name. */
export const TYO_PACKAGE = 2;

/** Imported from a file; the specifier is the path as written. */
export const TYO_FILE = 3;

/** An unresolved global this analysis cannot attribute. */
export const TYO_GLOBAL = 4;

/** Names of the origins, indexed by origin code. Append-only. */
export const TYPE_ORIGIN_NAMES: readonly string[] = [
	"local",
	"lib",
	"package",
	"file",
	"global",
];

//-----------------------------------------------------------------------------
// Intrinsic types
//-----------------------------------------------------------------------------

/*
 * The first records of every type buffer, written in this order before
 * anything else, so that the common types have the same ID in every buffer.
 * `TYPE_NONE` is the sentinel: record 0 exists but means "no type recorded".
 * Append-only.
 */

export const TYPE_NONE = 0;
export const TYPE_ANY = 1;
export const TYPE_UNKNOWN = 2;
export const TYPE_NEVER = 3;
export const TYPE_VOID = 4;
export const TYPE_UNDEFINED = 5;
export const TYPE_NULL = 6;
export const TYPE_STRING = 7;
export const TYPE_NUMBER = 8;
export const TYPE_BIGINT = 9;
export const TYPE_BOOLEAN = 10;
export const TYPE_SYMBOL = 11;
export const TYPE_OBJECT = 12;
export const TYPE_TRUE = 13;
export const TYPE_FALSE = 14;

/** How many intrinsic records every buffer starts with, sentinel included. */
export const TYPE_INTRINSIC_COUNT = 15;

/** Names of the intrinsic types, indexed by type ID. Append-only. */
export const TYPE_INTRINSIC_NAMES: readonly string[] = [
	"none",
	"any",
	"unknown",
	"never",
	"void",
	"undefined",
	"null",
	"string",
	"number",
	"bigint",
	"boolean",
	"symbol",
	"object",
	"true",
	"false",
];

//-----------------------------------------------------------------------------
// Indexes
//-----------------------------------------------------------------------------

/*
 * Three lookup sections turn "at this point in the AST" into a type ID:
 *
 * - The **node-type index** is `(node handle, type ID)` word pairs sorted by
 *   handle, one per node the walk typed, answered by binary search. Nodes the
 *   analysis could say nothing about have no entry.
 * - The **symbol-types array** is one word per scope-buffer symbol: the type
 *   of the symbol's *value* — what `x` holds. `TYPE_NONE` when unknown.
 * - The **declared-types array** is one word per scope-buffer symbol: the
 *   type the symbol *declares* — an interface's structure, a class's
 *   instance type, an alias's target, an enum's type. `TYPE_NONE` for
 *   symbols that declare no type.
 */

/** Words per node-type index entry. Entries are sorted by node handle. */
export const NODE_TYPE_WORDS = 2;
export const NT_NODE = 0; // node handle
export const NT_TYPE = 1; // type ID
