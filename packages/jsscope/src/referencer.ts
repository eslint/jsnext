/**
 * @fileoverview The walk that builds the scope graph.
 *
 * This is a direct port of what `eslint-scope`'s `Referencer` and
 * `@typescript-eslint/scope-manager`'s `Referencer`, `ClassVisitor`, and
 * `TypeVisitor` do, rewritten against the binary AST. Three things change in
 * the translation and nothing else does:
 *
 * - Dispatch is a `switch` over integer node kinds rather than a lookup of a
 *   method named after a node type.
 * - The generic "visit whatever children this node has" fallback reads
 *   `SLOT_TABLE` instead of a visitor-key table. Slot order matches visitor-key
 *   order everywhere it can be observed; the handful of kinds where it does not
 *   are all handled explicitly below.
 * - Nodes are integers, so `0` stands in for a missing child.
 *
 * Where the two reference implementations disagree, `eslint-scope` wins. Those
 * points are marked as they come up.
 */

import {
	DECL_KIND_NAMES,
	DECL_MASK,
	DECL_SHIFT,
	DECL_VAR,
	MODULE_GLOBAL,
	MODULE_KIND_MASK,
	MODULE_KIND_SHIFT,
	NF_COMPUTED,
	NF_TYPE_ONLY,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_D,
	NODE_E,
	NODE_F,
	NODE_G,
	SLOT_COUNT,
	SLOT_LIST,
	SLOT_NODE,
	SLOT_TABLE,
	T_ASSIGN,
	N_AccessorProperty,
	N_ArrayPattern,
	N_ArrowFunctionExpression,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_BlockStatement,
	N_BreakStatement,
	N_CallExpression,
	N_CatchClause,
	N_ClassBody,
	N_ClassDeclaration,
	N_ClassExpression,
	N_ContinueStatement,
	N_ExportAllDeclaration,
	N_ExportDefaultDeclaration,
	N_ExportNamedDeclaration,
	N_ForInStatement,
	N_ForOfStatement,
	N_ForStatement,
	N_FunctionDeclaration,
	N_FunctionExpression,
	N_Identifier,
	N_ImportAttribute,
	N_ImportDeclaration,
	N_ImportSpecifier,
	N_JSXAttribute,
	N_JSXElement,
	N_JSXExpressionContainer,
	N_JSXFragment,
	N_JSXIdentifier,
	N_JSXMemberExpression,
	N_JSXNamespacedName,
	N_JSXOpeningElement,
	N_LabeledStatement,
	N_Literal,
	N_MemberExpression,
	N_MetaProperty,
	N_MethodDefinition,
	N_NewExpression,
	N_ObjectPattern,
	N_PrivateIdentifier,
	N_Program,
	N_Property,
	N_PropertyDefinition,
	N_RestElement,
	N_StaticBlock,
	N_SwitchStatement,
	N_TSAbstractAccessorProperty,
	N_TSAbstractMethodDefinition,
	N_TSAbstractPropertyDefinition,
	N_TSAsExpression,
	N_TSCallSignatureDeclaration,
	N_TSConditionalType,
	N_TSConstructSignatureDeclaration,
	N_TSConstructorType,
	N_TSDeclareFunction,
	N_TSEmptyBodyFunctionExpression,
	N_TSEnumDeclaration,
	N_TSExportAssignment,
	N_TSFunctionType,
	N_TSImportEqualsDeclaration,
	N_TSImportType,
	N_TSIndexSignature,
	N_TSInferType,
	N_TSInstantiationExpression,
	N_TSInterfaceDeclaration,
	N_TSMappedType,
	N_TSMethodSignature,
	N_TSModuleDeclaration,
	N_TSNamedTupleMember,
	N_TSNonNullExpression,
	N_TSParameterProperty,
	N_TSPropertySignature,
	N_TSQualifiedName,
	N_TSSatisfiesExpression,
	N_TSThisType,
	N_TSTypeAliasDeclaration,
	N_TSTypeAssertion,
	N_TSTypeParameter,
	N_TSTypePredicate,
	N_TSTypeQuery,
	N_TaggedTemplateExpression,
	N_ThisExpression,
	N_UpdateExpression,
	N_VariableDeclaration,
	N_WithStatement,
	type AstReader,
} from "jsparse";
import {
	catchClauseDefinition,
	classNameDefinition,
	enumMemberDefinition,
	enumNameDefinition,
	functionNameDefinition,
	importBindingDefinition,
	moduleNameDefinition,
	parameterDefinition,
	typeDefinition,
	variableDefinition,
} from "./definition.js";
import {
	READ_WRITE,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FUNCTION_TYPE,
	SCOPE_MAPPED_TYPE,
	WRITE,
} from "./kinds.js";
import { identifierName, literalStringValue } from "./names.js";
import type { MaybeImplicitGlobal } from "./reference.js";
import {
	isPatternKind,
	PatternVisitor,
	type PatternCallback,
} from "./pattern-visitor.js";
import type { Scope } from "./scope.js";
import type { ScopeManager } from "./scope-manager.js";

/**
 * Builds the scope graph for one program.
 */
export class Referencer {
	/** The manager collecting the scopes. */
	private readonly scopeManager: ScopeManager;

	/** The reader over the AST buffer. */
	private readonly reader: AstReader;

	/** Whether TypeScript syntax carries meaning. */
	private readonly typescript: boolean;

	/** Whether a JSX identifier counts as a reference. */
	private readonly jsx: boolean;

	/** Whether a direct `eval` should be ignored. */
	private readonly ignoreEval: boolean;

	/** The name a JSX element compiles a call to, or `null`. */
	private readonly jsxPragma: string | null;

	/** The name a JSX fragment compiles a call to, or `null`. */
	private readonly jsxFragmentName: string | null;

	/** Whether the JSX factory has already been referenced. */
	private referencedJsxFactory = false;

	/** Whether the JSX fragment factory has already been referenced. */
	private referencedJsxFragmentFactory = false;

	/**
	 * Creates a referencer.
	 * @param scopeManager The manager collecting the scopes.
	 */
	constructor(scopeManager: ScopeManager) {
		const options = scopeManager.options;

		this.scopeManager = scopeManager;
		this.reader = scopeManager.reader;
		this.typescript = options.dialect === "ts";
		this.jsx = options.jsx;
		this.ignoreEval = options.ignoreEval;
		this.jsxPragma = options.jsxPragma;
		this.jsxFragmentName = options.jsxFragmentName;
	}

	//-------------------------------------------------------------------------
	// Scope Plumbing
	//-------------------------------------------------------------------------

	/**
	 * The scope currently being filled in.
	 * @returns The innermost open scope.
	 */
	private get scope(): Scope {
		return this.scopeManager.currentScope!;
	}

	/**
	 * Closes every scope a node opened.
	 * @param node The node index the scopes were opened for.
	 * @returns Nothing.
	 */
	private close(node: number): void {
		while (
			this.scopeManager.currentScope !== null &&
			node === this.scopeManager.currentScope.block
		) {
			this.scopeManager.currentScope =
				this.scopeManager.currentScope.close();
		}
	}

	//-------------------------------------------------------------------------
	// Generic Traversal
	//-------------------------------------------------------------------------

	/**
	 * Visits every child of a node, in the order a visitor-key walk would.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitList(this.reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits every element of a child list.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private visitList(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.visit(this.reader.listItem(handle, i));
		}
	}

	/**
	 * Walks a pattern, declaring or referencing every name it binds.
	 * @param node The pattern node index.
	 * @param callback What to do at each name.
	 * @param processRightHandNodes Whether the expressions inside the pattern
	 *      should be visited as ordinary code afterward.
	 * @returns Nothing.
	 */
	private visitPattern(
		node: number,
		callback: PatternCallback,
		processRightHandNodes = false,
	): void {
		const visitor = new PatternVisitor(this.reader, node, callback);

		visitor.visit(node);

		if (processRightHandNodes) {
			for (let i = 0; i < visitor.rightHandNodes.length; i++) {
				this.visit(visitor.rightHandNodes[i]);
			}
		}
	}

	/**
	 * Records the writes that a pattern's default values perform.
	 * @param pattern The `Identifier` node being bound.
	 * @param assignments The defaults enclosing it.
	 * @param maybeImplicitGlobal Where an undeclared assignment happened.
	 * @param init Whether the writes initialize a declaration.
	 * @returns Nothing.
	 */
	private referencingDefaultValue(
		pattern: number,
		assignments: number[],
		maybeImplicitGlobal: MaybeImplicitGlobal | null,
		init: boolean,
	): void {
		if (assignments.length === 0) {
			return;
		}

		const name = identifierName(this.reader, pattern);

		for (let i = 0; i < assignments.length; i++) {
			const assignment = assignments[i];

			this.scope.referenceValue(
				pattern,
				name,
				WRITE,
				this.reader.field(assignment, NODE_B),
				maybeImplicitGlobal,
				pattern !== this.reader.field(assignment, NODE_A),
				init,
			);
		}
	}

	//-------------------------------------------------------------------------
	// The Main Walk
	//-------------------------------------------------------------------------

	/**
	 * Visits a node and everything it contains.
	 * @param node The node index, or `0` for no node.
	 * @returns Nothing.
	 */
	visit(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				this.scope.referenceValue(node, identifierName(reader, node));
				this.visitType(reader.field(node, NODE_B));
				return;

			case N_Program:
				this.visitProgram(node);
				return;

			case N_BlockStatement:
				this.scopeManager.nestBlockScope(node);
				this.visitList(reader.field(node, NODE_A));
				this.close(node);
				return;

			case N_FunctionDeclaration:
			case N_FunctionExpression:
			case N_ArrowFunctionExpression:
			case N_TSDeclareFunction:
			case N_TSEmptyBodyFunctionExpression:
				this.visitFunction(node, kind, false);
				return;

			case N_ClassDeclaration:
			case N_ClassExpression:
				this.visitClass(node, kind);
				return;

			case N_VariableDeclaration:
				this.visitVariableDeclaration(node);
				return;

			case N_AssignmentExpression:
				this.visitAssignment(node);
				return;

			case N_UpdateExpression:
				this.visitUpdate(node);
				return;

			case N_MemberExpression:
				this.visit(reader.field(node, NODE_A));

				if ((reader.flags(node) & NF_COMPUTED) !== 0) {
					this.visit(reader.field(node, NODE_B));
				}

				return;

			case N_Property:
				this.visitPropertyLike(node);
				return;

			case N_CatchClause:
				this.visitCatchClause(node);
				return;

			case N_ForStatement:
				this.visitFor(node);
				return;

			case N_ForInStatement:
			case N_ForOfStatement:
				this.visitForIn(node);
				return;

			case N_SwitchStatement:
				this.visit(reader.field(node, NODE_A));
				this.scopeManager.nestSwitchScope(node);
				this.visitList(reader.field(node, NODE_B));
				this.close(node);
				return;

			case N_WithStatement:
				this.visit(reader.field(node, NODE_A));
				this.scopeManager.nestWithScope(node);
				this.visit(reader.field(node, NODE_B));
				this.close(node);
				return;

			case N_CallExpression:
				this.visitCall(node);
				return;

			case N_NewExpression:
				this.visit(reader.field(node, NODE_A));
				this.visitList(reader.field(node, NODE_B));
				this.visitType(reader.field(node, NODE_C));
				return;

			case N_ThisExpression:
				this.scope.variableScope.detectThis();
				return;

			case N_LabeledStatement:
				this.visit(reader.field(node, NODE_B));
				return;

			case N_ImportDeclaration:
				this.visitImportDeclaration(node);
				return;

			case N_ExportNamedDeclaration:
				this.visitExportNamed(node);
				return;

			case N_ExportDefaultDeclaration:
				this.visitExportDefault(node);
				return;

			case N_TaggedTemplateExpression:
				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_B));
				this.visitType(reader.field(node, NODE_C));
				return;

			/*
			 * A label is not a variable, an `export * from` names nothing in
			 * this program, and an import attribute's key is a property name.
			 * None of the three reaches a scope.
			 */
			case N_BreakStatement:
			case N_ContinueStatement:
			case N_ExportAllDeclaration:
			case N_ImportAttribute:
			case N_MetaProperty:
			case N_PrivateIdentifier:
				return;

			case N_JSXElement:
				this.visitJsxElement(node);
				return;

			case N_JSXFragment:
				this.visitJsxFragment(node);
				return;

			case N_JSXOpeningElement:
				this.visitJsxOpeningElement(node);
				return;

			case N_JSXIdentifier:
				if (this.jsx) {
					const name = identifierName(reader, node);

					// `this` in a JSX name is the keyword, not a variable.
					if (name !== "this") {
						this.scope.referenceValue(node, name);
					}
				}

				return;

			case N_JSXMemberExpression:
				this.visit(reader.field(node, NODE_A));
				return;

			case N_JSXNamespacedName:
				this.visit(reader.field(node, NODE_A));
				this.visit(reader.field(node, NODE_B));
				return;

			case N_JSXAttribute:
				this.visit(reader.field(node, NODE_B));
				return;

			case N_JSXExpressionContainer:
				this.visit(reader.field(node, NODE_A));
				return;

			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
				this.visit(reader.field(node, NODE_A));
				this.visitType(reader.field(node, NODE_B));
				return;

			case N_TSTypeAssertion:
				this.visit(reader.field(node, NODE_B));
				this.visitType(reader.field(node, NODE_A));
				return;

			case N_TSInstantiationExpression:
				this.visit(reader.field(node, NODE_A));
				this.visitType(reader.field(node, NODE_B));
				return;

			case N_TSInterfaceDeclaration:
			case N_TSTypeAliasDeclaration:
				this.visitType(node);
				return;

			case N_TSEnumDeclaration:
				this.visitEnum(node);
				return;

			case N_TSModuleDeclaration:
				this.visitModuleDeclaration(node);
				return;

			case N_TSImportEqualsDeclaration:
				this.visitImportEquals(node);
				return;

			case N_TSExportAssignment:
				this.visitExportAssignment(node);
				return;

			case N_StaticBlock:
				this.scopeManager.nestClassStaticBlockScope(node);
				this.visitList(reader.field(node, NODE_A));
				this.close(node);
				return;

			default:
				this.visitChildren(node, kind);
		}
	}

	//-------------------------------------------------------------------------
	// Statements and Declarations
	//-------------------------------------------------------------------------

	/**
	 * Visits the program, opening the scopes that wrap the whole file.
	 * @param node The `Program` node index.
	 * @returns Nothing.
	 */
	private visitProgram(node: number): void {
		const scopeManager = this.scopeManager;

		scopeManager.nestGlobalScope(node);

		/*
		 * A CommonJS module runs inside a function, so `return` is legal at
		 * the top level and the global scope itself is never strict.
		 */
		if (scopeManager.isGlobalReturn()) {
			this.scope.isStrict = false;
			scopeManager.nestFunctionScope(node, false);
		}

		if (scopeManager.isModule()) {
			scopeManager.nestModuleScope(node);
		}

		if (scopeManager.isImpliedStrict()) {
			this.scope.isStrict = true;
		}

		this.visitList(this.reader.field(node, NODE_A));
		this.close(node);
	}

	/**
	 * Visits a variable declaration, binding each name it introduces.
	 * @param node The `VariableDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitVariableDeclaration(node: number): void {
		const reader = this.reader;
		const flags = reader.flags(node);
		const declarationKind = (flags & DECL_MASK) >>> DECL_SHIFT;
		const kindName = DECL_KIND_NAMES[declarationKind];
		const target =
			declarationKind === DECL_VAR ? this.scope.variableScope : this.scope;
		const declarations = reader.field(node, NODE_A);
		const size = reader.listSize(declarations);

		for (let index = 0; index < size; index++) {
			const declarator = reader.listItem(declarations, index);
			const id = reader.field(declarator, NODE_A);
			const init = reader.field(declarator, NODE_B);

			this.visitPattern(
				id,
				(pattern, info) => {
					const name = identifierName(reader, pattern);

					target.define(
						pattern,
						name,
						variableDefinition(
							pattern,
							declarator,
							node,
							index,
							kindName,
						),
					);

					this.referencingDefaultValue(
						pattern,
						info.assignments,
						null,
						true,
					);

					if (init !== 0) {
						this.scope.referenceValue(
							pattern,
							name,
							WRITE,
							init,
							null,
							!info.topLevel,
							true,
						);
					}
				},
				true,
			);

			this.visit(init);
			this.visitType(typeAnnotationOf(reader, id));
		}
	}

	/**
	 * Visits an assignment, which either writes names or writes a property.
	 * @param node The `AssignmentExpression` node index.
	 * @returns Nothing.
	 */
	private visitAssignment(node: number): void {
		const reader = this.reader;
		const right = reader.field(node, NODE_B);
		const left = this.expressionTarget(reader.field(node, NODE_A));

		if (isPatternKind(reader.kind(left))) {
			if (reader.field(node, NODE_C) === T_ASSIGN) {
				this.visitPattern(
					left,
					(pattern, info) => {
						const name = identifierName(reader, pattern);

						/*
						 * Outside strict mode an assignment to an undeclared
						 * name creates a global, so the global scope has to
						 * hear about it even though nothing declared it.
						 */
						const maybeImplicitGlobal = this.scope.isStrict
							? null
							: { pattern, node };

						this.referencingDefaultValue(
							pattern,
							info.assignments,
							maybeImplicitGlobal,
							false,
						);
						this.scope.referenceValue(
							pattern,
							name,
							WRITE,
							right,
							maybeImplicitGlobal,
							!info.topLevel,
							false,
						);
					},
					true,
				);
			} else if (reader.kind(left) === N_Identifier) {
				this.scope.referenceValue(
					left,
					identifierName(reader, left),
					READ_WRITE,
					right,
				);
			}
		} else {
			this.visit(left);
		}

		this.visit(right);
	}

	/**
	 * Visits an increment or decrement, which reads and writes at once.
	 * @param node The `UpdateExpression` node index.
	 * @returns Nothing.
	 */
	private visitUpdate(node: number): void {
		const reader = this.reader;
		const argument = this.expressionTarget(reader.field(node, NODE_A));

		if (reader.kind(argument) === N_Identifier) {
			this.scope.referenceValue(
				argument,
				identifierName(reader, argument),
				READ_WRITE,
				0,
			);
		} else {
			this.visit(argument);
		}
	}

	/**
	 * Looks through the TypeScript expressions that wrap an assignment target
	 * without changing what is being written to.
	 * @param node The node the assignment names.
	 * @returns The expression underneath, with any type wrappers removed.
	 */
	private expressionTarget(node: number): number {
		const reader = this.reader;
		const kind = reader.kind(node);

		if (kind === N_TSAsExpression) {
			this.visitType(reader.field(node, NODE_B));

			return reader.field(node, NODE_A);
		}

		if (kind === N_TSTypeAssertion) {
			this.visitType(reader.field(node, NODE_A));

			return reader.field(node, NODE_B);
		}

		if (kind === N_TSNonNullExpression) {
			return reader.field(node, NODE_A);
		}

		return node;
	}

	/**
	 * Visits a `catch` clause, binding its parameter in a scope of its own.
	 * @param node The `CatchClause` node index.
	 * @returns Nothing.
	 */
	private visitCatchClause(node: number): void {
		const reader = this.reader;
		const param = reader.field(node, NODE_A);

		this.scopeManager.nestCatchScope(node);

		if (param !== 0) {
			this.visitPattern(
				param,
				(pattern, info) => {
					this.scope.define(
						pattern,
						identifierName(reader, pattern),
						catchClauseDefinition(pattern, node),
					);
					this.referencingDefaultValue(
						pattern,
						info.assignments,
						null,
						true,
					);
				},
				true,
			);
		}

		this.visit(reader.field(node, NODE_B));
		this.close(node);
	}

	/**
	 * Visits a `for` statement, which gets a scope of its own only when it
	 * declares block-scoped names.
	 * @param node The `ForStatement` node index.
	 * @returns Nothing.
	 */
	private visitFor(node: number): void {
		const reader = this.reader;
		const init = reader.field(node, NODE_A);

		if (init !== 0 && isLexicalDeclaration(reader, init)) {
			this.scopeManager.nestForScope(node);
		}

		this.visit(init);
		this.visit(reader.field(node, NODE_B));
		this.visit(reader.field(node, NODE_C));
		this.visit(reader.field(node, NODE_D));
		this.close(node);
	}

	/**
	 * Visits a `for-in` or `for-of` statement, whose left side is written on
	 * every iteration.
	 * @param node The loop node index.
	 * @returns Nothing.
	 */
	private visitForIn(node: number): void {
		const reader = this.reader;
		const left = reader.field(node, NODE_A);
		const right = reader.field(node, NODE_B);
		const isDeclaration = reader.kind(left) === N_VariableDeclaration;

		if (isDeclaration && isLexicalDeclaration(reader, left)) {
			this.scopeManager.nestForScope(node);
		}

		if (isDeclaration) {
			this.visit(left);

			const declarations = reader.field(left, NODE_A);

			if (reader.listSize(declarations) === 0) {
				this.visit(right);
				this.visit(reader.field(node, NODE_C));
				this.close(node);

				return;
			}

			const first = reader.listItem(declarations, 0);

			this.visitPattern(reader.field(first, NODE_A), pattern => {
				this.scope.referenceValue(
					pattern,
					identifierName(reader, pattern),
					WRITE,
					right,
					null,
					true,
					true,
				);
			});
		} else {
			this.visitPattern(
				left,
				(pattern, info) => {
					const maybeImplicitGlobal = this.scope.isStrict
						? null
						: { pattern, node };

					this.referencingDefaultValue(
						pattern,
						info.assignments,
						maybeImplicitGlobal,
						false,
					);
					this.scope.referenceValue(
						pattern,
						identifierName(reader, pattern),
						WRITE,
						right,
						maybeImplicitGlobal,
						true,
						false,
					);
				},
				true,
			);
		}

		this.visit(right);
		this.visit(reader.field(node, NODE_C));
		this.close(node);
	}

	/**
	 * Visits a call, noticing a direct call to `eval`.
	 * @param node The `CallExpression` node index.
	 * @returns Nothing.
	 */
	private visitCall(node: number): void {
		const reader = this.reader;
		const callee = reader.field(node, NODE_A);

		/*
		 * A direct `eval` can introduce bindings at runtime, which is what
		 * makes every enclosing scope dynamic. It is the variable scope that
		 * is marked, because that is where `var` declarations from the evaluated
		 * code would land.
		 */
		if (
			!this.ignoreEval &&
			reader.kind(callee) === N_Identifier &&
			identifierName(reader, callee) === "eval"
		) {
			this.scope.variableScope.detectEval();
		}

		this.visit(callee);
		this.visitList(reader.field(node, NODE_B));
		this.visitType(reader.field(node, NODE_C));
	}

	//-------------------------------------------------------------------------
	// Functions
	//-------------------------------------------------------------------------

	/**
	 * Visits a function, binding its name and parameters.
	 * @param node The function node index.
	 * @param kind The function's node kind.
	 * @param isMethod Whether the function is a method body, which is strict
	 *      no matter what encloses it, and whose parameter decorators are
	 *      evaluated outside the function rather than inside it.
	 * @returns Nothing.
	 */
	private visitFunction(
		node: number,
		kind: number,
		isMethod: boolean,
	): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);
		const params = reader.field(node, NODE_B);

		/*
		 * A function declaration binds its name where it is written, while a
		 * named function expression binds its name only inside itself, in a
		 * scope that exists for nothing else.
		 */
		if (kind === N_FunctionExpression) {
			if (id !== 0) {
				this.scopeManager.nestFunctionExpressionNameScope(node);
				this.scope.define(
					id,
					identifierName(reader, id),
					functionNameDefinition(id, node),
				);
			}
		} else if (id !== 0 && kind !== N_ArrowFunctionExpression) {
			this.scope.define(
				id,
				identifierName(reader, id),
				functionNameDefinition(id, node),
			);
		}

		/*
		 * A decorator on a method's parameter is evaluated where the class is
		 * defined, not where the method runs, so it is referenced before the
		 * function scope opens. On a plain function the reference happens
		 * inside, right after the parameter it decorates.
		 */
		if (isMethod) {
			this.visitParameterDecorators(params);
		}

		this.scopeManager.nestFunctionScope(node, isMethod);
		this.visitParameters(node, params, !isMethod);
		this.visitType(reader.field(node, NODE_E));
		this.visitType(reader.field(node, NODE_D));

		const body = reader.field(node, NODE_C);

		if (body !== 0) {
			/*
			 * The body's own block scope is skipped: a function body and its
			 * parameters share one scope.
			 */
			if (reader.kind(body) === N_BlockStatement) {
				this.visitList(reader.field(body, NODE_A));
			} else {
				this.visit(body);
			}
		}

		this.close(node);
	}

	/**
	 * Binds every parameter of a function.
	 * @param node The function node index.
	 * @param params The parameter list handle.
	 * @param withDecorators Whether each parameter's decorators should be
	 *      visited here.
	 * @returns Nothing.
	 */
	private visitParameters(
		node: number,
		params: number,
		withDecorators: boolean,
	): void {
		const reader = this.reader;
		const size = reader.listSize(params);

		for (let index = 0; index < size; index++) {
			const param = reader.listItem(params, index);

			this.visitPattern(
				param,
				(pattern, info) => {
					this.scope.define(
						pattern,
						identifierName(reader, pattern),
						parameterDefinition(pattern, node, index, info.rest),
					);
					this.referencingDefaultValue(
						pattern,
						info.assignments,
						null,
						true,
					);
				},
				true,
			);

			this.visitParameterTypeAnnotation(param);

			if (
				withDecorators &&
				reader.kind(param) === N_TSParameterProperty
			) {
				this.visitList(reader.field(param, NODE_B));
			}
		}
	}

	/**
	 * Visits the decorators of every parameter in a list, without binding the
	 * parameters themselves.
	 * @param params The parameter list handle.
	 * @returns Nothing.
	 */
	private visitParameterDecorators(params: number): void {
		const reader = this.reader;
		const size = reader.listSize(params);

		for (let i = 0; i < size; i++) {
			const param = reader.listItem(params, i);

			if (reader.kind(param) === N_TSParameterProperty) {
				this.visitList(reader.field(param, NODE_B));
			}
		}
	}

	/**
	 * Visits the type annotation of a parameter, wherever the annotation hides.
	 * @param param The parameter node index.
	 * @returns Nothing.
	 */
	private visitParameterTypeAnnotation(param: number): void {
		const reader = this.reader;
		const kind = reader.kind(param);

		if (kind === N_AssignmentPattern) {
			this.visitType(
				typeAnnotationOf(reader, reader.field(param, NODE_A)),
			);
		} else if (kind === N_TSParameterProperty) {
			this.visitParameterTypeAnnotation(reader.field(param, NODE_A));
		} else {
			this.visitType(typeAnnotationOf(reader, param));
		}
	}

	//-------------------------------------------------------------------------
	// Classes
	//-------------------------------------------------------------------------

	/**
	 * Visits a class, which binds its own name twice: once outside, so that
	 * the declaration is visible, and once inside, so that the body can refer
	 * to the class without seeing a later rebinding.
	 * @param node The class node index.
	 * @param kind The class's node kind.
	 * @returns Nothing.
	 */
	private visitClass(node: number, kind: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);

		if (kind === N_ClassDeclaration && id !== 0) {
			this.scope.define(
				id,
				identifierName(reader, id),
				classNameDefinition(id, node),
			);
		}

		this.visitList(reader.field(node, NODE_G));
		this.scopeManager.nestClassScope(node);

		if (id !== 0) {
			this.scope.define(
				id,
				identifierName(reader, id),
				classNameDefinition(id, node),
			);
		}

		this.visit(reader.field(node, NODE_B));
		this.visitType(reader.field(node, NODE_D));
		this.visitType(reader.field(node, NODE_E));
		this.visitTypeList(reader.field(node, NODE_F));
		this.visitClassBody(reader.field(node, NODE_C));
		this.close(node);
	}

	/**
	 * Visits the members of a class body.
	 * @param body The `ClassBody` node index.
	 * @returns Nothing.
	 */
	private visitClassBody(body: number): void {
		if (body === 0 || this.reader.kind(body) !== N_ClassBody) {
			return;
		}

		const members = this.reader.field(body, NODE_A);
		const size = this.reader.listSize(members);

		for (let i = 0; i < size; i++) {
			this.visitClassMember(this.reader.listItem(members, i));
		}
	}

	/**
	 * Visits one member of a class body.
	 * @param member The member node index.
	 * @returns Nothing.
	 */
	private visitClassMember(member: number): void {
		const reader = this.reader;
		const kind = reader.kind(member);

		switch (kind) {
			case N_MethodDefinition:
				this.visitMethod(member, true);
				return;

			/*
			 * An abstract method has no body to enter, so it is visited the
			 * way a property is rather than the way a method is.
			 */
			case N_TSAbstractMethodDefinition:
				this.visitMethod(member, false);
				return;

			case N_PropertyDefinition:
			case N_AccessorProperty:
				this.visitClassProperty(member, true);
				return;

			case N_TSAbstractPropertyDefinition:
			case N_TSAbstractAccessorProperty:
				this.visitClassProperty(member, false);
				return;

			case N_StaticBlock:
				this.scopeManager.nestClassStaticBlockScope(member);
				this.visitList(reader.field(member, NODE_A));
				this.close(member);
				return;

			case N_TSIndexSignature:
				this.visitType(member);
				return;

			default:
				this.visit(member);
		}
	}

	/**
	 * Visits a method definition.
	 * @param member The member node index.
	 * @param hasBody Whether the method's value is a function with a body.
	 * @returns Nothing.
	 */
	private visitMethod(member: number, hasBody: boolean): void {
		const reader = this.reader;
		const value = reader.field(member, NODE_B);

		if ((reader.flags(member) & NF_COMPUTED) !== 0) {
			this.visit(reader.field(member, NODE_A));
		}

		if (hasBody && reader.kind(value) === N_FunctionExpression) {
			this.visitMethodFunction(value);
		} else {
			this.visit(value);
		}

		this.visitList(reader.field(member, NODE_C));
	}

	/**
	 * Visits the function that implements a method, which is strict whatever
	 * encloses it.
	 * @param node The `FunctionExpression` node index.
	 * @returns Nothing.
	 */
	private visitMethodFunction(node: number): void {
		this.visitFunction(node, N_FunctionExpression, true);
	}

	/**
	 * Visits a class field, whose initializer runs in a scope of its own.
	 * @param member The member node index.
	 * @param hasInitializerScope Whether the initializer gets its own scope,
	 *      which an abstract declaration does not because it never runs.
	 * @returns Nothing.
	 */
	private visitClassProperty(
		member: number,
		hasInitializerScope: boolean,
	): void {
		const reader = this.reader;
		const value = reader.field(member, NODE_B);

		if ((reader.flags(member) & NF_COMPUTED) !== 0) {
			this.visit(reader.field(member, NODE_A));
		}

		if (value !== 0) {
			if (hasInitializerScope) {
				this.scopeManager.nestClassFieldInitializerScope(value);
			}

			this.visit(value);

			if (hasInitializerScope) {
				this.close(value);
			}
		}

		this.visitList(reader.field(member, NODE_C));
		this.visitType(reader.field(member, NODE_D));
	}

	/**
	 * Visits an object literal property or a method definition's key and
	 * value.
	 * @param node The `Property` node index.
	 * @returns Nothing.
	 */
	private visitPropertyLike(node: number): void {
		const reader = this.reader;

		// An ordinary key is a property name, not a variable.
		if ((reader.flags(node) & NF_COMPUTED) !== 0) {
			this.visit(reader.field(node, NODE_A));
		}

		this.visit(reader.field(node, NODE_B));
	}

	//-------------------------------------------------------------------------
	// Modules
	//-------------------------------------------------------------------------

	/**
	 * Visits an import declaration, binding every name it brings in.
	 * @param node The `ImportDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitImportDeclaration(node: number): void {
		const reader = this.reader;
		const specifiers = reader.field(node, NODE_A);
		const size = reader.listSize(specifiers);

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);
			const kind = reader.kind(specifier);

			/*
			 * The local name is the last slot on an `ImportSpecifier` and the
			 * only one on the default and namespace forms.
			 */
			const local = reader.field(
				specifier,
				kind === N_ImportSpecifier ? NODE_B : NODE_A,
			);

			if (local === 0) {
				continue;
			}

			this.scope.define(
				local,
				identifierName(reader, local),
				importBindingDefinition(local, specifier, node),
			);
		}
	}

	/**
	 * Visits a named export, which either declares something or names things
	 * declared elsewhere.
	 * @param node The `ExportNamedDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitExportNamed(node: number): void {
		const reader = this.reader;

		// `export { x } from "m"` names nothing in this program.
		if (reader.field(node, NODE_C) !== 0) {
			return;
		}

		const declaration = reader.field(node, NODE_A);

		if (declaration !== 0) {
			this.visit(declaration);
			return;
		}

		const typeOnly = (reader.flags(node) & NF_TYPE_ONLY) !== 0;
		const specifiers = reader.field(node, NODE_B);
		const size = reader.listSize(specifiers);

		for (let i = 0; i < size; i++) {
			const specifier = reader.listItem(specifiers, i);
			const local = reader.field(specifier, NODE_A);

			if (reader.kind(local) !== N_Identifier) {
				continue;
			}

			this.referenceExportedName(
				local,
				typeOnly ||
					(reader.flags(specifier) & NF_TYPE_ONLY) !== 0,
			);
		}
	}

	/**
	 * Visits a default export.
	 * @param node The `ExportDefaultDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitExportDefault(node: number): void {
		const reader = this.reader;
		const declaration = reader.field(node, NODE_A);

		if (reader.kind(declaration) === N_Identifier) {
			this.referenceExportedName(
				declaration,
				(reader.flags(node) & NF_TYPE_ONLY) !== 0,
			);
			return;
		}

		this.visit(declaration);
	}

	/**
	 * Records the reference that exporting a name by itself creates.
	 *
	 * `export { x }` can be exporting a value, a type, or a name that is both,
	 * and TypeScript needs the difference. `eslint-scope` has no notion of a
	 * type reference at all, so in JavaScript this stays an ordinary read.
	 * @param local The `Identifier` node being exported.
	 * @param typeOnly Whether the export was written `export type`.
	 * @returns Nothing.
	 */
	private referenceExportedName(local: number, typeOnly: boolean): void {
		const name = identifierName(this.reader, local);

		if (!this.typescript) {
			this.scope.referenceValue(local, name);
			return;
		}

		if (typeOnly) {
			this.scope.referenceType(local, name);
		} else {
			this.scope.referenceDualValueType(local, name);
		}
	}

	//-------------------------------------------------------------------------
	// JSX
	//-------------------------------------------------------------------------

	/**
	 * Visits a JSX element.
	 *
	 * Only the opening element and the children are visited. A closing tag
	 * repeats a name that the opening tag already referenced, and counting it
	 * twice is what `eslint-scope` declines to do.
	 * @param node The `JSXElement` node index.
	 * @returns Nothing.
	 */
	private visitJsxElement(node: number): void {
		const reader = this.reader;

		if (!this.jsx) {
			this.visitChildren(node, N_JSXElement);
			return;
		}

		this.visit(reader.field(node, NODE_A));
		this.visitList(reader.field(node, NODE_C));
	}

	/**
	 * Visits a JSX fragment.
	 * @param node The `JSXFragment` node index.
	 * @returns Nothing.
	 */
	private visitJsxFragment(node: number): void {
		this.referenceJsxPragma();
		this.referenceJsxFragment();
		this.visitList(this.reader.field(node, NODE_C));
	}

	/**
	 * Visits a JSX opening tag.
	 *
	 * A lowercase tag name is a host element such as `div`, not a variable, so
	 * only a capitalized name or a member expression is referenced.
	 * @param node The `JSXOpeningElement` node index.
	 * @returns Nothing.
	 */
	private visitJsxOpeningElement(node: number): void {
		const reader = this.reader;
		const name = reader.field(node, NODE_A);

		this.referenceJsxPragma();

		if (this.jsx) {
			const kind = reader.kind(name);

			if (kind === N_JSXMemberExpression) {
				this.visit(name);
			} else if (kind === N_JSXIdentifier) {
				const text = identifierName(reader, name);

				if (text[0] === text[0].toUpperCase()) {
					this.visit(name);
				}
			}
		}

		this.visitType(reader.field(node, NODE_D));
		this.visitList(reader.field(node, NODE_B));
	}

	/**
	 * References the name a JSX element compiles a call to, once per program.
	 * @returns Nothing.
	 */
	private referenceJsxPragma(): void {
		if (this.jsxPragma === null || this.referencedJsxFactory) {
			return;
		}

		this.referencedJsxFactory = this.referenceInSomeUpperScope(
			this.jsxPragma,
		);
	}

	/**
	 * References the name a JSX fragment compiles a call to, once per program.
	 * @returns Nothing.
	 */
	private referenceJsxFragment(): void {
		if (
			this.jsxFragmentName === null ||
			this.referencedJsxFragmentFactory
		) {
			return;
		}

		this.referencedJsxFragmentFactory = this.referenceInSomeUpperScope(
			this.jsxFragmentName,
		);
	}

	/**
	 * References a name in whichever enclosing scope declares it.
	 * @param name The name to reference.
	 * @returns `true` when some scope declared the name.
	 */
	private referenceInSomeUpperScope(name: string): boolean {
		let scope: Scope | null = this.scopeManager.currentScope;

		while (scope !== null) {
			const variable = scope.set.get(name);

			if (variable !== undefined) {
				scope.referenceValue(variable.identifiers[0], name);
				return true;
			}

			scope = scope.upper;
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// TypeScript Declarations
	//-------------------------------------------------------------------------

	/**
	 * Visits an enum, whose members are bound in a scope of their own so that
	 * one member can name another.
	 * @param node The `TSEnumDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitEnum(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);

		if (id !== 0) {
			this.scope.define(
				id,
				identifierName(reader, id),
				enumNameDefinition(id, node),
			);
		}

		this.scopeManager.nestTSEnumScope(node);

		const body = reader.field(node, NODE_B);
		const members = body === 0 ? 0 : reader.field(body, NODE_A);
		const size = reader.listSize(members);

		for (let i = 0; i < size; i++) {
			const member = reader.listItem(members, i);
			const memberId = reader.field(member, NODE_A);
			const memberKind = reader.kind(memberId);

			if (memberKind === N_Identifier) {
				this.scope.define(
					memberId,
					identifierName(reader, memberId),
					enumMemberDefinition(memberId, member),
				);
			} else if (memberKind === N_Literal) {
				this.scope.defineLiteral(
					literalStringValue(reader, memberId),
					enumMemberDefinition(memberId, member),
				);
			}

			this.visit(reader.field(member, NODE_B));
		}

		this.close(node);
	}

	/**
	 * Visits a namespace or module declaration.
	 * @param node The `TSModuleDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitModuleDeclaration(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);
		const moduleKind =
			(reader.flags(node) & MODULE_KIND_MASK) >>> MODULE_KIND_SHIFT;

		/*
		 * `declare global` reopens the global scope rather than introducing a
		 * name, so there is nothing to bind.
		 */
		if (reader.kind(id) === N_Identifier && moduleKind !== MODULE_GLOBAL) {
			this.scope.define(
				id,
				identifierName(reader, id),
				moduleNameDefinition(id, node),
			);
		}

		this.scopeManager.nestTSModuleScope(node);
		this.visit(reader.field(node, NODE_B));
		this.close(node);
	}

	/**
	 * Visits an `import x = require("m")` declaration.
	 * @param node The `TSImportEqualsDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitImportEquals(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);

		this.scope.define(
			id,
			identifierName(reader, id),
			importBindingDefinition(id, node, node),
		);

		let reference = reader.field(node, NODE_B);

		// Only the leftmost name of `A.B.C` is a variable.
		if (reader.kind(reference) === N_TSQualifiedName) {
			reference = reader.field(reference, NODE_A);

			while (reader.kind(reference) === N_TSQualifiedName) {
				reference = reader.field(reference, NODE_A);
			}
		}

		this.visit(reference);
	}

	/**
	 * Visits an `export = x` assignment.
	 * @param node The `TSExportAssignment` node index.
	 * @returns Nothing.
	 */
	private visitExportAssignment(node: number): void {
		const reader = this.reader;
		const expression = reader.field(node, NODE_A);

		if (reader.kind(expression) === N_Identifier) {
			this.scope.referenceDualValueType(
				expression,
				identifierName(reader, expression),
			);
			return;
		}

		this.visit(expression);
	}

	//-------------------------------------------------------------------------
	// Types
	//-------------------------------------------------------------------------

	/**
	 * Visits every element of a list of type nodes.
	 * @param handle The list handle.
	 * @returns Nothing.
	 */
	private visitTypeList(handle: number): void {
		const size = this.reader.listSize(handle);

		for (let i = 0; i < size; i++) {
			this.visitType(this.reader.listItem(handle, i));
		}
	}

	/**
	 * Visits a node in type position, where a name means a type rather than a
	 * value.
	 * @param node The node index, or `0` for no node.
	 * @returns Nothing.
	 */
	private visitType(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier:
				this.scope.referenceType(node, identifierName(reader, node));
				return;

			case N_MemberExpression:
				this.visitType(reader.field(node, NODE_A));
				return;

			case N_TSQualifiedName:
				// Only the leftmost name of `A.B.C` names anything bound.
				this.visitType(reader.field(node, NODE_A));
				return;

			case N_TSFunctionType:
			case N_TSConstructorType:
			case N_TSCallSignatureDeclaration:
			case N_TSConstructSignatureDeclaration:
				this.visitFunctionType(node, NODE_A, NODE_B, NODE_C);
				return;

			case N_TSMethodSignature:
				this.visitPropertyKey(node);
				this.visitFunctionType(node, NODE_B, NODE_C, NODE_D);
				return;

			case N_TSPropertySignature:
				this.visitPropertyKey(node);
				this.visitType(reader.field(node, NODE_B));
				return;

			case N_TSConditionalType:
				this.visitConditionalType(node);
				return;

			case N_TSMappedType:
				this.visitMappedType(node);
				return;

			case N_TSInferType:
				this.visitInferType(node);
				return;

			case N_TSTypeParameter:
				this.visitTypeParameter(node);
				return;

			case N_TSInterfaceDeclaration:
				this.visitInterfaceDeclaration(node);
				return;

			case N_TSTypeAliasDeclaration:
				this.visitTypeAliasDeclaration(node);
				return;

			case N_TSIndexSignature:
				this.visitIndexSignature(node);
				return;

			case N_TSTypeQuery:
				this.visitTypeQuery(node);
				return;

			case N_TSTypePredicate:
				this.visitTypePredicate(node);
				return;

			case N_TSNamedTupleMember:
				// The label is not a reference to anything.
				this.visitType(reader.field(node, NODE_B));
				return;

			case N_TSImportType:
				this.visitType(reader.field(node, NODE_C));
				return;

			default:
				this.visitTypeChildren(node, kind);
		}
	}

	/**
	 * Visits every child of a type node that has no rule of its own.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitTypeChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visitType(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitTypeList(this.reader.field(node, NODE_A + slot));
			}
		}
	}

	/**
	 * Visits a computed key in a type member, which is ordinary code.
	 * @param node The member node index.
	 * @returns Nothing.
	 */
	private visitPropertyKey(node: number): void {
		if ((this.reader.flags(node) & NF_COMPUTED) !== 0) {
			this.visit(this.reader.field(node, NODE_A));
		}
	}

	/**
	 * Visits a function type, whose parameters are bound in a scope of their
	 * own so that a type parameter can be named by a later parameter.
	 * @param node The function type node index.
	 * @param paramsSlot The slot holding the parameter list.
	 * @param returnTypeSlot The slot holding the return type.
	 * @param typeParametersSlot The slot holding the type parameters.
	 * @returns Nothing.
	 */
	private visitFunctionType(
		node: number,
		paramsSlot: number,
		returnTypeSlot: number,
		typeParametersSlot: number,
	): void {
		const reader = this.reader;

		this.scopeManager.nestFunctionTypeScope(node);
		this.visitType(reader.field(node, typeParametersSlot));

		const params = reader.field(node, paramsSlot);
		const size = reader.listSize(params);

		for (let index = 0; index < size; index++) {
			const param = reader.listItem(params, index);
			let visitedAnnotation = false;

			this.visitPattern(param, (pattern, info) => {
				this.scope.define(
					pattern,
					identifierName(reader, pattern),
					parameterDefinition(pattern, node, index, info.rest),
				);

				const annotation = typeAnnotationOf(reader, pattern);

				if (annotation !== 0) {
					this.visitType(annotation);
					visitedAnnotation = true;
				}
			});

			if (!visitedAnnotation) {
				this.visitType(typeAnnotationOf(reader, param));
			}
		}

		this.visitType(reader.field(node, returnTypeSlot));
		this.close(node);
	}

	/**
	 * Visits a conditional type. Its `infer` names are visible in the true
	 * branch but not in the false one, which is why the false branch is
	 * visited after the scope closes.
	 * @param node The `TSConditionalType` node index.
	 * @returns Nothing.
	 */
	private visitConditionalType(node: number): void {
		const reader = this.reader;

		this.scopeManager.nestConditionalTypeScope(node);
		this.visitType(reader.field(node, NODE_A));
		this.visitType(reader.field(node, NODE_B));
		this.visitType(reader.field(node, NODE_C));
		this.close(node);
		this.visitType(reader.field(node, NODE_D));
	}

	/**
	 * Visits a mapped type, whose key is bound for the rest of the type.
	 * @param node The `TSMappedType` node index.
	 * @returns Nothing.
	 */
	private visitMappedType(node: number): void {
		const reader = this.reader;
		const typeParameter = reader.field(node, NODE_A);
		const key = reader.field(typeParameter, NODE_A);

		this.scopeManager.nestMappedTypeScope(node);
		this.scope.define(
			key,
			identifierName(reader, key),
			typeDefinition(key, node),
		);
		this.visitType(reader.field(typeParameter, NODE_B));
		this.visitType(reader.field(node, NODE_C));
		this.visitType(reader.field(node, NODE_D));
		this.close(node);
	}

	/**
	 * Visits an `infer T`, binding `T` where it can be referred to.
	 * @param node The `TSInferType` node index.
	 * @returns Nothing.
	 */
	private visitInferType(node: number): void {
		const reader = this.reader;
		const typeParameter = reader.field(node, NODE_A);
		const name = reader.field(typeParameter, NODE_A);
		let scope = this.scope;

		/*
		 * An `infer` inside a function or mapped type nested in a conditional
		 * type belongs to the conditional type, since that is where the name
		 * can be referred to from.
		 */
		if (
			scope.type === SCOPE_FUNCTION_TYPE ||
			scope.type === SCOPE_MAPPED_TYPE
		) {
			let current = scope.upper;

			while (current !== null) {
				if (
					current.type === SCOPE_FUNCTION_TYPE ||
					current.type === SCOPE_MAPPED_TYPE
				) {
					current = current.upper;
					continue;
				}

				if (current.type === SCOPE_CONDITIONAL_TYPE) {
					scope = current;
				}

				break;
			}
		}

		scope.define(
			name,
			identifierName(reader, name),
			typeDefinition(name, typeParameter),
		);
		this.visitType(reader.field(typeParameter, NODE_B));
	}

	/**
	 * Visits a type parameter declaration.
	 * @param node The `TSTypeParameter` node index.
	 * @returns Nothing.
	 */
	private visitTypeParameter(node: number): void {
		const reader = this.reader;
		const name = reader.field(node, NODE_A);

		this.scope.define(
			name,
			identifierName(reader, name),
			typeDefinition(name, node),
		);
		this.visitType(reader.field(node, NODE_B));
		this.visitType(reader.field(node, NODE_C));
	}

	/**
	 * Visits an interface declaration.
	 * @param node The `TSInterfaceDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitInterfaceDeclaration(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);
		const typeParameters = reader.field(node, NODE_C);

		this.scope.define(
			id,
			identifierName(reader, id),
			typeDefinition(id, node),
		);

		// The scope exists only to hold type parameters, so it is optional.
		if (typeParameters !== 0) {
			this.scopeManager.nestTypeScope(node);
			this.visitType(typeParameters);
		}

		this.visitTypeList(reader.field(node, NODE_D));
		this.visitType(reader.field(node, NODE_B));

		if (typeParameters !== 0) {
			this.close(node);
		}
	}

	/**
	 * Visits a type alias declaration.
	 * @param node The `TSTypeAliasDeclaration` node index.
	 * @returns Nothing.
	 */
	private visitTypeAliasDeclaration(node: number): void {
		const reader = this.reader;
		const id = reader.field(node, NODE_A);
		const typeParameters = reader.field(node, NODE_C);

		this.scope.define(
			id,
			identifierName(reader, id),
			typeDefinition(id, node),
		);

		if (typeParameters !== 0) {
			this.scopeManager.nestTypeScope(node);
			this.visitType(typeParameters);
		}

		this.visitType(reader.field(node, NODE_B));

		if (typeParameters !== 0) {
			this.close(node);
		}
	}

	/**
	 * Visits an index signature, whose parameter names nothing.
	 * @param node The `TSIndexSignature` node index.
	 * @returns Nothing.
	 */
	private visitIndexSignature(node: number): void {
		const reader = this.reader;
		const parameters = reader.field(node, NODE_A);
		const size = reader.listSize(parameters);

		for (let i = 0; i < size; i++) {
			const parameter = reader.listItem(parameters, i);

			if (reader.kind(parameter) === N_Identifier) {
				this.visitType(typeAnnotationOf(reader, parameter));
			}
		}

		this.visitType(reader.field(node, NODE_B));
	}

	/**
	 * Visits a `typeof x` type, where the name is a value even though the
	 * position is a type.
	 * @param node The `TSTypeQuery` node index.
	 * @returns Nothing.
	 */
	private visitTypeQuery(node: number): void {
		const reader = this.reader;
		const exprName = reader.field(node, NODE_A);
		let entityName = exprName;

		if (reader.kind(exprName) === N_TSQualifiedName) {
			let iterator = exprName;

			while (
				reader.kind(reader.field(iterator, NODE_A)) === N_TSQualifiedName
			) {
				iterator = reader.field(iterator, NODE_A);
			}

			entityName = reader.field(iterator, NODE_A);
		} else if (reader.kind(exprName) === N_TSImportType) {
			this.visitType(exprName);
		}

		if (reader.kind(entityName) === N_Identifier) {
			this.scope.referenceValue(
				entityName,
				identifierName(reader, entityName),
			);
		}

		this.visitType(reader.field(node, NODE_B));
	}

	/**
	 * Visits a type predicate, whose parameter name is a value.
	 * @param node The `TSTypePredicate` node index.
	 * @returns Nothing.
	 */
	private visitTypePredicate(node: number): void {
		const reader = this.reader;
		const parameterName = reader.field(node, NODE_A);

		if (
			parameterName !== 0 &&
			reader.kind(parameterName) !== N_TSThisType
		) {
			this.scope.referenceValue(
				parameterName,
				identifierName(reader, parameterName),
			);
		}

		this.visitType(reader.field(node, NODE_B));
	}
}

/**
 * The type annotation attached to a binding, if the binding can carry one.
 * @param reader The reader over the AST buffer.
 * @param node The binding node index.
 * @returns The `TSTypeAnnotation` node index, or `0`.
 */
function typeAnnotationOf(reader: AstReader, node: number): number {
	if (node === 0) {
		return 0;
	}

	switch (reader.kind(node)) {
		case N_Identifier:
		case N_ArrayPattern:
		case N_ObjectPattern:
		case N_RestElement:
			return reader.field(node, NODE_B);

		default:
			return 0;
	}
}

/**
 * Reports whether a declaration binds names that a loop's own scope should
 * hold, which `var` does not.
 * @param reader The reader over the AST buffer.
 * @param node The node in the loop's initializer position.
 * @returns `true` for a `let`, `const`, or `using` declaration.
 */
function isLexicalDeclaration(reader: AstReader, node: number): boolean {
	return (
		reader.kind(node) === N_VariableDeclaration &&
		((reader.flags(node) & DECL_MASK) >>> DECL_SHIFT) !== DECL_VAR
	);
}
