//! The binary scope format, field by field.
//!
//! Port of the constants in `packages/jskit/src/scope/scope-buffer.ts`. The
//! enum code tables are append-only; the numeric codes here are the positions
//! the TypeScript tables assign.

/// The first word of every scope buffer: "JSSC" read as little-endian bytes.
pub const SCOPE_BUFFER_MAGIC: u32 = 0x4353534a;

/// The format version this module writes.
pub const SCOPE_BUFFER_VERSION: u32 = 1;

pub const SCOPE_H_MAGIC: usize = 0;
pub const SCOPE_H_VERSION: usize = 1;
pub const SCOPE_H_FLAGS: usize = 2;
pub const SCOPE_H_SCOPE_COUNT: usize = 3;
pub const SCOPE_H_SYMBOL_COUNT: usize = 4;
pub const SCOPE_H_REFERENCE_COUNT: usize = 5;
pub const SCOPE_H_DEFINITION_COUNT: usize = 6;
pub const SCOPE_H_SCOPES_BASE: usize = 7;
pub const SCOPE_H_SYMBOLS_BASE: usize = 8;
pub const SCOPE_H_REFERENCES_BASE: usize = 9;
pub const SCOPE_H_DEFINITIONS_BASE: usize = 10;
pub const SCOPE_H_POOL_BASE: usize = 11;
pub const SCOPE_H_NODE_SCOPE_BASE: usize = 12;
pub const SCOPE_H_NODE_SCOPE_COUNT: usize = 13;
pub const SCOPE_H_DECLARED_BASE: usize = 14;
pub const SCOPE_H_DECLARED_COUNT: usize = 15;
pub const SCOPE_H_IDENT_REF_BASE: usize = 16;
pub const SCOPE_H_IDENT_REF_COUNT: usize = 17;
pub const SCOPE_H_STRINGS_BASE: usize = 18;
pub const SCOPE_H_STRING_COUNT: usize = 19;
pub const SCOPE_H_STRING_BYTES: usize = 20;
pub const SCOPE_H_OPTIONS: usize = 21;
pub const SCOPE_H_JSX_PRAGMA: usize = 22;
pub const SCOPE_H_JSX_FRAGMENT: usize = 23;

/// How many words the header occupies.
pub const SCOPE_HEADER_WORDS: usize = 24;

pub const OPT_SOURCE_TYPE_SCRIPT: u32 = 0;
pub const OPT_SOURCE_TYPE_MODULE: u32 = 1;
pub const OPT_SOURCE_TYPE_COMMONJS: u32 = 2;
pub const OPT_DIALECT_TS: u32 = 1 << 2;
pub const OPT_JSX: u32 = 1 << 3;
pub const OPT_IMPLIED_STRICT: u32 = 1 << 4;
pub const OPT_GLOBAL_RETURN: u32 = 1 << 5;
pub const OPT_IGNORE_EVAL: u32 = 1 << 6;

/// Words per scope record.
pub const SCOPE_WORDS: usize = 9;
pub const S_TYPE: usize = 0;
pub const S_FLAGS: usize = 1;
pub const S_BLOCK: usize = 2;
pub const S_UPPER: usize = 3;
pub const S_VARIABLE_SCOPE: usize = 4;
pub const S_VARIABLES: usize = 5;
pub const S_REFERENCES: usize = 6;
pub const S_THROUGH: usize = 7;
pub const S_IMPLICIT: usize = 8;

pub const SF_STRICT: u32 = 1;
pub const SF_DYNAMIC: u32 = 2;
pub const SF_FUNCTION_EXPRESSION_SCOPE: u32 = 4;
pub const SF_DIRECT_EVAL: u32 = 8;
pub const SF_THIS_FOUND: u32 = 16;

/// Words per symbol record.
pub const SYMBOL_WORDS: usize = 8;
pub const V_NAME: usize = 0;
pub const V_SCOPE: usize = 1;
pub const V_FLAGS: usize = 2;
pub const V_IDENTIFIERS: usize = 3;
pub const V_DEFINITIONS: usize = 4;
pub const V_REFERENCES: usize = 5;
pub const V_READ_COUNT: usize = 6;
pub const V_WRITE_COUNT: usize = 7;

pub const VF_TAINTED: u32 = 1;
pub const VF_STACK: u32 = 2;
pub const VF_IMPLICIT_GLOBAL: u32 = 4;

/// Words per reference record.
pub const REFERENCE_WORDS: usize = 8;
pub const R_IDENTIFIER: usize = 0;
pub const R_NAME: usize = 1;
pub const R_FROM: usize = 2;
pub const R_RESOLVED: usize = 3;
pub const R_FLAGS: usize = 4;
pub const R_WRITE_EXPR: usize = 5;
pub const R_IG_PATTERN: usize = 6;
pub const R_IG_NODE: usize = 7;

pub const RF_READ: u32 = 1;
pub const RF_WRITE: u32 = 2;
pub const RF_INIT: u32 = 4;
pub const RF_PARTIAL: u32 = 8;
pub const RF_TAINTED: u32 = 16;
pub const RF_VALUE: u32 = 32;
pub const RF_TYPE: u32 = 64;

/// Words per definition record.
pub const DEFINITION_WORDS: usize = 7;
pub const D_TYPE: usize = 0;
pub const D_NAME: usize = 1;
pub const D_NODE: usize = 2;
pub const D_PARENT: usize = 3;
pub const D_INDEX: usize = 4;
pub const D_KIND: usize = 5;
pub const D_FLAGS: usize = 6;

pub const DF_REST: u32 = 1;
pub const DF_TYPE_DEFINITION: u32 = 2;
pub const DF_VARIABLE_DEFINITION: u32 = 4;

// Scope type codes, in format order (append-only).
pub const CODE_GLOBAL: u32 = 0;
pub const CODE_MODULE: u32 = 1;
pub const CODE_FUNCTION: u32 = 2;
pub const CODE_FUNCTION_EXPRESSION_NAME: u32 = 3;
pub const CODE_BLOCK: u32 = 4;
pub const CODE_SWITCH: u32 = 5;
pub const CODE_CATCH: u32 = 6;
pub const CODE_WITH: u32 = 7;
pub const CODE_FOR: u32 = 8;
pub const CODE_CLASS: u32 = 9;
pub const CODE_CLASS_FIELD_INITIALIZER: u32 = 10;
pub const CODE_CLASS_STATIC_BLOCK: u32 = 11;
pub const CODE_CONDITIONAL_TYPE: u32 = 12;
pub const CODE_FUNCTION_TYPE: u32 = 13;
pub const CODE_MAPPED_TYPE: u32 = 14;
pub const CODE_TS_ENUM: u32 = 15;
pub const CODE_TS_MODULE: u32 = 16;
pub const CODE_TYPE: u32 = 17;

// Definition type codes, in format order (append-only).
pub const DEF_CODE_CATCH: u32 = 0;
pub const DEF_CODE_PARAMETER: u32 = 1;
pub const DEF_CODE_FUNCTION: u32 = 2;
pub const DEF_CODE_CLASS: u32 = 3;
pub const DEF_CODE_VARIABLE: u32 = 4;
pub const DEF_CODE_IMPORT: u32 = 5;
pub const DEF_CODE_IMPLICIT: u32 = 6;
pub const DEF_CODE_TYPE: u32 = 7;
pub const DEF_CODE_ENUM: u32 = 8;
pub const DEF_CODE_MODULE: u32 = 9;
pub const DEF_CODE_ENUM_MEMBER: u32 = 10;
