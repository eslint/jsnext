//! What each node slot holds, packed two bits per slot.
//!
//! Port of the `SLOT_DESCRIPTORS` half of `packages/jskit/src/parse/slots.ts`,
//! which is all the buffer producers need: the parent-table sweep reads a
//! kind's whole layout in one word. The two-bits-per-slot packing and the
//! per-kind layouts must match the TypeScript table exactly.

use super::node_kinds::*;

/// The slot holds nothing of interest to a generic walk.
pub const SLOT_DATA: u32 = 0;

/// The slot holds a single child node index.
pub const SLOT_NODE: u32 = 1;

/// The slot holds a handle for a list of child nodes.
pub const SLOT_LIST: u32 = 2;

/// Number of data slots described for each node kind.
pub const SLOT_COUNT: usize = 8;

/// The whole slot layout of a kind in one word, two bits per slot.
pub const SLOT_DESCRIPTORS: [u16; NODE_KIND_COUNT] = build_slot_descriptors();

/// Slot descriptors for every node kind, `SLOT_COUNT` entries per kind — the
/// same information as `SLOT_DESCRIPTORS`, in the one-slot-at-a-time shape
/// the scope walk reads.
pub const SLOT_TABLE: [u8; NODE_KIND_COUNT * SLOT_COUNT] = build_slot_table();

const fn build_slot_table() -> [u8; NODE_KIND_COUNT * SLOT_COUNT] {
    let descriptors = build_slot_descriptors();
    let mut table = [0u8; NODE_KIND_COUNT * SLOT_COUNT];
    let mut kind = 0;

    while kind < NODE_KIND_COUNT {
        let mut slot = 0;

        while slot < SLOT_COUNT {
            table[kind * SLOT_COUNT + slot] =
                ((descriptors[kind] >> (slot * 2)) & 3) as u8;
            slot += 1;
        }

        kind += 1;
    }

    table
}

const N: u32 = SLOT_NODE;
const L: u32 = SLOT_LIST;
const D: u32 = SLOT_DATA;

const fn pack(slots: &[u32]) -> u16 {
    let mut descriptors = 0u16;
    let mut slot = 0;

    while slot < slots.len() {
        descriptors |= (slots[slot] as u16) << (slot * 2);
        slot += 1;
    }

    descriptors
}

const fn define(table: &mut [u16; NODE_KIND_COUNT], kinds: &[u32], slots: &[u32]) {
    let descriptors = pack(slots);
    let mut i = 0;

    while i < kinds.len() {
        table[kinds[i] as usize] = descriptors;
        i += 1;
    }
}

const fn build_slot_descriptors() -> [u16; NODE_KIND_COUNT] {
    let mut t = [0u16; NODE_KIND_COUNT];

    define(&mut t, &[N_PROGRAM], &[L]);
    define(&mut t, &[N_IDENTIFIER], &[D, N, L]);
    define(&mut t, &[N_LITERAL], &[D, D]);
    define(&mut t, &[N_TEMPLATE_LITERAL, N_TS_TEMPLATE_LITERAL_TYPE], &[L, L]);
    define(&mut t, &[N_TAGGED_TEMPLATE_EXPRESSION], &[N, N, N]);
    define(&mut t, &[N_EXPRESSION_STATEMENT], &[N, D]);
    define(
        &mut t,
        &[
            N_BLOCK_STATEMENT,
            N_STATIC_BLOCK,
            N_CLASS_BODY,
            N_TS_MODULE_BLOCK,
            N_TS_INTERFACE_BODY,
            N_TS_ENUM_BODY,
            N_SEQUENCE_EXPRESSION,
            N_TS_TUPLE_TYPE,
            N_TS_UNION_TYPE,
            N_TS_INTERSECTION_TYPE,
            N_TS_TYPE_LITERAL,
            N_TS_TYPE_PARAMETER_DECLARATION,
            N_TS_TYPE_PARAMETER_INSTANTIATION,
            N_VARIABLE_DECLARATION,
        ],
        &[L],
    );
    define(&mut t, &[N_WITH_STATEMENT, N_LABELED_STATEMENT], &[N, N]);
    define(
        &mut t,
        &[
            N_RETURN_STATEMENT,
            N_THROW_STATEMENT,
            N_AWAIT_EXPRESSION,
            N_SPREAD_ELEMENT,
            N_CHAIN_EXPRESSION,
            N_DECORATOR,
            N_TS_EXPORT_ASSIGNMENT,
            N_TS_EXTERNAL_MODULE_REFERENCE,
            N_TS_NAMESPACE_EXPORT_DECLARATION,
            N_TS_NON_NULL_EXPRESSION,
            N_YIELD_EXPRESSION,
            N_BREAK_STATEMENT,
            N_CONTINUE_STATEMENT,
            N_EXPORT_DEFAULT_DECLARATION,
            N_TS_TYPE_ANNOTATION,
            N_TS_ARRAY_TYPE,
            N_TS_REST_TYPE,
            N_TS_OPTIONAL_TYPE,
            N_TS_INFER_TYPE,
            N_TS_LITERAL_TYPE,
            N_IMPORT_DEFAULT_SPECIFIER,
            N_IMPORT_NAMESPACE_SPECIFIER,
        ],
        &[N],
    );
    define(
        &mut t,
        &[N_IF_STATEMENT, N_CONDITIONAL_EXPRESSION, N_TRY_STATEMENT],
        &[N, N, N],
    );
    define(&mut t, &[N_SWITCH_STATEMENT, N_SWITCH_CASE], &[N, L]);
    define(
        &mut t,
        &[N_CATCH_CLAUSE, N_WHILE_STATEMENT, N_DO_WHILE_STATEMENT],
        &[N, N],
    );
    define(&mut t, &[N_FOR_STATEMENT], &[N, N, N, N]);
    define(&mut t, &[N_FOR_IN_STATEMENT, N_FOR_OF_STATEMENT], &[N, N, N]);
    define(&mut t, &[N_VARIABLE_DECLARATOR], &[N, N]);
    define(&mut t, &[N_ASSIGNMENT_PATTERN], &[N, N, L]);
    define(
        &mut t,
        &[
            N_FUNCTION_DECLARATION,
            N_FUNCTION_EXPRESSION,
            N_TS_DECLARE_FUNCTION,
            N_TS_EMPTY_BODY_FUNCTION_EXPRESSION,
            N_ARROW_FUNCTION_EXPRESSION,
        ],
        &[N, L, N, N, N],
    );
    define(
        &mut t,
        &[N_CLASS_DECLARATION, N_CLASS_EXPRESSION],
        &[N, N, N, N, N, L, L],
    );
    define(
        &mut t,
        &[N_METHOD_DEFINITION, N_TS_ABSTRACT_METHOD_DEFINITION],
        &[N, N, L],
    );
    define(
        &mut t,
        &[
            N_PROPERTY_DEFINITION,
            N_TS_ABSTRACT_PROPERTY_DEFINITION,
            N_ACCESSOR_PROPERTY,
            N_TS_ABSTRACT_ACCESSOR_PROPERTY,
        ],
        &[N, N, L, N],
    );
    define(&mut t, &[N_ARRAY_EXPRESSION, N_OBJECT_EXPRESSION], &[L, N]);
    define(&mut t, &[N_ARRAY_PATTERN, N_OBJECT_PATTERN], &[L, N, L]);
    define(
        &mut t,
        &[
            N_PROPERTY,
            N_MEMBER_EXPRESSION,
            N_META_PROPERTY,
            N_IMPORT_SPECIFIER,
            N_IMPORT_ATTRIBUTE,
            N_EXPORT_SPECIFIER,
            N_IMPORT_EXPRESSION,
            N_TS_NAMED_TUPLE_MEMBER,
            N_TS_INDEXED_ACCESS_TYPE,
            N_TS_TYPE_REFERENCE,
            N_TS_QUALIFIED_NAME,
            N_TS_TYPE_QUERY,
            N_TS_INTERFACE_HERITAGE,
            N_TS_CLASS_IMPLEMENTS,
            N_TS_PROPERTY_SIGNATURE,
            N_TS_ENUM_MEMBER,
            N_TS_MODULE_DECLARATION,
            N_TS_AS_EXPRESSION,
            N_TS_SATISFIES_EXPRESSION,
            N_TS_TYPE_ASSERTION,
            N_TS_INSTANTIATION_EXPRESSION,
            N_TS_IMPORT_EQUALS_DECLARATION,
            N_TS_ENUM_DECLARATION,
            N_TS_INDEX_SIGNATURE,
        ],
        &[N, N],
    );
    define(&mut t, &[N_TS_INDEX_SIGNATURE], &[L, N]);
    define(
        &mut t,
        &[N_UNARY_EXPRESSION, N_UPDATE_EXPRESSION, N_TS_TYPE_OPERATOR],
        &[N, D],
    );
    define(
        &mut t,
        &[N_BINARY_EXPRESSION, N_LOGICAL_EXPRESSION, N_ASSIGNMENT_EXPRESSION],
        &[N, N, D],
    );
    define(&mut t, &[N_CALL_EXPRESSION, N_NEW_EXPRESSION], &[N, L, N]);
    define(&mut t, &[N_REST_ELEMENT], &[N, N, L]);
    define(&mut t, &[N_IMPORT_DECLARATION], &[L, N, L]);
    define(&mut t, &[N_EXPORT_NAMED_DECLARATION], &[N, L, N, L]);
    define(&mut t, &[N_EXPORT_ALL_DECLARATION], &[N, N, L]);
    define(&mut t, &[N_TS_TYPE_PARAMETER], &[N, N, N]);
    define(&mut t, &[N_TS_CONDITIONAL_TYPE], &[N, N, N, N]);
    define(&mut t, &[N_TS_MAPPED_TYPE], &[N, D, N, N, D, D]);
    define(&mut t, &[N_TS_TYPE_PREDICATE], &[N, N, D]);
    define(
        &mut t,
        &[
            N_TS_FUNCTION_TYPE,
            N_TS_CONSTRUCTOR_TYPE,
            N_TS_CALL_SIGNATURE_DECLARATION,
            N_TS_CONSTRUCT_SIGNATURE_DECLARATION,
        ],
        &[L, N, N],
    );
    define(&mut t, &[N_TS_IMPORT_TYPE], &[N, N, N, N]);
    define(&mut t, &[N_TS_METHOD_SIGNATURE], &[N, L, N, N]);
    define(&mut t, &[N_TS_INTERFACE_DECLARATION], &[N, N, N, L]);
    define(&mut t, &[N_TS_TYPE_ALIAS_DECLARATION], &[N, N, N]);
    define(&mut t, &[N_TS_PARAMETER_PROPERTY], &[N, L]);

    define(&mut t, &[N_JSX_ELEMENT, N_JSX_FRAGMENT], &[N, N, L]);
    define(&mut t, &[N_JSX_OPENING_ELEMENT], &[N, L, D, N]);
    define(&mut t, &[N_JSX_CLOSING_ELEMENT], &[N]);
    define(
        &mut t,
        &[N_JSX_OPENING_FRAGMENT, N_JSX_CLOSING_FRAGMENT, N_JSX_IDENTIFIER],
        &[],
    );
    define(
        &mut t,
        &[N_JSX_ATTRIBUTE, N_JSX_NAMESPACED_NAME, N_JSX_MEMBER_EXPRESSION],
        &[N, N],
    );
    define(
        &mut t,
        &[N_JSX_SPREAD_ATTRIBUTE, N_JSX_EXPRESSION_CONTAINER, N_JSX_SPREAD_CHILD],
        &[N],
    );
    define(&mut t, &[N_JSX_EMPTY_EXPRESSION, N_JSX_TEXT], &[]);

    t
}
