/**
 * @fileoverview Decoding of the binary AST into ESTree objects.
 *
 * This is the only place where JavaScript objects are created for nodes, and
 * it runs on demand. Tools that only need to look at a handful of nodes can
 * read the binary buffers directly and skip this cost entirely.
 */

import {
	ACCESSIBILITY_NAMES,
	ACCESS_MASK,
	ACCESS_SHIFT,
	DECL_KIND_NAMES,
	DECL_MASK,
	DECL_SHIFT,
	LIT_BIGINT,
	LIT_BOOLEAN,
	LIT_JSX_STRING,
	LIT_NULL,
	LIT_NUMBER,
	LIT_REGEXP,
	LIT_STRING,
	MKIND_MASK,
	MKIND_NAMES,
	MKIND_SHIFT,
	MODULE_GLOBAL,
	MODULE_KIND_MASK,
	MODULE_KIND_NAMES,
	MODULE_KIND_SHIFT,
	NF_ABSTRACT,
	NF_ASYNC,
	NF_COMPUTED,
	NF_CONST,
	NF_DECLARE,
	NF_DEFINITE,
	NF_DELEGATE,
	NF_EXPRESSION_BODY,
	NF_GENERATOR,
	NF_IN,
	NF_INVALID_ESCAPE,
	NF_METHOD,
	NF_OPTIONAL,
	NF_OVERRIDE,
	NF_PREFIX,
	NF_READONLY,
	NF_SELF_CLOSING,
	NF_SHORTHAND,
	NF_STATIC,
	NF_TAIL,
	NF_TYPE_ONLY,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	NODE_G,
	NODE_KIND_NAMES,
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
	N_DebuggerStatement,
	N_Decorator,
	N_DoWhileStatement,
	N_EmptyStatement,
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
	N_LabeledStatement,
	N_Literal,
	N_LogicalExpression,
	N_MemberExpression,
	N_MetaProperty,
	N_MethodDefinition,
	N_NewExpression,
	N_ObjectExpression,
	N_ObjectPattern,
	N_PrivateIdentifier,
	N_Program,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_ReturnStatement,
	N_SequenceExpression,
	N_SpreadElement,
	N_StaticBlock,
	N_Super,
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
	N_TemplateElement,
	N_TemplateLiteral,
	N_ThisExpression,
	N_ThrowStatement,
	N_TryStatement,
	N_UnaryExpression,
	N_UpdateExpression,
	N_VariableDeclaration,
	N_VariableDeclarator,
	N_WhileStatement,
	N_WithStatement,
	N_YieldExpression,
	TS_FIRST,
} from "./node-kinds.js";
import { AstReader } from "./reader.js";
import { decodeEntities } from "./entities.js";
import type { LineIndex } from "./locations.js";
import { decodeEscapes, decodeNumber } from "./values.js";
import {
	KEYWORD_FIRST,
	KEYWORD_NAMES,
	PUNCTUATOR_NAMES,
	PUNCT_FIRST,
} from "./token-kinds.js";

/** A decoded ESTree node. */
export type EsNode = Record<string, unknown>;

/**
 * Converts a binary AST into ESTree objects.
 */
export class AstDecoder {
	/** The reader over the binary buffer. */
	private readonly reader: AstReader;

	/** The source text, hoisted for slicing. */
	private readonly source: string;

	/**
	 * Whether TypeScript-only properties should be emitted. In JavaScript
	 * mode the output matches `espree`, which has no notion of import kinds
	 * or type annotations.
	 */
	private readonly typescript: boolean;

	/**
	 * Where to look up line and column numbers, or `null` to leave `range`
	 * and `loc` off the nodes entirely. Only the ESLint adapter asks for
	 * them, because ESLint requires both.
	 */
	private readonly lines: LineIndex | null;

	/**
	 * Creates a decoder.
	 * @param reader The reader over the AST buffer.
	 * @param typescript Whether to emit TypeScript-only node properties.
	 * @param lines Where to look up positions, or `null` for no `range`/`loc`.
	 */
	constructor(
		reader: AstReader,
		typescript: boolean,
		lines: LineIndex | null = null,
	) {
		this.reader = reader;
		this.source = reader.source;
		this.typescript = typescript;
		this.lines = lines;
	}

	/**
	 * Converts a node and everything below it.
	 * @param index The node index, or `0` for no node.
	 * @returns The ESTree node, or `null` when there is no node.
	 */
	node(index: number): EsNode | null {
		if (index === 0) {
			return null;
		}

		const reader = this.reader;
		const kind = reader.kind(index);
		const start = reader.start(index);
		const end = reader.end(index);
		const node: EsNode = {
			type: NODE_KIND_NAMES[kind],
			start,
			end,
		};

		if (this.lines !== null) {
			node.range = [start, end];
			node.loc = this.lines.location(start, end);
		}

		this.fill(node, index, kind);

		return node;
	}

	/**
	 * Converts every element of a list.
	 * @param handle The list handle.
	 * @returns An array of nodes, with `null` for array holes.
	 */
	list(handle: number): (EsNode | null)[] {
		const size = this.reader.listSize(handle);
		const result = new Array<EsNode | null>(size);

		for (let i = 0; i < size; i++) {
			result[i] = this.node(this.reader.listItem(handle, i));
		}

		return result;
	}

	/**
	 * The operator spelling for a stored token kind.
	 * @param tokenKind The token kind that was recorded on the node.
	 * @returns The operator's source spelling.
	 */
	private operator(tokenKind: number): string {
		if (tokenKind >= KEYWORD_FIRST) {
			return KEYWORD_NAMES[tokenKind - KEYWORD_FIRST];
		}

		return PUNCTUATOR_NAMES[tokenKind - PUNCT_FIRST];
	}

	/**
	 * Adds the kind-specific properties to a node.
	 * @param node The node object being built.
	 * @param index The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private fill(node: EsNode, index: number, kind: number): void {
		const reader = this.reader;
		const flags = reader.flags(index);
		const a = reader.field(index, NODE_A);
		const b = reader.field(index, NODE_B);
		const c = reader.field(index, NODE_C);
		const d = reader.field(index, NODE_D);
		const e = reader.field(index, NODE_E);

		switch (kind) {
			case N_Program:
				node.body = this.list(a);
				return;

			case N_Identifier:
				node.name = this.identifierName(index);

				if (this.typescript) {
					node.decorators = [];
					node.optional = (flags & NF_OPTIONAL) !== 0;
					node.typeAnnotation = this.node(b);
				}

				return;

			case N_PrivateIdentifier:
				node.name = this.identifierName(index).slice(1);
				return;

			case N_Literal:
				this.fillLiteral(node, index, a, b);
				return;

			case N_TemplateLiteral:
			case N_TSTemplateLiteralType:
				node.quasis = this.list(a);
				node[kind === N_TemplateLiteral ? "expressions" : "types"] =
					this.list(b);
				return;

			case N_TemplateElement: {
				const raw = this.source.slice(a, b);

				node.value = {
					raw,
					cooked:
						(flags & NF_INVALID_ESCAPE) !== 0
							? null
							: decodeEscapes(raw, true),
				};
				node.tail = (flags & NF_TAIL) !== 0;
				return;
			}

			case N_TaggedTemplateExpression:
				node.tag = this.node(a);
				node.quasi = this.node(b);
				this.addOptional(node, "typeArguments", c);
				return;

			case N_ExpressionStatement:
				node.expression = this.node(a);

				if (b === 1) {
					const raw = this.source.slice(
						reader.start(a),
						reader.end(a),
					);

					node.directive = raw.slice(1, -1);
				} else if (this.typescript) {
					node.directive = null;
				}

				return;

			case N_BlockStatement:
			case N_StaticBlock:
			case N_ClassBody:
			case N_TSModuleBlock:
			case N_TSInterfaceBody:
				node.body = this.list(a);
				return;

			case N_TSEnumBody:
				node.members = this.list(a);
				return;

			case N_EmptyStatement:
			case N_DebuggerStatement:
			case N_ThisExpression:
			case N_Super:
				return;

			case N_WithStatement:
				node.object = this.node(a);
				node.body = this.node(b);
				return;

			case N_ReturnStatement:
			case N_ThrowStatement:
			case N_AwaitExpression:
			case N_SpreadElement:
				node.argument = this.node(a);
				return;

			case N_TSNonNullExpression:
			case N_ChainExpression:
			case N_Decorator:
			case N_TSExportAssignment:
			case N_TSExternalModuleReference:
				node.expression = this.node(a);
				return;

			case N_LabeledStatement:
				node.label = this.node(a);
				node.body = this.node(b);
				return;

			case N_BreakStatement:
			case N_ContinueStatement:
				node.label = this.node(a);
				return;

			case N_IfStatement:
				node.test = this.node(a);
				node.consequent = this.node(b);
				node.alternate = this.node(c);
				return;

			case N_SwitchStatement:
				node.discriminant = this.node(a);
				node.cases = this.list(b);
				return;

			case N_SwitchCase:
				node.test = this.node(a);
				node.consequent = this.list(b);
				return;

			case N_TryStatement:
				node.block = this.node(a);
				node.handler = this.node(b);
				node.finalizer = this.node(c);
				return;

			case N_CatchClause:
				node.param = this.node(a);
				node.body = this.node(b);
				return;

			case N_WhileStatement:
				node.test = this.node(a);
				node.body = this.node(b);
				return;

			case N_DoWhileStatement:
				node.body = this.node(a);
				node.test = this.node(b);
				return;

			case N_ForStatement:
				node.init = this.node(a);
				node.test = this.node(b);
				node.update = this.node(c);
				node.body = this.node(d);
				return;

			case N_ForInStatement:
			case N_ForOfStatement:
				node.left = this.node(a);
				node.right = this.node(b);
				node.body = this.node(c);

				if (kind === N_ForOfStatement) {
					node.await = (flags & NF_ASYNC) !== 0;
				}

				return;

			case N_VariableDeclaration:
				node.declarations = this.list(a);
				node.kind = DECL_KIND_NAMES[(flags & DECL_MASK) >>> DECL_SHIFT];

				if (this.typescript) {
					node.declare = (flags & NF_DECLARE) !== 0;
				}

				return;

			case N_VariableDeclarator:
				node.id = this.node(a);
				node.init = this.node(b);

				if (this.typescript) {
					node.definite = (flags & NF_DEFINITE) !== 0;
				}

				return;

			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				node.id = this.node(a);
				node.params = this.list(b);
				node.body = this.node(c);
				node.generator = (flags & NF_GENERATOR) !== 0;
				node.expression = false;
				node.async = (flags & NF_ASYNC) !== 0;
				this.addTypeMembers(node, d, e);

				if (this.typescript) {
					node.declare = (flags & NF_DECLARE) !== 0;
				}

				return;

			case N_ArrowFunctionExpression:
				node.id = null;
				node.params = this.list(b);
				node.body = this.node(c);
				node.async = (flags & NF_ASYNC) !== 0;
				node.expression = (flags & NF_EXPRESSION_BODY) !== 0;
				node.generator = false;
				this.addTypeMembers(node, d, e);
				return;

			case N_ClassDeclaration:
			case N_ClassExpression:
				node.id = this.node(a);
				node.superClass = this.node(b);
				node.body = this.node(c);
				this.addOptional(node, "typeParameters", d);
				this.addOptional(node, "superTypeArguments", e);
				this.addListIfPresent(
					node,
					"implements",
					reader.field(index, NODE_F),
				);
				this.addListIfPresent(
					node,
					"decorators",
					reader.field(index, NODE_G),
				);

				if (this.typescript) {
					node.abstract = (flags & NF_ABSTRACT) !== 0;
					node.declare = (flags & NF_DECLARE) !== 0;
				}

				return;

			case N_MethodDefinition:
			case N_TSAbstractMethodDefinition:
				node.key = this.node(a);
				node.value = this.node(b);
				node.kind = MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT];
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				this.addListIfPresent(node, "decorators", c);

				if (this.typescript) {
					node.accessibility = this.accessibility(flags);
					node.optional = (flags & NF_OPTIONAL) !== 0;
					node.override = (flags & NF_OVERRIDE) !== 0;
				}

				return;

			case N_PropertyDefinition:
			case N_TSAbstractPropertyDefinition:
			case N_AccessorProperty:
			case N_TSAbstractAccessorProperty:
				node.key = this.node(a);
				node.value = this.node(b);
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				this.addListIfPresent(node, "decorators", c);
				this.addOptional(node, "typeAnnotation", d);

				if (this.typescript) {
					node.accessibility = this.accessibility(flags);
					node.declare = (flags & NF_DECLARE) !== 0;
					node.definite = (flags & NF_DEFINITE) !== 0;
					node.optional = (flags & NF_OPTIONAL) !== 0;
					node.override = (flags & NF_OVERRIDE) !== 0;
					node.readonly = (flags & NF_READONLY) !== 0;
				}

				return;

			case N_ArrayExpression:
				node.elements = this.list(a);
				return;

			case N_ArrayPattern:
				node.elements = this.list(a);
				this.addOptional(node, "typeAnnotation", b);
				this.addPatternModifiers(node, flags);
				return;

			case N_ObjectExpression:
				node.properties = this.list(a);
				return;

			case N_ObjectPattern:
				node.properties = this.list(a);
				this.addOptional(node, "typeAnnotation", b);
				this.addPatternModifiers(node, flags);
				return;

			case N_Property:
				node.key = this.node(a);
				node.value = this.node(b);
				node.kind = MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT];
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.method = (flags & NF_METHOD) !== 0;
				node.shorthand = (flags & NF_SHORTHAND) !== 0;

				if (this.typescript) {
					node.optional = (flags & NF_OPTIONAL) !== 0;
				}

				return;

			case N_SequenceExpression:
				node.expressions = this.list(a);
				return;

			case N_UnaryExpression:
			case N_UpdateExpression:
				node.operator = this.operator(b);
				node.prefix = (flags & NF_PREFIX) !== 0;
				node.argument = this.node(a);
				return;

			case N_BinaryExpression:
			case N_LogicalExpression:
			case N_AssignmentExpression:
				node.operator = this.operator(c);
				node.left = this.node(a);
				node.right = this.node(b);
				return;

			case N_ConditionalExpression:
				node.test = this.node(a);
				node.consequent = this.node(b);
				node.alternate = this.node(c);
				return;

			case N_CallExpression:
				node.callee = this.node(a);
				node.arguments = this.list(b);
				node.optional = (flags & NF_OPTIONAL) !== 0;
				this.addOptional(node, "typeArguments", c);
				return;

			case N_NewExpression:
				node.callee = this.node(a);
				node.arguments = this.list(b);
				this.addOptional(node, "typeArguments", c);
				return;

			case N_MemberExpression:
				node.object = this.node(a);
				node.property = this.node(b);
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.optional = (flags & NF_OPTIONAL) !== 0;
				return;

			case N_YieldExpression:
				node.delegate = (flags & NF_DELEGATE) !== 0;
				node.argument = this.node(a);
				return;

			case N_ImportExpression:
				node.source = this.node(a);
				node.options = this.node(b);
				return;

			case N_MetaProperty:
				node.meta = this.node(a);
				node.property = this.node(b);
				return;

			case N_RestElement:
				node.argument = this.node(a);
				this.addOptional(node, "typeAnnotation", b);

				if (this.typescript) {
					node.decorators = [];
					node.optional = (flags & NF_OPTIONAL) !== 0;
					node.value = null;
				}

				return;

			case N_AssignmentPattern:
				node.left = this.node(a);
				node.right = this.node(b);

				if (this.typescript) {
					node.decorators = [];
					node.optional = (flags & NF_OPTIONAL) !== 0;
					node.typeAnnotation = null;
				}

				return;

			case N_ImportDeclaration:
				node.specifiers = this.list(a);
				node.source = this.node(b);
				node.attributes = this.list(c);
				this.addKind(node, "importKind", flags);

				if (this.typescript) {
					node.phase = null;
				}

				return;

			case N_ImportSpecifier:
				node.imported = this.node(a);
				node.local = this.node(b);
				this.addKind(node, "importKind", flags);
				return;

			case N_ImportDefaultSpecifier:
			case N_ImportNamespaceSpecifier:
				node.local = this.node(a);
				return;

			case N_ImportAttribute:
				node.key = this.node(a);
				node.value = this.node(b);
				return;

			case N_ExportNamedDeclaration:
				node.declaration = this.node(a);
				node.specifiers = this.list(b);
				node.source = this.node(c);
				node.attributes = this.list(d);
				this.addKind(node, "exportKind", flags);
				return;

			case N_ExportSpecifier:
				node.local = this.node(a);
				node.exported = this.node(b);
				this.addKind(node, "exportKind", flags);
				return;

			case N_ExportDefaultDeclaration:
				node.declaration = this.node(a);
				this.addKind(node, "exportKind", 0);
				return;

			case N_JSXElement:
			case N_JSXFragment:
				node[kind === N_JSXElement ? "openingElement" : "openingFragment"] =
					this.node(a);
				node[kind === N_JSXElement ? "closingElement" : "closingFragment"] =
					this.node(b);
				node.children = this.list(c);
				return;

			case N_JSXOpeningElement:
				node.name = this.node(a);
				node.attributes = this.list(b);
				node.selfClosing = (flags & NF_SELF_CLOSING) !== 0;

				if (this.typescript) {
					node.typeArguments = this.node(d);
				}

				return;

			case N_JSXOpeningFragment:
				/*
				 * `espree` reports these two properties on an opening fragment
				 * even though a fragment can carry neither.
				 */
				if (!this.typescript) {
					node.attributes = [];
					node.selfClosing = false;
				}

				return;

			case N_JSXClosingElement:
				node.name = this.node(a);
				return;

			case N_JSXClosingFragment:
			case N_JSXEmptyExpression:
				return;

			case N_JSXIdentifier:
				node.name = this.source.slice(
					reader.start(index),
					reader.end(index),
				);
				return;

			case N_JSXNamespacedName:
				node.namespace = this.node(a);
				node.name = this.node(b);
				return;

			case N_JSXMemberExpression:
				node.object = this.node(a);
				node.property = this.node(b);
				return;

			case N_JSXAttribute:
				node.name = this.node(a);
				node.value = this.node(b);
				return;

			case N_JSXSpreadAttribute:
				node.argument = this.node(a);
				return;

			case N_JSXExpressionContainer:
			case N_JSXSpreadChild:
				node.expression = this.node(a);
				return;

			case N_JSXText: {
				const raw = this.source.slice(
					reader.start(index),
					reader.end(index),
				);

				node.value = decodeEntities(raw);
				node.raw = raw;
				return;
			}

			case N_ExportAllDeclaration:
				node.exported = this.node(a);
				node.source = this.node(b);
				node.attributes = this.list(c);
				this.addKind(node, "exportKind", flags);
				return;

			default:
				this.fillTypeNode(node, index, kind, flags, a, b, c, d, e);
		}
	}

	/**
	 * Adds the kind-specific properties of a TypeScript node.
	 * @param node The node object being built.
	 * @param index The node index.
	 * @param kind The node kind.
	 * @param flags The node's flags word.
	 * @param a The node's first data slot.
	 * @param b The node's second data slot.
	 * @param c The node's third data slot.
	 * @param d The node's fourth data slot.
	 * @param e The node's fifth data slot.
	 * @returns Nothing.
	 */
	private fillTypeNode(
		node: EsNode,
		index: number,
		kind: number,
		flags: number,
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
	): void {
		switch (kind) {
			case N_TSTypeAnnotation:
			case N_TSRestType:
			case N_TSOptionalType:
				node.typeAnnotation = this.node(a);
				return;

			case N_TSArrayType:
				node.elementType = this.node(a);
				return;

			case N_TSInferType:
				node.typeParameter = this.node(a);
				return;

			case N_TSTypeParameterDeclaration:
			case N_TSTypeParameterInstantiation:
				node.params = this.list(a);
				return;

			case N_TSTypeParameter:
				node.name = this.node(a);
				node.constraint = this.node(b);
				node.default = this.node(c);
				node.in = (flags & NF_IN) !== 0;
				node.out = (flags & NF_STATIC) !== 0;
				node.const = (flags & NF_CONST) !== 0;
				return;

			case N_TSTupleType:
				node.elementTypes = this.list(a);
				return;

			case N_TSNamedTupleMember:
				node.label = this.node(a);
				node.elementType = this.node(b);
				node.optional = (flags & NF_OPTIONAL) !== 0;
				return;



			case N_TSUnionType:
			case N_TSIntersectionType:
				node.types = this.list(a);
				return;

			case N_TSConditionalType:
				node.checkType = this.node(a);
				node.extendsType = this.node(b);
				node.trueType = this.node(c);
				node.falseType = this.node(d);
				return;

			case N_TSTypeOperator:
				node.operator = this.operator(b);
				node.typeAnnotation = this.node(a);
				return;

			case N_TSIndexedAccessType:
				node.objectType = this.node(a);
				node.indexType = this.node(b);
				return;

			case N_TSMappedType:
				node.key = this.node(this.reader.field(a, NODE_A));
				node.constraint = this.node(this.reader.field(a, NODE_B));
				node.nameType = this.node(c);
				node.typeAnnotation = this.node(d);
				node.optional = this.mappedModifier(e) ?? false;
				node.readonly =
					this.mappedModifier(this.reader.field(index, NODE_F)) ??
					null;
				return;

			case N_TSLiteralType:
				node.literal = this.node(a);
				return;

			case N_TSTypeReference:
				node.typeName = this.node(a);
				this.addOptional(node, "typeArguments", b);
				return;

			case N_TSQualifiedName:
				node.left = this.node(a);
				node.right = this.node(b);
				return;

			case N_TSTypeQuery:
				node.exprName = this.node(a);
				this.addOptional(node, "typeArguments", b);
				return;

			case N_TSTypePredicate:
				node.parameterName = this.node(a);
				node.typeAnnotation = this.node(b);
				node.asserts = c === 1;
				return;

			case N_TSFunctionType:
			case N_TSConstructorType:
			case N_TSCallSignatureDeclaration:
			case N_TSConstructSignatureDeclaration:
				node.params = this.list(a);
				node.returnType = this.node(b);
				this.addOptional(node, "typeParameters", c);

				if (kind === N_TSConstructorType) {
					node.abstract = (flags & NF_ABSTRACT) !== 0;
				}

				return;

			case N_TSTypeLiteral:
				node.members = this.list(a);
				return;

			case N_TSImportType:
				node.source = this.node(a);
				node.qualifier = this.node(b);
				this.addOptional(node, "typeArguments", c);
				node.options = this.node(d);
				return;

			case N_TSPropertySignature:
				node.key = this.node(a);
				node.typeAnnotation = this.node(b);
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.optional = (flags & NF_OPTIONAL) !== 0;
				node.readonly = (flags & NF_READONLY) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				node.accessibility = this.accessibility(flags);
				return;

			case N_TSMethodSignature:
				node.key = this.node(a);
				node.params = this.list(b);
				node.returnType = this.node(c);
				this.addOptional(node, "typeParameters", d);
				node.computed = (flags & NF_COMPUTED) !== 0;
				node.optional = (flags & NF_OPTIONAL) !== 0;
				node.readonly = (flags & NF_READONLY) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				node.accessibility = this.accessibility(flags);
				node.kind =
					MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT] ===
					"init"
						? "method"
						: MKIND_NAMES[(flags & MKIND_MASK) >>> MKIND_SHIFT];
				return;

			case N_TSIndexSignature:
				node.parameters = this.list(a);
				node.typeAnnotation = this.node(b);
				node.readonly = (flags & NF_READONLY) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				node.accessibility = this.accessibility(flags);
				return;

			case N_TSInterfaceDeclaration:
				node.id = this.node(a);
				node.body = this.node(b);
				this.addOptional(node, "typeParameters", c);
				node.extends = this.list(d);
				node.declare = (flags & NF_DECLARE) !== 0;
				return;

			case N_TSInterfaceHeritage:
			case N_TSClassImplements:
				node.expression = this.node(a);
				this.addOptional(node, "typeArguments", b);
				return;

			case N_TSTypeAliasDeclaration:
				node.id = this.node(a);
				node.typeAnnotation = this.node(b);
				this.addOptional(node, "typeParameters", c);
				node.declare = (flags & NF_DECLARE) !== 0;
				return;

			case N_TSEnumDeclaration:
				node.id = this.node(a);
				node.body = this.node(b);
				node.const = (flags & NF_CONST) !== 0;
				node.declare = (flags & NF_DECLARE) !== 0;
				return;

			case N_TSEnumMember:
				node.id = this.node(a);
				node.initializer = this.node(b);
				return;

			case N_TSModuleDeclaration:
				node.id = this.node(a);
				node.body = this.node(b);
				node.kind =
					MODULE_KIND_NAMES[
						(flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT
					];
				node.declare = (flags & NF_DECLARE) !== 0;
				node.global =
					((flags & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT) ===
					MODULE_GLOBAL;
				return;

			case N_TSParameterProperty:
				node.parameter = this.node(a);
				this.addListIfPresent(node, "decorators", b);
				node.readonly = (flags & NF_READONLY) !== 0;
				node.override = (flags & NF_OVERRIDE) !== 0;
				node.static = (flags & NF_STATIC) !== 0;
				node.accessibility = this.accessibility(flags);
				return;

			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
				node.expression = this.node(a);
				node.typeAnnotation = this.node(b);
				return;

			case N_TSTypeAssertion:
				node.typeAnnotation = this.node(a);
				node.expression = this.node(b);
				return;

			case N_TSInstantiationExpression:
				node.expression = this.node(a);
				node.typeArguments = this.node(b);
				return;

			case N_TSImportEqualsDeclaration:
				node.id = this.node(a);
				node.moduleReference = this.node(b);
				this.addKind(node, "importKind", flags);
				return;

			default:
				// Keyword types such as `TSStringKeyword` carry no children.
				return;
		}
	}

	/**
	 * Converts a mapped type modifier slot into its ESTree form.
	 * @param value The stored modifier value.
	 * @returns `undefined` when absent, `true` for a bare modifier, or the
	 *      sign that was written.
	 */
	private mappedModifier(value: number): boolean | string | null {
		switch (value) {
			case 1:
				return true;

			case 2:
				return "+";

			case 3:
				return "-";

			default:
				return null;
		}
	}

	/**
	 * Adds an `importKind` or `exportKind` property in TypeScript mode.
	 * @param node The node object being built.
	 * @param name The property name.
	 * @param flags The node's flags word.
	 * @returns Nothing.
	 */
	private addKind(node: EsNode, name: string, flags: number): void {
		if (this.typescript) {
			node[name] = (flags & NF_TYPE_ONLY) !== 0 ? "type" : "value";
		}
	}

	/**
	 * Adds a property only when the referenced node exists.
	 * @param node The node object being built.
	 * @param name The property name.
	 * @param index The referenced node index.
	 * @returns Nothing.
	 */
	private addOptional(node: EsNode, name: string, index: number): void {
		if (index !== 0) {
			node[name] = this.node(index);
		} else if (this.typescript) {
			/*
			 * TypeScript's AST always carries these properties. A missing
			 * value is spelled `null` rather than left off or `undefined`.
			 */
			node[name] = null;
		}
	}

	/**
	 * Adds a list-valued property only when the list is non-empty.
	 * @param node The node object being built.
	 * @param name The property name.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private addListIfPresent(
		node: EsNode,
		name: string,
		handle: number,
	): void {
		if (handle !== 0) {
			node[name] = this.list(handle);
		} else if (this.typescript) {
			node[name] = [];
		}
	}

	/**
	 * Adds the type parameter and return type of a function-like node.
	 * @param node The node object being built.
	 * @param typeParameters The type parameter declaration node index.
	 * @param returnType The return type annotation node index.
	 * @returns Nothing.
	 */
	private addTypeMembers(
		node: EsNode,
		typeParameters: number,
		returnType: number,
	): void {
		this.addOptional(node, "typeParameters", typeParameters);
		this.addOptional(node, "returnType", returnType);
	}

	/**
	 * Adds the properties that TypeScript puts on every destructuring pattern.
	 * @param node The node object being built.
	 * @param flags The node's flags word.
	 * @returns Nothing.
	 */
	private addPatternModifiers(node: EsNode, flags: number): void {
		if (this.typescript) {
			node.decorators = [];
			node.optional = (flags & NF_OPTIONAL) !== 0;
		}
	}

	/**
	 * The accessibility modifier recorded on a node.
	 * @param flags The node's flags word.
	 * @returns The modifier name, or `null` when none was written.
	 */
	private accessibility(flags: number): string | null {
		return ACCESSIBILITY_NAMES[(flags & ACCESS_MASK) >>> ACCESS_SHIFT];
	}

	/**
	 * Decodes the name of an identifier, resolving unicode escapes.
	 * @param index The `Identifier` node index.
	 * @returns The identifier's name.
	 */
	private identifierName(index: number): string {
		const nameEnd = this.reader.field(index, NODE_A);
		const raw = this.source.slice(
			this.reader.start(index),
			nameEnd === 0 ? this.reader.end(index) : nameEnd,
		);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * Adds the value and raw text of a literal.
	 * @param node The node object being built.
	 * @param index The node index.
	 * @param subtype The literal subtype.
	 * @param patternEnd For regular expressions, the offset of the closing
	 *      slash.
	 * @returns Nothing.
	 */
	private fillLiteral(
		node: EsNode,
		index: number,
		subtype: number,
		patternEnd: number,
	): void {
		const start = this.reader.start(index);
		const end = this.reader.end(index);
		const raw = this.source.slice(start, end);

		node.raw = raw;

		switch (subtype) {
			case LIT_STRING:
				node.value = decodeEscapes(raw.slice(1, -1), false);
				return;

			case LIT_NUMBER:
				node.value = decodeNumber(raw);
				return;

			case LIT_BOOLEAN:
				node.value = raw === "true";
				return;

			case LIT_NULL:
				node.value = null;
				return;

			case LIT_JSX_STRING:
				/*
				 * A JSX attribute value has no escape sequences; the only
				 * thing that resolves is an entity reference.
				 */
				node.value = decodeEntities(raw.slice(1, -1));
				return;

			case LIT_BIGINT:
				node.value = BigInt(raw.slice(0, -1).replace(/_/gu, ""));
				node.bigint = raw.slice(0, -1).replace(/_/gu, "");
				return;

			case LIT_REGEXP: {
				const pattern = this.source.slice(start + 1, patternEnd);
				const flagText = this.source.slice(patternEnd + 1, end);

				node.regex = { pattern, flags: flagText };

				try {
					node.value = new RegExp(pattern, flagText);
				} catch {
					// A pattern the host cannot compile is reported as null,
					// which is what other ESTree parsers do.
					node.value = null;
				}

				return;
			}

			default:
				node.value = null;
		}
	}
}

/** Marker so that consumers can test whether a kind is TypeScript-only. */
export { TS_FIRST };
