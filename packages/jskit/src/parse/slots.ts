/**
 * @fileoverview A table describing what each node slot holds.
 *
 * The parser and decoder both know the meaning of every slot for the kinds
 * they handle, but generic passes such as validation need to walk the tree
 * without a per-kind switch. This table answers "is slot N of kind K a child
 * node, a list of children, or plain data?" with a single array read.
 */

import {
	NODE_KIND_COUNT,
	N_AccessorProperty,
	N_ArrayExpression,
	N_ArrayPattern,
	N_ArrowFunctionExpression,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_AwaitExpression,
	N_BinaryExpression,
	N_BlockStatement,
	N_BreakStatement,
	N_CallExpression,
	N_CatchClause,
	N_ChainExpression,
	N_ClassBody,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ConditionalExpression,
	N_ContinueStatement,
	N_Decorator,
	N_DoWhileStatement,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ExportSpecifier,
	N_ExpressionStatement,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_Identifier,
	N_IfStatement,
	N_ImportAttribute,
	N_ImportDeclaration,
	N_ImportDefaultSpecifier,
	N_ImportExpression,
	N_ImportNamespaceSpecifier,
	N_ImportSpecifier,
	N_LabeledStatement,
	N_Literal,
	N_LogicalExpression,
	N_MemberExpression,
	N_MetaProperty,
	N_MethodDefinition,
	N_NewExpression,
	N_ObjectExpression,
	N_ObjectPattern,
	N_Program,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_ReturnStatement,
	N_SequenceExpression,
	N_SpreadElement,
	N_StaticBlock,
	N_SwitchCase,
	N_SwitchStatement,
	N_TSAbstractAccessorProperty,
	N_TSAbstractMethodDefinition,
	N_TSAbstractPropertyDefinition,
	N_TSArrayType,
	N_TSAsExpression,
	N_TSCallSignatureDeclaration,
	N_TSClassImplements,
	N_TSConditionalType,
	N_TSConstructSignatureDeclaration,
	N_TSConstructorType,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumBody,
	N_TSEnumDeclaration,
	N_TSEnumMember,
	N_TSExportAssignment,
	N_TSExternalModuleReference,
	N_TSFunctionType,
	N_TSImportEqualsDeclaration,
	N_TSImportType,
	N_TSIndexSignature,
	N_TSIndexedAccessType,
	N_TSInferType,
	N_TSInstantiationExpression,
	N_TSInterfaceBody,
	N_TSInterfaceDeclaration,
	N_TSInterfaceHeritage,
	N_TSIntersectionType,
	N_TSLiteralType,
	N_TSMappedType,
	N_TSMethodSignature,
	N_TSModuleBlock,
	N_TSModuleDeclaration,
	N_TSNamedTupleMember,
	N_TSNamespaceExportDeclaration,
	N_TSNonNullExpression,
	N_TSOptionalType,
	N_TSParameterProperty,
	N_TSPropertySignature,
	N_TSQualifiedName,
	N_TSRestType,
	N_TSSatisfiesExpression,
	N_TSTemplateLiteralType,
	N_TSTupleType,
	N_TSTypeAliasDeclaration,
	N_TSTypeAnnotation,
	N_TSTypeAssertion,
	N_TSTypeLiteral,
	N_TSTypeOperator,
	N_TSTypeParameter,
	N_TSTypeParameterDeclaration,
	N_TSTypeParameterInstantiation,
	N_TSTypePredicate,
	N_TSTypeQuery,
	N_TSTypeReference,
	N_TSUnionType,
	N_JSXAttribute,
	N_JSXClosingElement,
	N_JSXClosingFragment,
	N_JSXElement,
	N_JSXEmptyExpression,
	N_JSXExpressionContainer,
	N_JSXFragment,
	N_JSXIdentifier,
	N_JSXMemberExpression,
	N_JSXNamespacedName,
	N_JSXOpeningElement,
	N_JSXOpeningFragment,
	N_JSXSpreadAttribute,
	N_JSXSpreadChild,
	N_JSXText,
	N_TaggedTemplateExpression,
	N_TemplateLiteral,
	N_ThrowStatement,
	N_TryStatement,
	N_UnaryExpression,
	N_UpdateExpression,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_WithStatement,
	N_YieldExpression,
} from "./node-kinds.js";

/** The slot holds nothing of interest to a generic walk. */
export const SLOT_DATA = 0;

/** The slot holds a single child node index. */
export const SLOT_NODE = 1;

/** The slot holds a handle for a list of child nodes. */
export const SLOT_LIST = 2;

/** Number of data slots described for each node kind. */
export const SLOT_COUNT = 8;

/**
 * Slot descriptors for every node kind, `SLOT_COUNT` entries per kind.
 */
export const SLOT_TABLE = new Uint8Array(NODE_KIND_COUNT * SLOT_COUNT);

/**
 * The whole slot layout of a kind in one word, two bits per slot.
 *
 * This is `SLOT_TABLE` again in a shape that suits a different access pattern:
 * one read per *node* rather than one per slot, with the descriptors shifted
 * out two bits at a time and the loop ending as soon as the remaining bits are
 * zero. A pass that touches every slot of every node — building the parent
 * table is one — runs measurably faster this way, and a leaf kind costs a
 * single read. Reach for `SLOT_TABLE` when a walk asks about one slot at a
 * time; both are filled from the same definition below, so they cannot drift.
 */
export const SLOT_DESCRIPTORS = new Uint16Array(NODE_KIND_COUNT);

/**
 * Records the slot layout of one or more node kinds.
 * @param kinds The node kinds that share this layout.
 * @param slots The descriptor for each slot, in order.
 * @returns Nothing.
 */
function define(kinds: number[], slots: number[]): void {
	let descriptors = 0;

	for (let slot = 0; slot < slots.length; slot++) {
		descriptors |= slots[slot] << (slot * 2);
	}

	for (let i = 0; i < kinds.length; i++) {
		const base = kinds[i] * SLOT_COUNT;

		for (let slot = 0; slot < slots.length; slot++) {
			SLOT_TABLE[base + slot] = slots[slot];
		}

		SLOT_DESCRIPTORS[kinds[i]] = descriptors;
	}
}

const N = SLOT_NODE;
const L = SLOT_LIST;
const D = SLOT_DATA;

define([N_Program], [L]);
/*
 * Slot C of every binding form holds the decorators a parameter was written
 * with. A decorator without an accessibility modifier does not make a
 * parameter property, so it has nowhere else to live.
 */
define([N_Identifier], [D, N, L]);
define([N_Literal], [D, D]);
define([N_TemplateLiteral, N_TSTemplateLiteralType], [L, L]);
define([N_TaggedTemplateExpression], [N, N, N]);
define([N_ExpressionStatement], [N, D]);
define([
	N_BlockStatement,
	N_StaticBlock,
	N_ClassBody,
	N_TSModuleBlock,
	N_TSInterfaceBody,
	N_TSEnumBody,
	N_SequenceExpression,
	N_TSTupleType,
	N_TSUnionType,
	N_TSIntersectionType,
	N_TSTypeLiteral,
	N_TSTypeParameterDeclaration,
	N_TSTypeParameterInstantiation,
	N_VariableDeclaration,
], [L]);
define([N_WithStatement, N_LabeledStatement], [N, N]);
define([
	N_ReturnStatement,
	N_ThrowStatement,
	N_AwaitExpression,
	N_SpreadElement,
	N_ChainExpression,
	N_Decorator,
	N_TSExportAssignment,
	N_TSExternalModuleReference,
	N_TSNamespaceExportDeclaration,
	N_TSNonNullExpression,
	N_YieldExpression,
	N_BreakStatement,
	N_ContinueStatement,
	N_ExportDefaultDeclaration,
	N_TSTypeAnnotation,
	N_TSArrayType,
	N_TSRestType,
	N_TSOptionalType,
	N_TSInferType,
	N_TSLiteralType,
	N_ImportDefaultSpecifier,
	N_ImportNamespaceSpecifier,
], [N]);
define([N_IfStatement, N_ConditionalExpression, N_TryStatement], [N, N, N]);
define([N_SwitchStatement, N_SwitchCase], [N, L]);
define([N_CatchClause, N_WhileStatement, N_DoWhileStatement], [N, N]);
define([N_ForStatement], [N, N, N, N]);
define([N_ForInStatement, N_ForOfStatement], [N, N, N]);
define([N_VariableDeclarator], [N, N]);
define([N_AssignmentPattern], [N, N, L]);
define([
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_ArrowFunctionExpression,
], [N, L, N, N, N]);
define([N_ClassDeclaration, N_ClassExpression], [N, N, N, N, N, L, L]);
define([N_MethodDefinition, N_TSAbstractMethodDefinition], [N, N, L]);
define([
	N_PropertyDefinition,
	N_TSAbstractPropertyDefinition,
	N_AccessorProperty,
	N_TSAbstractAccessorProperty,
], [N, N, L, N]);
define([N_ArrayExpression, N_ObjectExpression], [L, N]);
define([N_ArrayPattern, N_ObjectPattern], [L, N, L]);
define([
	N_Property,
	N_MemberExpression,
	N_MetaProperty,
	N_ImportSpecifier,
	N_ImportAttribute,
	N_ExportSpecifier,
	N_ImportExpression,
	N_TSNamedTupleMember,
	N_TSIndexedAccessType,
	N_TSTypeReference,
	N_TSQualifiedName,
	N_TSTypeQuery,
	N_TSInterfaceHeritage,
	N_TSClassImplements,
	N_TSPropertySignature,
	N_TSEnumMember,
	N_TSModuleDeclaration,
	N_TSAsExpression,
	N_TSSatisfiesExpression,
	N_TSTypeAssertion,
	N_TSInstantiationExpression,
	N_TSImportEqualsDeclaration,
	N_TSEnumDeclaration,
	N_TSIndexSignature,
], [N, N]);
define([N_TSIndexSignature], [L, N]);
define([N_UnaryExpression, N_UpdateExpression, N_TSTypeOperator], [N, D]);
define([N_BinaryExpression, N_LogicalExpression, N_AssignmentExpression], [
	N,
	N,
	D,
]);
define([N_CallExpression, N_NewExpression], [N, L, N]);
define([N_RestElement], [N, N, L]);
define([N_ImportDeclaration], [L, N, L]);
define([N_ExportNamedDeclaration], [N, L, N, L]);
define([N_ExportAllDeclaration], [N, N, L]);
define([N_TSTypeParameter], [N, N, N]);
define([N_TSConditionalType], [N, N, N, N]);
define([N_TSMappedType], [N, D, N, N, D, D]);
define([N_TSTypePredicate], [N, N, D]);
define([
	N_TSFunctionType,
	N_TSConstructorType,
	N_TSCallSignatureDeclaration,
	N_TSConstructSignatureDeclaration,
], [L, N, N]);
define([N_TSImportType], [N, N, N, N]);
define([N_TSMethodSignature], [N, L, N, N]);
define([N_TSInterfaceDeclaration], [N, N, N, L]);
define([N_TSTypeAliasDeclaration], [N, N, N]);
define([N_TSParameterProperty], [N, L]);

define([N_JSXElement, N_JSXFragment], [N, N, L]);
define([N_JSXOpeningElement], [N, L, D, N]);
define([N_JSXClosingElement], [N]);
define([N_JSXOpeningFragment, N_JSXClosingFragment, N_JSXIdentifier], []);
define([N_JSXAttribute, N_JSXNamespacedName, N_JSXMemberExpression], [N, N]);
define([N_JSXSpreadAttribute, N_JSXExpressionContainer, N_JSXSpreadChild], [N]);
define([N_JSXEmptyExpression, N_JSXText], []);
