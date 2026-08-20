/**
 * @fileoverview The result of an analysis: every scope, and the index that
 * makes them findable.
 */

import { N_ArrowFunctionExpression, type AstReader } from "../parse/index.js";
import type { AstAccess } from "./ast-access.js";
import type { ResolvedOptions } from "./options.js";
import {
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FOR,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_FUNCTION_TYPE,
	SCOPE_GLOBAL,
	SCOPE_MAPPED_TYPE,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
	SCOPE_WITH,
	type ScopeType,
} from "./kinds.js";
import { Scope } from "./scope.js";
import type { Variable } from "./variable.js";

/**
 * Every scope found in a program, and the maps that make them findable.
 *
 * A node is whatever the analysis represents one with — an index into a binary
 * buffer, or an ESTree object — and both work as `Map` keys, so the two
 * lookups below are the same code either way.
 *
 * @template TNode How one node is represented.
 */
export class ScopeManager<TNode> {
	/** Every scope, in the order they were created. */
	readonly scopes: Scope<TNode>[] = [];

	/** The outermost scope. */
	globalScope: Scope<TNode> | null = null;

	/** The scope being filled in right now, or `null` once analysis ends. */
	currentScope: Scope<TNode> | null = null;

	/** How to read the program the scopes describe. */
	readonly ast: AstAccess<TNode>;

	/**
	 * The reader over the binary buffer, when the analysis ran on one.
	 * `analyzeTree()` leaves this `null`, since there is no buffer to read.
	 */
	reader: AstReader | null = null;

	/** The options the analysis ran with. */
	readonly options: ResolvedOptions;

	/** Every scope a node opened. */
	private readonly nodeToScope = new Map<TNode, Scope<TNode>[]>();

	/** Every variable a node declares. */
	private readonly declaredVariables = new Map<TNode, Variable<TNode>[]>();

	/**
	 * Creates an empty manager.
	 * @param ast How to read the program to analyze.
	 * @param options The options the analysis runs with.
	 */
	constructor(ast: AstAccess<TNode>, options: ResolvedOptions) {
		this.ast = ast;
		this.options = options;
	}

	//-------------------------------------------------------------------------
	// Registration
	//-------------------------------------------------------------------------

	/**
	 * Files a newly created scope. Called by the `Scope` constructor.
	 * @param scope The scope to file.
	 * @returns Nothing.
	 */
	register(scope: Scope<TNode>): void {
		this.scopes.push(scope);

		const existing = this.nodeToScope.get(scope.block);

		if (existing === undefined) {
			this.nodeToScope.set(scope.block, [scope]);
		} else {
			existing.push(scope);
		}
	}

	/**
	 * Records that a node declares a variable.
	 * @param variable The variable being declared.
	 * @param node The declaring node, or `null` for no node.
	 * @returns Nothing.
	 */
	addDeclaredVariable(variable: Variable<TNode>, node: TNode | null): void {
		if (node === null) {
			return;
		}

		const existing = this.declaredVariables.get(node);

		if (existing === undefined) {
			this.declaredVariables.set(node, [variable]);
		} else if (!existing.includes(variable)) {
			existing.push(variable);
		}
	}

	//-------------------------------------------------------------------------
	// Options
	//-------------------------------------------------------------------------

	/**
	 * Whether the program is an ES module.
	 * @returns `true` for `sourceType: "module"`.
	 */
	isModule(): boolean {
		return this.options.sourceType === "module";
	}

	/**
	 * Whether the program runs inside an implicit function, the way a CommonJS
	 * module does, so that `return` at the top level is legal.
	 * @returns `true` when an extra function scope wraps the program.
	 */
	isGlobalReturn(): boolean {
		return (
			this.options.globalReturn || this.options.sourceType === "commonjs"
		);
	}

	/**
	 * Whether strict mode applies without a directive saying so.
	 * @returns `true` when strict mode is implied.
	 */
	isImpliedStrict(): boolean {
		return this.options.impliedStrict;
	}

	//-------------------------------------------------------------------------
	// Queries
	//-------------------------------------------------------------------------

	/**
	 * The variables a node declares.
	 * @param node The node.
	 * @returns The variables, or an empty array when the node declares none.
	 */
	getDeclaredVariables(node: TNode): Variable<TNode>[] {
		return this.declaredVariables.get(node) ?? [];
	}

	/**
	 * Every node that declares variables, with the variables it declares.
	 *
	 * This exists for the serializer: the declared-variables map is built
	 * incrementally during the walk and cannot be reproduced from the rest of
	 * the graph without re-deriving its ordering, so it is read out here and
	 * stored in the buffer as its own index.
	 * @returns One entry per declaring node, in insertion order.
	 */
	declaredVariableEntries(): [TNode, Variable<TNode>[]][] {
		return [...this.declaredVariables.entries()];
	}

	/**
	 * The scope a node opened.
	 *
	 * A node can open more than one — a `Program` opens the global scope and,
	 * in a module, the module scope as well — so this picks the one a caller
	 * almost always means, skipping the scope that exists only to hold a
	 * function expression's name.
	 * @param node The node.
	 * @param inner Whether to prefer the innermost scope rather than the
	 *      outermost.
	 * @returns The scope, or `null` when the node opened none.
	 */
	acquire(node: TNode, inner = false): Scope<TNode> | null {
		const scopes = this.nodeToScope.get(node);

		if (scopes === undefined || scopes.length === 0) {
			return null;
		}

		if (scopes.length === 1) {
			return scopes[0];
		}

		if (inner) {
			for (let i = scopes.length - 1; i >= 0; i--) {
				if (!scopes[i].functionExpressionScope) {
					return scopes[i];
				}
			}

			return null;
		}

		for (let i = 0; i < scopes.length; i++) {
			if (!scopes[i].functionExpressionScope) {
				return scopes[i];
			}
		}

		return null;
	}

	/**
	 * Every scope a node opened.
	 * @param node The node.
	 * @returns The scopes, or `undefined` when the node opened none.
	 */
	acquireAll(node: TNode): Scope<TNode>[] | undefined {
		return this.nodeToScope.get(node);
	}

	/**
	 * The scope enclosing the one a node opened.
	 * @param node The node.
	 * @param inner Whether to prefer the innermost scope of the enclosing
	 *      node.
	 * @returns The enclosing scope, or `null` when there is none.
	 */
	release(node: TNode, inner = false): Scope<TNode> | null {
		const scopes = this.nodeToScope.get(node);

		if (scopes === undefined || scopes.length === 0) {
			return null;
		}

		const upper = scopes[0].upper;

		return upper === null ? null : this.acquire(upper.block, inner);
	}

	/**
	 * Declares names in the global scope and resolves whatever was waiting for
	 * them, which is how a host's globals are supplied after the fact.
	 * @param names The global names to declare.
	 * @returns Nothing.
	 */
	addGlobals(names: Iterable<string>): void {
		const globalScope = this.globalScope;

		if (globalScope === null) {
			return;
		}

		const added = new Set<string>();

		for (const name of names) {
			globalScope.defineVariable(
				name,
				globalScope.set,
				globalScope.variables,
				null,
				null,
			);
			globalScope.implicit!.set.delete(name);
			added.add(name);
		}

		globalScope.through = globalScope.through.filter(reference => {
			if (!added.has(reference.name)) {
				return true;
			}

			const variable = globalScope.set.get(reference.name)!;

			reference.resolved = variable;
			variable.addReference(reference);

			return false;
		});

		const implicit = globalScope.implicit!;

		implicit.variables = implicit.variables.filter(
			variable => !added.has(variable.name),
		);
		implicit.left = implicit.left.filter(
			reference => !added.has(reference.name),
		);
	}

	/**
	 * The ESTree type name of a node, for a caller holding an opaque node.
	 * @param node The node.
	 * @returns Its `type` string.
	 */
	nodeType(node: TNode): string {
		return this.ast.typeName(node);
	}

	/**
	 * The source extent of a node, for a caller holding an opaque node.
	 * @param node The node.
	 * @returns The start and end offsets.
	 */
	nodeRange(node: TNode): [number, number] {
		return [this.ast.start(node), this.ast.end(node)];
	}

	//-------------------------------------------------------------------------
	// Nesting
	//-------------------------------------------------------------------------

	/**
	 * Opens a scope inside the current one and makes it current.
	 * @param type The kind of scope to open.
	 * @param block The node of the syntax opening it.
	 * @param isMethodDefinition Whether the scope is a method body.
	 * @returns The new scope.
	 */
	private nest(
		type: ScopeType,
		block: TNode,
		isMethodDefinition = false,
	): Scope<TNode> {
		const scope = new Scope(
			this,
			type,
			this.currentScope,
			block,
			isMethodDefinition,
		);

		this.currentScope = scope;

		return scope;
	}

	/**
	 * Opens the global scope.
	 * @param block The `Program` node.
	 * @returns The global scope.
	 */
	nestGlobalScope(block: TNode): Scope<TNode> {
		const scope = this.nest(SCOPE_GLOBAL, block);

		this.globalScope = scope;

		return scope;
	}

	/**
	 * Opens a module scope.
	 * @param block The `Program` node.
	 * @returns The new scope.
	 */
	nestModuleScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_MODULE, block);
	}

	/**
	 * Opens a function scope.
	 * @param block The function node.
	 * @param isMethodDefinition Whether the function is a method body.
	 * @returns The new scope.
	 */
	nestFunctionScope(block: TNode, isMethodDefinition: boolean): Scope<TNode> {
		const scope = this.nest(SCOPE_FUNCTION, block, isMethodDefinition);

		/*
		 * Section 10.2.11, FunctionDeclarationInstantiation. An arrow function
		 * has no `arguments` object of its own, so a mention of the name in
		 * one belongs to the enclosing function.
		 */
		if (this.ast.kind(block) !== N_ArrowFunctionExpression) {
			scope.defineVariable(
				"arguments",
				scope.set,
				scope.variables,
				null,
				null,
			);
			scope.taints.set("arguments", true);
		}

		return scope;
	}

	/**
	 * Opens the scope that holds a named function expression's own name.
	 * @param block The `FunctionExpression` node.
	 * @returns The new scope.
	 */
	nestFunctionExpressionNameScope(block: TNode): Scope<TNode> {
		const scope = this.nest(SCOPE_FUNCTION_EXPRESSION_NAME, block);

		scope.functionExpressionScope = true;

		return scope;
	}

	/**
	 * Opens a block scope.
	 * @param block The `BlockStatement` node.
	 * @returns The new scope.
	 */
	nestBlockScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_BLOCK, block);
	}

	/**
	 * Opens a `switch` scope.
	 * @param block The `SwitchStatement` node.
	 * @returns The new scope.
	 */
	nestSwitchScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_SWITCH, block);
	}

	/**
	 * Opens a `catch` scope.
	 * @param block The `CatchClause` node.
	 * @returns The new scope.
	 */
	nestCatchScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_CATCH, block);
	}

	/**
	 * Opens a `with` scope.
	 * @param block The `WithStatement` node.
	 * @returns The new scope.
	 */
	nestWithScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_WITH, block);
	}

	/**
	 * Opens the scope of a `for` statement's own bindings.
	 * @param block The loop node.
	 * @returns The new scope.
	 */
	nestForScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_FOR, block);
	}

	/**
	 * Opens a class scope.
	 * @param block The class node.
	 * @returns The new scope.
	 */
	nestClassScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_CLASS, block);
	}

	/**
	 * Opens the scope a class field initializer runs in.
	 * @param block The initializer expression node.
	 * @returns The new scope.
	 */
	nestClassFieldInitializerScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_CLASS_FIELD_INITIALIZER, block, true);
	}

	/**
	 * Opens the scope of a `static` block.
	 * @param block The `StaticBlock` node.
	 * @returns The new scope.
	 */
	nestClassStaticBlockScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_CLASS_STATIC_BLOCK, block, true);
	}

	/**
	 * Opens the scope holding a type alias or interface's type parameters.
	 * @param block The declaration node.
	 * @returns The new scope.
	 */
	nestTypeScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_TYPE, block);
	}

	/**
	 * Opens the scope of a function type's parameters.
	 * @param block The function type node.
	 * @returns The new scope.
	 */
	nestFunctionTypeScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_FUNCTION_TYPE, block);
	}

	/**
	 * Opens the scope a conditional type's `infer` names belong to.
	 * @param block The `TSConditionalType` node.
	 * @returns The new scope.
	 */
	nestConditionalTypeScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_CONDITIONAL_TYPE, block);
	}

	/**
	 * Opens the scope of a mapped type's key.
	 * @param block The `TSMappedType` node.
	 * @returns The new scope.
	 */
	nestMappedTypeScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_MAPPED_TYPE, block);
	}

	/**
	 * Opens the scope of an enum's members.
	 * @param block The `TSEnumDeclaration` node.
	 * @returns The new scope.
	 */
	nestTSEnumScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_TS_ENUM, block);
	}

	/**
	 * Opens the scope of a namespace or module body.
	 * @param block The `TSModuleDeclaration` node.
	 * @returns The new scope.
	 */
	nestTSModuleScope(block: TNode): Scope<TNode> {
		return this.nest(SCOPE_TS_MODULE, block);
	}
}
