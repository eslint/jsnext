/**
 * @fileoverview The shape of every decoded node, declaratively.
 *
 * This is the single source of truth for what `toAST()` emits. The decoder
 * itself is generated from it — `generate-to-ast.mjs` turns each entry into
 * monomorphic functions in `src/parse/to-ast-decode.ts` — and
 * `derive-shapes.mjs` checks it against the hand-written declarations in
 * `src/parse/ast-types.ts`. Changing what a node looks like therefore means
 * changing it here, regenerating, and letting both checks agree.
 *
 * Each key is a node kind name (the `N_` constant without its prefix, which
 * is also the ESTree `type` string) and each value lists the node's
 * properties in emission order. Every node also carries `type`, `start`, and
 * `end`, which no entry repeats; the ESLint variants add `range` and `loc`
 * between `end` and the listed properties. A kind with no entry decodes to
 * those base properties alone, which is what the `TS*Keyword` types want.
 *
 * The operations, and the property each writes:
 *
 * - `child(p, slot)` — the node in the slot, or `null` when the slot is 0.
 * - `children(p, slot)` — the list in the slot, `[]` when the slot is 0.
 * - `optChild(p, slot)` — a child that `js` mode omits when absent and `ts`
 *   mode spells `null`, matching the reference parsers.
 * - `optChildren(p, slot)` — a list that `js` mode omits when absent and
 *   `ts` mode spells `[]`.
 * - `flag(p, name)` — a boolean read from the named `NF_*` flag.
 * - `constant(p, value)` — a fixed value, given as source text.
 * - `operator(slot)` — the `operator` spelling of the token kind in the slot.
 * - `mkind(p)` / `declKind(p)` / `moduleKind(p)` — the packed kind field, as
 *   its name.
 * - `methodKind(p)` — `mkind`, with `init` reported as `method`, which is
 *   what `TSMethodSignature` wants.
 * - `moduleGlobal(p)` — whether the packed module kind is `global`.
 * - `accessibility(p)` — the accessibility modifier name, or `null`.
 * - `typeOnly(p)` — `"type"` or `"value"` from `NF_TYPE_ONLY`; TS-only.
 * - `eq1(p, slot)` — whether the slot holds exactly 1.
 * - `identifierName(p)` / `privateName(p)` / `rawText(p)` — the identifier
 *   spelling with escapes resolved, the same without its leading `#`, and
 *   the raw source text of the node.
 *
 * The modifiers:
 *
 * - `ts(spec)` — emitted only under `dialect: "ts"`.
 * - `js(spec)` — emitted only under `dialect: "js"`.
 *
 * A handful of kinds compute something no operation describes — a literal's
 * value, a template element's cooked text. Those are `custom` entries: the
 * generator holds their bodies, and `shape` here declares what the bodies
 * emit so `derive-shapes.mjs` can still check them.
 */

/**
 * Builds an unconditional child property spec.
 * @param p The property name.
 * @param slot The slot letter, `A` through `G`.
 * @returns The spec.
 */
const child = (p, slot) => ({ p, op: "child", slot });

/**
 * Builds an unconditional list property spec.
 * @param p The property name.
 * @param slot The slot letter.
 * @returns The spec.
 */
const children = (p, slot) => ({ p, op: "children", slot });

/**
 * Builds a child property that `js` mode leaves off when absent.
 * @param p The property name.
 * @param slot The slot letter.
 * @returns The spec.
 */
const optChild = (p, slot) => ({ p, op: "optChild", slot });

/**
 * Builds a list property that `js` mode leaves off when absent.
 * @param p The property name.
 * @param slot The slot letter.
 * @returns The spec.
 */
const optChildren = (p, slot) => ({ p, op: "optChildren", slot });

/**
 * Builds a boolean property read from a node flag.
 * @param p The property name.
 * @param name The `NF_*` constant's name.
 * @returns The spec.
 */
const flag = (p, name) => ({ p, op: "flag", flag: name });

/**
 * Builds a fixed-value property.
 * @param p The property name.
 * @param value The value, as source text.
 * @returns The spec.
 */
const constant = (p, value) => ({ p, op: "constant", value });

/**
 * Builds the `operator` property from a stored token kind.
 * @param slot The slot letter holding the token kind.
 * @returns The spec.
 */
const operator = slot => ({ p: "operator", op: "operator", slot });

/**
 * Builds a property from the packed method-kind field.
 * @param p The property name.
 * @returns The spec.
 */
const mkind = p => ({ p, op: "mkind" });

/**
 * Builds a property from the packed declaration-kind field.
 * @param p The property name.
 * @returns The spec.
 */
const declKind = p => ({ p, op: "declKind" });

/**
 * Builds a property from the packed module-kind field.
 * @param p The property name.
 * @returns The spec.
 */
const moduleKind = p => ({ p, op: "moduleKind" });

/**
 * Builds the method-kind property with `init` reported as `method`.
 * @param p The property name.
 * @returns The spec.
 */
const methodKind = p => ({ p, op: "methodKind" });

/**
 * Builds the flag that reports a `global` module declaration.
 * @param p The property name.
 * @returns The spec.
 */
const moduleGlobal = p => ({ p, op: "moduleGlobal" });

/**
 * Builds the accessibility-modifier property.
 * @param p The property name.
 * @returns The spec.
 */
const accessibility = p => ({ p, op: "accessibility" });

/**
 * Builds an `importKind`/`exportKind` property, which is TS-only.
 * @param p The property name.
 * @returns The spec.
 */
const typeOnly = p => ({ p, op: "typeOnly", ts: true });

/**
 * Builds a boolean property that reports whether a slot holds 1.
 * @param p The property name.
 * @param slot The slot letter.
 * @returns The spec.
 */
const eq1 = (p, slot) => ({ p, op: "eq1", slot });

/**
 * Builds the resolved identifier-name property.
 * @param p The property name.
 * @returns The spec.
 */
const identifierName = p => ({ p, op: "identifierName" });

/**
 * Builds the resolved private-name property, without its `#`.
 * @param p The property name.
 * @returns The spec.
 */
const privateName = p => ({ p, op: "privateName" });

/**
 * Builds a property holding the node's raw source text.
 * @param p The property name.
 * @returns The spec.
 */
const rawText = p => ({ p, op: "rawText" });

/**
 * Restricts a spec to `dialect: "ts"`.
 * @param spec The spec to restrict.
 * @returns The restricted spec.
 */
const ts = spec => ({ ...spec, ts: true });

/**
 * Restricts a spec to `dialect: "js"`.
 * @param spec The spec to restrict.
 * @returns The restricted spec.
 */
const js = spec => ({ ...spec, js: true });

/**
 * What a `custom` entry's generator-held body emits, for `derive-shapes.mjs`.
 * @param props The emitted properties.
 * @returns The entry.
 */
const custom = (...props) => ({ custom: true, shape: props });

/**
 * Describes one property of a `custom` entry.
 * @param p The property name.
 * @param kind The value kind, in `derive-shapes.mjs` vocabulary.
 * @param optional Whether some decode leaves the property off.
 * @returns The description.
 */
const emits = (p, kind, optional = false) => ({ p, kind, optional });

/**
 * The shared shape of the four function kinds.
 *
 * `TSDeclareFunction` and `TSEmptyBodyFunctionExpression` never carry a body,
 * but the slot is simply 0 there and decodes to the same `null` either way.
 */
const functionShape = [
	child("id", "A"),
	children("params", "B"),
	child("body", "C"),
	flag("generator", "NF_GENERATOR"),
	constant("expression", "false"),
	flag("async", "NF_ASYNC"),
	optChild("typeParameters", "D"),
	optChild("returnType", "E"),
	ts(flag("declare", "NF_DECLARE")),
];

/** The shared shape of the class kinds. */
const classShape = [
	child("id", "A"),
	child("superClass", "B"),
	child("body", "C"),
	optChild("typeParameters", "D"),
	optChild("superTypeArguments", "E"),
	optChildren("implements", "F"),
	optChildren("decorators", "G"),
	ts(flag("abstract", "NF_ABSTRACT")),
	ts(flag("declare", "NF_DECLARE")),
];

/** The shared shape of the method-definition kinds. */
const methodShape = [
	child("key", "A"),
	child("value", "B"),
	mkind("kind"),
	flag("computed", "NF_COMPUTED"),
	flag("static", "NF_STATIC"),
	optChildren("decorators", "C"),
	ts(accessibility("accessibility")),
	ts(flag("optional", "NF_OPTIONAL")),
	ts(flag("override", "NF_OVERRIDE")),
];

/** The shared shape of the field-definition kinds. */
const fieldShape = [
	child("key", "A"),
	child("value", "B"),
	flag("computed", "NF_COMPUTED"),
	flag("static", "NF_STATIC"),
	optChildren("decorators", "C"),
	optChild("typeAnnotation", "D"),
	ts(accessibility("accessibility")),
	ts(flag("declare", "NF_DECLARE")),
	ts(flag("definite", "NF_DEFINITE")),
	ts(flag("optional", "NF_OPTIONAL")),
	ts(flag("override", "NF_OVERRIDE")),
	ts(flag("readonly", "NF_READONLY")),
];

/** The shared shape of the call-signature kinds. */
const signatureShape = [
	children("params", "A"),
	child("returnType", "B"),
	optChild("typeParameters", "C"),
];

/** The shape of every node kind that carries more than its extent. */
export const SHAPES = {
	Program: [children("body", "A")],

	Identifier: [
		identifierName("name"),
		ts(optChildren("decorators", "C")),
		ts(flag("optional", "NF_OPTIONAL")),
		ts(child("typeAnnotation", "B")),
	],

	PrivateIdentifier: [privateName("name")],

	Literal: custom(
		emits("raw", "string"),
		emits("value", "unknown"),
		emits("bigint", "string", true),
		emits("regex", "unknown", true),
	),

	TemplateLiteral: [children("quasis", "A"), children("expressions", "B")],

	TSTemplateLiteralType: [children("quasis", "A"), children("types", "B")],

	TemplateElement: custom(
		emits("value", "unknown"),
		emits("tail", "boolean"),
	),

	TaggedTemplateExpression: [
		child("tag", "A"),
		child("quasi", "B"),
		optChild("typeArguments", "C"),
	],

	ExpressionStatement: custom(
		emits("expression", "node"),
		emits("directive", "string", true),
	),

	BlockStatement: [children("body", "A")],
	StaticBlock: [children("body", "A")],
	ClassBody: [children("body", "A")],
	TSModuleBlock: [children("body", "A")],
	TSInterfaceBody: [children("body", "A")],
	TSEnumBody: [children("members", "A")],

	WithStatement: [child("object", "A"), child("body", "B")],

	ReturnStatement: [child("argument", "A")],
	ThrowStatement: [child("argument", "A")],
	AwaitExpression: [child("argument", "A")],
	SpreadElement: [child("argument", "A")],

	TSNonNullExpression: [child("expression", "A")],
	ChainExpression: [child("expression", "A")],
	Decorator: [child("expression", "A")],
	TSExportAssignment: [child("expression", "A")],
	TSExternalModuleReference: [child("expression", "A")],

	TSNamespaceExportDeclaration: [child("id", "A")],

	LabeledStatement: [child("label", "A"), child("body", "B")],
	BreakStatement: [child("label", "A")],
	ContinueStatement: [child("label", "A")],

	IfStatement: [
		child("test", "A"),
		child("consequent", "B"),
		child("alternate", "C"),
	],

	SwitchStatement: [child("discriminant", "A"), children("cases", "B")],
	SwitchCase: [child("test", "A"), children("consequent", "B")],

	TryStatement: [
		child("block", "A"),
		child("handler", "B"),
		child("finalizer", "C"),
	],

	CatchClause: [child("param", "A"), child("body", "B")],

	WhileStatement: [child("test", "A"), child("body", "B")],
	DoWhileStatement: [child("body", "A"), child("test", "B")],

	ForStatement: [
		child("init", "A"),
		child("test", "B"),
		child("update", "C"),
		child("body", "D"),
	],

	ForInStatement: [
		child("left", "A"),
		child("right", "B"),
		child("body", "C"),
	],

	ForOfStatement: [
		child("left", "A"),
		child("right", "B"),
		child("body", "C"),
		flag("await", "NF_ASYNC"),
	],

	VariableDeclaration: [
		children("declarations", "A"),
		declKind("kind"),
		ts(flag("declare", "NF_DECLARE")),
	],

	VariableDeclarator: [
		child("id", "A"),
		child("init", "B"),
		ts(flag("definite", "NF_DEFINITE")),
	],

	FunctionDeclaration: functionShape,
	FunctionExpression: functionShape,
	TSDeclareFunction: functionShape,
	TSEmptyBodyFunctionExpression: functionShape,

	ArrowFunctionExpression: [
		constant("id", "null"),
		children("params", "B"),
		child("body", "C"),
		flag("async", "NF_ASYNC"),
		flag("expression", "NF_EXPRESSION_BODY"),
		constant("generator", "false"),
		optChild("typeParameters", "D"),
		optChild("returnType", "E"),
	],

	ClassDeclaration: classShape,
	ClassExpression: classShape,

	MethodDefinition: methodShape,
	TSAbstractMethodDefinition: methodShape,

	PropertyDefinition: fieldShape,
	TSAbstractPropertyDefinition: fieldShape,
	AccessorProperty: fieldShape,
	TSAbstractAccessorProperty: fieldShape,

	ArrayExpression: [children("elements", "A")],

	ArrayPattern: [
		children("elements", "A"),
		optChild("typeAnnotation", "B"),
		ts(optChildren("decorators", "C")),
		ts(flag("optional", "NF_OPTIONAL")),
	],

	ObjectExpression: [children("properties", "A")],

	ObjectPattern: [
		children("properties", "A"),
		optChild("typeAnnotation", "B"),
		ts(optChildren("decorators", "C")),
		ts(flag("optional", "NF_OPTIONAL")),
	],

	Property: [
		child("key", "A"),
		child("value", "B"),
		mkind("kind"),
		flag("computed", "NF_COMPUTED"),
		flag("method", "NF_METHOD"),
		flag("shorthand", "NF_SHORTHAND"),
		ts(flag("optional", "NF_OPTIONAL")),
	],

	SequenceExpression: [children("expressions", "A")],

	UnaryExpression: [
		operator("B"),
		flag("prefix", "NF_PREFIX"),
		child("argument", "A"),
	],

	UpdateExpression: [
		operator("B"),
		flag("prefix", "NF_PREFIX"),
		child("argument", "A"),
	],

	BinaryExpression: [operator("C"), child("left", "A"), child("right", "B")],
	LogicalExpression: [operator("C"), child("left", "A"), child("right", "B")],
	AssignmentExpression: [
		operator("C"),
		child("left", "A"),
		child("right", "B"),
	],

	ConditionalExpression: [
		child("test", "A"),
		child("consequent", "B"),
		child("alternate", "C"),
	],

	CallExpression: [
		child("callee", "A"),
		children("arguments", "B"),
		flag("optional", "NF_OPTIONAL"),
		optChild("typeArguments", "C"),
	],

	NewExpression: [
		child("callee", "A"),
		children("arguments", "B"),
		optChild("typeArguments", "C"),
	],

	MemberExpression: [
		child("object", "A"),
		child("property", "B"),
		flag("computed", "NF_COMPUTED"),
		flag("optional", "NF_OPTIONAL"),
	],

	YieldExpression: [flag("delegate", "NF_DELEGATE"), child("argument", "A")],

	ImportExpression: [child("source", "A"), child("options", "B")],

	MetaProperty: [child("meta", "A"), child("property", "B")],

	RestElement: [
		child("argument", "A"),
		optChild("typeAnnotation", "B"),
		ts(optChildren("decorators", "C")),
		ts(flag("optional", "NF_OPTIONAL")),
		ts(constant("value", "null")),
	],

	AssignmentPattern: [
		child("left", "A"),
		child("right", "B"),
		ts(optChildren("decorators", "C")),
		ts(flag("optional", "NF_OPTIONAL")),
		ts(constant("typeAnnotation", "null")),
	],

	ImportDeclaration: [
		children("specifiers", "A"),
		child("source", "B"),
		children("attributes", "C"),
		typeOnly("importKind"),
		ts(constant("phase", "null")),
	],

	ImportSpecifier: [
		child("imported", "A"),
		child("local", "B"),
		typeOnly("importKind"),
	],

	ImportDefaultSpecifier: [child("local", "A")],
	ImportNamespaceSpecifier: [child("local", "A")],

	ImportAttribute: [child("key", "A"), child("value", "B")],

	ExportNamedDeclaration: [
		child("declaration", "A"),
		children("specifiers", "B"),
		child("source", "C"),
		children("attributes", "D"),
		typeOnly("exportKind"),
	],

	ExportSpecifier: [
		child("local", "A"),
		child("exported", "B"),
		typeOnly("exportKind"),
	],

	ExportDefaultDeclaration: [
		child("declaration", "A"),
		ts(constant("exportKind", '"value"')),
	],

	ExportAllDeclaration: [
		child("exported", "A"),
		child("source", "B"),
		children("attributes", "C"),
		typeOnly("exportKind"),
	],

	JSXElement: [
		child("openingElement", "A"),
		child("closingElement", "B"),
		children("children", "C"),
	],

	JSXFragment: [
		child("openingFragment", "A"),
		child("closingFragment", "B"),
		children("children", "C"),
	],

	JSXOpeningElement: [
		child("name", "A"),
		children("attributes", "B"),
		flag("selfClosing", "NF_SELF_CLOSING"),
		ts(child("typeArguments", "D")),
	],

	/*
	 * `espree` reports these two properties on an opening fragment even
	 * though a fragment can carry neither.
	 */
	JSXOpeningFragment: [
		js(constant("attributes", "[]")),
		js(constant("selfClosing", "false")),
	],

	JSXClosingElement: [child("name", "A")],

	JSXIdentifier: [rawText("name")],

	JSXNamespacedName: [child("namespace", "A"), child("name", "B")],
	JSXMemberExpression: [child("object", "A"), child("property", "B")],
	JSXAttribute: [child("name", "A"), child("value", "B")],
	JSXSpreadAttribute: [child("argument", "A")],
	JSXExpressionContainer: [child("expression", "A")],
	JSXSpreadChild: [child("expression", "A")],

	JSXText: custom(emits("value", "string"), emits("raw", "string")),

	TSTypeAnnotation: [child("typeAnnotation", "A")],
	TSRestType: [child("typeAnnotation", "A")],
	TSOptionalType: [child("typeAnnotation", "A")],

	TSArrayType: [child("elementType", "A")],
	TSInferType: [child("typeParameter", "A")],

	TSTypeParameterDeclaration: [children("params", "A")],
	TSTypeParameterInstantiation: [children("params", "A")],

	TSTypeParameter: [
		child("name", "A"),
		child("constraint", "B"),
		child("default", "C"),
		flag("in", "NF_IN"),
		flag("out", "NF_STATIC"),
		flag("const", "NF_CONST"),
	],

	TSTupleType: [children("elementTypes", "A")],

	TSNamedTupleMember: [
		child("label", "A"),
		child("elementType", "B"),
		flag("optional", "NF_OPTIONAL"),
	],

	TSUnionType: [children("types", "A")],
	TSIntersectionType: [children("types", "A")],

	TSConditionalType: [
		child("checkType", "A"),
		child("extendsType", "B"),
		child("trueType", "C"),
		child("falseType", "D"),
	],

	TSTypeOperator: [operator("B"), child("typeAnnotation", "A")],

	TSIndexedAccessType: [child("objectType", "A"), child("indexType", "B")],

	TSMappedType: custom(
		emits("key", "node"),
		emits("constraint", "node"),
		emits("nameType", "node"),
		emits("typeAnnotation", "node"),
		emits("optional", "unknown"),
		emits("readonly", "unknown"),
	),

	TSLiteralType: [child("literal", "A")],

	TSTypeReference: [child("typeName", "A"), optChild("typeArguments", "B")],

	TSQualifiedName: [child("left", "A"), child("right", "B")],

	TSTypeQuery: [child("exprName", "A"), optChild("typeArguments", "B")],

	TSTypePredicate: [
		child("parameterName", "A"),
		child("typeAnnotation", "B"),
		eq1("asserts", "C"),
	],

	TSFunctionType: signatureShape,
	TSCallSignatureDeclaration: signatureShape,
	TSConstructSignatureDeclaration: signatureShape,
	TSConstructorType: [...signatureShape, flag("abstract", "NF_ABSTRACT")],

	TSTypeLiteral: [children("members", "A")],

	TSImportType: [
		child("source", "A"),
		child("qualifier", "B"),
		optChild("typeArguments", "C"),
		child("options", "D"),
	],

	TSPropertySignature: [
		child("key", "A"),
		child("typeAnnotation", "B"),
		flag("computed", "NF_COMPUTED"),
		flag("optional", "NF_OPTIONAL"),
		flag("readonly", "NF_READONLY"),
		flag("static", "NF_STATIC"),
		accessibility("accessibility"),
	],

	TSMethodSignature: [
		child("key", "A"),
		children("params", "B"),
		child("returnType", "C"),
		optChild("typeParameters", "D"),
		flag("computed", "NF_COMPUTED"),
		flag("optional", "NF_OPTIONAL"),
		flag("readonly", "NF_READONLY"),
		flag("static", "NF_STATIC"),
		accessibility("accessibility"),
		methodKind("kind"),
	],

	TSIndexSignature: [
		children("parameters", "A"),
		child("typeAnnotation", "B"),
		flag("readonly", "NF_READONLY"),
		flag("static", "NF_STATIC"),
		accessibility("accessibility"),
	],

	TSInterfaceDeclaration: [
		child("id", "A"),
		child("body", "B"),
		optChild("typeParameters", "C"),
		children("extends", "D"),
		flag("declare", "NF_DECLARE"),
	],

	TSInterfaceHeritage: [
		child("expression", "A"),
		optChild("typeArguments", "B"),
	],

	TSClassImplements: [
		child("expression", "A"),
		optChild("typeArguments", "B"),
	],

	TSTypeAliasDeclaration: [
		child("id", "A"),
		child("typeAnnotation", "B"),
		optChild("typeParameters", "C"),
		flag("declare", "NF_DECLARE"),
	],

	TSEnumDeclaration: [
		child("id", "A"),
		child("body", "B"),
		flag("const", "NF_CONST"),
		flag("declare", "NF_DECLARE"),
	],

	TSEnumMember: [child("id", "A"), child("initializer", "B")],

	TSModuleDeclaration: [
		child("id", "A"),
		child("body", "B"),
		moduleKind("kind"),
		flag("declare", "NF_DECLARE"),
		moduleGlobal("global"),
	],

	TSParameterProperty: [
		child("parameter", "A"),
		optChildren("decorators", "B"),
		flag("readonly", "NF_READONLY"),
		flag("override", "NF_OVERRIDE"),
		flag("static", "NF_STATIC"),
		accessibility("accessibility"),
	],

	TSAsExpression: [child("expression", "A"), child("typeAnnotation", "B")],
	TSSatisfiesExpression: [
		child("expression", "A"),
		child("typeAnnotation", "B"),
	],

	TSTypeAssertion: [child("typeAnnotation", "A"), child("expression", "B")],

	TSInstantiationExpression: [
		child("expression", "A"),
		child("typeArguments", "B"),
	],

	TSImportEqualsDeclaration: [
		child("id", "A"),
		child("moduleReference", "B"),
		typeOnly("importKind"),
	],
};
