/**
 * @fileoverview The walk that builds the scope graph.
 *
 * This is a direct port of what `eslint-scope`'s `Referencer` and
 * `@typescript-eslint/scope-manager`'s `Referencer`, `ClassVisitor`, and
 * `TypeVisitor` do, rewritten against `AstAccess`. Three things change in the
 * translation and nothing else does:
 *
 * - Dispatch is a `switch` over integer node kinds rather than a lookup of a
 *   method named after a node type.
 * - Children are addressed by slot. The generic "visit whatever children this
 *   node has" fallback reads `SLOT_TABLE` instead of a visitor-key table. Slot
 *   order matches visitor-key order everywhere it can be observed; the handful
 *   of kinds where it does not are all handled explicitly below.
 * - A missing child is `null`.
 *
 * Nothing here knows whether it is reading a binary buffer or an ESTree tree.
 * That is the point: one walk, checked against two reference implementations,
 * serving both representations.
 *
 * Where the two reference implementations disagree, `eslint-scope` wins. Those
 * points are marked as they come up.
 */

import {
	SLOT_COUNT,
	SLOT_LIST,
	SLOT_NODE,
	SLOT_TABLE,
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
} from "../parse/index.js";
import {
	SLOT_A,
	SLOT_B,
	SLOT_C,
	SLOT_D,
	SLOT_E,
	SLOT_F,
	SLOT_G,
	type AstAccess,
} from "./ast-access.js";
import {
	READ_WRITE,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FUNCTION_TYPE,
	SCOPE_MAPPED_TYPE,
	WRITE,
} from "./kinds.js";
import {
	isPatternKind,
	PatternVisitor,
	type PatternCallback,
} from "./pattern-visitor.js";
import type { ScopeBuilder } from "./scope-builder.js";

/**
 * Builds the scope graph for one program.
 *
 * @template TNode How one node is represented.
 */
export class Referencer<TNode> {
	/** The graph being built. */
	private readonly builder: ScopeBuilder<TNode>;

	/** How to read the program. */
	private readonly ast: AstAccess<TNode>;

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
	 * @param builder The graph being built.
	 */
	constructor(builder: ScopeBuilder<TNode>) {
		const options = builder.options;

		this.builder = builder;
		this.ast = builder.ast;
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
	 * Closes every scope a node opened.
	 * @param node The node the scopes were opened for.
	 * @returns Nothing.
	 */
	private close(node: TNode): void {
		const builder = this.builder;

		while (
			builder.currentScope() !== -1 &&
			node === builder.currentBlock()
		) {
			builder.closeCurrent();
		}
	}

	//-------------------------------------------------------------------------
	// Generic Traversal
	//-------------------------------------------------------------------------

	/**
	 * Visits every child of a node, in the order a visitor-key walk would.
	 * @param node The node.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: TNode, kind: number): void {
		/*
		 * A parser may produce a node type this analyzer has never heard of.
		 * Walking whatever it holds beats skipping the subtree, and it is what
		 * `eslint-scope` does for the same case.
		 */
		if (kind === 0) {
			const children = this.ast.unknownChildren(node);

			for (let i = 0; i < children.length; i++) {
				this.visit(children[i]);
			}

			return;
		}

		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.ast.child(node, slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitList(node, slot);
			}
		}
	}

	/**
	 * Visits every element of a slot's list.
	 * @param node The node holding the list.
	 * @param slot The slot the list is in.
	 * @returns Nothing.
	 */
	private visitList(node: TNode, slot: number): void {
		const size = this.ast.listSize(node, slot);

		for (let i = 0; i < size; i++) {
			this.visit(this.ast.listItem(node, slot, i));
		}
	}

	/**
	 * Walks a pattern, declaring or referencing every name it binds.
	 * @param node The pattern node, or `null`.
	 * @param callback What to do at each name.
	 * @param processRightHandNodes Whether the expressions inside the pattern
	 *      should be visited as ordinary code afterward.
	 * @returns Nothing.
	 */
	private visitPattern(
		node: TNode | null,
		callback: PatternCallback<TNode>,
		processRightHandNodes = false,
	): void {
		if (node === null) {
			return;
		}

		const visitor = new PatternVisitor(this.ast, node, callback);

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
	 * @param implicitNode The undeclared assignment's statement, or `null`.
	 * @param init Whether the writes initialize a declaration.
	 * @returns Nothing.
	 */
	private referencingDefaultValue(
		pattern: TNode,
		assignments: TNode[],
		implicitNode: TNode | null,
		init: boolean,
	): void {
		if (assignments.length === 0) {
			return;
		}

		const ast = this.ast;
		const name = ast.name(pattern);

		for (let i = 0; i < assignments.length; i++) {
			const assignment = assignments[i];

			this.builder.referenceValue(
				pattern,
				name,
				WRITE,
				ast.child(assignment, SLOT_B),
				implicitNode,
				pattern !== ast.child(assignment, SLOT_A),
				init,
			);
		}
	}

	//-------------------------------------------------------------------------
	// The Main Walk
	//-------------------------------------------------------------------------

	/**
	 * Visits a node and everything it contains.
	 * @param node The node, or `null` for no node.
	 * @returns Nothing.
	 */
	visit(node: TNode | null): void {
		if (node === null) {
			return;
		}

		const ast = this.ast;
		const kind = ast.kind(node);

		switch (kind) {
			case N_Identifier:
				this.builder.referenceRead(node, ast.name(node));
				this.visitType(ast.child(node, SLOT_B));
				return;

			case N_Program:
				this.visitProgram(node);
				return;

			case N_BlockStatement:
				this.builder.nestBlockScope(node);
				this.visitList(node, SLOT_A);
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
				this.visit(ast.child(node, SLOT_A));

				if (ast.computed(node)) {
					this.visit(ast.child(node, SLOT_B));
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
				this.visit(ast.child(node, SLOT_A));
				this.builder.nestSwitchScope(node);
				this.visitList(node, SLOT_B);
				this.close(node);
				return;

			case N_WithStatement:
				this.visit(ast.child(node, SLOT_A));
				this.builder.nestWithScope(node);
				this.visit(ast.child(node, SLOT_B));
				this.close(node);
				return;

			case N_CallExpression:
				this.visitCall(node);
				return;

			case N_NewExpression:
				this.visit(ast.child(node, SLOT_A));
				this.visitList(node, SLOT_B);
				this.visitType(ast.child(node, SLOT_C));
				return;

			case N_ThisExpression:
				this.builder.detectThis();
				return;

			case N_LabeledStatement:
				this.visit(ast.child(node, SLOT_B));
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
				this.visit(ast.child(node, SLOT_A));
				this.visit(ast.child(node, SLOT_B));
				this.visitType(ast.child(node, SLOT_C));
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
					const name = ast.name(node);

					// `this` in a JSX name is the keyword, not a variable.
					if (name !== "this") {
						this.builder.referenceRead(node, name);
					}
				}

				return;

			case N_JSXMemberExpression:
				this.visit(ast.child(node, SLOT_A));
				return;

			case N_JSXNamespacedName:
				this.visit(ast.child(node, SLOT_A));
				this.visit(ast.child(node, SLOT_B));
				return;

			case N_JSXAttribute:
				this.visit(ast.child(node, SLOT_B));
				return;

			case N_JSXExpressionContainer:
				this.visit(ast.child(node, SLOT_A));
				return;

			case N_TSAsExpression:
			case N_TSSatisfiesExpression:
				this.visit(ast.child(node, SLOT_A));
				this.visitType(ast.child(node, SLOT_B));
				return;

			case N_TSTypeAssertion:
				this.visit(ast.child(node, SLOT_B));
				this.visitType(ast.child(node, SLOT_A));
				return;

			case N_TSInstantiationExpression:
				this.visit(ast.child(node, SLOT_A));
				this.visitType(ast.child(node, SLOT_B));
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
				this.builder.nestClassStaticBlockScope(node);
				this.visitList(node, SLOT_A);
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
	 * @param node The `Program` node.
	 * @returns Nothing.
	 */
	private visitProgram(node: TNode): void {
		const builder = this.builder;

		builder.nestGlobalScope(node);

		/*
		 * A CommonJS module runs inside a function, so `return` is legal at
		 * the top level and the global scope itself is never strict.
		 */
		if (builder.isGlobalReturn()) {
			builder.setStrict(false);
			builder.nestFunctionScope(node, false);
		}

		if (builder.isModule()) {
			builder.nestModuleScope(node);
		}

		if (builder.isImpliedStrict()) {
			builder.setStrict(true);
		}

		this.visitList(node, SLOT_A);
		this.close(node);
	}

	/**
	 * Visits a variable declaration, binding each name it introduces.
	 * @param node The `VariableDeclaration` node.
	 * @returns Nothing.
	 */
	private visitVariableDeclaration(node: TNode): void {
		const ast = this.ast;
		const kindName = ast.declarationKind(node);
		const target =
			kindName === "var"
				? this.builder.currentVariableScope()
				: this.builder.currentScope();
		const size = ast.listSize(node, SLOT_A);

		for (let index = 0; index < size; index++) {
			const declarator = ast.listItem(node, SLOT_A, index);

			if (declarator === null) {
				continue;
			}

			const id = ast.child(declarator, SLOT_A);
			const init = ast.child(declarator, SLOT_B);

			this.visitPattern(
				id,
				(pattern, info) => {
					const name = ast.name(pattern);

					this.builder.defineVariable(
						target,
						pattern,
						name,
						declarator,
						node,
						index,
						kindName,
					);

					this.referencingDefaultValue(
						pattern,
						info.assignments,
						null,
						true,
					);

					if (init !== null) {
						this.builder.referenceValue(
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
			this.visitType(typeAnnotationOf(ast, id));
		}
	}

	/**
	 * Visits an assignment, which either writes names or writes a property.
	 * @param node The `AssignmentExpression` node.
	 * @returns Nothing.
	 */
	private visitAssignment(node: TNode): void {
		const ast = this.ast;
		const right = ast.child(node, SLOT_B);
		const left = this.expressionTarget(ast.child(node, SLOT_A));

		if (left !== null && isPatternKind(ast.kind(left))) {
			if (ast.isSimpleAssignment(node)) {
				this.visitPattern(
					left,
					(pattern, info) => {
						const name = ast.name(pattern);

						/*
						 * Outside strict mode an assignment to an undeclared
						 * name creates a global, so the global scope has to
						 * hear about it even though nothing declared it.
						 */
						const implicitNode = this.builder.isStrict()
							? null
							: node;

						this.referencingDefaultValue(
							pattern,
							info.assignments,
							implicitNode,
							false,
						);
						this.builder.referenceValue(
							pattern,
							name,
							WRITE,
							right,
							implicitNode,
							!info.topLevel,
							false,
						);
					},
					true,
				);
			} else if (ast.kind(left) === N_Identifier) {
				this.builder.referenceValue(
					left,
					ast.name(left),
					READ_WRITE,
					right,
					null,
					false,
					false,
				);
			}
		} else {
			this.visit(left);
		}

		this.visit(right);
	}

	/**
	 * Visits an increment or decrement, which reads and writes at once.
	 * @param node The `UpdateExpression` node.
	 * @returns Nothing.
	 */
	private visitUpdate(node: TNode): void {
		const ast = this.ast;
		const argument = this.expressionTarget(ast.child(node, SLOT_A));

		if (argument !== null && ast.kind(argument) === N_Identifier) {
			this.builder.referenceValue(
				argument,
				ast.name(argument),
				READ_WRITE,
				null,
				null,
				false,
				false,
			);
		} else {
			this.visit(argument);
		}
	}

	/**
	 * Looks through the TypeScript expressions that wrap an assignment target
	 * without changing what is being written to.
	 * @param node The node the assignment names, or `null`.
	 * @returns The expression underneath, with one type wrapper removed.
	 */
	private expressionTarget(node: TNode | null): TNode | null {
		if (node === null) {
			return null;
		}

		const ast = this.ast;
		const kind = ast.kind(node);

		if (kind === N_TSAsExpression) {
			this.visitType(ast.child(node, SLOT_B));

			return ast.child(node, SLOT_A);
		}

		if (kind === N_TSTypeAssertion) {
			this.visitType(ast.child(node, SLOT_A));

			return ast.child(node, SLOT_B);
		}

		if (kind === N_TSNonNullExpression) {
			return ast.child(node, SLOT_A);
		}

		return node;
	}

	/**
	 * Visits a `catch` clause, binding its parameter in a scope of its own.
	 * @param node The `CatchClause` node.
	 * @returns Nothing.
	 */
	private visitCatchClause(node: TNode): void {
		const ast = this.ast;
		const param = ast.child(node, SLOT_A);

		this.builder.nestCatchScope(node);

		this.visitPattern(
			param,
			(pattern, info) => {
				this.builder.defineCatchClause(
					pattern,
					ast.name(pattern),
					node,
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

		this.visit(ast.child(node, SLOT_B));
		this.close(node);
	}

	/**
	 * Visits a `for` statement, which gets a scope of its own only when it
	 * declares block-scoped names.
	 * @param node The `ForStatement` node.
	 * @returns Nothing.
	 */
	private visitFor(node: TNode): void {
		const ast = this.ast;
		const init = ast.child(node, SLOT_A);

		if (init !== null && isLexicalDeclaration(ast, init)) {
			this.builder.nestForScope(node);
		}

		this.visit(init);
		this.visit(ast.child(node, SLOT_B));
		this.visit(ast.child(node, SLOT_C));
		this.visit(ast.child(node, SLOT_D));
		this.close(node);
	}

	/**
	 * Visits a `for-in` or `for-of` statement, whose left side is written on
	 * every iteration.
	 * @param node The loop node.
	 * @returns Nothing.
	 */
	private visitForIn(node: TNode): void {
		const ast = this.ast;
		const left = ast.child(node, SLOT_A);
		const right = ast.child(node, SLOT_B);
		const isDeclaration =
			left !== null && ast.kind(left) === N_VariableDeclaration;

		if (isDeclaration && isLexicalDeclaration(ast, left)) {
			this.builder.nestForScope(node);
		}

		if (isDeclaration) {
			this.visit(left);

			const first = ast.listItem(left, SLOT_A, 0);

			if (first !== null) {
				this.visitPattern(ast.child(first, SLOT_A), pattern => {
					this.builder.referenceValue(
						pattern,
						ast.name(pattern),
						WRITE,
						right,
						null,
						true,
						true,
					);
				});
			}
		} else {
			this.visitPattern(
				left,
				(pattern, info) => {
					const implicitNode = this.builder.isStrict() ? null : node;

					this.referencingDefaultValue(
						pattern,
						info.assignments,
						implicitNode,
						false,
					);
					this.builder.referenceValue(
						pattern,
						ast.name(pattern),
						WRITE,
						right,
						implicitNode,
						true,
						false,
					);
				},
				true,
			);
		}

		this.visit(right);
		this.visit(ast.child(node, SLOT_C));
		this.close(node);
	}

	/**
	 * Visits a call, noticing a direct call to `eval`.
	 * @param node The `CallExpression` node.
	 * @returns Nothing.
	 */
	private visitCall(node: TNode): void {
		const ast = this.ast;
		const callee = ast.child(node, SLOT_A);

		/*
		 * A direct `eval` can introduce bindings at runtime, which is what
		 * makes every enclosing scope dynamic. It is the variable scope that
		 * is marked, because that is where `var` declarations from the
		 * evaluated code would land.
		 */
		if (
			!this.ignoreEval &&
			callee !== null &&
			ast.kind(callee) === N_Identifier &&
			ast.name(callee) === "eval"
		) {
			this.builder.detectEval();
		}

		this.visit(callee);
		this.visitList(node, SLOT_B);
		this.visitType(ast.child(node, SLOT_C));
	}

	//-------------------------------------------------------------------------
	// Functions
	//-------------------------------------------------------------------------

	/**
	 * Visits a function, binding its name and parameters.
	 * @param node The function node.
	 * @param kind The function's node kind.
	 * @param isMethod Whether the function is a method body, which is strict
	 *      no matter what encloses it, and whose parameter decorators are
	 *      evaluated outside the function rather than inside it.
	 * @returns Nothing.
	 */
	private visitFunction(node: TNode, kind: number, isMethod: boolean): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);

		/*
		 * A function declaration binds its name where it is written, while a
		 * named function expression binds its name only inside itself, in a
		 * scope that exists for nothing else.
		 */
		if (kind === N_FunctionExpression) {
			if (id !== null) {
				this.builder.nestFunctionExpressionNameScope(node);
				this.builder.defineFunctionName(id, ast.name(id), node);
			}
		} else if (id !== null && kind !== N_ArrowFunctionExpression) {
			this.builder.defineFunctionName(id, ast.name(id), node);
		}

		/*
		 * A decorator on a method's parameter is evaluated where the class is
		 * defined, not where the method runs, so it is referenced before the
		 * function scope opens. On a plain function the reference happens
		 * inside, right after the parameter it decorates.
		 */
		if (isMethod) {
			this.visitParameterDecorators(node);
		}

		this.builder.nestFunctionScope(node, isMethod);
		this.visitParameters(node, !isMethod);
		this.visitType(ast.child(node, SLOT_E));
		this.visitType(ast.child(node, SLOT_D));

		const body = ast.child(node, SLOT_C);

		if (body !== null) {
			/*
			 * The body's own block scope is skipped: a function body and its
			 * parameters share one scope.
			 */
			if (ast.kind(body) === N_BlockStatement) {
				this.visitList(body, SLOT_A);
			} else {
				this.visit(body);
			}
		}

		this.close(node);
	}

	/**
	 * Binds every parameter of a function.
	 * @param node The function node.
	 * @param withDecorators Whether each parameter's decorators should be
	 *      visited here.
	 * @returns Nothing.
	 */
	private visitParameters(node: TNode, withDecorators: boolean): void {
		const ast = this.ast;
		const size = ast.listSize(node, SLOT_B);

		for (let index = 0; index < size; index++) {
			const param = ast.listItem(node, SLOT_B, index);

			if (param === null) {
				continue;
			}

			this.visitPattern(
				param,
				(pattern, info) => {
					this.builder.defineParameter(
						pattern,
						ast.name(pattern),
						node,
						index,
						info.rest,
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

			if (withDecorators) {
				this.visitParameterDecoratorsOf(param);
			}
		}
	}

	/**
	 * Visits the decorators of every parameter of a function, without binding
	 * the parameters themselves.
	 * @param node The function node.
	 * @returns Nothing.
	 */
	private visitParameterDecorators(node: TNode): void {
		const ast = this.ast;
		const size = ast.listSize(node, SLOT_B);

		for (let index = 0; index < size; index++) {
			const param = ast.listItem(node, SLOT_B, index);

			if (param !== null) {
				this.visitParameterDecoratorsOf(param);
			}
		}
	}

	/**
	 * Visits the decorators attached to one parameter.
	 * @param param The parameter node.
	 * @returns Nothing.
	 */
	private visitParameterDecoratorsOf(param: TNode): void {
		const size = this.ast.parameterDecoratorSize(param);

		for (let i = 0; i < size; i++) {
			this.visit(this.ast.parameterDecoratorAt(param, i));
		}
	}

	/**
	 * Visits the type annotation of a parameter, wherever the annotation
	 * hides.
	 * @param param The parameter node.
	 * @returns Nothing.
	 */
	private visitParameterTypeAnnotation(param: TNode): void {
		const ast = this.ast;
		const kind = ast.kind(param);

		if (kind === N_AssignmentPattern) {
			this.visitType(typeAnnotationOf(ast, ast.child(param, SLOT_A)));
		} else if (kind === N_TSParameterProperty) {
			const inner = ast.child(param, SLOT_A);

			if (inner !== null) {
				this.visitParameterTypeAnnotation(inner);
			}
		} else {
			this.visitType(typeAnnotationOf(ast, param));
		}
	}

	//-------------------------------------------------------------------------
	// Classes
	//-------------------------------------------------------------------------

	/**
	 * Visits a class, which binds its own name twice: once outside, so that
	 * the declaration is visible, and once inside, so that the body can refer
	 * to the class without seeing a later rebinding.
	 * @param node The class node.
	 * @param kind The class's node kind.
	 * @returns Nothing.
	 */
	private visitClass(node: TNode, kind: number): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);

		if (kind === N_ClassDeclaration && id !== null) {
			this.builder.defineClassName(id, ast.name(id), node);
		}

		this.visitList(node, SLOT_G);
		this.builder.nestClassScope(node);

		if (id !== null) {
			this.builder.defineClassName(id, ast.name(id), node);
		}

		this.visit(ast.child(node, SLOT_B));
		this.visitType(ast.child(node, SLOT_D));
		this.visitType(ast.child(node, SLOT_E));
		this.visitTypeList(node, SLOT_F);
		this.visitClassBody(ast.child(node, SLOT_C));
		this.close(node);
	}

	/**
	 * Visits the members of a class body.
	 * @param body The `ClassBody` node, or `null`.
	 * @returns Nothing.
	 */
	private visitClassBody(body: TNode | null): void {
		if (body === null || this.ast.kind(body) !== N_ClassBody) {
			return;
		}

		const size = this.ast.listSize(body, SLOT_A);

		for (let i = 0; i < size; i++) {
			const member = this.ast.listItem(body, SLOT_A, i);

			if (member !== null) {
				this.visitClassMember(member);
			}
		}
	}

	/**
	 * Visits one member of a class body.
	 * @param member The member node.
	 * @returns Nothing.
	 */
	private visitClassMember(member: TNode): void {
		switch (this.ast.kind(member)) {
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
				this.builder.nestClassStaticBlockScope(member);
				this.visitList(member, SLOT_A);
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
	 * @param member The member node.
	 * @param hasBody Whether the method's value is a function with a body.
	 * @returns Nothing.
	 */
	private visitMethod(member: TNode, hasBody: boolean): void {
		const ast = this.ast;
		const value = ast.child(member, SLOT_B);

		if (ast.computed(member)) {
			this.visit(ast.child(member, SLOT_A));
		}

		if (
			hasBody &&
			value !== null &&
			ast.kind(value) === N_FunctionExpression
		) {
			this.visitFunction(value, N_FunctionExpression, true);
		} else {
			this.visit(value);
		}

		this.visitList(member, SLOT_C);
	}

	/**
	 * Visits a class field, whose initializer runs in a scope of its own.
	 * @param member The member node.
	 * @param hasInitializerScope Whether the initializer gets its own scope,
	 *      which an abstract declaration does not because it never runs.
	 * @returns Nothing.
	 */
	private visitClassProperty(
		member: TNode,
		hasInitializerScope: boolean,
	): void {
		const ast = this.ast;
		const value = ast.child(member, SLOT_B);

		if (ast.computed(member)) {
			this.visit(ast.child(member, SLOT_A));
		}

		if (value !== null) {
			if (hasInitializerScope) {
				this.builder.nestClassFieldInitializerScope(value);
			}

			this.visit(value);

			if (hasInitializerScope) {
				this.close(value);
			}
		}

		this.visitList(member, SLOT_C);
		this.visitType(ast.child(member, SLOT_D));
	}

	/**
	 * Visits an object literal property's key and value.
	 * @param node The `Property` node.
	 * @returns Nothing.
	 */
	private visitPropertyLike(node: TNode): void {
		// An ordinary key is a property name, not a variable.
		if (this.ast.computed(node)) {
			this.visit(this.ast.child(node, SLOT_A));
		}

		this.visit(this.ast.child(node, SLOT_B));
	}

	//-------------------------------------------------------------------------
	// Modules
	//-------------------------------------------------------------------------

	/**
	 * Visits an import declaration, binding every name it brings in.
	 * @param node The `ImportDeclaration` node.
	 * @returns Nothing.
	 */
	private visitImportDeclaration(node: TNode): void {
		const ast = this.ast;
		const size = ast.listSize(node, SLOT_A);

		for (let i = 0; i < size; i++) {
			const specifier = ast.listItem(node, SLOT_A, i);

			if (specifier === null) {
				continue;
			}

			/*
			 * The local name is the last slot on an `ImportSpecifier` and the
			 * only one on the default and namespace forms.
			 */
			const local = ast.child(
				specifier,
				ast.kind(specifier) === N_ImportSpecifier ? SLOT_B : SLOT_A,
			);

			if (local === null) {
				continue;
			}

			this.builder.defineImportBinding(
				local,
				ast.name(local),
				specifier,
				node,
			);
		}
	}

	/**
	 * Visits a named export, which either declares something or names things
	 * declared elsewhere.
	 * @param node The `ExportNamedDeclaration` node.
	 * @returns Nothing.
	 */
	private visitExportNamed(node: TNode): void {
		const ast = this.ast;

		// `export { x } from "m"` names nothing in this program.
		if (ast.child(node, SLOT_C) !== null) {
			return;
		}

		const declaration = ast.child(node, SLOT_A);

		if (declaration !== null) {
			this.visit(declaration);
			return;
		}

		const typeOnly = ast.typeOnly(node);
		const size = ast.listSize(node, SLOT_B);

		for (let i = 0; i < size; i++) {
			const specifier = ast.listItem(node, SLOT_B, i);

			if (specifier === null) {
				continue;
			}

			const local = ast.child(specifier, SLOT_A);

			if (local === null || ast.kind(local) !== N_Identifier) {
				continue;
			}

			this.referenceExportedName(
				local,
				typeOnly || ast.typeOnly(specifier),
			);
		}
	}

	/**
	 * Visits a default export.
	 * @param node The `ExportDefaultDeclaration` node.
	 * @returns Nothing.
	 */
	private visitExportDefault(node: TNode): void {
		const ast = this.ast;
		const declaration = ast.child(node, SLOT_A);

		if (declaration === null) {
			return;
		}

		if (ast.kind(declaration) === N_Identifier) {
			this.referenceExportedName(declaration, ast.typeOnly(node));
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
	private referenceExportedName(local: TNode, typeOnly: boolean): void {
		const name = this.ast.name(local);

		if (!this.typescript) {
			this.builder.referenceRead(local, name);
			return;
		}

		if (typeOnly) {
			this.builder.referenceType(local, name);
		} else {
			this.builder.referenceDualValueType(local, name);
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
	 * @param node The `JSXElement` node.
	 * @returns Nothing.
	 */
	private visitJsxElement(node: TNode): void {
		if (!this.jsx) {
			this.visitChildren(node, N_JSXElement);
			return;
		}

		this.visit(this.ast.child(node, SLOT_A));
		this.visitList(node, SLOT_C);
	}

	/**
	 * Visits a JSX fragment.
	 * @param node The `JSXFragment` node.
	 * @returns Nothing.
	 */
	private visitJsxFragment(node: TNode): void {
		this.referenceJsxPragma();
		this.referenceJsxFragment();
		this.visitList(node, SLOT_C);
	}

	/**
	 * Visits a JSX opening tag.
	 *
	 * A lowercase tag name is a host element such as `div`, not a variable, so
	 * only a capitalized name or a member expression is referenced.
	 * @param node The `JSXOpeningElement` node.
	 * @returns Nothing.
	 */
	private visitJsxOpeningElement(node: TNode): void {
		const ast = this.ast;
		const name = ast.child(node, SLOT_A);

		this.referenceJsxPragma();

		if (this.jsx && name !== null) {
			const kind = ast.kind(name);

			if (kind === N_JSXMemberExpression) {
				this.visit(name);
			} else if (kind === N_JSXIdentifier) {
				const text = ast.name(name);

				if (text[0] === text[0].toUpperCase()) {
					this.visit(name);
				}
			}
		}

		this.visitType(ast.child(node, SLOT_D));
		this.visitList(node, SLOT_B);
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
		return this.builder.referenceIfDeclared(name);
	}

	//-------------------------------------------------------------------------
	// TypeScript Declarations
	//-------------------------------------------------------------------------

	/**
	 * Visits an enum, whose members are bound in a scope of their own so that
	 * one member can name another.
	 * @param node The `TSEnumDeclaration` node.
	 * @returns Nothing.
	 */
	private visitEnum(node: TNode): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);

		if (id !== null) {
			this.builder.defineEnumName(id, ast.name(id), node);
		}

		this.builder.nestTSEnumScope(node);

		const body = ast.child(node, SLOT_B);

		if (body !== null) {
			const size = ast.listSize(body, SLOT_A);

			for (let i = 0; i < size; i++) {
				const member = ast.listItem(body, SLOT_A, i);

				if (member === null) {
					continue;
				}

				this.visitEnumMember(member);
			}
		}

		this.close(node);
	}

	/**
	 * Binds one enum member and visits its initializer.
	 * @param member The `TSEnumMember` node.
	 * @returns Nothing.
	 */
	private visitEnumMember(member: TNode): void {
		const ast = this.ast;
		const id = ast.child(member, SLOT_A);

		if (id !== null) {
			const kind = ast.kind(id);

			if (kind === N_Identifier) {
				this.builder.defineEnumMember(id, ast.name(id), member);
			} else if (kind === N_Literal) {
				this.builder.defineEnumMemberLiteral(
					ast.literalString(id),
					id,
					member,
				);
			}
		}

		this.visit(ast.child(member, SLOT_B));
	}

	/**
	 * Visits a namespace or module declaration.
	 * @param node The `TSModuleDeclaration` node.
	 * @returns Nothing.
	 */
	private visitModuleDeclaration(node: TNode): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);

		/*
		 * `declare global` reopens the global scope rather than introducing a
		 * name, so there is nothing to bind.
		 */
		if (
			id !== null &&
			ast.kind(id) === N_Identifier &&
			!ast.isGlobalModule(node)
		) {
			this.builder.defineModuleName(id, ast.name(id), node);
		}

		this.builder.nestTSModuleScope(node);
		this.visit(ast.child(node, SLOT_B));
		this.close(node);
	}

	/**
	 * Visits an `import x = require("m")` declaration.
	 * @param node The `TSImportEqualsDeclaration` node.
	 * @returns Nothing.
	 */
	private visitImportEquals(node: TNode): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);

		if (id !== null) {
			this.builder.defineImportBinding(id, ast.name(id), node, node);
		}

		let reference = ast.child(node, SLOT_B);

		// Only the leftmost name of `A.B.C` is a variable.
		while (
			reference !== null &&
			ast.kind(reference) === N_TSQualifiedName
		) {
			reference = ast.child(reference, SLOT_A);
		}

		this.visit(reference);
	}

	/**
	 * Visits an `export = x` assignment.
	 * @param node The `TSExportAssignment` node.
	 * @returns Nothing.
	 */
	private visitExportAssignment(node: TNode): void {
		const ast = this.ast;
		const expression = ast.child(node, SLOT_A);

		if (expression !== null && ast.kind(expression) === N_Identifier) {
			this.builder.referenceDualValueType(
				expression,
				ast.name(expression),
			);
			return;
		}

		this.visit(expression);
	}

	//-------------------------------------------------------------------------
	// Types
	//-------------------------------------------------------------------------

	/**
	 * Visits every element of a slot's list as type nodes.
	 * @param node The node holding the list.
	 * @param slot The slot the list is in.
	 * @returns Nothing.
	 */
	private visitTypeList(node: TNode, slot: number): void {
		const size = this.ast.listSize(node, slot);

		for (let i = 0; i < size; i++) {
			this.visitType(this.ast.listItem(node, slot, i));
		}
	}

	/**
	 * Visits a node in type position, where a name means a type rather than a
	 * value.
	 * @param node The node, or `null` for no node.
	 * @returns Nothing.
	 */
	private visitType(node: TNode | null): void {
		if (node === null) {
			return;
		}

		const ast = this.ast;
		const kind = ast.kind(node);

		switch (kind) {
			case N_Identifier:
				this.builder.referenceType(node, ast.name(node));
				return;

			case N_MemberExpression:
			case N_TSQualifiedName:
				// Only the leftmost name of `A.B.C` names anything bound.
				this.visitType(ast.child(node, SLOT_A));
				return;

			case N_TSFunctionType:
			case N_TSConstructorType:
			case N_TSCallSignatureDeclaration:
			case N_TSConstructSignatureDeclaration:
				this.visitFunctionType(node, SLOT_A, SLOT_B, SLOT_C);
				return;

			case N_TSMethodSignature:
				this.visitPropertyKey(node);
				this.visitFunctionType(node, SLOT_B, SLOT_C, SLOT_D);
				return;

			case N_TSPropertySignature:
				this.visitPropertyKey(node);
				this.visitType(ast.child(node, SLOT_B));
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
				this.visitType(ast.child(node, SLOT_B));
				return;

			case N_TSImportType:
				this.visitType(ast.child(node, SLOT_C));
				return;

			default:
				this.visitTypeChildren(node, kind);
		}
	}

	/**
	 * Visits every child of a type node that has no rule of its own.
	 * @param node The node.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitTypeChildren(node: TNode, kind: number): void {
		if (kind === 0) {
			const children = this.ast.unknownChildren(node);

			for (let i = 0; i < children.length; i++) {
				this.visitType(children[i]);
			}

			return;
		}

		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visitType(this.ast.child(node, slot));
			} else if (descriptor === SLOT_LIST) {
				this.visitTypeList(node, slot);
			}
		}
	}

	/**
	 * Visits a computed key in a type member, which is ordinary code.
	 * @param node The member node.
	 * @returns Nothing.
	 */
	private visitPropertyKey(node: TNode): void {
		if (this.ast.computed(node)) {
			this.visit(this.ast.child(node, SLOT_A));
		}
	}

	/**
	 * Visits a function type, whose parameters are bound in a scope of their
	 * own so that a type parameter can be named by a later parameter.
	 * @param node The function type node.
	 * @param paramsSlot The slot holding the parameter list.
	 * @param returnTypeSlot The slot holding the return type.
	 * @param typeParametersSlot The slot holding the type parameters.
	 * @returns Nothing.
	 */
	private visitFunctionType(
		node: TNode,
		paramsSlot: number,
		returnTypeSlot: number,
		typeParametersSlot: number,
	): void {
		const ast = this.ast;

		this.builder.nestFunctionTypeScope(node);
		this.visitType(ast.child(node, typeParametersSlot));

		const size = ast.listSize(node, paramsSlot);

		for (let index = 0; index < size; index++) {
			const param = ast.listItem(node, paramsSlot, index);

			if (param === null) {
				continue;
			}

			let visitedAnnotation = false;

			this.visitPattern(param, (pattern, info) => {
				this.builder.defineParameter(
					pattern,
					ast.name(pattern),
					node,
					index,
					info.rest,
				);

				const annotation = typeAnnotationOf(ast, pattern);

				if (annotation !== null) {
					this.visitType(annotation);
					visitedAnnotation = true;
				}
			});

			if (!visitedAnnotation) {
				this.visitType(typeAnnotationOf(ast, param));
			}
		}

		this.visitType(ast.child(node, returnTypeSlot));
		this.close(node);
	}

	/**
	 * Visits a conditional type. Its `infer` names are visible in the true
	 * branch but not in the false one, which is why the false branch is
	 * visited after the scope closes.
	 * @param node The `TSConditionalType` node.
	 * @returns Nothing.
	 */
	private visitConditionalType(node: TNode): void {
		const ast = this.ast;

		this.builder.nestConditionalTypeScope(node);
		this.visitType(ast.child(node, SLOT_A));
		this.visitType(ast.child(node, SLOT_B));
		this.visitType(ast.child(node, SLOT_C));
		this.close(node);
		this.visitType(ast.child(node, SLOT_D));
	}

	/**
	 * Visits a mapped type, whose key is bound for the rest of the type.
	 * @param node The `TSMappedType` node.
	 * @returns Nothing.
	 */
	private visitMappedType(node: TNode): void {
		const ast = this.ast;
		const key = ast.mappedTypeKey(node);

		this.builder.nestMappedTypeScope(node);

		if (key !== null) {
			this.builder.defineType(
				this.builder.currentScope(),
				key,
				ast.name(key),
				node,
			);
		}

		this.visitType(ast.mappedTypeConstraint(node));
		this.visitType(ast.child(node, SLOT_C));
		this.visitType(ast.child(node, SLOT_D));
		this.close(node);
	}

	/**
	 * Visits an `infer T`, binding `T` where it can be referred to.
	 * @param node The `TSInferType` node.
	 * @returns Nothing.
	 */
	private visitInferType(node: TNode): void {
		const ast = this.ast;
		const typeParameter = ast.child(node, SLOT_A);

		if (typeParameter === null) {
			return;
		}

		const name = ast.child(typeParameter, SLOT_A);
		const builder = this.builder;
		let scope = builder.currentScope();

		/*
		 * An `infer` inside a function or mapped type nested in a conditional
		 * type belongs to the conditional type, since that is where the name
		 * can be referred to from.
		 */
		if (
			builder.scopeType(scope) === SCOPE_FUNCTION_TYPE ||
			builder.scopeType(scope) === SCOPE_MAPPED_TYPE
		) {
			let current = builder.upperOf(scope);

			while (current !== -1) {
				const type = builder.scopeType(current);

				if (
					type === SCOPE_FUNCTION_TYPE ||
					type === SCOPE_MAPPED_TYPE
				) {
					current = builder.upperOf(current);
					continue;
				}

				if (type === SCOPE_CONDITIONAL_TYPE) {
					scope = current;
				}

				break;
			}
		}

		if (name !== null) {
			builder.defineType(scope, name, ast.name(name), typeParameter);
		}

		this.visitType(ast.child(typeParameter, SLOT_B));
	}

	/**
	 * Visits a type parameter declaration.
	 * @param node The `TSTypeParameter` node.
	 * @returns Nothing.
	 */
	private visitTypeParameter(node: TNode): void {
		const ast = this.ast;
		const name = ast.child(node, SLOT_A);

		if (name !== null) {
			this.builder.defineType(
				this.builder.currentScope(),
				name,
				ast.name(name),
				node,
			);
		}

		this.visitType(ast.child(node, SLOT_B));
		this.visitType(ast.child(node, SLOT_C));
	}

	/**
	 * Visits an interface declaration.
	 * @param node The `TSInterfaceDeclaration` node.
	 * @returns Nothing.
	 */
	private visitInterfaceDeclaration(node: TNode): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);
		const typeParameters = ast.child(node, SLOT_C);

		if (id !== null) {
			this.builder.defineType(
				this.builder.currentScope(),
				id,
				ast.name(id),
				node,
			);
		}

		// The scope exists only to hold type parameters, so it is optional.
		if (typeParameters !== null) {
			this.builder.nestTypeScope(node);
			this.visitType(typeParameters);
		}

		this.visitTypeList(node, SLOT_D);
		this.visitType(ast.child(node, SLOT_B));

		if (typeParameters !== null) {
			this.close(node);
		}
	}

	/**
	 * Visits a type alias declaration.
	 * @param node The `TSTypeAliasDeclaration` node.
	 * @returns Nothing.
	 */
	private visitTypeAliasDeclaration(node: TNode): void {
		const ast = this.ast;
		const id = ast.child(node, SLOT_A);
		const typeParameters = ast.child(node, SLOT_C);

		if (id !== null) {
			this.builder.defineType(
				this.builder.currentScope(),
				id,
				ast.name(id),
				node,
			);
		}

		if (typeParameters !== null) {
			this.builder.nestTypeScope(node);
			this.visitType(typeParameters);
		}

		this.visitType(ast.child(node, SLOT_B));

		if (typeParameters !== null) {
			this.close(node);
		}
	}

	/**
	 * Visits an index signature, whose parameter names nothing.
	 * @param node The `TSIndexSignature` node.
	 * @returns Nothing.
	 */
	private visitIndexSignature(node: TNode): void {
		const ast = this.ast;
		const size = ast.listSize(node, SLOT_A);

		for (let i = 0; i < size; i++) {
			const parameter = ast.listItem(node, SLOT_A, i);

			if (parameter !== null && ast.kind(parameter) === N_Identifier) {
				this.visitType(typeAnnotationOf(ast, parameter));
			}
		}

		this.visitType(ast.child(node, SLOT_B));
	}

	/**
	 * Visits a `typeof x` type, where the name is a value even though the
	 * position is a type.
	 * @param node The `TSTypeQuery` node.
	 * @returns Nothing.
	 */
	private visitTypeQuery(node: TNode): void {
		const ast = this.ast;
		const exprName = ast.child(node, SLOT_A);
		let entityName = exprName;

		if (exprName !== null && ast.kind(exprName) === N_TSQualifiedName) {
			let left = ast.child(exprName, SLOT_A);

			while (left !== null && ast.kind(left) === N_TSQualifiedName) {
				left = ast.child(left, SLOT_A);
			}

			entityName = left;
		} else if (exprName !== null && ast.kind(exprName) === N_TSImportType) {
			this.visitType(exprName);
		}

		if (entityName !== null && ast.kind(entityName) === N_Identifier) {
			this.builder.referenceRead(entityName, ast.name(entityName));
		}

		this.visitType(ast.child(node, SLOT_B));
	}

	/**
	 * Visits a type predicate, whose parameter name is a value.
	 * @param node The `TSTypePredicate` node.
	 * @returns Nothing.
	 */
	private visitTypePredicate(node: TNode): void {
		const ast = this.ast;
		const parameterName = ast.child(node, SLOT_A);

		if (
			parameterName !== null &&
			ast.kind(parameterName) !== N_TSThisType
		) {
			this.builder.referenceRead(parameterName, ast.name(parameterName));
		}

		this.visitType(ast.child(node, SLOT_B));
	}
}

/**
 * The type annotation attached to a binding, if the binding can carry one.
 * @param ast How to read the program.
 * @param node The binding node, or `null`.
 * @returns The `TSTypeAnnotation` node, or `null`.
 */
function typeAnnotationOf<TNode>(
	ast: AstAccess<TNode>,
	node: TNode | null,
): TNode | null {
	if (node === null) {
		return null;
	}

	switch (ast.kind(node)) {
		case N_Identifier:
		case N_ArrayPattern:
		case N_ObjectPattern:
		case N_RestElement:
			return ast.child(node, SLOT_B);

		default:
			return null;
	}
}

/**
 * Reports whether a declaration binds names that a loop's own scope should
 * hold, which `var` does not.
 * @param ast How to read the program.
 * @param node The node in the loop's initializer position.
 * @returns `true` for a `let`, `const`, or `using` declaration.
 */
function isLexicalDeclaration<TNode>(
	ast: AstAccess<TNode>,
	node: TNode,
): boolean {
	return (
		ast.kind(node) === N_VariableDeclaration &&
		ast.declarationKind(node) !== "var"
	);
}
