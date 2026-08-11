/**
 * @fileoverview The ESTree shapes `toAST()` produces.
 *
 * These describe what this parser actually emits, which is not quite what any
 * published type package describes:
 *
 * - Every node carries `start` and `end`. `range` and `loc` appear only on
 *   nodes from `eslintParser.parse()`, so they are optional here.
 * - A property TypeScript's AST spells `undefined` is spelled `null` here.
 * - In `dialect: "js"` the TypeScript-only properties are omitted entirely
 *   rather than set to `null`, so every one of them is optional.
 *
 * The last two are why the nodes below are declared rather than derived from
 * `@types/estree` or `@typescript-eslint/types`. Both are usable only through
 * a whole-tree transformation or a global `declare module` augmentation, and
 * each of those breaks something: the transformation reaches into non-node
 * objects like `regex` and `RegExp` itself, and the augmentation makes
 * `start`/`end` required for every consumer of `estree` in the dependency
 * tree, not just this one.
 *
 * The JavaScript and JSX shapes here are transcribed from `@types/estree` and
 * `@types/estree-jsx` (DefinitelyTyped, MIT), corrected against what the
 * decoder emits. Where they disagree, the decoder wins — see `Program` and
 * `ExpressionStatement` for the two places that has already come up.
 */

import type { SourceLocation } from "./locations.js";
import type { Token } from "./index.js";

//-----------------------------------------------------------------------------
// Base
//-----------------------------------------------------------------------------

/**
 * What every node has.
 *
 * `range` and `loc` are optional because only the ESLint parser adds them;
 * `toAST()` leaves them off. A caller that went through `eslintParser` knows
 * they are present and can narrow.
 */
export interface NodeBase {
	/** The ESTree node type. */
	type: string;

	/** The offset of the first character of the node. */
	start: number;

	/** The offset just past the last character of the node. */
	end: number;

	/** Present only on nodes produced for the ESLint parser. */
	range?: [number, number];

	/** Present only on nodes produced for the ESLint parser. */
	loc?: SourceLocation;
}

//-----------------------------------------------------------------------------
// Enumerations
//
// These mirror the name tables in `node-kinds.ts`. A value that comes out of
// one of those tables can be spelled exactly, so it is.
//-----------------------------------------------------------------------------

/** The declaration forms `VariableDeclaration.kind` can take. */
export type VariableDeclarationKind =
	| "var"
	| "let"
	| "const"
	| "using"
	| "await using";

/** The TypeScript accessibility modifiers, or `null` when none was written. */
export type Accessibility = "public" | "private" | "protected" | null;

/** What an object literal's or class's member can be. */
export type MethodKind = "constructor" | "get" | "init" | "method" | "set";

/** Whether an import or export moves a type or a value. */
export type ImportExportKind = "type" | "value";

/** The operators a `UnaryExpression` can hold. */
export type UnaryOperator =
	| "!"
	| "+"
	| "-"
	| "delete"
	| "typeof"
	| "void"
	| "~";

/** The operators an `UpdateExpression` can hold. */
export type UpdateOperator = "++" | "--";

/** The operators a `BinaryExpression` can hold. */
export type BinaryOperator =
	| "!="
	| "!=="
	| "%"
	| "&"
	| "*"
	| "**"
	| "+"
	| "-"
	| "/"
	| "<"
	| "<<"
	| "<="
	| "=="
	| "==="
	| ">"
	| ">="
	| ">>"
	| ">>>"
	| "^"
	| "in"
	| "instanceof"
	| "|";

/** The operators a `LogicalExpression` can hold. */
export type LogicalOperator = "&&" | "??" | "||";

/** The operators an `AssignmentExpression` can hold. */
export type AssignmentOperator =
	| "%="
	| "&&="
	| "&="
	| "**="
	| "*="
	| "+="
	| "-="
	| "/="
	| "<<="
	| "="
	| ">>="
	| ">>>="
	| "??="
	| "^="
	| "|="
	| "||=";

//-----------------------------------------------------------------------------
// TypeScript unions
//-----------------------------------------------------------------------------

/** Any type. */
export type TSType =
	| TSAnyKeyword
	| TSArrayType
	| TSBigIntKeyword
	| TSBooleanKeyword
	| TSConditionalType
	| TSConstructorType
	| TSFunctionType
	| TSImportType
	| TSIndexedAccessType
	| TSInferType
	| TSIntersectionType
	| TSIntrinsicKeyword
	| TSLiteralType
	| TSMappedType
	| TSNamedTupleMember
	| TSNeverKeyword
	| TSNullKeyword
	| TSNumberKeyword
	| TSObjectKeyword
	| TSOptionalType
	| TSRestType
	| TSStringKeyword
	| TSSymbolKeyword
	| TSTemplateLiteralType
	| TSThisType
	| TSTupleType
	| TSTypeLiteral
	| TSTypeOperator
	| TSTypePredicate
	| TSTypeQuery
	| TSTypeReference
	| TSUndefinedKeyword
	| TSUnionType
	| TSUnknownKeyword
	| TSVoidKeyword;

/** An expression that exists only in TypeScript. */
export type TSExpression =
	| TSAsExpression
	| TSInstantiationExpression
	| TSNonNullExpression
	| TSSatisfiesExpression
	| TSTypeAssertion;

/** A declaration that exists only in TypeScript. */
export type TSDeclaration =
	| TSDeclareFunction
	| TSEnumDeclaration
	| TSImportEqualsDeclaration
	| TSInterfaceDeclaration
	| TSModuleDeclaration
	| TSTypeAliasDeclaration;

/** Anything that can appear in an interface body or a type literal. */
export type TypeElement =
	| TSCallSignatureDeclaration
	| TSConstructSignatureDeclaration
	| TSIndexSignature
	| TSMethodSignature
	| TSPropertySignature;

/**
 * A dotted name in type position.
 *
 * `ThisExpression` is a member because the left of a qualified name can be
 * `this`, as in `typeof this.x`.
 */
export type EntityName = Identifier | ThisExpression | TSQualifiedName;

/**
 * What a mapped type's `readonly` or `?` modifier can say.
 *
 * `true` for a bare modifier and the sign for one that was written with it.
 */
export type MappedModifier = "+" | "-" | boolean;

//-----------------------------------------------------------------------------
// Unions
//-----------------------------------------------------------------------------

/** Any expression. */
export type Expression =
	| TSExpression
	| ArrayExpression
	| ArrowFunctionExpression
	| AssignmentExpression
	| AwaitExpression
	| BinaryExpression
	| CallExpression
	| ChainExpression
	| ClassExpression
	| ConditionalExpression
	| FunctionExpression
	| Identifier
	| ImportExpression
	| JSXElement
	| JSXFragment
	| Literal
	| LogicalExpression
	| MemberExpression
	| MetaProperty
	| NewExpression
	| ObjectExpression
	| SequenceExpression
	| Super
	| TaggedTemplateExpression
	| TemplateLiteral
	| ThisExpression
	| UnaryExpression
	| UpdateExpression
	| YieldExpression;

/**
 * Any binding target.
 *
 * `MemberExpression` is a member because `[a.b] = c` and `for (a.b of c)` both
 * put one in a binding position.
 */
export type Pattern =
	| ArrayPattern
	| AssignmentPattern
	| Identifier
	| MemberExpression
	| ObjectPattern
	| RestElement;

/** Anything that can appear in a function's parameter list. */
export type Parameter = Pattern | TSParameterProperty;

/** Anything that can name a property. */
export type PropertyKey = Expression | PrivateIdentifier;

/** Anything that can appear in a class body. */
export type ClassMember =
	| AccessorProperty
	| MethodDefinition
	| PropertyDefinition
	| StaticBlock
	| TSAbstractAccessorProperty
	| TSAbstractMethodDefinition
	| TSAbstractPropertyDefinition
	| TSIndexSignature;

/** Anything an `export` can attach to. */
export type Declaration =
	| ClassDeclaration
	| FunctionDeclaration
	| TSDeclaration
	| VariableDeclaration;

/** An `import` or `export` declaration. */
export type ModuleDeclaration =
	| ExportAllDeclaration
	| ExportDefaultDeclaration
	| ExportNamedDeclaration
	| ImportDeclaration;

/** Anything that can name a JSX element. */
export type JSXTagName = JSXIdentifier | JSXMemberExpression | JSXNamespacedName;

/** Anything that can appear between a JSX element's tags. */
export type JSXChild =
	| JSXElement
	| JSXExpressionContainer
	| JSXFragment
	| JSXSpreadChild
	| JSXText;

/** Anything that can appear in a JSX opening tag. */
export type JSXAttributeLike = JSXAttribute | JSXSpreadAttribute;

/** Anything that can be a JSX attribute's value. */
export type JSXAttributeValue =
	| JSXElement
	| JSXExpressionContainer
	| JSXFragment
	| Literal
	| null;

/** Anything that can appear in an `import` declaration's specifier list. */
export type ImportClause =
	| ImportDefaultSpecifier
	| ImportNamespaceSpecifier
	| ImportSpecifier;

/**
 * Any statement.
 *
 * `FunctionDeclaration`, `VariableDeclaration`, and `ClassDeclaration` are
 * members rather than a separate `Declaration` union, because every position
 * that accepts a statement accepts them too.
 */
export type Statement =
	| BlockStatement
	| BreakStatement
	| ClassDeclaration
	| ContinueStatement
	| DebuggerStatement
	| DoWhileStatement
	| EmptyStatement
	| ExpressionStatement
	| ForInStatement
	| ForOfStatement
	| ForStatement
	| FunctionDeclaration
	| IfStatement
	| LabeledStatement
	| ReturnStatement
	| StaticBlock
	| SwitchStatement
	| ThrowStatement
	| TryStatement
	| TSDeclaration
	| TSExportAssignment
	| VariableDeclaration
	| WhileStatement
	| WithStatement;

//-----------------------------------------------------------------------------
// Program
//-----------------------------------------------------------------------------

/**
 * The root node.
 *
 * `@types/estree` gives `comments` and `tokens` as optional, and separates a
 * leading directive out into a `Directive` interface. Neither matches what is
 * emitted: both properties are always set, and a directive is an ordinary
 * `ExpressionStatement` carrying a `directive` property.
 */
export interface Program extends NodeBase {
	type: "Program";

	/** The statements and declarations making up the program. */
	body: (ModuleDeclaration | Statement)[];

	/** How the program was interpreted. */
	sourceType: "script" | "module" | "commonjs";

	/** Every comment in the source, in source order. */
	comments: Token[];

	/** Every token in the source, in source order. */
	tokens: Token[];
}

//-----------------------------------------------------------------------------
// Leaves
//-----------------------------------------------------------------------------

/**
 * A name.
 *
 * The three TypeScript-only properties are the ones the decoder adds for every
 * identifier, including the ones no annotation can attach to.
 */
export interface Identifier extends NodeBase {
	type: "Identifier";

	/** The name, with any unicode escapes resolved. */
	name: string;

	/** TypeScript only. Always empty; identifiers hold no decorators. */
	decorators?: Decorator[];

	/** TypeScript only. Whether a `?` followed the name. */
	optional?: boolean;

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;
}

/** A `#name` in a class. */
export interface PrivateIdentifier extends NodeBase {
	type: "PrivateIdentifier";

	/** The name, with the leading `#` removed. */
	name: string;
}

/**
 * A literal value.
 *
 * Split three ways because `regex` and `bigint` appear only on their own kind
 * of literal, so a single interface would make both optional and lose the
 * connection between `regex` being present and `value` being a `RegExp`.
 */
export type Literal = BigIntLiteral | RegExpLiteral | SimpleLiteral;

/** A string, number, boolean, or `null` literal. */
export interface SimpleLiteral extends NodeBase {
	type: "Literal";

	/** The literal's value. */
	value: string | number | boolean | null;

	/** The literal exactly as it was written. */
	raw: string;
}

/** A regular expression literal. */
export interface RegExpLiteral extends NodeBase {
	type: "Literal";

	/** The compiled expression, or `null` when the host rejected it. */
	value: RegExp | null;

	/** The pattern and flags as written. */
	regex: { pattern: string; flags: string };

	/** The literal exactly as it was written. */
	raw: string;
}

/** A bigint literal. */
export interface BigIntLiteral extends NodeBase {
	type: "Literal";

	/** The literal's value. */
	value: bigint;

	/** The digits, with the `n` suffix and any separators removed. */
	bigint: string;

	/** The literal exactly as it was written. */
	raw: string;
}

/** A `this` reference. */
export interface ThisExpression extends NodeBase {
	type: "ThisExpression";
}

/** A `super` reference. */
export interface Super extends NodeBase {
	type: "Super";
}

//-----------------------------------------------------------------------------
// Statements
//-----------------------------------------------------------------------------

/**
 * An expression evaluated for its effect.
 *
 * `directive` is the string of a directive prologue entry with its quotes
 * stripped. In `dialect: "js"` it is present only on an actual directive; in
 * `dialect: "ts"` every expression statement has it, `null` when the statement
 * is not a directive.
 */
export interface ExpressionStatement extends NodeBase {
	type: "ExpressionStatement";

	/** The expression being evaluated. */
	expression: Expression;

	/** The directive's text, or `null` when this is not a directive. */
	directive?: string | null;
}

/** A `{ … }` block. */
export interface BlockStatement extends NodeBase {
	type: "BlockStatement";

	/** The statements inside the block. */
	body: Statement[];
}

/** A class's `static { … }` block. */
export interface StaticBlock extends NodeBase {
	type: "StaticBlock";

	/** The statements inside the block. */
	body: Statement[];
}

/** A lone `;`. */
export interface EmptyStatement extends NodeBase {
	type: "EmptyStatement";
}

/** A `debugger;` statement. */
export interface DebuggerStatement extends NodeBase {
	type: "DebuggerStatement";
}

/** A `with (…) …` statement. */
export interface WithStatement extends NodeBase {
	type: "WithStatement";

	/** The object whose properties enter scope. */
	object: Expression;

	/** The statement evaluated with that scope in place. */
	body: Statement;
}

/** A `return` statement. */
export interface ReturnStatement extends NodeBase {
	type: "ReturnStatement";

	/** The returned expression, or `null` for a bare `return`. */
	argument: Expression | null;
}

/** A labeled statement. */
export interface LabeledStatement extends NodeBase {
	type: "LabeledStatement";

	/** The label. */
	label: Identifier;

	/** The statement the label applies to. */
	body: Statement;
}

/** A `break` statement. */
export interface BreakStatement extends NodeBase {
	type: "BreakStatement";

	/** The target label, or `null` for a bare `break`. */
	label: Identifier | null;
}

/** A `continue` statement. */
export interface ContinueStatement extends NodeBase {
	type: "ContinueStatement";

	/** The target label, or `null` for a bare `continue`. */
	label: Identifier | null;
}

/** An `if` statement. */
export interface IfStatement extends NodeBase {
	type: "IfStatement";

	/** The condition. */
	test: Expression;

	/** The statement run when the condition holds. */
	consequent: Statement;

	/** The `else` branch, or `null` when there is none. */
	alternate: Statement | null;
}

/** A `switch` statement. */
export interface SwitchStatement extends NodeBase {
	type: "SwitchStatement";

	/** The value being matched. */
	discriminant: Expression;

	/** The cases, in source order. */
	cases: SwitchCase[];
}

/** One `case` or `default` of a `switch`. */
export interface SwitchCase extends NodeBase {
	type: "SwitchCase";

	/** The matched value, or `null` for `default`. */
	test: Expression | null;

	/** The statements run when the case matches. */
	consequent: Statement[];
}

/** A `throw` statement. */
export interface ThrowStatement extends NodeBase {
	type: "ThrowStatement";

	/** The thrown value. */
	argument: Expression;
}

/** A `try` statement. */
export interface TryStatement extends NodeBase {
	type: "TryStatement";

	/** The guarded block. */
	block: BlockStatement;

	/** The `catch` clause, or `null` when there is none. */
	handler: CatchClause | null;

	/** The `finally` block, or `null` when there is none. */
	finalizer: BlockStatement | null;
}

/** The `catch` clause of a `try` statement. */
export interface CatchClause extends NodeBase {
	type: "CatchClause";

	/** The bound error, or `null` for `catch { … }`. */
	param: Pattern | null;

	/** The clause's body. */
	body: BlockStatement;
}

/** A `while` loop. */
export interface WhileStatement extends NodeBase {
	type: "WhileStatement";

	/** The condition, tested before each iteration. */
	test: Expression;

	/** The loop body. */
	body: Statement;
}

/** A `do … while` loop. */
export interface DoWhileStatement extends NodeBase {
	type: "DoWhileStatement";

	/** The loop body. */
	body: Statement;

	/** The condition, tested after each iteration. */
	test: Expression;
}

/** A three-part `for` loop. */
export interface ForStatement extends NodeBase {
	type: "ForStatement";

	/** The initializer, or `null` when the clause is empty. */
	init: Expression | VariableDeclaration | null;

	/** The condition, or `null` when the clause is empty. */
	test: Expression | null;

	/** The update expression, or `null` when the clause is empty. */
	update: Expression | null;

	/** The loop body. */
	body: Statement;
}

/** A `for … in` loop. */
export interface ForInStatement extends NodeBase {
	type: "ForInStatement";

	/** What each key is assigned to. */
	left: Pattern | VariableDeclaration;

	/** The object whose keys are enumerated. */
	right: Expression;

	/** The loop body. */
	body: Statement;
}

/** A `for … of` loop. */
export interface ForOfStatement extends NodeBase {
	type: "ForOfStatement";

	/** What each value is assigned to. */
	left: Pattern | VariableDeclaration;

	/** The iterated expression. */
	right: Expression;

	/** The loop body. */
	body: Statement;

	/** Whether this is a `for await … of` loop. */
	await: boolean;
}

//-----------------------------------------------------------------------------
// Declarations
//-----------------------------------------------------------------------------

/** A `var`, `let`, `const`, or `using` declaration. */
export interface VariableDeclaration extends NodeBase {
	type: "VariableDeclaration";

	/** The declarators, in source order. */
	declarations: VariableDeclarator[];

	/** Which declaration form was used. */
	kind: VariableDeclarationKind;

	/** TypeScript only. Whether the declaration was marked `declare`. */
	declare?: boolean;
}

/** One binding of a variable declaration. */
export interface VariableDeclarator extends NodeBase {
	type: "VariableDeclarator";

	/** The bound pattern. */
	id: Pattern;

	/** The initializer, or `null` when there is none. */
	init: Expression | null;

	/** TypeScript only. Whether a `!` followed the binding. */
	definite?: boolean;
}

/**
 * A function declaration.
 *
 * `expression` is always `false` and `generator` reflects the `*`; both are
 * emitted for every function so that the shape matches an arrow function's.
 * `body` is `null` only for an overload signature, which the decoder emits as
 * `TSDeclareFunction`.
 */
export interface FunctionDeclaration extends NodeBase {
	type: "FunctionDeclaration";

	/** The function's name, or `null` for `export default function () {}`. */
	id: Identifier | null;

	/** The parameter list. */
	params: Parameter[];

	/** The function body. */
	body: BlockStatement;

	/** Whether the function was declared with a `*`. */
	generator: boolean;

	/** Whether the function was declared `async`. */
	async: boolean;

	/** Always `false`; a declaration never has an expression body. */
	expression: false;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** TypeScript only. The return annotation, or `null` when there is none. */
	returnType?: TSTypeAnnotation | null;

	/** TypeScript only. Whether the function was marked `declare`. */
	declare?: boolean;
}

//-----------------------------------------------------------------------------
// Expressions
//-----------------------------------------------------------------------------

/** An array literal. */
export interface ArrayExpression extends NodeBase {
	type: "ArrayExpression";

	/** The elements, with `null` for each hole. */
	elements: (Expression | SpreadElement | null)[];
}

/** An object literal. */
export interface ObjectExpression extends NodeBase {
	type: "ObjectExpression";

	/** The properties, in source order. */
	properties: (Property | SpreadElement)[];
}

/**
 * One property of an object literal or object pattern.
 *
 * `value` is a `Pattern` when the property belongs to an `ObjectPattern`, so
 * both are allowed here; which one it is follows from the parent.
 */
export interface Property extends NodeBase {
	type: "Property";

	/** The property's key. */
	key: Expression;

	/** The property's value. */
	value: Expression | Pattern;

	/** Whether the property is a plain entry, a getter, or a setter. */
	kind: MethodKind;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the property was written in method shorthand. */
	method: boolean;

	/** Whether the property was written in shorthand. */
	shorthand: boolean;

	/** TypeScript only. Whether a `?` followed the key. */
	optional?: boolean;
}

/** A `...x` in an array literal, object literal, or argument list. */
export interface SpreadElement extends NodeBase {
	type: "SpreadElement";

	/** The spread expression. */
	argument: Expression;
}

/** A template literal. */
export interface TemplateLiteral extends NodeBase {
	type: "TemplateLiteral";

	/** The literal chunks, one more than there are expressions. */
	quasis: TemplateElement[];

	/** The interpolated expressions. */
	expressions: Expression[];
}

/** One literal chunk of a template. */
export interface TemplateElement extends NodeBase {
	type: "TemplateElement";

	/** The chunk's text, raw and resolved. */
	value: {
		/** The text exactly as written. */
		raw: string;

		/** The text with escapes resolved, or `null` if any are invalid. */
		cooked: string | null;
	};

	/** Whether this is the chunk after the last expression. */
	tail: boolean;
}

/** A tagged template. */
export interface TaggedTemplateExpression extends NodeBase {
	type: "TaggedTemplateExpression";

	/** The tag being applied. */
	tag: Expression;

	/** The template being tagged. */
	quasi: TemplateLiteral;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** A unary operation. */
export interface UnaryExpression extends NodeBase {
	type: "UnaryExpression";

	/** The operator. */
	operator: UnaryOperator;

	/** Always `true`; a unary operator always precedes its operand. */
	prefix: boolean;

	/** The operand. */
	argument: Expression;
}

/** An increment or decrement. */
export interface UpdateExpression extends NodeBase {
	type: "UpdateExpression";

	/** The operator. */
	operator: UpdateOperator;

	/** Whether the operator preceded its operand. */
	prefix: boolean;

	/** The operand. */
	argument: Expression;
}

/**
 * A binary operation.
 *
 * `left` can be a `PrivateIdentifier` for `#field in obj`, which is the only
 * place a private name appears outside a member expression.
 */
export interface BinaryExpression extends NodeBase {
	type: "BinaryExpression";

	/** The operator. */
	operator: BinaryOperator;

	/** The left operand. */
	left: Expression | PrivateIdentifier;

	/** The right operand. */
	right: Expression;
}

/** A short-circuiting operation. */
export interface LogicalExpression extends NodeBase {
	type: "LogicalExpression";

	/** The operator. */
	operator: LogicalOperator;

	/** The left operand. */
	left: Expression;

	/** The right operand. */
	right: Expression;
}

/** An assignment. */
export interface AssignmentExpression extends NodeBase {
	type: "AssignmentExpression";

	/** The operator. */
	operator: AssignmentOperator;

	/** What is being assigned to. */
	left: Pattern;

	/** The assigned value. */
	right: Expression;
}

/** A `… ? … : …` expression. */
export interface ConditionalExpression extends NodeBase {
	type: "ConditionalExpression";

	/** The condition. */
	test: Expression;

	/** The value when the condition holds. */
	consequent: Expression;

	/** The value when it does not. */
	alternate: Expression;
}

/** A function call. */
export interface CallExpression extends NodeBase {
	type: "CallExpression";

	/** What is being called. */
	callee: Expression;

	/** The arguments. */
	arguments: (Expression | SpreadElement)[];

	/** Whether the call was written `?.()`. */
	optional: boolean;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** A `new` expression. */
export interface NewExpression extends NodeBase {
	type: "NewExpression";

	/** What is being constructed. */
	callee: Expression;

	/** The arguments. */
	arguments: (Expression | SpreadElement)[];

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** A property access. */
export interface MemberExpression extends NodeBase {
	type: "MemberExpression";

	/** The object being accessed. */
	object: Expression;

	/** The property being read. */
	property: Expression | PrivateIdentifier;

	/** Whether the property was written in brackets. */
	computed: boolean;

	/** Whether the access was written `?.`. */
	optional: boolean;
}

/** The root of an optional chain. */
export interface ChainExpression extends NodeBase {
	type: "ChainExpression";

	/** The chain itself. */
	expression: CallExpression | MemberExpression;
}

/** A comma expression. */
export interface SequenceExpression extends NodeBase {
	type: "SequenceExpression";

	/** The expressions, in source order. */
	expressions: Expression[];
}

/** A `yield` expression. */
export interface YieldExpression extends NodeBase {
	type: "YieldExpression";

	/** Whether the expression was written `yield*`. */
	delegate: boolean;

	/** The yielded value, or `null` for a bare `yield`. */
	argument: Expression | null;
}

/** An `await` expression. */
export interface AwaitExpression extends NodeBase {
	type: "AwaitExpression";

	/** The awaited value. */
	argument: Expression;
}

/** A dynamic `import()`. */
export interface ImportExpression extends NodeBase {
	type: "ImportExpression";

	/** The imported specifier. */
	source: Expression;

	/** The options argument, or `null` when there is none. */
	options: Expression | null;
}

/** A `new.target` or `import.meta`. */
export interface MetaProperty extends NodeBase {
	type: "MetaProperty";

	/** The `new` or `import` half. */
	meta: Identifier;

	/** The `target` or `meta` half. */
	property: Identifier;
}

/**
 * A function expression.
 *
 * `declare` is emitted here as well as on a declaration, because the decoder
 * fills both from one case.
 */
export interface FunctionExpression extends NodeBase {
	type: "FunctionExpression";

	/** The function's name, or `null` when it is anonymous. */
	id: Identifier | null;

	/** The parameter list. */
	params: Parameter[];

	/** The function body. */
	body: BlockStatement;

	/** Whether the function was declared with a `*`. */
	generator: boolean;

	/** Whether the function was declared `async`. */
	async: boolean;

	/** Always `false`; only an arrow function has an expression body. */
	expression: false;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** TypeScript only. The return annotation, or `null` when there is none. */
	returnType?: TSTypeAnnotation | null;

	/** TypeScript only. Whether the function was marked `declare`. */
	declare?: boolean;
}

/** An arrow function. */
export interface ArrowFunctionExpression extends NodeBase {
	type: "ArrowFunctionExpression";

	/** Always `null`; an arrow function cannot be named. */
	id: null;

	/** The parameter list. */
	params: Parameter[];

	/** The body, which is an expression when there are no braces. */
	body: BlockStatement | Expression;

	/** Whether the body was written without braces. */
	expression: boolean;

	/** Whether the function was declared `async`. */
	async: boolean;

	/** Always `false`; an arrow function cannot be a generator. */
	generator: false;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** TypeScript only. The return annotation, or `null` when there is none. */
	returnType?: TSTypeAnnotation | null;
}

//-----------------------------------------------------------------------------
// Patterns
//-----------------------------------------------------------------------------

/** A destructuring array pattern. */
export interface ArrayPattern extends NodeBase {
	type: "ArrayPattern";

	/** The bound elements, with `null` for each hole. */
	elements: (Pattern | null)[];

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** TypeScript only. Always empty; a pattern holds no decorators. */
	decorators?: Decorator[];

	/** TypeScript only. Whether a `?` followed the pattern. */
	optional?: boolean;
}

/** A destructuring object pattern. */
export interface ObjectPattern extends NodeBase {
	type: "ObjectPattern";

	/** The bound properties. */
	properties: (Property | RestElement)[];

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** TypeScript only. Always empty; a pattern holds no decorators. */
	decorators?: Decorator[];

	/** TypeScript only. Whether a `?` followed the pattern. */
	optional?: boolean;
}

/** A `...x` in a pattern or parameter list. */
export interface RestElement extends NodeBase {
	type: "RestElement";

	/** The bound target. */
	argument: Pattern;

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** TypeScript only. Always empty; a rest element holds no decorators. */
	decorators?: Decorator[];

	/** TypeScript only. Whether a `?` followed the element. */
	optional?: boolean;

	/** TypeScript only. Always `null`; a rest element has no default. */
	value?: null;
}

/** A binding with a default. */
export interface AssignmentPattern extends NodeBase {
	type: "AssignmentPattern";

	/** The bound target. */
	left: Pattern;

	/** The default value. */
	right: Expression;

	/** TypeScript only. Always empty; a pattern holds no decorators. */
	decorators?: Decorator[];

	/** TypeScript only. Whether a `?` followed the target. */
	optional?: boolean;

	/** TypeScript only. Always `null`; the annotation sits on `left`. */
	typeAnnotation?: null;
}

//-----------------------------------------------------------------------------
// Classes
//-----------------------------------------------------------------------------

/** A class declaration. */
export interface ClassDeclaration extends NodeBase {
	type: "ClassDeclaration";

	/** The class's name, or `null` for `export default class {}`. */
	id: Identifier | null;

	/** The `extends` clause, or `null` when there is none. */
	superClass: Expression | null;

	/** The class body. */
	body: ClassBody;

	/** The decorators applied to the class. */
	decorators?: Decorator[];

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** TypeScript only. The `<T>` list on `extends`, or `null` for none. */
	superTypeArguments?: TSTypeParameterInstantiation | null;

	/** TypeScript only. The `implements` clause. */
	implements?: TSClassImplements[];

	/** TypeScript only. Whether the class was marked `abstract`. */
	abstract?: boolean;

	/** TypeScript only. Whether the class was marked `declare`. */
	declare?: boolean;
}

/** A class expression. */
export interface ClassExpression extends NodeBase {
	type: "ClassExpression";

	/** The class's name, or `null` when it is anonymous. */
	id: Identifier | null;

	/** The `extends` clause, or `null` when there is none. */
	superClass: Expression | null;

	/** The class body. */
	body: ClassBody;

	/** The decorators applied to the class. */
	decorators?: Decorator[];

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** TypeScript only. The `<T>` list on `extends`, or `null` for none. */
	superTypeArguments?: TSTypeParameterInstantiation | null;

	/** TypeScript only. The `implements` clause. */
	implements?: TSClassImplements[];

	/** TypeScript only. Whether the class was marked `abstract`. */
	abstract?: boolean;

	/** TypeScript only. Whether the class was marked `declare`. */
	declare?: boolean;
}

/** The `{ … }` of a class. */
export interface ClassBody extends NodeBase {
	type: "ClassBody";

	/** The members, in source order. */
	body: ClassMember[];
}

/** A method, getter, setter, or constructor. */
export interface MethodDefinition extends NodeBase {
	type: "MethodDefinition";

	/** The member's key. */
	key: PropertyKey;

	/** The function implementing the member, bodyless for an overload. */
	value: FunctionExpression | TSEmptyBodyFunctionExpression;

	/** Which kind of member this is. */
	kind: MethodKind;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the member was declared `static`. */
	static: boolean;

	/** The decorators applied to the member. */
	decorators?: Decorator[];

	/** TypeScript only. The accessibility modifier, or `null` for none. */
	accessibility?: Accessibility;

	/** TypeScript only. Whether a `?` followed the key. */
	optional?: boolean;

	/** TypeScript only. Whether the member was marked `override`. */
	override?: boolean;
}

/** A class field. */
export interface PropertyDefinition extends NodeBase {
	type: "PropertyDefinition";

	/** The field's key. */
	key: PropertyKey;

	/** The initializer, or `null` when there is none. */
	value: Expression | null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the field was declared `static`. */
	static: boolean;

	/** The decorators applied to the field. */
	decorators?: Decorator[];

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** TypeScript only. The accessibility modifier, or `null` for none. */
	accessibility?: Accessibility;

	/** TypeScript only. Whether the field was marked `declare`. */
	declare?: boolean;

	/** TypeScript only. Whether a `!` followed the key. */
	definite?: boolean;

	/** TypeScript only. Whether a `?` followed the key. */
	optional?: boolean;

	/** TypeScript only. Whether the field was marked `override`. */
	override?: boolean;

	/** TypeScript only. Whether the field was marked `readonly`. */
	readonly?: boolean;
}

/** An `accessor` class field. */
export interface AccessorProperty extends NodeBase {
	type: "AccessorProperty";

	/** The field's key. */
	key: PropertyKey;

	/** The initializer, or `null` when there is none. */
	value: Expression | null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the field was declared `static`. */
	static: boolean;

	/** The decorators applied to the field. */
	decorators?: Decorator[];

	/** TypeScript only. The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** TypeScript only. The accessibility modifier, or `null` for none. */
	accessibility?: Accessibility;

	/** TypeScript only. Whether the field was marked `declare`. */
	declare?: boolean;

	/** TypeScript only. Whether a `!` followed the key. */
	definite?: boolean;

	/** TypeScript only. Whether a `?` followed the key. */
	optional?: boolean;

	/** TypeScript only. Whether the field was marked `override`. */
	override?: boolean;

	/** TypeScript only. Whether the field was marked `readonly`. */
	readonly?: boolean;
}

/** A decorator applied to a class or one of its members. */
export interface Decorator extends NodeBase {
	type: "Decorator";

	/** The decorator's expression. */
	expression: Expression;
}

//-----------------------------------------------------------------------------
// Module declarations
//-----------------------------------------------------------------------------

/** An `import` declaration. */
export interface ImportDeclaration extends NodeBase {
	type: "ImportDeclaration";

	/** What the declaration binds. */
	specifiers: ImportClause[];

	/** The imported module. */
	source: Literal;

	/** The `with { … }` attributes. */
	attributes: ImportAttribute[];

	/** TypeScript only. Whether the import moves a type or a value. */
	importKind?: ImportExportKind;

	/** TypeScript only. Always `null`; import phases are not parsed yet. */
	phase?: null;
}

/** A named import. */
export interface ImportSpecifier extends NodeBase {
	type: "ImportSpecifier";

	/** The name as exported by the other module. */
	imported: Identifier | Literal;

	/** The name it is bound to here. */
	local: Identifier;

	/** TypeScript only. Whether the specifier moves a type or a value. */
	importKind?: ImportExportKind;
}

/** A default import. */
export interface ImportDefaultSpecifier extends NodeBase {
	type: "ImportDefaultSpecifier";

	/** The name the default is bound to. */
	local: Identifier;
}

/** A namespace import. */
export interface ImportNamespaceSpecifier extends NodeBase {
	type: "ImportNamespaceSpecifier";

	/** The name the namespace is bound to. */
	local: Identifier;
}

/** One entry of a `with { … }` clause. */
export interface ImportAttribute extends NodeBase {
	type: "ImportAttribute";

	/** The attribute's key. */
	key: Identifier | Literal;

	/** The attribute's value. */
	value: Literal;
}

/** An `export { … }` or `export …` declaration. */
export interface ExportNamedDeclaration extends NodeBase {
	type: "ExportNamedDeclaration";

	/** The exported declaration, or `null` for `export { … }`. */
	declaration: Declaration | null;

	/** The exported names. */
	specifiers: ExportSpecifier[];

	/** The re-exported module, or `null` when there is none. */
	source: Literal | null;

	/** The `with { … }` attributes. */
	attributes: ImportAttribute[];

	/** TypeScript only. Whether the export moves a type or a value. */
	exportKind?: ImportExportKind;
}

/** One name of an `export { … }`. */
export interface ExportSpecifier extends NodeBase {
	type: "ExportSpecifier";

	/** The name as bound here. */
	local: Identifier | Literal;

	/** The name it is exported under. */
	exported: Identifier | Literal;

	/** TypeScript only. Whether the specifier moves a type or a value. */
	exportKind?: ImportExportKind;
}

/** An `export default …` declaration. */
export interface ExportDefaultDeclaration extends NodeBase {
	type: "ExportDefaultDeclaration";

	/** What is being exported. */
	declaration: ClassDeclaration | Expression | FunctionDeclaration;

	/** TypeScript only. Always `"value"`; a default export is never a type. */
	exportKind?: "value";
}

/** An `export * from …` declaration. */
export interface ExportAllDeclaration extends NodeBase {
	type: "ExportAllDeclaration";

	/** The namespace's name, or `null` for a bare `export *`. */
	exported: Identifier | Literal | null;

	/** The re-exported module. */
	source: Literal;

	/** The `with { … }` attributes. */
	attributes: ImportAttribute[];

	/** TypeScript only. Whether the export moves a type or a value. */
	exportKind?: ImportExportKind;
}

//-----------------------------------------------------------------------------
// JSX
//-----------------------------------------------------------------------------

/** A JSX element. */
export interface JSXElement extends NodeBase {
	type: "JSXElement";

	/** The opening tag. */
	openingElement: JSXOpeningElement;

	/** The closing tag, or `null` when the element is self-closing. */
	closingElement: JSXClosingElement | null;

	/** What appears between the tags. */
	children: JSXChild[];
}

/** A `<>…</>` fragment. */
export interface JSXFragment extends NodeBase {
	type: "JSXFragment";

	/** The opening `<>`. */
	openingFragment: JSXOpeningFragment;

	/** The closing `</>`. */
	closingFragment: JSXClosingFragment;

	/** What appears between them. */
	children: JSXChild[];
}

/** The opening tag of a JSX element. */
export interface JSXOpeningElement extends NodeBase {
	type: "JSXOpeningElement";

	/** The element's name. */
	name: JSXTagName;

	/** The attributes, in source order. */
	attributes: JSXAttributeLike[];

	/** Whether the tag closed itself with `/>`. */
	selfClosing: boolean;

	/** TypeScript only. The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/**
 * The closing tag of a JSX element.
 */
export interface JSXClosingElement extends NodeBase {
	type: "JSXClosingElement";

	/** The element's name. */
	name: JSXTagName;
}

/**
 * The opening `<>` of a fragment.
 *
 * The two optional properties are the mirror image of the TypeScript-only ones
 * elsewhere in this file: `espree` reports them on every opening fragment, and
 * `@typescript-eslint/parser` reports neither, so they appear in `js` mode
 * only. A fragment can carry neither an attribute nor a slash, so both are
 * pinned to the only value they ever hold.
 */
export interface JSXOpeningFragment extends NodeBase {
	type: "JSXOpeningFragment";

	/** JavaScript only. Always empty; a fragment has no attributes. */
	attributes?: never[];

	/** JavaScript only. Always `false`; a fragment cannot self-close. */
	selfClosing?: false;
}

/** The closing `</>` of a fragment. */
export interface JSXClosingFragment extends NodeBase {
	type: "JSXClosingFragment";
}

/** A name in a JSX tag or attribute. */
export interface JSXIdentifier extends NodeBase {
	type: "JSXIdentifier";

	/** The name exactly as written. */
	name: string;
}

/** A `a:b` name. */
export interface JSXNamespacedName extends NodeBase {
	type: "JSXNamespacedName";

	/** The part before the colon. */
	namespace: JSXIdentifier;

	/** The part after it. */
	name: JSXIdentifier;
}

/** An `a.b` name. */
export interface JSXMemberExpression extends NodeBase {
	type: "JSXMemberExpression";

	/** The part before the dot. */
	object: JSXIdentifier | JSXMemberExpression;

	/** The part after it. */
	property: JSXIdentifier;
}

/** An attribute of a JSX element. */
export interface JSXAttribute extends NodeBase {
	type: "JSXAttribute";

	/** The attribute's name. */
	name: JSXIdentifier | JSXNamespacedName;

	/** The value, or `null` when the attribute stands alone. */
	value: JSXAttributeValue;
}

/** A `{...props}` attribute. */
export interface JSXSpreadAttribute extends NodeBase {
	type: "JSXSpreadAttribute";

	/** The spread expression. */
	argument: Expression;
}

/** A `{ … }` in a JSX element. */
export interface JSXExpressionContainer extends NodeBase {
	type: "JSXExpressionContainer";

	/** The expression, or an empty node when the braces hold a comment. */
	expression: Expression | JSXEmptyExpression;
}

/** A `{...children}` child. */
export interface JSXSpreadChild extends NodeBase {
	type: "JSXSpreadChild";

	/** The spread expression. */
	expression: Expression;
}

/** What a `{ }` holding nothing but a comment contains. */
export interface JSXEmptyExpression extends NodeBase {
	type: "JSXEmptyExpression";
}

/** Literal text between JSX tags. */
export interface JSXText extends NodeBase {
	type: "JSXText";

	/** The text with entity references resolved. */
	value: string;

	/** The text exactly as written. */
	raw: string;
}

//-----------------------------------------------------------------------------
// TypeScript: types
//
// These appear only under `dialect: "ts"`, so unlike the TypeScript-only
// *properties* elsewhere in this file, nothing here is conditional on the
// dialect. What is optional here is optional for the ordinary reason: the
// decoder writes it only when the source had one.
//-----------------------------------------------------------------------------

/** A `: T` annotation. */
export interface TSTypeAnnotation extends NodeBase {
	type: "TSTypeAnnotation";

	/** The annotated type. */
	typeAnnotation: TSType;
}

/** A `<T>` list on a declaration. */
export interface TSTypeParameterDeclaration extends NodeBase {
	type: "TSTypeParameterDeclaration";

	/** The declared parameters. */
	params: TSTypeParameter[];
}

/** A `<T>` list at a use site. */
export interface TSTypeParameterInstantiation extends NodeBase {
	type: "TSTypeParameterInstantiation";

	/** The supplied types. */
	params: TSType[];
}

/** One declared type parameter. */
export interface TSTypeParameter extends NodeBase {
	type: "TSTypeParameter";

	/** The parameter's name. */
	name: Identifier;

	/** The `extends` bound, or `null` when there is none. */
	constraint: TSType | null;

	/** The default, or `null` when there is none. */
	default: TSType | null;

	/** Whether the parameter was marked `in`. */
	in: boolean;

	/** Whether the parameter was marked `out`. */
	out: boolean;

	/** Whether the parameter was marked `const`. */
	const: boolean;
}

/** A `T[]` type. */
export interface TSArrayType extends NodeBase {
	type: "TSArrayType";

	/** The element type. */
	elementType: TSType;
}

/** A `[A, B]` type. */
export interface TSTupleType extends NodeBase {
	type: "TSTupleType";

	/** The element types, in order. */
	elementTypes: TSType[];
}

/** A `name: T` element of a tuple. */
export interface TSNamedTupleMember extends NodeBase {
	type: "TSNamedTupleMember";

	/** The element's name. */
	label: Identifier;

	/** The element's type. */
	elementType: TSType;

	/** Whether a `?` followed the name. */
	optional: boolean;
}

/** A `...T` element of a tuple. */
export interface TSRestType extends NodeBase {
	type: "TSRestType";

	/** The spread type. */
	typeAnnotation: TSType;
}

/** A `T?` element of a tuple. */
export interface TSOptionalType extends NodeBase {
	type: "TSOptionalType";

	/** The optional type. */
	typeAnnotation: TSType;
}

/** An `A | B` type. */
export interface TSUnionType extends NodeBase {
	type: "TSUnionType";

	/** The members. */
	types: TSType[];
}

/** An `A & B` type. */
export interface TSIntersectionType extends NodeBase {
	type: "TSIntersectionType";

	/** The members. */
	types: TSType[];
}

/** An `A extends B ? C : D` type. */
export interface TSConditionalType extends NodeBase {
	type: "TSConditionalType";

	/** The type being tested. */
	checkType: TSType;

	/** What it is tested against. */
	extendsType: TSType;

	/** The result when the test holds. */
	trueType: TSType;

	/** The result when it does not. */
	falseType: TSType;
}

/** An `infer T`. */
export interface TSInferType extends NodeBase {
	type: "TSInferType";

	/** The inferred parameter. */
	typeParameter: TSTypeParameter;
}

/** A `keyof`, `unique`, or `readonly` type. */
export interface TSTypeOperator extends NodeBase {
	type: "TSTypeOperator";

	/** The operator. */
	operator: "keyof" | "readonly" | "unique";

	/** The operand. */
	typeAnnotation: TSType;
}

/** A `T[K]` type. */
export interface TSIndexedAccessType extends NodeBase {
	type: "TSIndexedAccessType";

	/** The type being indexed. */
	objectType: TSType;

	/** The index. */
	indexType: TSType;
}

/**
 * A `{ [K in T]: U }` type.
 *
 * `key` and `constraint` are the two halves of the `K in T`, which the ESTree
 * shape flattens out of the type parameter the binary format stores.
 */
export interface TSMappedType extends NodeBase {
	type: "TSMappedType";

	/** The introduced name. */
	key: Identifier;

	/** What it ranges over. */
	constraint: TSType;

	/** The `as` clause, or `null` when there is none. */
	nameType: TSType | null;

	/** The value type, or `null` when there is none. */
	typeAnnotation: TSType | null;

	/** The `?` modifier, or `false` when none was written. */
	optional: MappedModifier;

	/** The `readonly` modifier, or `null` when none was written. */
	readonly: MappedModifier | null;
}

/** A literal used as a type. */
export interface TSLiteralType extends NodeBase {
	type: "TSLiteralType";

	/** The literal, negated numbers included. */
	literal: Literal | UnaryExpression;
}

/** A template literal type. */
export interface TSTemplateLiteralType extends NodeBase {
	type: "TSTemplateLiteralType";

	/** The literal chunks, one more than there are types. */
	quasis: TemplateElement[];

	/** The interpolated types. */
	types: TSType[];
}

/** A reference to a named type. */
export interface TSTypeReference extends NodeBase {
	type: "TSTypeReference";

	/** The name being referenced. */
	typeName: EntityName;

	/** The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** An `A.B` name. */
export interface TSQualifiedName extends NodeBase {
	type: "TSQualifiedName";

	/** The part before the dot. */
	left: EntityName;

	/** The part after it. */
	right: Identifier;
}

/** A `typeof x` type. */
export interface TSTypeQuery extends NodeBase {
	type: "TSTypeQuery";

	/** What is being queried. */
	exprName: EntityName | TSImportType;

	/** The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** An `x is T` or `asserts x` return type. */
export interface TSTypePredicate extends NodeBase {
	type: "TSTypePredicate";

	/** The parameter being narrowed. */
	parameterName: Identifier | TSThisType;

	/** The narrowed type, or `null` for a bare `asserts x`. */
	typeAnnotation: TSTypeAnnotation | null;

	/** Whether the predicate was written with `asserts`. */
	asserts: boolean;
}

/** A `(…) => T` type. */
export interface TSFunctionType extends NodeBase {
	type: "TSFunctionType";

	/** The parameter list. */
	params: Parameter[];

	/** The return annotation. */
	returnType: TSTypeAnnotation;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;
}

/** A `new (…) => T` type. */
export interface TSConstructorType extends NodeBase {
	type: "TSConstructorType";

	/** The parameter list. */
	params: Parameter[];

	/** The return annotation. */
	returnType: TSTypeAnnotation;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** Whether the type was marked `abstract`. */
	abstract: boolean;
}

/** A `{ … }` type. */
export interface TSTypeLiteral extends NodeBase {
	type: "TSTypeLiteral";

	/** The members. */
	members: TypeElement[];
}

/** An `import("m").T` type. */
export interface TSImportType extends NodeBase {
	type: "TSImportType";

	/** The imported module. */
	source: Literal;

	/** The name taken from it, or `null` for the module itself. */
	qualifier: EntityName | null;

	/** The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;

	/** The options argument, or `null` when there is none. */
	options: ObjectExpression | null;
}

//-----------------------------------------------------------------------------
// TypeScript: keywords
//
// Their names carry everything they mean, so all of them are empty. The three
// modifier kinds `node-kinds.ts` reserves -- `TSAbstractKeyword`,
// `TSDeclareKeyword`, and `TSExportKeyword` -- are deliberately absent: the
// parser never emits one, so there is no shape to describe.
//-----------------------------------------------------------------------------

/** The `any` type. */
export interface TSAnyKeyword extends NodeBase {
	type: "TSAnyKeyword";
}

/** The `bigint` type. */
export interface TSBigIntKeyword extends NodeBase {
	type: "TSBigIntKeyword";
}

/** The `boolean` type. */
export interface TSBooleanKeyword extends NodeBase {
	type: "TSBooleanKeyword";
}

/** The `intrinsic` type. */
export interface TSIntrinsicKeyword extends NodeBase {
	type: "TSIntrinsicKeyword";
}

/** The `never` type. */
export interface TSNeverKeyword extends NodeBase {
	type: "TSNeverKeyword";
}

/** The `null` type. */
export interface TSNullKeyword extends NodeBase {
	type: "TSNullKeyword";
}

/** The `number` type. */
export interface TSNumberKeyword extends NodeBase {
	type: "TSNumberKeyword";
}

/** The `object` type. */
export interface TSObjectKeyword extends NodeBase {
	type: "TSObjectKeyword";
}

/** The `string` type. */
export interface TSStringKeyword extends NodeBase {
	type: "TSStringKeyword";
}

/** The `symbol` type. */
export interface TSSymbolKeyword extends NodeBase {
	type: "TSSymbolKeyword";
}

/** The `this` type. */
export interface TSThisType extends NodeBase {
	type: "TSThisType";
}

/** The `undefined` type. */
export interface TSUndefinedKeyword extends NodeBase {
	type: "TSUndefinedKeyword";
}

/** The `unknown` type. */
export interface TSUnknownKeyword extends NodeBase {
	type: "TSUnknownKeyword";
}

/** The `void` type. */
export interface TSVoidKeyword extends NodeBase {
	type: "TSVoidKeyword";
}

//-----------------------------------------------------------------------------
// TypeScript: signatures
//-----------------------------------------------------------------------------

/** A property of an interface or type literal. */
export interface TSPropertySignature extends NodeBase {
	type: "TSPropertySignature";

	/** The property's key. */
	key: PropertyKey;

	/** The `: T` annotation, or `null` when there is none. */
	typeAnnotation: TSTypeAnnotation | null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether a `?` followed the key. */
	optional: boolean;

	/** Whether the property was marked `readonly`. */
	readonly: boolean;

	/** Whether the property was marked `static`. */
	static: boolean;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility: Accessibility;
}

/** A method of an interface or type literal. */
export interface TSMethodSignature extends NodeBase {
	type: "TSMethodSignature";

	/** The method's key. */
	key: PropertyKey;

	/** The parameter list. */
	params: Parameter[];

	/** The return annotation, or `null` when there is none. */
	returnType: TSTypeAnnotation | null;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether a `?` followed the key. */
	optional: boolean;

	/** Whether the method was marked `readonly`. */
	readonly: boolean;

	/** Whether the method was marked `static`. */
	static: boolean;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility: Accessibility;

	/** Which kind of member this is; a plain method reads `"method"`. */
	kind: "constructor" | "get" | "method" | "set";
}

/** An index signature. */
export interface TSIndexSignature extends NodeBase {
	type: "TSIndexSignature";

	/** The index parameter. */
	parameters: Parameter[];

	/** The value annotation, or `null` when there is none. */
	typeAnnotation: TSTypeAnnotation | null;

	/** Whether the signature was marked `readonly`. */
	readonly: boolean;

	/** Whether the signature was marked `static`. */
	static: boolean;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility: Accessibility;
}

/** A call signature. */
export interface TSCallSignatureDeclaration extends NodeBase {
	type: "TSCallSignatureDeclaration";

	/** The parameter list. */
	params: Parameter[];

	/** The return annotation, or `null` when there is none. */
	returnType: TSTypeAnnotation | null;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;
}

/** A construct signature. */
export interface TSConstructSignatureDeclaration extends NodeBase {
	type: "TSConstructSignatureDeclaration";

	/** The parameter list. */
	params: Parameter[];

	/** The return annotation, or `null` when there is none. */
	returnType: TSTypeAnnotation | null;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;
}

//-----------------------------------------------------------------------------
// TypeScript: declarations
//-----------------------------------------------------------------------------

/** An `interface` declaration. */
export interface TSInterfaceDeclaration extends NodeBase {
	type: "TSInterfaceDeclaration";

	/** The interface's name. */
	id: Identifier;

	/** The interface body. */
	body: TSInterfaceBody;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** The `extends` clause. */
	extends: TSInterfaceHeritage[];

	/** Whether the interface was marked `declare`. */
	declare: boolean;
}

/** The `{ … }` of an interface. */
export interface TSInterfaceBody extends NodeBase {
	type: "TSInterfaceBody";

	/** The members. */
	body: TypeElement[];
}

/** One entry of an interface's `extends` clause. */
export interface TSInterfaceHeritage extends NodeBase {
	type: "TSInterfaceHeritage";

	/** The name being extended. */
	expression: Expression;

	/** The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** One entry of a class's `implements` clause. */
export interface TSClassImplements extends NodeBase {
	type: "TSClassImplements";

	/** The name being implemented. */
	expression: Expression;

	/** The `<T>` list, or `null` when there is none. */
	typeArguments?: TSTypeParameterInstantiation | null;
}

/** A `type` alias. */
export interface TSTypeAliasDeclaration extends NodeBase {
	type: "TSTypeAliasDeclaration";

	/** The alias's name. */
	id: Identifier;

	/** The aliased type. */
	typeAnnotation: TSType;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** Whether the alias was marked `declare`. */
	declare: boolean;
}

/** An `enum` declaration. */
export interface TSEnumDeclaration extends NodeBase {
	type: "TSEnumDeclaration";

	/** The enum's name. */
	id: Identifier;

	/** The enum body. */
	body: TSEnumBody;

	/** Whether the enum was marked `const`. */
	const: boolean;

	/** Whether the enum was marked `declare`. */
	declare: boolean;
}

/** The `{ … }` of an enum. */
export interface TSEnumBody extends NodeBase {
	type: "TSEnumBody";

	/** The members. */
	members: TSEnumMember[];
}

/** One member of an enum. */
export interface TSEnumMember extends NodeBase {
	type: "TSEnumMember";

	/** The member's name. */
	id: Identifier | Literal;

	/** The assigned value, or `null` when there is none. */
	initializer: Expression | null;
}

/** A `module` or `namespace` declaration. */
export interface TSModuleDeclaration extends NodeBase {
	type: "TSModuleDeclaration";

	/** The declared name. */
	id: Identifier | Literal | TSQualifiedName;

	/** The body, or `null` for a bodyless `declare module "m";`. */
	body: TSModuleBlock | null;

	/** Which form was written. */
	kind: "global" | "module" | "namespace";

	/** Whether the declaration was marked `declare`. */
	declare: boolean;

	/** Whether the declaration is the `global` form. */
	global: boolean;
}

/** The `{ … }` of a module or namespace. */
export interface TSModuleBlock extends NodeBase {
	type: "TSModuleBlock";

	/** The statements and declarations inside. */
	body: (ModuleDeclaration | Statement)[];
}

/** An overload signature, which is a function without a body. */
export interface TSDeclareFunction extends NodeBase {
	type: "TSDeclareFunction";

	/** The function's name, or `null` for `export default function`. */
	id: Identifier | null;

	/** The parameter list. */
	params: Parameter[];

	/** Always `null`; an overload signature has no body. */
	body: null;

	/** Whether the function was declared with a `*`. */
	generator: boolean;

	/** Whether the function was declared `async`. */
	async: boolean;

	/** Always `false`; a declaration never has an expression body. */
	expression: false;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** The return annotation, or `null` when there is none. */
	returnType?: TSTypeAnnotation | null;

	/** Whether the function was marked `declare`. */
	declare?: boolean;
}

/** A class method's overload signature or an ambient method. */
export interface TSEmptyBodyFunctionExpression extends NodeBase {
	type: "TSEmptyBodyFunctionExpression";

	/** Always `null`; the name sits on the member instead. */
	id: null;

	/** The parameter list. */
	params: Parameter[];

	/** Always `null`; there is no body. */
	body: null;

	/** Whether the method was declared with a `*`. */
	generator: boolean;

	/** Whether the method was declared `async`. */
	async: boolean;

	/** Always `false`; only an arrow function has an expression body. */
	expression: false;

	/** The `<T>` list, or `null` when there is none. */
	typeParameters?: TSTypeParameterDeclaration | null;

	/** The return annotation, or `null` when there is none. */
	returnType?: TSTypeAnnotation | null;

	/** Whether the method was marked `declare`. */
	declare?: boolean;
}

/** An `import x = require("m")` declaration. */
export interface TSImportEqualsDeclaration extends NodeBase {
	type: "TSImportEqualsDeclaration";

	/** The bound name. */
	id: Identifier;

	/** What it is bound to. */
	moduleReference: EntityName | TSExternalModuleReference;

	/** Whether the import moves a type or a value. */
	importKind?: ImportExportKind;
}

/** The `require("m")` of an import-equals declaration. */
export interface TSExternalModuleReference extends NodeBase {
	type: "TSExternalModuleReference";

	/** The module specifier. */
	expression: Literal;
}

/** An `export = x` declaration. */
export interface TSExportAssignment extends NodeBase {
	type: "TSExportAssignment";

	/** What is being exported. */
	expression: Expression;
}

//-----------------------------------------------------------------------------
// TypeScript: class members
//-----------------------------------------------------------------------------

/** An `abstract` method. */
export interface TSAbstractMethodDefinition extends NodeBase {
	type: "TSAbstractMethodDefinition";

	/** The member's key. */
	key: PropertyKey;

	/** The signature, which has no body. */
	value: TSEmptyBodyFunctionExpression;

	/** Which kind of member this is. */
	kind: MethodKind;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the member was declared `static`. */
	static: boolean;

	/** The decorators applied to the member. */
	decorators?: Decorator[];

	/** The accessibility modifier, or `null` when none was written. */
	accessibility?: Accessibility;

	/** Whether a `?` followed the key. */
	optional?: boolean;

	/** Whether the member was marked `override`. */
	override?: boolean;
}

/** An `abstract` field. */
export interface TSAbstractPropertyDefinition extends NodeBase {
	type: "TSAbstractPropertyDefinition";

	/** The field's key. */
	key: PropertyKey;

	/** Always `null`; an abstract field has no initializer. */
	value: null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the field was declared `static`. */
	static: boolean;

	/** The decorators applied to the field. */
	decorators?: Decorator[];

	/** The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility?: Accessibility;

	/** Whether the field was marked `declare`. */
	declare?: boolean;

	/** Whether a `!` followed the key. */
	definite?: boolean;

	/** Whether a `?` followed the key. */
	optional?: boolean;

	/** Whether the field was marked `override`. */
	override?: boolean;

	/** Whether the field was marked `readonly`. */
	readonly?: boolean;
}

/** An `abstract accessor` field. */
export interface TSAbstractAccessorProperty extends NodeBase {
	type: "TSAbstractAccessorProperty";

	/** The field's key. */
	key: PropertyKey;

	/** Always `null`; an abstract field has no initializer. */
	value: null;

	/** Whether the key was written in brackets. */
	computed: boolean;

	/** Whether the field was declared `static`. */
	static: boolean;

	/** The decorators applied to the field. */
	decorators?: Decorator[];

	/** The `: T` annotation, or `null` when there is none. */
	typeAnnotation?: TSTypeAnnotation | null;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility?: Accessibility;

	/** Whether the field was marked `declare`. */
	declare?: boolean;

	/** Whether a `!` followed the key. */
	definite?: boolean;

	/** Whether a `?` followed the key. */
	optional?: boolean;

	/** Whether the field was marked `override`. */
	override?: boolean;

	/** Whether the field was marked `readonly`. */
	readonly?: boolean;
}

/** A constructor parameter that declares a field. */
export interface TSParameterProperty extends NodeBase {
	type: "TSParameterProperty";

	/** The parameter itself. */
	parameter: AssignmentPattern | Identifier | RestElement;

	/** The decorators applied to the parameter. */
	decorators?: Decorator[];

	/** Whether the parameter was marked `readonly`. */
	readonly: boolean;

	/** Whether the parameter was marked `override`. */
	override: boolean;

	/** Whether the parameter was marked `static`. */
	static: boolean;

	/** The accessibility modifier, or `null` when none was written. */
	accessibility: Accessibility;
}

//-----------------------------------------------------------------------------
// TypeScript: expressions
//-----------------------------------------------------------------------------

/** An `x as T` expression. */
export interface TSAsExpression extends NodeBase {
	type: "TSAsExpression";

	/** The expression being cast. */
	expression: Expression;

	/** The type it is cast to. */
	typeAnnotation: TSType;
}

/** An `x satisfies T` expression. */
export interface TSSatisfiesExpression extends NodeBase {
	type: "TSSatisfiesExpression";

	/** The expression being checked. */
	expression: Expression;

	/** The type it is checked against. */
	typeAnnotation: TSType;
}

/** An `x!` expression. */
export interface TSNonNullExpression extends NodeBase {
	type: "TSNonNullExpression";

	/** The expression being asserted. */
	expression: Expression;
}

/** A `<T>x` expression. */
export interface TSTypeAssertion extends NodeBase {
	type: "TSTypeAssertion";

	/** The type it is cast to. */
	typeAnnotation: TSType;

	/** The expression being cast. */
	expression: Expression;
}

/** An `f<T>` expression. */
export interface TSInstantiationExpression extends NodeBase {
	type: "TSInstantiationExpression";

	/** The expression being instantiated. */
	expression: Expression;

	/** The supplied types. */
	typeArguments: TSTypeParameterInstantiation;
}
