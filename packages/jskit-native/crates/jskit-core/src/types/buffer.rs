//! The binary type format, field by field.
//!
//! Port of `packages/jskit/src/types/types-buffer.ts`. Every constant here
//! must match its TypeScript counterpart exactly; the differential tools
//! compare raw bytes.

/// The first word of every type buffer: "JSTY" read as little-endian bytes.
pub const TYPES_BUFFER_MAGIC: u32 = 0x5954534a;

/// The format version this module writes.
pub const TYPES_BUFFER_VERSION: u32 = 1;

pub const TYPES_H_MAGIC: usize = 0;
pub const TYPES_H_VERSION: usize = 1;
pub const TYPES_H_FLAGS: usize = 2;
pub const TYPES_H_TYPE_COUNT: usize = 3;
pub const TYPES_H_MEMBER_COUNT: usize = 4;
pub const TYPES_H_SYMBOL_COUNT: usize = 5;
pub const TYPES_H_TYPES_BASE: usize = 6;
pub const TYPES_H_MEMBERS_BASE: usize = 7;
pub const TYPES_H_POOL_BASE: usize = 8;
pub const TYPES_H_SYMBOLS_BASE: usize = 9;
pub const TYPES_H_SYMBOL_TYPES_BASE: usize = 10;
pub const TYPES_H_SYMBOL_TYPES_COUNT: usize = 11;
pub const TYPES_H_DECLARED_TYPES_BASE: usize = 12;
pub const TYPES_H_NODE_TYPE_BASE: usize = 13;
pub const TYPES_H_NODE_TYPE_COUNT: usize = 14;
pub const TYPES_H_STRINGS_BASE: usize = 15;
pub const TYPES_H_STRING_COUNT: usize = 16;
pub const TYPES_H_STRING_BYTES: usize = 17;
pub const TYPES_H_IMPORTS_BASE: usize = 18;
pub const TYPES_H_IMPORT_COUNT: usize = 19;

/// How many words the header occupies.
pub const TYPES_HEADER_WORDS: usize = 20;

/// Words per type record.
pub const TYPE_WORDS: usize = 8;
pub const TY_FLAGS: usize = 0;
pub const TY_SHAPE: usize = 1;
pub const TY_SYMBOL: usize = 2;
pub const TY_DATA0: usize = 3;
pub const TY_DATA1: usize = 4;
pub const TY_MEMBER_FIRST: usize = 5;
pub const TY_MEMBER_COUNT: usize = 6;
pub const TY_NODE: usize = 7;

/// Words per member record.
pub const MEMBER_WORDS: usize = 3;
pub const TM_NAME: usize = 0;
pub const TM_TYPE: usize = 1;
pub const TM_FLAGS: usize = 2;

pub const TMF_OPTIONAL: u32 = 1;
pub const TMF_READONLY: u32 = 2;
pub const TMF_METHOD: u32 = 4;
pub const TMF_GETTER: u32 = 8;
pub const TMF_SETTER: u32 = 16;
pub const TMF_INDEX_STRING: u32 = 32;
pub const TMF_INDEX_NUMBER: u32 = 64;

/// Words per symbol record.
pub const TYPE_SYMBOL_WORDS: usize = 5;
pub const SY_NAME: usize = 0;
pub const SY_ORIGIN: usize = 1;
pub const SY_SPECIFIER: usize = 2;
pub const SY_DECL: usize = 3;
pub const SY_TARGET: usize = 4;

// Type flags, `ts.TypeFlags`-aligned where both define a bit.
pub const TYF_ANY: u32 = 1 << 0;
pub const TYF_UNKNOWN: u32 = 1 << 1;
pub const TYF_STRING: u32 = 1 << 2;
pub const TYF_NUMBER: u32 = 1 << 3;
pub const TYF_BOOLEAN: u32 = 1 << 4;
pub const TYF_ENUM: u32 = 1 << 5;
pub const TYF_BIGINT: u32 = 1 << 6;
pub const TYF_STRING_LITERAL: u32 = 1 << 7;
pub const TYF_NUMBER_LITERAL: u32 = 1 << 8;
pub const TYF_BOOLEAN_LITERAL: u32 = 1 << 9;
pub const TYF_ENUM_LITERAL: u32 = 1 << 10;
pub const TYF_BIGINT_LITERAL: u32 = 1 << 11;
pub const TYF_SYMBOL: u32 = 1 << 12;
pub const TYF_UNIQUE_SYMBOL: u32 = 1 << 13;
pub const TYF_VOID: u32 = 1 << 14;
pub const TYF_UNDEFINED: u32 = 1 << 15;
pub const TYF_NULL: u32 = 1 << 16;
pub const TYF_NEVER: u32 = 1 << 17;
pub const TYF_TYPE_PARAMETER: u32 = 1 << 18;
pub const TYF_OBJECT: u32 = 1 << 19;
pub const TYF_UNION: u32 = 1 << 20;
pub const TYF_INTERSECTION: u32 = 1 << 21;
pub const TYF_NON_PRIMITIVE: u32 = 1 << 26;
pub const TYF_TEMPLATE_LITERAL: u32 = 1 << 27;

pub const TYF_STRING_LIKE: u32 = TYF_STRING | TYF_STRING_LITERAL | TYF_TEMPLATE_LITERAL;
pub const TYF_NUMBER_LIKE: u32 = TYF_NUMBER | TYF_NUMBER_LITERAL | TYF_ENUM;
pub const TYF_BIGINT_LIKE: u32 = TYF_BIGINT | TYF_BIGINT_LITERAL;
pub const TYF_BOOLEAN_LIKE: u32 = TYF_BOOLEAN | TYF_BOOLEAN_LITERAL;
pub const TYF_ENUM_LIKE: u32 = TYF_ENUM | TYF_ENUM_LITERAL;
pub const TYF_NULLISH: u32 = TYF_NULL | TYF_UNDEFINED | TYF_VOID;

// Shapes.
pub const TYS_REFERENCE: u32 = 1 << 0;
pub const TYS_ANONYMOUS: u32 = 1 << 1;
pub const TYS_CLASS: u32 = 1 << 2;
pub const TYS_INTERFACE: u32 = 1 << 3;
pub const TYS_ARRAY: u32 = 1 << 4;
pub const TYS_TUPLE: u32 = 1 << 5;
pub const TYS_FUNCTION: u32 = 1 << 6;
pub const TYS_CONSTRUCTOR: u32 = 1 << 7;
pub const TYS_NAMESPACE: u32 = 1 << 8;
pub const TYS_DEFERRED: u32 = 1 << 9;
pub const TYS_UNRESOLVED: u32 = 1 << 10;
pub const TYS_FOREIGN: u32 = 1 << 11;
pub const TYS_INEXACT: u32 = 1 << 12;
pub const TYS_CALLABLE: u32 = 1 << 13;

// Origins.
pub const TYO_LOCAL: u32 = 0;
pub const TYO_LIB: u32 = 1;
pub const TYO_PACKAGE: u32 = 2;
pub const TYO_FILE: u32 = 3;
pub const TYO_GLOBAL: u32 = 4;

// Intrinsic type IDs, pinned by internment order.
pub const TYPE_NONE: u32 = 0;
pub const TYPE_ANY: u32 = 1;
pub const TYPE_UNKNOWN: u32 = 2;
pub const TYPE_NEVER: u32 = 3;
pub const TYPE_VOID: u32 = 4;
pub const TYPE_UNDEFINED: u32 = 5;
pub const TYPE_NULL: u32 = 6;
pub const TYPE_STRING: u32 = 7;
pub const TYPE_NUMBER: u32 = 8;
pub const TYPE_BIGINT: u32 = 9;
pub const TYPE_BOOLEAN: u32 = 10;
pub const TYPE_SYMBOL: u32 = 11;
pub const TYPE_OBJECT: u32 = 12;
pub const TYPE_TRUE: u32 = 13;
pub const TYPE_FALSE: u32 = 14;

/// Words per node-type index entry. Entries are sorted by node handle.
pub const NODE_TYPE_WORDS: usize = 2;
