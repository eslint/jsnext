/**
 * @fileoverview The binary scope format, field by field.
 *
 * `analyze()` and `analyzeTree()` both return one `ArrayBuffer` in this
 * format. Everything in it is a little-endian 32-bit word, the same convention
 * `@eslint/jsparse`'s parse buffer uses, and every consumer — `Scopes`,
 * `toScopeManager()`, `toScopeTree()` — reads it through the constants below
 * rather than through magic numbers of its own.
 *
 * Node references are **handles**. On the binary path a handle is the byte
 * offset of the node's record inside the parse buffer the analysis ran over. On
 * the tree path it is the node's one-based position in a deterministic
 * enumeration of the tree (see `tree-nodes.ts`). Handle `0` means "no node"
 * on both paths, which is what lets one format serve two representations.
 *
 * IDs are stable and immutable: a scope, symbol, reference, or definition is
 * its zero-based index into its own record section, assigned once when the
 * buffer is written and never renumbered. Where a record field holds an
 * optional ID, it is stored as `id + 1` so that `0` can mean "none".
 *
 * The enum code tables at the bottom are part of the format. **Their order is
 * append-only**: changing the position of an existing entry changes what
 * every previously written buffer means.
 */

import {
	DEF_CATCH_CLAUSE,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_IMPLICIT_GLOBAL_VARIABLE,
	DEF_IMPORT_BINDING,
	DEF_PARAMETER,
	DEF_TS_ENUM_MEMBER,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TYPE,
	DEF_VARIABLE,
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FOR,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_FUNCTION_TYPE,
	SCOPE_GLOBAL,
	SCOPE_MAPPED_TYPE,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
	SCOPE_WITH,
	type DefinitionType,
	type ScopeType,
} from "./kinds.js";

//-----------------------------------------------------------------------------
// Header
//-----------------------------------------------------------------------------

/** The first word of every scope buffer: "JSSC" read as little-endian bytes. */
export const SCOPE_BUFFER_MAGIC = 0x4353534a;

/** The format version this module writes and reads. */
export const SCOPE_BUFFER_VERSION = 1;

export const H_MAGIC = 0;
export const H_VERSION = 1;
export const H_FLAGS = 2;
export const H_SCOPE_COUNT = 3;
export const H_SYMBOL_COUNT = 4;
export const H_REFERENCE_COUNT = 5;
export const H_DEFINITION_COUNT = 6;
export const H_SCOPES_BASE = 7;
export const H_SYMBOLS_BASE = 8;
export const H_REFERENCES_BASE = 9;
export const H_DEFINITIONS_BASE = 10;
export const H_POOL_BASE = 11;
export const H_NODE_SCOPE_BASE = 12;
export const H_NODE_SCOPE_COUNT = 13;
export const H_DECLARED_BASE = 14;
export const H_DECLARED_COUNT = 15;
export const H_IDENT_REF_BASE = 16;
export const H_IDENT_REF_COUNT = 17;
export const H_STRINGS_BASE = 18;
export const H_STRING_COUNT = 19;
export const H_STRING_BYTES = 20;
export const H_OPTIONS = 21;
export const H_JSX_PRAGMA = 22;
export const H_JSX_FRAGMENT = 23;

/** How many words the header occupies. */
export const HEADER_WORDS = 24;

/** `H_FLAGS` bit: handles are tree enumeration indexes, not byte offsets. */
export const BUFFER_TREE_HANDLES = 1;

/*
 * `H_OPTIONS` records the options the analysis ran with, so that a consumer
 * of the buffer does not have to be told them again. `globals` is not among
 * them: supplied globals are already materialized as symbols by the time the
 * buffer is written.
 */
export const OPT_SOURCE_TYPE_MASK = 0b11;
export const OPT_SOURCE_TYPE_SCRIPT = 0;
export const OPT_SOURCE_TYPE_MODULE = 1;
export const OPT_SOURCE_TYPE_COMMONJS = 2;
export const OPT_DIALECT_TS = 1 << 2;
export const OPT_JSX = 1 << 3;
export const OPT_IMPLIED_STRICT = 1 << 4;
export const OPT_GLOBAL_RETURN = 1 << 5;
export const OPT_IGNORE_EVAL = 1 << 6;

//-----------------------------------------------------------------------------
// Records
//-----------------------------------------------------------------------------

/*
 * Every list-valued field holds a **pool handle**: a word offset into the
 * pool section where `[count, item0, item1, ...]` sits. Handle `0` is the
 * empty list.
 */

/** Words per scope record. */
export const SCOPE_WORDS = 9;
export const S_TYPE = 0; // scope type code
export const S_FLAGS = 1;
export const S_BLOCK = 2; // node handle
export const S_UPPER = 3; // scope ID + 1, 0 for the global scope
export const S_VARIABLE_SCOPE = 4; // scope ID
export const S_VARIABLES = 5; // pool handle: symbol IDs
export const S_REFERENCES = 6; // pool handle: reference IDs
export const S_THROUGH = 7; // pool handle: reference IDs
export const S_IMPLICIT = 8; // pool handle: symbol IDs, global scope only

export const SF_STRICT = 1;
export const SF_DYNAMIC = 2;
export const SF_FUNCTION_EXPRESSION_SCOPE = 4;
export const SF_DIRECT_EVAL = 8;
export const SF_THIS_FOUND = 16;

/** Words per symbol record. */
export const SYMBOL_WORDS = 6;
export const V_NAME = 0; // string ID
export const V_SCOPE = 1; // scope ID
export const V_FLAGS = 2;
export const V_IDENTIFIERS = 3; // pool handle: node handles
export const V_DEFINITIONS = 4; // pool handle: definition IDs
export const V_REFERENCES = 5; // pool handle: reference IDs

export const VF_TAINTED = 1;
export const VF_STACK = 2;

/**
 * The symbol lives in the global scope's implicit list — an undeclared
 * assignment created it — rather than in the scope's own variables.
 */
export const VF_IMPLICIT_GLOBAL = 4;

/** Words per reference record. */
export const REFERENCE_WORDS = 8;
export const R_IDENTIFIER = 0; // node handle
export const R_NAME = 1; // string ID
export const R_FROM = 2; // scope ID
export const R_RESOLVED = 3; // symbol ID + 1, 0 for unresolved
export const R_FLAGS = 4;
export const R_WRITE_EXPR = 5; // node handle
export const R_IG_PATTERN = 6; // node handle: maybe-implicit-global pattern
export const R_IG_NODE = 7; // node handle: maybe-implicit-global assignment

export const RF_READ = 1;
export const RF_WRITE = 2;
export const RF_INIT = 4;
export const RF_PARTIAL = 8;
export const RF_TAINTED = 16;
export const RF_VALUE = 32;
export const RF_TYPE = 64;

/** Words per definition record. */
export const DEFINITION_WORDS = 7;
export const D_TYPE = 0; // definition type code
export const D_NAME = 1; // node handle
export const D_NODE = 2; // node handle
export const D_PARENT = 3; // node handle, 0 for none
export const D_INDEX = 4; // index + 1, 0 for none
export const D_KIND = 5; // string ID + 1, 0 for none
export const D_FLAGS = 6;

export const DF_REST = 1;
export const DF_TYPE_DEFINITION = 2;
export const DF_VARIABLE_DEFINITION = 4;

//-----------------------------------------------------------------------------
// Indexes
//-----------------------------------------------------------------------------

/*
 * Three sorted pair sections answer the point queries rules ask most, each a
 * run of `(key, value)` word pairs sorted by key and, within a key, by value:
 *
 * - node-scope: block node handle → scope ID, for `acquire()`/`getScope()`.
 * - declared: declaring node handle → pool handle of the symbol IDs it
 *   declares, in declaration order, for `getDeclaredVariables()`.
 * - ident-ref: identifier node handle → reference ID, for resolving a single
 *   identifier without touching anything else.
 */

//-----------------------------------------------------------------------------
// Enum codes
//-----------------------------------------------------------------------------

/** Scope type codes, in format order. Append-only. */
export const SCOPE_TYPE_CODES: readonly ScopeType[] = [
	SCOPE_GLOBAL,
	SCOPE_MODULE,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_BLOCK,
	SCOPE_SWITCH,
	SCOPE_CATCH,
	SCOPE_WITH,
	SCOPE_FOR,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FUNCTION_TYPE,
	SCOPE_MAPPED_TYPE,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
];

/** Definition type codes, in format order. Append-only. */
export const DEFINITION_TYPE_CODES: readonly DefinitionType[] = [
	DEF_CATCH_CLAUSE,
	DEF_PARAMETER,
	DEF_FUNCTION_NAME,
	DEF_CLASS_NAME,
	DEF_VARIABLE,
	DEF_IMPORT_BINDING,
	DEF_IMPLICIT_GLOBAL_VARIABLE,
	DEF_TYPE,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TS_ENUM_MEMBER,
];

/**
 * Builds the reverse lookup from an enum's string to its code.
 * @param codes The code table to invert.
 * @returns The string-to-code map.
 */
function invert(codes: readonly string[]): Map<string, number> {
	const map = new Map<string, number>();

	for (let i = 0; i < codes.length; i++) {
		map.set(codes[i], i);
	}

	return map;
}

/** Scope type string to code. */
const SCOPE_TYPE_OF = /* @__PURE__ */ invert(SCOPE_TYPE_CODES);

/** Definition type string to code. */
const DEFINITION_TYPE_OF = /* @__PURE__ */ invert(DEFINITION_TYPE_CODES);

/**
 * The format code for a scope type.
 * @param type The scope type.
 * @returns Its code.
 */
export function codeOfScopeType(type: ScopeType): number {
	return SCOPE_TYPE_OF.get(type)!;
}

/**
 * The format code for a definition type.
 * @param type The definition type.
 * @returns Its code.
 */
export function codeOfDefinitionType(type: DefinitionType): number {
	return DEFINITION_TYPE_OF.get(type)!;
}
