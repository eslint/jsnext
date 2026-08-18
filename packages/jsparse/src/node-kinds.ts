/**
 * @fileoverview AST node kinds, node flags, and the binary node layout.
 *
 * Nodes are stored in a flat `Uint32Array` as fixed-size records. Every record
 * has the same shape:
 *
 * ```text
 * word 0  start offset
 * word 1  end offset
 * word 2  node kind
 * word 3  flags
 * word 4  slot A   \
 * word 5  slot B    |
 * word 6  slot C    |  meaning depends on the node kind; each slot holds
 * word 7  slot D    |  either a node index, a list handle, a token kind,
 * word 8  slot E    |  or a raw offset
 * word 9  slot F    |
 * word 10 slot G    |
 * word 11 slot H   /
 * ```
 *
 * Node index `0` is reserved as the "no node" sentinel, so a slot holding `0`
 * always decodes to `null`.
 *
 * Fixed-size records mean a node can be reached with one multiply and one add,
 * and the record size lives in the buffer header so future versions can grow
 * the record without breaking older readers.
 */

//-----------------------------------------------------------------------------
// Record Layout
//-----------------------------------------------------------------------------

/** Number of 32-bit words in one node record. */
export const NODE_WORDS = 12;

/** Size of one node record in bytes. */
export const NODE_BYTES = NODE_WORDS * 4;

export const NODE_START = 0;
export const NODE_END = 1;
export const NODE_KIND = 2;
export const NODE_FLAGS = 3;
export const NODE_A = 4;
export const NODE_B = 5;
export const NODE_C = 6;
export const NODE_D = 7;
export const NODE_E = 8;
export const NODE_F = 9;
export const NODE_G = 10;
export const NODE_H = 11;

/** The index that represents "there is no node here". */
export const NO_NODE = 0;

/** The list handle that represents an empty list. */
export const EMPTY_LIST = 0;

//-----------------------------------------------------------------------------
// Node Flags
//-----------------------------------------------------------------------------

export const NF_ASYNC = 1 << 0;
export const NF_GENERATOR = 1 << 1;
export const NF_STATIC = 1 << 2;
export const NF_COMPUTED = 1 << 3;
export const NF_OPTIONAL = 1 << 4;
export const NF_PREFIX = 1 << 5;
export const NF_DELEGATE = 1 << 6;
export const NF_SHORTHAND = 1 << 7;
export const NF_METHOD = 1 << 8;
export const NF_EXPRESSION_BODY = 1 << 9;
export const NF_READONLY = 1 << 10;
export const NF_DECLARE = 1 << 11;
export const NF_ABSTRACT = 1 << 12;
export const NF_CONST = 1 << 13;
export const NF_OVERRIDE = 1 << 14;
export const NF_DEFINITE = 1 << 15;
export const NF_TYPE_ONLY = 1 << 16;
export const NF_PARENTHESIZED = 1 << 17;
export const NF_TAIL = 1 << 18;
export const NF_INVALID_ESCAPE = 1 << 19;
export const NF_STRICT = 1 << 20;
export const NF_EXPORT = 1 << 21;
export const NF_IN = 1 << 22;

/** A JSX opening element that closes itself, as in `<br />`. */
export const NF_SELF_CLOSING = NF_ASYNC;

/**
 * An array or object whose rest element is followed by a comma.
 *
 * `[...a,]` and `[...a]` are the same tree, and as array *literals* both are
 * legal, so the comma is nothing the parser can refuse on sight. Read as
 * patterns they differ: a rest element collects everything left, and a comma
 * after it offers a place for something that cannot be there. Only the parser
 * sees the comma, so it records it and `validate()` decides.
 */
export const NF_COMMA_AFTER_REST = NF_ASYNC;

/**
 * An `Identifier` that stands for an `IdentifierName` rather than for a
 * binding or a reference: the `x` in `o.x`, `{ x: 1 }`, `class C { x() {} }`,
 * and `import { x as y }`.
 *
 * The two are the same node kind and the same text, and only the parser can
 * tell them apart — it reaches one through `parseIdentifier()` and the other
 * through `parseWordAsIdentifier()`. Which it was decides whether a reserved
 * word is an error there, so `validate()` needs the answer and cannot work it
 * out from the tree: `await` is a name in `o.await` and a reference in
 * `({ await })`, and both are an `Identifier` under a `Property`.
 *
 * The highest bit, because the low ones are spoken for and the packed
 * enumerations above start at 23.
 */
export const NF_IDENTIFIER_NAME = 1 << 31;

/*
 * Small enumerations are packed into the high bits of the flags word rather
 * than consuming a whole data slot.
 */
export const ACCESS_SHIFT = 23;
export const ACCESS_MASK = 3 << ACCESS_SHIFT;
export const ACCESS_NONE = 0;
export const ACCESS_PUBLIC = 1;
export const ACCESS_PRIVATE = 2;
export const ACCESS_PROTECTED = 3;

/** Names of the accessibility values, indexed by the packed value. */
export const ACCESSIBILITY_NAMES: readonly (string | null)[] = [
	null,
	"public",
	"private",
	"protected",
];

export const DECL_SHIFT = 25;
export const DECL_MASK = 7 << DECL_SHIFT;
export const DECL_VAR = 0;
export const DECL_LET = 1;
export const DECL_CONST = 2;
export const DECL_USING = 3;
export const DECL_AWAIT_USING = 4;

/** Names of the variable declaration kinds, indexed by the packed value. */
export const DECL_KIND_NAMES: readonly string[] = [
	"var",
	"let",
	"const",
	"using",
	"await using",
];

export const MKIND_SHIFT = 28;
export const MKIND_MASK = 7 << MKIND_SHIFT;
export const MKIND_INIT = 0;
export const MKIND_GET = 1;
export const MKIND_SET = 2;
export const MKIND_METHOD = 3;
export const MKIND_CONSTRUCTOR = 4;

/** Names of the property/method kinds, indexed by the packed value. */
export const MKIND_NAMES: readonly string[] = [
	"init",
	"get",
	"set",
	"method",
	"constructor",
];

//-----------------------------------------------------------------------------
// Node Kinds
//-----------------------------------------------------------------------------

/*
 * Kind `0` is unused so that a zeroed record is never mistaken for a real
 * node. JavaScript kinds come first, TypeScript kinds follow; both groups are
 * append-only.
 */

export const N_NONE = 0;
export const N_Program = 1;
export const N_Identifier = 2;
export const N_PrivateIdentifier = 3;
export const N_Literal = 4;
export const N_TemplateLiteral = 5;
export const N_TemplateElement = 6;
export const N_TaggedTemplateExpression = 7;
export const N_ExpressionStatement = 8;
export const N_BlockStatement = 9;
export const N_StaticBlock = 10;
export const N_EmptyStatement = 11;
export const N_DebuggerStatement = 12;
export const N_WithStatement = 13;
export const N_ReturnStatement = 14;
export const N_LabeledStatement = 15;
export const N_BreakStatement = 16;
export const N_ContinueStatement = 17;
export const N_IfStatement = 18;
export const N_SwitchStatement = 19;
export const N_SwitchCase = 20;
export const N_ThrowStatement = 21;
export const N_TryStatement = 22;
export const N_CatchClause = 23;
export const N_WhileStatement = 24;
export const N_DoWhileStatement = 25;
export const N_ForStatement = 26;
export const N_ForInStatement = 27;
export const N_ForOfStatement = 28;
export const N_VariableDeclaration = 29;
export const N_VariableDeclarator = 30;
export const N_FunctionDeclaration = 31;
export const N_FunctionExpression = 32;
export const N_ArrowFunctionExpression = 33;
export const N_ClassDeclaration = 34;
export const N_ClassExpression = 35;
export const N_ClassBody = 36;
export const N_MethodDefinition = 37;
export const N_PropertyDefinition = 38;
export const N_AccessorProperty = 39;
export const N_ThisExpression = 40;
export const N_ArrayExpression = 41;
export const N_ObjectExpression = 42;
export const N_Property = 43;
export const N_SequenceExpression = 44;
export const N_UnaryExpression = 45;
export const N_UpdateExpression = 46;
export const N_BinaryExpression = 47;
export const N_AssignmentExpression = 48;
export const N_LogicalExpression = 49;
export const N_ConditionalExpression = 50;
export const N_CallExpression = 51;
export const N_NewExpression = 52;
export const N_MemberExpression = 53;
export const N_YieldExpression = 54;
export const N_AwaitExpression = 55;
export const N_ImportExpression = 56;
export const N_ChainExpression = 57;
export const N_MetaProperty = 58;
export const N_Super = 59;
export const N_SpreadElement = 60;
export const N_RestElement = 61;
export const N_AssignmentPattern = 62;
export const N_ArrayPattern = 63;
export const N_ObjectPattern = 64;
export const N_ImportDeclaration = 65;
export const N_ImportSpecifier = 66;
export const N_ImportDefaultSpecifier = 67;
export const N_ImportNamespaceSpecifier = 68;
export const N_ImportAttribute = 69;
export const N_ExportNamedDeclaration = 70;
export const N_ExportSpecifier = 71;
export const N_ExportDefaultDeclaration = 72;
export const N_ExportAllDeclaration = 73;
export const N_Decorator = 74;
export const N_JSXElement = 75;
export const N_JSXFragment = 76;
export const N_JSXOpeningElement = 77;
export const N_JSXClosingElement = 78;
export const N_JSXOpeningFragment = 79;
export const N_JSXClosingFragment = 80;
export const N_JSXAttribute = 81;
export const N_JSXSpreadAttribute = 82;
export const N_JSXIdentifier = 83;
export const N_JSXNamespacedName = 84;
export const N_JSXMemberExpression = 85;
export const N_JSXExpressionContainer = 86;
export const N_JSXEmptyExpression = 87;
export const N_JSXSpreadChild = 88;
export const N_JSXText = 89;

export const TS_FIRST = 100;

export const N_TSTypeAnnotation = 100;
export const N_TSTypeParameterDeclaration = 101;
export const N_TSTypeParameter = 102;
export const N_TSTypeParameterInstantiation = 103;
export const N_TSAnyKeyword = 104;
export const N_TSBigIntKeyword = 105;
export const N_TSBooleanKeyword = 106;
export const N_TSNeverKeyword = 107;
export const N_TSNullKeyword = 108;
export const N_TSNumberKeyword = 109;
export const N_TSObjectKeyword = 110;
export const N_TSStringKeyword = 111;
export const N_TSSymbolKeyword = 112;
export const N_TSUndefinedKeyword = 113;
export const N_TSUnknownKeyword = 114;
export const N_TSVoidKeyword = 115;
export const N_TSIntrinsicKeyword = 116;
export const N_TSThisType = 117;
export const N_TSArrayType = 118;
export const N_TSTupleType = 119;
export const N_TSNamedTupleMember = 120;
export const N_TSRestType = 121;
export const N_TSOptionalType = 122;
export const N_TSUnionType = 123;
export const N_TSIntersectionType = 124;
export const N_TSConditionalType = 125;
export const N_TSInferType = 126;
export const N_TSTypeOperator = 127;
export const N_TSIndexedAccessType = 128;
export const N_TSMappedType = 129;
export const N_TSLiteralType = 130;
export const N_TSTemplateLiteralType = 131;
export const N_TSTypeReference = 132;
export const N_TSQualifiedName = 133;
export const N_TSTypeQuery = 134;
export const N_TSTypePredicate = 135;
export const N_TSFunctionType = 136;
export const N_TSConstructorType = 137;
export const N_TSTypeLiteral = 138;
export const N_TSImportType = 139;
export const N_TSPropertySignature = 140;
export const N_TSMethodSignature = 141;
export const N_TSIndexSignature = 142;
export const N_TSCallSignatureDeclaration = 143;
export const N_TSConstructSignatureDeclaration = 144;
export const N_TSInterfaceDeclaration = 145;
export const N_TSInterfaceBody = 146;
export const N_TSInterfaceHeritage = 147;
export const N_TSClassImplements = 148;
export const N_TSTypeAliasDeclaration = 149;
export const N_TSEnumDeclaration = 150;
export const N_TSEnumBody = 151;
export const N_TSEnumMember = 152;
export const N_TSModuleDeclaration = 153;
export const N_TSModuleBlock = 154;
export const N_TSDeclareFunction = 155;
export const N_TSAbstractMethodDefinition = 156;
export const N_TSAbstractPropertyDefinition = 157;
export const N_TSAbstractAccessorProperty = 158;
export const N_TSParameterProperty = 159;
export const N_TSEmptyBodyFunctionExpression = 160;
export const N_TSAsExpression = 161;
export const N_TSSatisfiesExpression = 162;
export const N_TSNonNullExpression = 163;
export const N_TSTypeAssertion = 164;
export const N_TSInstantiationExpression = 165;
export const N_TSExportAssignment = 166;
export const N_TSImportEqualsDeclaration = 167;
export const N_TSExternalModuleReference = 168;
export const N_TSAbstractKeyword = 169;
export const N_TSDeclareKeyword = 170;
export const N_TSExportKeyword = 171;
export const N_TSNamespaceExportDeclaration = 172;

/** One past the largest defined node kind. */
export const NODE_KIND_COUNT = 173;

/**
 * ESTree `type` string for each node kind, indexed by kind. Empty strings mark
 * unassigned kind numbers, which are reserved for future extension.
 */
export const NODE_KIND_NAMES: readonly string[] = (() => {
	const names = new Array<string>(NODE_KIND_COUNT).fill("");

	names[N_Program] = "Program";
	names[N_Identifier] = "Identifier";
	names[N_PrivateIdentifier] = "PrivateIdentifier";
	names[N_Literal] = "Literal";
	names[N_TemplateLiteral] = "TemplateLiteral";
	names[N_TemplateElement] = "TemplateElement";
	names[N_TaggedTemplateExpression] = "TaggedTemplateExpression";
	names[N_ExpressionStatement] = "ExpressionStatement";
	names[N_BlockStatement] = "BlockStatement";
	names[N_StaticBlock] = "StaticBlock";
	names[N_EmptyStatement] = "EmptyStatement";
	names[N_DebuggerStatement] = "DebuggerStatement";
	names[N_WithStatement] = "WithStatement";
	names[N_ReturnStatement] = "ReturnStatement";
	names[N_LabeledStatement] = "LabeledStatement";
	names[N_BreakStatement] = "BreakStatement";
	names[N_ContinueStatement] = "ContinueStatement";
	names[N_IfStatement] = "IfStatement";
	names[N_SwitchStatement] = "SwitchStatement";
	names[N_SwitchCase] = "SwitchCase";
	names[N_ThrowStatement] = "ThrowStatement";
	names[N_TryStatement] = "TryStatement";
	names[N_CatchClause] = "CatchClause";
	names[N_WhileStatement] = "WhileStatement";
	names[N_DoWhileStatement] = "DoWhileStatement";
	names[N_ForStatement] = "ForStatement";
	names[N_ForInStatement] = "ForInStatement";
	names[N_ForOfStatement] = "ForOfStatement";
	names[N_VariableDeclaration] = "VariableDeclaration";
	names[N_VariableDeclarator] = "VariableDeclarator";
	names[N_FunctionDeclaration] = "FunctionDeclaration";
	names[N_FunctionExpression] = "FunctionExpression";
	names[N_ArrowFunctionExpression] = "ArrowFunctionExpression";
	names[N_ClassDeclaration] = "ClassDeclaration";
	names[N_ClassExpression] = "ClassExpression";
	names[N_ClassBody] = "ClassBody";
	names[N_MethodDefinition] = "MethodDefinition";
	names[N_PropertyDefinition] = "PropertyDefinition";
	names[N_AccessorProperty] = "AccessorProperty";
	names[N_ThisExpression] = "ThisExpression";
	names[N_ArrayExpression] = "ArrayExpression";
	names[N_ObjectExpression] = "ObjectExpression";
	names[N_Property] = "Property";
	names[N_SequenceExpression] = "SequenceExpression";
	names[N_UnaryExpression] = "UnaryExpression";
	names[N_UpdateExpression] = "UpdateExpression";
	names[N_BinaryExpression] = "BinaryExpression";
	names[N_AssignmentExpression] = "AssignmentExpression";
	names[N_LogicalExpression] = "LogicalExpression";
	names[N_ConditionalExpression] = "ConditionalExpression";
	names[N_CallExpression] = "CallExpression";
	names[N_NewExpression] = "NewExpression";
	names[N_MemberExpression] = "MemberExpression";
	names[N_YieldExpression] = "YieldExpression";
	names[N_AwaitExpression] = "AwaitExpression";
	names[N_ImportExpression] = "ImportExpression";
	names[N_ChainExpression] = "ChainExpression";
	names[N_MetaProperty] = "MetaProperty";
	names[N_Super] = "Super";
	names[N_SpreadElement] = "SpreadElement";
	names[N_RestElement] = "RestElement";
	names[N_AssignmentPattern] = "AssignmentPattern";
	names[N_ArrayPattern] = "ArrayPattern";
	names[N_ObjectPattern] = "ObjectPattern";
	names[N_ImportDeclaration] = "ImportDeclaration";
	names[N_ImportSpecifier] = "ImportSpecifier";
	names[N_ImportDefaultSpecifier] = "ImportDefaultSpecifier";
	names[N_ImportNamespaceSpecifier] = "ImportNamespaceSpecifier";
	names[N_ImportAttribute] = "ImportAttribute";
	names[N_ExportNamedDeclaration] = "ExportNamedDeclaration";
	names[N_ExportSpecifier] = "ExportSpecifier";
	names[N_ExportDefaultDeclaration] = "ExportDefaultDeclaration";
	names[N_ExportAllDeclaration] = "ExportAllDeclaration";
	names[N_Decorator] = "Decorator";
	names[N_JSXElement] = "JSXElement";
	names[N_JSXFragment] = "JSXFragment";
	names[N_JSXOpeningElement] = "JSXOpeningElement";
	names[N_JSXClosingElement] = "JSXClosingElement";
	names[N_JSXOpeningFragment] = "JSXOpeningFragment";
	names[N_JSXClosingFragment] = "JSXClosingFragment";
	names[N_JSXAttribute] = "JSXAttribute";
	names[N_JSXSpreadAttribute] = "JSXSpreadAttribute";
	names[N_JSXIdentifier] = "JSXIdentifier";
	names[N_JSXNamespacedName] = "JSXNamespacedName";
	names[N_JSXMemberExpression] = "JSXMemberExpression";
	names[N_JSXExpressionContainer] = "JSXExpressionContainer";
	names[N_JSXEmptyExpression] = "JSXEmptyExpression";
	names[N_JSXSpreadChild] = "JSXSpreadChild";
	names[N_JSXText] = "JSXText";

	names[N_TSTypeAnnotation] = "TSTypeAnnotation";
	names[N_TSTypeParameterDeclaration] = "TSTypeParameterDeclaration";
	names[N_TSTypeParameter] = "TSTypeParameter";
	names[N_TSTypeParameterInstantiation] = "TSTypeParameterInstantiation";
	names[N_TSAnyKeyword] = "TSAnyKeyword";
	names[N_TSBigIntKeyword] = "TSBigIntKeyword";
	names[N_TSBooleanKeyword] = "TSBooleanKeyword";
	names[N_TSNeverKeyword] = "TSNeverKeyword";
	names[N_TSNullKeyword] = "TSNullKeyword";
	names[N_TSNumberKeyword] = "TSNumberKeyword";
	names[N_TSObjectKeyword] = "TSObjectKeyword";
	names[N_TSStringKeyword] = "TSStringKeyword";
	names[N_TSSymbolKeyword] = "TSSymbolKeyword";
	names[N_TSUndefinedKeyword] = "TSUndefinedKeyword";
	names[N_TSUnknownKeyword] = "TSUnknownKeyword";
	names[N_TSVoidKeyword] = "TSVoidKeyword";
	names[N_TSIntrinsicKeyword] = "TSIntrinsicKeyword";
	names[N_TSThisType] = "TSThisType";
	names[N_TSArrayType] = "TSArrayType";
	names[N_TSTupleType] = "TSTupleType";
	names[N_TSNamedTupleMember] = "TSNamedTupleMember";
	names[N_TSRestType] = "TSRestType";
	names[N_TSOptionalType] = "TSOptionalType";
	names[N_TSUnionType] = "TSUnionType";
	names[N_TSIntersectionType] = "TSIntersectionType";
	names[N_TSConditionalType] = "TSConditionalType";
	names[N_TSInferType] = "TSInferType";
	names[N_TSTypeOperator] = "TSTypeOperator";
	names[N_TSIndexedAccessType] = "TSIndexedAccessType";
	names[N_TSMappedType] = "TSMappedType";
	names[N_TSLiteralType] = "TSLiteralType";
	names[N_TSTemplateLiteralType] = "TSTemplateLiteralType";
	names[N_TSTypeReference] = "TSTypeReference";
	names[N_TSQualifiedName] = "TSQualifiedName";
	names[N_TSTypeQuery] = "TSTypeQuery";
	names[N_TSTypePredicate] = "TSTypePredicate";
	names[N_TSFunctionType] = "TSFunctionType";
	names[N_TSConstructorType] = "TSConstructorType";
	names[N_TSTypeLiteral] = "TSTypeLiteral";
	names[N_TSImportType] = "TSImportType";
	names[N_TSPropertySignature] = "TSPropertySignature";
	names[N_TSMethodSignature] = "TSMethodSignature";
	names[N_TSIndexSignature] = "TSIndexSignature";
	names[N_TSCallSignatureDeclaration] = "TSCallSignatureDeclaration";
	names[N_TSConstructSignatureDeclaration] =
		"TSConstructSignatureDeclaration";
	names[N_TSInterfaceDeclaration] = "TSInterfaceDeclaration";
	names[N_TSInterfaceBody] = "TSInterfaceBody";
	names[N_TSInterfaceHeritage] = "TSInterfaceHeritage";
	names[N_TSClassImplements] = "TSClassImplements";
	names[N_TSTypeAliasDeclaration] = "TSTypeAliasDeclaration";
	names[N_TSEnumDeclaration] = "TSEnumDeclaration";
	names[N_TSEnumBody] = "TSEnumBody";
	names[N_TSEnumMember] = "TSEnumMember";
	names[N_TSModuleDeclaration] = "TSModuleDeclaration";
	names[N_TSModuleBlock] = "TSModuleBlock";
	names[N_TSDeclareFunction] = "TSDeclareFunction";
	names[N_TSAbstractMethodDefinition] = "TSAbstractMethodDefinition";
	names[N_TSAbstractPropertyDefinition] = "TSAbstractPropertyDefinition";
	names[N_TSAbstractAccessorProperty] = "TSAbstractAccessorProperty";
	names[N_TSParameterProperty] = "TSParameterProperty";
	names[N_TSEmptyBodyFunctionExpression] = "TSEmptyBodyFunctionExpression";
	names[N_TSAsExpression] = "TSAsExpression";
	names[N_TSSatisfiesExpression] = "TSSatisfiesExpression";
	names[N_TSNonNullExpression] = "TSNonNullExpression";
	names[N_TSTypeAssertion] = "TSTypeAssertion";
	names[N_TSInstantiationExpression] = "TSInstantiationExpression";
	names[N_TSExportAssignment] = "TSExportAssignment";
	names[N_TSImportEqualsDeclaration] = "TSImportEqualsDeclaration";
	names[N_TSExternalModuleReference] = "TSExternalModuleReference";
	names[N_TSAbstractKeyword] = "TSAbstractKeyword";
	names[N_TSDeclareKeyword] = "TSDeclareKeyword";
	names[N_TSExportKeyword] = "TSExportKeyword";
	names[N_TSNamespaceExportDeclaration] = "TSNamespaceExportDeclaration";

	return names;
})();

//-----------------------------------------------------------------------------
// Literal Subtypes
//-----------------------------------------------------------------------------

export const LIT_STRING = 0;
export const LIT_NUMBER = 1;
export const LIT_BOOLEAN = 2;
export const LIT_NULL = 3;
export const LIT_REGEXP = 4;
export const LIT_BIGINT = 5;

/** A quoted JSX attribute value, whose only escapes are entity references. */
export const LIT_JSX_STRING = 6;

//-----------------------------------------------------------------------------
// Module Declaration Subtypes
//-----------------------------------------------------------------------------

/*
 * `TSModuleDeclaration` never carries a method kind, so it reuses the same
 * bit field to record whether it was written as `global`, `module`, or
 * `namespace`.
 */
export const MODULE_KIND_SHIFT = MKIND_SHIFT;
export const MODULE_KIND_MASK = MKIND_MASK;

export const MODULE_GLOBAL = 0;
export const MODULE_MODULE = 1;
export const MODULE_NAMESPACE = 2;

/** Names of the `TSModuleDeclaration` kinds, indexed by the packed value. */
export const MODULE_KIND_NAMES: readonly string[] = [
	"global",
	"module",
	"namespace",
];
