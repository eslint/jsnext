/**
 * @fileoverview What each node slot is called in an ESTree tree.
 *
 * `@eslint/jsparse` addresses a node's children by slot — the position they
 * occupy in a fixed-size binary record — and `SLOT_TABLE` says which slots
 * hold children. This table says what those same children are *named*, which
 * is all a tree adapter needs to answer the same questions about an ordinary
 * ESTree node.
 *
 * The grouping below mirrors `slots.ts` in `@eslint/jsparse` deliberately, so
 * that the two can be read side by side. Where that file groups kinds that
 * share a layout, this one has to split them apart whenever they disagree
 * about names: a `WithStatement` and a `LabeledStatement` both hold two child
 * nodes, but one calls the first `object` and the other calls it `label`.
 *
 * A `null` entry means the slot holds something a tree does not have as a
 * property — `Identifier` slot A is the offset the name ends at, and
 * `TSMappedType` slot A is a synthetic type parameter that the ESTree shape
 * flattens into `key` and `constraint`.
 *
 * This module is only reachable from `analyzeTree()`. A consumer that uses
 * only the binary entry point drops the table along with the tree adapter.
 */

import {
	NODE_KIND_COUNT,
	SLOT_COUNT,
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
	N_JSXAttribute,
	N_JSXClosingElement,
	N_JSXElement,
	N_JSXExpressionContainer,
	N_JSXFragment,
	N_JSXMemberExpression,
	N_JSXNamespacedName,
	N_JSXOpeningElement,
	N_JSXSpreadAttribute,
	N_JSXSpreadChild,
	N_LabeledStatement,
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
} from "@eslint/jsparse";

/**
 * Builds the slot-name table.
 *
 * Everything happens inside one function so that the table is produced by a
 * single expression a bundler can drop whole. Filling a module-level array
 * with eighty top-level calls would look like eighty side effects, and no
 * bundler would remove any of them.
 * @returns The ESTree property name of every slot of every node kind,
 *      `SLOT_COUNT` entries per kind, indexed the same way `SLOT_TABLE` is.
 */
function buildSlotNames(): (string | null)[] {
	const names = new Array<string | null>(
		NODE_KIND_COUNT * SLOT_COUNT,
	).fill(null);

	/**
	 * Records what the slots of one or more node kinds are called.
	 * @param kinds The node kinds that share these names.
	 * @param slotNames The property name of each slot, in order.
	 * @returns Nothing.
	 */
	function define(kinds: number[], slotNames: (string | null)[]): void {
		for (let i = 0; i < kinds.length; i++) {
			const base = kinds[i] * SLOT_COUNT;

			for (let slot = 0; slot < slotNames.length; slot++) {
				names[base + slot] = slotNames[slot];
			}
		}
	}

	define([N_Program], ["body"]);
	define([N_Identifier], [null, "typeAnnotation", "decorators"]);
	define([N_TemplateLiteral], ["quasis", "expressions"]);
	define([N_TSTemplateLiteralType], ["quasis", "types"]);
	define([N_TaggedTemplateExpression], ["tag", "quasi", "typeArguments"]);
	define([N_ExpressionStatement], ["expression"]);

	define(
		[
			N_BlockStatement,
			N_StaticBlock,
			N_ClassBody,
			N_TSModuleBlock,
			N_TSInterfaceBody,
		],
		["body"],
	);
	define([N_TSEnumBody], ["members"]);
	define([N_SequenceExpression], ["expressions"]);
	define([N_TSTupleType], ["elementTypes"]);
	define([N_TSUnionType, N_TSIntersectionType], ["types"]);
	define([N_TSTypeLiteral], ["members"]);
	define(
		[N_TSTypeParameterDeclaration, N_TSTypeParameterInstantiation],
		["params"],
	);
	define([N_VariableDeclaration], ["declarations"]);

	define([N_WithStatement], ["object", "body"]);
	define([N_LabeledStatement], ["label", "body"]);

	define(
		[
			N_ReturnStatement,
			N_ThrowStatement,
			N_AwaitExpression,
			N_SpreadElement,
			N_YieldExpression,
		],
		["argument"],
	);
	define(
		[
			N_ChainExpression,
			N_Decorator,
			N_TSExportAssignment,
			N_TSExternalModuleReference,
			N_TSNonNullExpression,
		],
		["expression"],
	);
	define([N_BreakStatement, N_ContinueStatement], ["label"]);
	define([N_TSNamespaceExportDeclaration], ["id"]);
	define([N_ExportDefaultDeclaration], ["declaration"]);
	define(
		[N_TSTypeAnnotation, N_TSRestType, N_TSOptionalType],
		["typeAnnotation"],
	);
	define([N_TSArrayType], ["elementType"]);
	define([N_TSInferType], ["typeParameter"]);
	define([N_TSLiteralType], ["literal"]);
	define([N_ImportDefaultSpecifier, N_ImportNamespaceSpecifier], ["local"]);

	define(
		[N_IfStatement, N_ConditionalExpression],
		["test", "consequent", "alternate"],
	);
	define([N_TryStatement], ["block", "handler", "finalizer"]);
	define([N_SwitchStatement], ["discriminant", "cases"]);
	define([N_SwitchCase], ["test", "consequent"]);
	define([N_CatchClause], ["param", "body"]);
	define([N_WhileStatement], ["test", "body"]);
	define([N_DoWhileStatement], ["body", "test"]);
	define([N_ForStatement], ["init", "test", "update", "body"]);
	define([N_ForInStatement, N_ForOfStatement], ["left", "right", "body"]);
	define([N_VariableDeclarator], ["id", "init"]);
	define([N_AssignmentPattern], ["left", "right", "decorators"]);

	define(
		[
			N_FunctionDeclaration,
			N_FunctionExpression,
			N_TSDeclareFunction,
			N_TSEmptyBodyFunctionExpression,
			N_ArrowFunctionExpression,
		],
		["id", "params", "body", "typeParameters", "returnType"],
	);
	define(
		[N_ClassDeclaration, N_ClassExpression],
		[
			"id",
			"superClass",
			"body",
			"typeParameters",
			"superTypeArguments",
			"implements",
			"decorators",
		],
	);
	define(
		[N_MethodDefinition, N_TSAbstractMethodDefinition],
		["key", "value", "decorators"],
	);
	define(
		[
			N_PropertyDefinition,
			N_TSAbstractPropertyDefinition,
			N_AccessorProperty,
			N_TSAbstractAccessorProperty,
		],
		["key", "value", "decorators", "typeAnnotation"],
	);

	define([N_ArrayExpression], ["elements", "typeAnnotation"]);
	define(
		[N_ArrayPattern],
		["elements", "typeAnnotation", "decorators"],
	);
	define([N_ObjectExpression], ["properties", "typeAnnotation"]);
	define(
		[N_ObjectPattern],
		["properties", "typeAnnotation", "decorators"],
	);

	define([N_Property], ["key", "value"]);
	define([N_MemberExpression], ["object", "property"]);
	define([N_MetaProperty], ["meta", "property"]);
	define([N_ImportSpecifier], ["imported", "local"]);
	define([N_ImportAttribute], ["key", "value"]);
	define([N_ExportSpecifier], ["local", "exported"]);
	define([N_ImportExpression], ["source", "options"]);
	define([N_TSNamedTupleMember], ["label", "elementType"]);
	define([N_TSIndexedAccessType], ["objectType", "indexType"]);
	define([N_TSTypeReference], ["typeName", "typeArguments"]);
	define([N_TSQualifiedName], ["left", "right"]);
	define([N_TSTypeQuery], ["exprName", "typeArguments"]);
	define(
		[N_TSInterfaceHeritage, N_TSClassImplements],
		["expression", "typeArguments"],
	);
	define([N_TSPropertySignature], ["key", "typeAnnotation"]);
	define([N_TSEnumMember], ["id", "initializer"]);
	define([N_TSModuleDeclaration, N_TSEnumDeclaration], ["id", "body"]);
	define(
		[N_TSAsExpression, N_TSSatisfiesExpression],
		["expression", "typeAnnotation"],
	);
	define([N_TSTypeAssertion], ["typeAnnotation", "expression"]);
	define([N_TSInstantiationExpression], ["expression", "typeArguments"]);
	define([N_TSImportEqualsDeclaration], ["id", "moduleReference"]);
	define([N_TSIndexSignature], ["parameters", "typeAnnotation"]);

	define([N_UnaryExpression, N_UpdateExpression], ["argument"]);
	define([N_TSTypeOperator], ["typeAnnotation"]);
	define(
		[N_BinaryExpression, N_LogicalExpression, N_AssignmentExpression],
		["left", "right"],
	);
	define([N_CallExpression, N_NewExpression], ["callee", "arguments", "typeArguments"]);
	define([N_RestElement], ["argument", "typeAnnotation", "decorators"]);
	define([N_ImportDeclaration], ["specifiers", "source", "attributes"]);
	define(
		[N_ExportNamedDeclaration],
		["declaration", "specifiers", "source", "attributes"],
	);
	define([N_ExportAllDeclaration], ["exported", "source", "attributes"]);
	define([N_TSTypeParameter], ["name", "constraint", "default"]);
	define(
		[N_TSConditionalType],
		["checkType", "extendsType", "trueType", "falseType"],
	);
	define([N_TSMappedType], [null, null, "nameType", "typeAnnotation"]);
	define([N_TSTypePredicate], ["parameterName", "typeAnnotation"]);
	define(
		[
			N_TSFunctionType,
			N_TSConstructorType,
			N_TSCallSignatureDeclaration,
			N_TSConstructSignatureDeclaration,
		],
		["params", "returnType", "typeParameters"],
	);
	define(
		[N_TSImportType],
		["source", "qualifier", "typeArguments", "options"],
	);
	define(
		[N_TSMethodSignature],
		["key", "params", "returnType", "typeParameters"],
	);
	define(
		[N_TSInterfaceDeclaration],
		["id", "body", "typeParameters", "extends"],
	);
	define(
		[N_TSTypeAliasDeclaration],
		["id", "typeAnnotation", "typeParameters"],
	);
	define([N_TSParameterProperty], ["parameter", "decorators"]);

	define(
		[N_JSXElement],
		["openingElement", "closingElement", "children"],
	);
	define(
		[N_JSXFragment],
		["openingFragment", "closingFragment", "children"],
	);
	define([N_JSXOpeningElement], ["name", "attributes", null, "typeArguments"]);
	define([N_JSXClosingElement], ["name"]);
	define([N_JSXAttribute], ["name", "value"]);
	define([N_JSXNamespacedName], ["namespace", "name"]);
	define([N_JSXMemberExpression], ["object", "property"]);
	define([N_JSXSpreadAttribute], ["argument"]);
	define([N_JSXExpressionContainer, N_JSXSpreadChild], ["expression"]);

	return names;
}

/**
 * The ESTree property name of every slot of every node kind, `SLOT_COUNT`
 * entries per kind, indexed the same way `SLOT_TABLE` is.
 */
export const SLOT_NAMES: readonly (string | null)[] =
	/* @__PURE__ */ buildSlotNames();
