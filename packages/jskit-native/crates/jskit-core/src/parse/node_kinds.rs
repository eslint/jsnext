//! AST node kinds, node flags, and the binary node layout.
//!
//! Port of `packages/jskit/src/parse/node-kinds.ts`. Only what the buffer
//! producers need is here; the ESTree name table lives on the TypeScript side.

pub const NODE_WORDS: usize = 12;
pub const NODE_BYTES: u32 = (NODE_WORDS as u32) * 4;

pub const NODE_START: usize = 0;
pub const NODE_END: usize = 1;
pub const NODE_KIND: usize = 2;
pub const NODE_FLAGS: usize = 3;
pub const NODE_A: usize = 4;
pub const NODE_B: usize = 5;
pub const NODE_C: usize = 6;
pub const NODE_D: usize = 7;
pub const NODE_E: usize = 8;
pub const NODE_F: usize = 9;
pub const NODE_G: usize = 10;
#[allow(dead_code)]
pub const NODE_H: usize = 11;

/// The index that represents "there is no node here".
pub const NO_NODE: u32 = 0;

/// The list handle that represents an empty list.
pub const EMPTY_LIST: u32 = 0;

pub const NF_ASYNC: u32 = 1 << 0;
pub const NF_GENERATOR: u32 = 1 << 1;
pub const NF_STATIC: u32 = 1 << 2;
pub const NF_COMPUTED: u32 = 1 << 3;
pub const NF_OPTIONAL: u32 = 1 << 4;
pub const NF_PREFIX: u32 = 1 << 5;
pub const NF_DELEGATE: u32 = 1 << 6;
pub const NF_SHORTHAND: u32 = 1 << 7;
pub const NF_METHOD: u32 = 1 << 8;
pub const NF_EXPRESSION_BODY: u32 = 1 << 9;
pub const NF_READONLY: u32 = 1 << 10;
pub const NF_DECLARE: u32 = 1 << 11;
pub const NF_ABSTRACT: u32 = 1 << 12;
pub const NF_CONST: u32 = 1 << 13;
pub const NF_OVERRIDE: u32 = 1 << 14;
pub const NF_DEFINITE: u32 = 1 << 15;
pub const NF_TYPE_ONLY: u32 = 1 << 16;
pub const NF_PARENTHESIZED: u32 = 1 << 17;
pub const NF_TAIL: u32 = 1 << 18;
pub const NF_INVALID_ESCAPE: u32 = 1 << 19;
#[allow(dead_code)]
pub const NF_STRICT: u32 = 1 << 20;
#[allow(dead_code)]
pub const NF_EXPORT: u32 = 1 << 21;
pub const NF_IN: u32 = 1 << 22;

/// A JSX opening element that closes itself, as in `<br />`.
pub const NF_SELF_CLOSING: u32 = NF_ASYNC;

/// An array or object whose rest element is followed by a comma.
pub const NF_COMMA_AFTER_REST: u32 = NF_ASYNC;

/// A `Literal` written with a legacy octal escape or number.
pub const NF_LEGACY_OCTAL: u32 = NF_TAIL;

/// An `ExpressionStatement` that is exactly the directive `"use strict"`.
pub const NF_USE_STRICT: u32 = NF_ASYNC;

/// An `Identifier` that stands for an `IdentifierName` rather than for a
/// binding or a reference.
pub const NF_IDENTIFIER_NAME: u32 = 1 << 31;

pub const ACCESS_SHIFT: u32 = 23;
pub const ACCESS_MASK: u32 = 3 << ACCESS_SHIFT;
pub const ACCESS_PUBLIC: u32 = 1;
pub const ACCESS_PRIVATE: u32 = 2;
pub const ACCESS_PROTECTED: u32 = 3;

pub const DECL_SHIFT: u32 = 25;
pub const DECL_VAR: u32 = 0;
pub const DECL_LET: u32 = 1;
pub const DECL_CONST: u32 = 2;
pub const DECL_USING: u32 = 3;
pub const DECL_AWAIT_USING: u32 = 4;

pub const MKIND_SHIFT: u32 = 28;
pub const MKIND_INIT: u32 = 0;
pub const MKIND_GET: u32 = 1;
pub const MKIND_SET: u32 = 2;
pub const MKIND_METHOD: u32 = 3;
pub const MKIND_CONSTRUCTOR: u32 = 4;

/// Which keyword an `Identifier`'s text spells, as an identifier word code.
pub const IDWORD_SHIFT: u32 = 23;

/// An `Identifier` whose text contains a unicode escape.
pub const NF_IDENTIFIER_ESCAPED: u32 = 1 << 27;

pub const N_PROGRAM: u32 = 1;
pub const N_IDENTIFIER: u32 = 2;
pub const N_PRIVATE_IDENTIFIER: u32 = 3;
pub const N_LITERAL: u32 = 4;
pub const N_TEMPLATE_LITERAL: u32 = 5;
pub const N_TEMPLATE_ELEMENT: u32 = 6;
pub const N_TAGGED_TEMPLATE_EXPRESSION: u32 = 7;
pub const N_EXPRESSION_STATEMENT: u32 = 8;
pub const N_BLOCK_STATEMENT: u32 = 9;
pub const N_STATIC_BLOCK: u32 = 10;
pub const N_EMPTY_STATEMENT: u32 = 11;
pub const N_DEBUGGER_STATEMENT: u32 = 12;
pub const N_WITH_STATEMENT: u32 = 13;
pub const N_RETURN_STATEMENT: u32 = 14;
pub const N_LABELED_STATEMENT: u32 = 15;
pub const N_BREAK_STATEMENT: u32 = 16;
pub const N_CONTINUE_STATEMENT: u32 = 17;
pub const N_IF_STATEMENT: u32 = 18;
pub const N_SWITCH_STATEMENT: u32 = 19;
pub const N_SWITCH_CASE: u32 = 20;
pub const N_THROW_STATEMENT: u32 = 21;
pub const N_TRY_STATEMENT: u32 = 22;
pub const N_CATCH_CLAUSE: u32 = 23;
pub const N_WHILE_STATEMENT: u32 = 24;
pub const N_DO_WHILE_STATEMENT: u32 = 25;
pub const N_FOR_STATEMENT: u32 = 26;
pub const N_FOR_IN_STATEMENT: u32 = 27;
pub const N_FOR_OF_STATEMENT: u32 = 28;
pub const N_VARIABLE_DECLARATION: u32 = 29;
pub const N_VARIABLE_DECLARATOR: u32 = 30;
pub const N_FUNCTION_DECLARATION: u32 = 31;
pub const N_FUNCTION_EXPRESSION: u32 = 32;
pub const N_ARROW_FUNCTION_EXPRESSION: u32 = 33;
pub const N_CLASS_DECLARATION: u32 = 34;
pub const N_CLASS_EXPRESSION: u32 = 35;
pub const N_CLASS_BODY: u32 = 36;
pub const N_METHOD_DEFINITION: u32 = 37;
pub const N_PROPERTY_DEFINITION: u32 = 38;
pub const N_ACCESSOR_PROPERTY: u32 = 39;
pub const N_THIS_EXPRESSION: u32 = 40;
pub const N_ARRAY_EXPRESSION: u32 = 41;
pub const N_OBJECT_EXPRESSION: u32 = 42;
pub const N_PROPERTY: u32 = 43;
pub const N_SEQUENCE_EXPRESSION: u32 = 44;
pub const N_UNARY_EXPRESSION: u32 = 45;
pub const N_UPDATE_EXPRESSION: u32 = 46;
pub const N_BINARY_EXPRESSION: u32 = 47;
pub const N_ASSIGNMENT_EXPRESSION: u32 = 48;
pub const N_LOGICAL_EXPRESSION: u32 = 49;
pub const N_CONDITIONAL_EXPRESSION: u32 = 50;
pub const N_CALL_EXPRESSION: u32 = 51;
pub const N_NEW_EXPRESSION: u32 = 52;
pub const N_MEMBER_EXPRESSION: u32 = 53;
pub const N_YIELD_EXPRESSION: u32 = 54;
pub const N_AWAIT_EXPRESSION: u32 = 55;
pub const N_IMPORT_EXPRESSION: u32 = 56;
pub const N_CHAIN_EXPRESSION: u32 = 57;
pub const N_META_PROPERTY: u32 = 58;
pub const N_SUPER: u32 = 59;
pub const N_SPREAD_ELEMENT: u32 = 60;
pub const N_REST_ELEMENT: u32 = 61;
pub const N_ASSIGNMENT_PATTERN: u32 = 62;
pub const N_ARRAY_PATTERN: u32 = 63;
pub const N_OBJECT_PATTERN: u32 = 64;
pub const N_IMPORT_DECLARATION: u32 = 65;
pub const N_IMPORT_SPECIFIER: u32 = 66;
pub const N_IMPORT_DEFAULT_SPECIFIER: u32 = 67;
pub const N_IMPORT_NAMESPACE_SPECIFIER: u32 = 68;
pub const N_IMPORT_ATTRIBUTE: u32 = 69;
pub const N_EXPORT_NAMED_DECLARATION: u32 = 70;
pub const N_EXPORT_SPECIFIER: u32 = 71;
pub const N_EXPORT_DEFAULT_DECLARATION: u32 = 72;
pub const N_EXPORT_ALL_DECLARATION: u32 = 73;
pub const N_DECORATOR: u32 = 74;
pub const N_JSX_ELEMENT: u32 = 75;
pub const N_JSX_FRAGMENT: u32 = 76;
pub const N_JSX_OPENING_ELEMENT: u32 = 77;
pub const N_JSX_CLOSING_ELEMENT: u32 = 78;
pub const N_JSX_OPENING_FRAGMENT: u32 = 79;
pub const N_JSX_CLOSING_FRAGMENT: u32 = 80;
pub const N_JSX_ATTRIBUTE: u32 = 81;
pub const N_JSX_SPREAD_ATTRIBUTE: u32 = 82;
pub const N_JSX_IDENTIFIER: u32 = 83;
pub const N_JSX_NAMESPACED_NAME: u32 = 84;
pub const N_JSX_MEMBER_EXPRESSION: u32 = 85;
pub const N_JSX_EXPRESSION_CONTAINER: u32 = 86;
pub const N_JSX_EMPTY_EXPRESSION: u32 = 87;
pub const N_JSX_SPREAD_CHILD: u32 = 88;
pub const N_JSX_TEXT: u32 = 89;

pub const N_TS_TYPE_ANNOTATION: u32 = 100;
pub const N_TS_TYPE_PARAMETER_DECLARATION: u32 = 101;
pub const N_TS_TYPE_PARAMETER: u32 = 102;
pub const N_TS_TYPE_PARAMETER_INSTANTIATION: u32 = 103;
pub const N_TS_ANY_KEYWORD: u32 = 104;
pub const N_TS_BIG_INT_KEYWORD: u32 = 105;
pub const N_TS_BOOLEAN_KEYWORD: u32 = 106;
pub const N_TS_NEVER_KEYWORD: u32 = 107;
pub const N_TS_NULL_KEYWORD: u32 = 108;
pub const N_TS_NUMBER_KEYWORD: u32 = 109;
pub const N_TS_OBJECT_KEYWORD: u32 = 110;
pub const N_TS_STRING_KEYWORD: u32 = 111;
pub const N_TS_SYMBOL_KEYWORD: u32 = 112;
pub const N_TS_UNDEFINED_KEYWORD: u32 = 113;
pub const N_TS_UNKNOWN_KEYWORD: u32 = 114;
pub const N_TS_VOID_KEYWORD: u32 = 115;
pub const N_TS_INTRINSIC_KEYWORD: u32 = 116;
pub const N_TS_THIS_TYPE: u32 = 117;
pub const N_TS_ARRAY_TYPE: u32 = 118;
pub const N_TS_TUPLE_TYPE: u32 = 119;
pub const N_TS_NAMED_TUPLE_MEMBER: u32 = 120;
pub const N_TS_REST_TYPE: u32 = 121;
pub const N_TS_OPTIONAL_TYPE: u32 = 122;
pub const N_TS_UNION_TYPE: u32 = 123;
pub const N_TS_INTERSECTION_TYPE: u32 = 124;
pub const N_TS_CONDITIONAL_TYPE: u32 = 125;
pub const N_TS_INFER_TYPE: u32 = 126;
pub const N_TS_TYPE_OPERATOR: u32 = 127;
pub const N_TS_INDEXED_ACCESS_TYPE: u32 = 128;
pub const N_TS_MAPPED_TYPE: u32 = 129;
pub const N_TS_LITERAL_TYPE: u32 = 130;
pub const N_TS_TEMPLATE_LITERAL_TYPE: u32 = 131;
pub const N_TS_TYPE_REFERENCE: u32 = 132;
pub const N_TS_QUALIFIED_NAME: u32 = 133;
pub const N_TS_TYPE_QUERY: u32 = 134;
pub const N_TS_TYPE_PREDICATE: u32 = 135;
pub const N_TS_FUNCTION_TYPE: u32 = 136;
pub const N_TS_CONSTRUCTOR_TYPE: u32 = 137;
pub const N_TS_TYPE_LITERAL: u32 = 138;
pub const N_TS_IMPORT_TYPE: u32 = 139;
pub const N_TS_PROPERTY_SIGNATURE: u32 = 140;
pub const N_TS_METHOD_SIGNATURE: u32 = 141;
pub const N_TS_INDEX_SIGNATURE: u32 = 142;
pub const N_TS_CALL_SIGNATURE_DECLARATION: u32 = 143;
pub const N_TS_CONSTRUCT_SIGNATURE_DECLARATION: u32 = 144;
pub const N_TS_INTERFACE_DECLARATION: u32 = 145;
pub const N_TS_INTERFACE_BODY: u32 = 146;
pub const N_TS_INTERFACE_HERITAGE: u32 = 147;
pub const N_TS_CLASS_IMPLEMENTS: u32 = 148;
pub const N_TS_TYPE_ALIAS_DECLARATION: u32 = 149;
pub const N_TS_ENUM_DECLARATION: u32 = 150;
pub const N_TS_ENUM_BODY: u32 = 151;
pub const N_TS_ENUM_MEMBER: u32 = 152;
pub const N_TS_MODULE_DECLARATION: u32 = 153;
pub const N_TS_MODULE_BLOCK: u32 = 154;
pub const N_TS_DECLARE_FUNCTION: u32 = 155;
pub const N_TS_ABSTRACT_METHOD_DEFINITION: u32 = 156;
pub const N_TS_ABSTRACT_PROPERTY_DEFINITION: u32 = 157;
pub const N_TS_ABSTRACT_ACCESSOR_PROPERTY: u32 = 158;
pub const N_TS_PARAMETER_PROPERTY: u32 = 159;
pub const N_TS_EMPTY_BODY_FUNCTION_EXPRESSION: u32 = 160;
pub const N_TS_AS_EXPRESSION: u32 = 161;
pub const N_TS_SATISFIES_EXPRESSION: u32 = 162;
pub const N_TS_NON_NULL_EXPRESSION: u32 = 163;
pub const N_TS_TYPE_ASSERTION: u32 = 164;
pub const N_TS_INSTANTIATION_EXPRESSION: u32 = 165;
pub const N_TS_EXPORT_ASSIGNMENT: u32 = 166;
pub const N_TS_IMPORT_EQUALS_DECLARATION: u32 = 167;
pub const N_TS_EXTERNAL_MODULE_REFERENCE: u32 = 168;
pub const N_TS_NAMESPACE_EXPORT_DECLARATION: u32 = 172;

/// One past the largest defined node kind.
pub const NODE_KIND_COUNT: usize = 173;

pub const LIT_STRING: u32 = 0;
pub const LIT_NUMBER: u32 = 1;
pub const LIT_BOOLEAN: u32 = 2;
pub const LIT_NULL: u32 = 3;
pub const LIT_REGEXP: u32 = 4;
pub const LIT_BIGINT: u32 = 5;

/// A quoted JSX attribute value, whose only escapes are entity references.
pub const LIT_JSX_STRING: u32 = 6;

pub const MODULE_KIND_SHIFT: u32 = MKIND_SHIFT;
pub const MODULE_GLOBAL: u32 = 0;
pub const MODULE_MODULE: u32 = 1;
pub const MODULE_NAMESPACE: u32 = 2;
