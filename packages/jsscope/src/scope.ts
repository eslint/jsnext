/**
 * @fileoverview One lexical scope, and the resolution that happens when it
 * closes.
 *
 * `eslint-scope` and `@typescript-eslint/scope-manager` both model the scope
 * types as a class hierarchy. Here there is one class and a `type` field. The
 * behavior that varies between scope types amounts to four branches — the
 * global scope's implicit variables, the `with` scope's tainted close, the
 * function scope's `arguments` binding and parameter-versus-body resolution
 * rule — and keeping every scope the same hidden class matters more on the hot
 * path than the tidier hierarchy would.
 */

import {
	NODE_A,
	NODE_B,
	NODE_C,
	N_ArrowFunctionExpression,
	N_BlockStatement,
	N_Program,
} from "jsparse";
import type { Definition } from "./definition.js";
import { implicitGlobalDefinition } from "./definition.js";
import {
	isImplicitlyStrictType,
	isVariableScopeType,
	READ,
	REF_TYPE,
	REF_VALUE,
	REF_VALUE_TYPE,
	SCOPE_BLOCK,
	SCOPE_FUNCTION,
	SCOPE_GLOBAL,
	SCOPE_SWITCH,
	SCOPE_WITH,
	type ScopeType,
} from "./kinds.js";
import { Reference, type MaybeImplicitGlobal } from "./reference.js";
import type { ScopeManager } from "./scope-manager.js";
import { Variable } from "./variable.js";

/**
 * The names an assignment created in the global scope without declaring them.
 */
export interface ImplicitGlobals {
	/** The implicit variables, by name. */
	set: Map<string, Variable>;

	/** The implicit variables, in the order they were created. */
	variables: Variable[];

	/** The references that never resolved to anything. */
	left: Reference[];
}

/**
 * One lexical scope.
 */
export class Scope {
	/** Which kind of scope this is. */
	readonly type: ScopeType;

	/** The variables bound here, by name. */
	readonly set = new Map<string, Variable>();

	/** The names a `with` statement could redirect. */
	readonly taints = new Map<string, boolean>();

	/**
	 * Whether what a reference means here can only be decided at runtime,
	 * which is true of the global scope, a `with` body, and anything
	 * containing a direct `eval`.
	 */
	dynamic: boolean;

	/** The node index of the syntax that opened the scope. */
	readonly block: number;

	/** The references that this scope could not resolve. */
	through: Reference[] = [];

	/** The variables bound here, in the order they were created. */
	readonly variables: Variable[] = [];

	/** Every occurrence written directly in this scope. */
	readonly references: Reference[] = [];

	/** The nearest enclosing scope that a `var` declaration binds in. */
	readonly variableScope: Scope;

	/** Whether this scope exists only to hold a function expression's name. */
	functionExpressionScope = false;

	/** Whether a direct call to `eval` appears in this scope. */
	directCallToEvalScope = false;

	/** Whether `this` is mentioned in this scope. */
	thisFound = false;

	/** The enclosing scope, or `null` for the global scope. */
	readonly upper: Scope | null;

	/** Whether strict mode rules apply here. */
	isStrict: boolean;

	/** The scopes directly inside this one. */
	readonly childScopes: Scope[] = [];

	/** The implicit global variables, on the global scope only. */
	readonly implicit: ImplicitGlobals | null;

	/**
	 * The references still waiting to be resolved, or `null` once the scope
	 * has closed.
	 */
	left: Reference[] | null = [];

	/** The manager that owns this scope. */
	private readonly scopeManager: ScopeManager;

	/**
	 * Creates a scope and registers it with its manager.
	 * @param scopeManager The manager that owns the scope.
	 * @param type Which kind of scope this is.
	 * @param upper The enclosing scope, or `null`.
	 * @param block The node index of the syntax that opened the scope.
	 * @param isMethodDefinition Whether the scope is a method body, which is
	 *      strict no matter what encloses it.
	 */
	constructor(
		scopeManager: ScopeManager,
		type: ScopeType,
		upper: Scope | null,
		block: number,
		isMethodDefinition: boolean,
	) {
		this.scopeManager = scopeManager;
		this.type = type;
		this.dynamic = type === SCOPE_GLOBAL || type === SCOPE_WITH;
		this.block = block;
		this.upper = upper;
		this.variableScope = isVariableScopeType(type)
			? this
			: upper!.variableScope;
		this.isStrict = isStrictScope(scopeManager, this, block, isMethodDefinition);
		this.implicit =
			type === SCOPE_GLOBAL
				? { set: new Map(), variables: [], left: [] }
				: null;

		if (upper !== null) {
			upper.childScopes.push(this);
		}

		scopeManager.register(this);
	}

	//-------------------------------------------------------------------------
	// Declaring
	//-------------------------------------------------------------------------

	/**
	 * Binds a name, creating the variable the first time the name is seen.
	 * @param name The name being bound.
	 * @param set Where to look the name up.
	 * @param variables Where to append a newly created variable.
	 * @param identifier The `Identifier` node index, or `0` when the binding
	 *      has no identifier of its own, as `arguments` does not.
	 * @param definition The declaration, or `null`.
	 * @returns The variable the name is bound to.
	 */
	defineVariable(
		name: string,
		set: Map<string, Variable>,
		variables: Variable[],
		identifier: number,
		definition: Definition | null,
	): Variable {
		let variable = set.get(name);

		if (variable === undefined) {
			variable = new Variable(name, this);
			set.set(name, variable);
			variables.push(variable);
		}

		if (definition !== null) {
			variable.defs.push(definition);
			this.scopeManager.addDeclaredVariable(variable, definition.node);
			this.scopeManager.addDeclaredVariable(variable, definition.parent);
		}

		if (identifier !== 0) {
			variable.identifiers.push(identifier);
		}

		return variable;
	}

	/**
	 * Binds the name an identifier spells.
	 * @param identifier The `Identifier` node index.
	 * @param name The name it spells.
	 * @param definition The declaration, or `null`.
	 * @returns Nothing.
	 */
	define(
		identifier: number,
		name: string,
		definition: Definition | null,
	): void {
		this.defineVariable(name, this.set, this.variables, identifier, definition);
	}

	/**
	 * Binds a name that a string literal spells, as `enum E { "a" = 1 }` does.
	 * @param name The name the literal spells.
	 * @param definition The declaration.
	 * @returns Nothing.
	 */
	defineLiteral(name: string, definition: Definition): void {
		this.defineVariable(name, this.set, this.variables, 0, definition);
	}

	//-------------------------------------------------------------------------
	// Referencing
	//-------------------------------------------------------------------------

	/**
	 * Records an occurrence of a name used as a value.
	 * @param identifier The identifier node index.
	 * @param name The name it spells.
	 * @param flag The read/write mode.
	 * @param writeExpr The expression assigned, for a write, or `0`.
	 * @param maybeImplicitGlobal Where an undeclared assignment happened.
	 * @param partial Whether a write sets only part of the assigned value.
	 * @param init Whether a write initializes a declaration.
	 * @returns Nothing.
	 */
	referenceValue(
		identifier: number,
		name: string,
		flag: number = READ,
		writeExpr: number = 0,
		maybeImplicitGlobal: MaybeImplicitGlobal | null = null,
		partial = false,
		init = false,
	): void {
		this.addReference(
			new Reference(
				identifier,
				name,
				this,
				flag,
				writeExpr,
				maybeImplicitGlobal,
				partial,
				init,
				REF_VALUE,
			),
		);
	}

	/**
	 * Records an occurrence of a name used as a type.
	 * @param identifier The identifier node index.
	 * @param name The name it spells.
	 * @returns Nothing.
	 */
	referenceType(identifier: number, name: string): void {
		this.addReference(
			new Reference(
				identifier,
				name,
				this,
				READ,
				0,
				null,
				false,
				false,
				REF_TYPE,
			),
		);
	}

	/**
	 * Records an occurrence that could name either a value or a type, which is
	 * what a bare `export { x }` does.
	 * @param identifier The identifier node index.
	 * @param name The name it spells.
	 * @returns Nothing.
	 */
	referenceDualValueType(identifier: number, name: string): void {
		this.addReference(
			new Reference(
				identifier,
				name,
				this,
				READ,
				0,
				null,
				false,
				false,
				REF_VALUE_TYPE,
			),
		);
	}

	/**
	 * Files a reference under this scope and queues it for resolution.
	 * @param reference The reference to record.
	 * @returns Nothing.
	 */
	private addReference(reference: Reference): void {
		this.references.push(reference);
		this.left!.push(reference);
	}

	//-------------------------------------------------------------------------
	// Closing
	//-------------------------------------------------------------------------

	/**
	 * Resolves everything left over and hands back the enclosing scope.
	 * @returns The enclosing scope, or `null` after the global scope closes.
	 */
	close(): Scope | null {
		if (this.type === SCOPE_GLOBAL) {
			this.closeGlobal();
			this.resolveLeft();
			this.implicit!.left = [...this.through];

			return null;
		}

		/*
		 * A `with` body whose object is not statically known cannot resolve
		 * anything: every name in it might be a property of that object. The
		 * references are marked so that a consumer can tell a resolution it
		 * can trust from one it cannot.
		 */
		if (this.type === SCOPE_WITH && !this.shouldStaticallyClose()) {
			const left = this.left!;

			for (let i = 0; i < left.length; i++) {
				left[i].tainted = true;
				this.delegateToUpperScope(left[i]);
			}

			this.left = null;

			return this.upper;
		}

		this.resolveLeft();

		return this.upper;
	}

	/**
	 * Resolves every queued reference, or passes them all up when the scope is
	 * dynamic.
	 * @returns Nothing.
	 */
	private resolveLeft(): void {
		const left = this.left!;
		const isStatic = this.shouldStaticallyClose();

		for (let i = 0; i < left.length; i++) {
			const reference = left[i];

			if (isStatic) {
				if (!this.resolve(reference)) {
					this.delegateToUpperScope(reference);
				}
			} else {
				// Every enclosing scope has to see a name it might not own.
				let current: Scope | null = this;

				do {
					current.through.push(reference);
					current = current.upper;
				} while (current !== null);
			}
		}

		this.left = null;
	}

	/**
	 * Turns the assignments to undeclared names into implicit global
	 * variables, which is the only way a name enters the global scope without
	 * a declaration.
	 * @returns Nothing.
	 */
	private closeGlobal(): void {
		const left = this.left!;
		const implicit = this.implicit!;

		for (let i = 0; i < left.length; i++) {
			const info = left[i].maybeImplicitGlobal;

			if (info !== null && !this.set.has(left[i].name)) {
				this.defineVariable(
					left[i].name,
					implicit.set,
					implicit.variables,
					info.pattern,
					implicitGlobalDefinition(info.pattern, info.node),
				);
			}
		}
	}

	/**
	 * Whether references here can be resolved by looking at the source alone.
	 * @returns `true` when nothing dynamic is in play, or when this is the
	 *      global scope, which resolves statically anyway because there is
	 *      nowhere left to pass a reference up to.
	 */
	private shouldStaticallyClose(): boolean {
		return !this.dynamic || this.type === SCOPE_GLOBAL;
	}

	/**
	 * Links a reference to the variable it names, if this scope has it.
	 * @param reference The reference to resolve.
	 * @returns `true` when the reference was resolved here.
	 */
	private resolve(reference: Reference): boolean {
		const variable = this.set.get(reference.name);

		if (variable === undefined) {
			return false;
		}

		if (!this.isValidResolution(reference, variable)) {
			return false;
		}

		/*
		 * A name can be bound as a type, as a value, or as both, and a
		 * reference names one or the other. An interface does not satisfy a
		 * reference from expression position, and the search has to continue
		 * outward for a value of the same name.
		 */
		if (
			!(reference.isTypeReference && variable.isTypeVariable) &&
			!(reference.isValueReference && variable.isValueVariable)
		) {
			return false;
		}

		variable.references.push(reference);
		variable.stack =
			variable.stack &&
			reference.from.variableScope === this.variableScope;

		if (reference.tainted) {
			variable.tainted = true;
			this.taints.set(variable.name, true);
		}

		reference.resolved = variable;

		return true;
	}

	/**
	 * Rejects the resolutions that are lexically impossible.
	 *
	 * A default parameter value is evaluated before the body's bindings exist,
	 * so in `function f(a = x) { const x = 2; }` the `x` belongs to whatever
	 * encloses `f`, not to the body.
	 * @param reference The reference being resolved.
	 * @param variable The candidate variable.
	 * @returns `true` when the reference may resolve to the variable.
	 */
	private isValidResolution(
		reference: Reference,
		variable: Variable,
	): boolean {
		if (this.type !== SCOPE_FUNCTION) {
			return true;
		}

		const reader = this.scopeManager.reader;

		// With `globalReturn`, the function scope's block is the program.
		if (reader.kind(this.block) === N_Program) {
			return true;
		}

		const body = reader.field(this.block, NODE_C);
		const bodyStart = body === 0 ? -1 : reader.start(body);

		if (
			variable.scope !== this ||
			reader.start(reference.identifier) >= bodyStart
		) {
			return true;
		}

		return !variable.defs.every(def => reader.start(def.name) >= bodyStart);
	}

	/**
	 * Passes a reference this scope could not resolve to the enclosing one.
	 * @param reference The unresolved reference.
	 * @returns Nothing.
	 */
	private delegateToUpperScope(reference: Reference): void {
		if (this.upper !== null) {
			this.upper.left!.push(reference);
		}

		this.through.push(reference);
	}

	//-------------------------------------------------------------------------
	// Queries
	//-------------------------------------------------------------------------

	/**
	 * Marks this scope, and everything around it, as containing a direct call
	 * to `eval`, which can introduce bindings at runtime.
	 * @returns Nothing.
	 */
	detectEval(): void {
		let current: Scope | null = this;

		this.directCallToEvalScope = true;

		do {
			current.dynamic = true;
			current = current.upper;
		} while (current !== null);
	}

	/**
	 * Records that `this` is mentioned in this scope.
	 * @returns Nothing.
	 */
	detectThis(): void {
		this.thisFound = true;
	}

	/**
	 * Whether the scope has finished resolving.
	 * @returns `true` once `close()` has run.
	 */
	isClosed(): boolean {
		return this.left === null;
	}

	/**
	 * Whether every reference in this scope resolves the same way at runtime
	 * as it does here.
	 * @returns `true` when nothing dynamic is in play.
	 */
	isStatic(): boolean {
		return !this.dynamic;
	}

	/**
	 * Whether a function's `arguments` object is actually needed.
	 * @returns `true` unless the function is an arrow, or nothing in a static
	 *      scope ever mentions `arguments`.
	 */
	isArgumentsMaterialized(): boolean {
		if (this.type !== SCOPE_FUNCTION) {
			return true;
		}

		if (
			this.scopeManager.reader.kind(this.block) ===
			N_ArrowFunctionExpression
		) {
			return false;
		}

		if (!this.isStatic()) {
			return true;
		}

		const variable = this.set.get("arguments");

		return (
			variable !== undefined &&
			(variable.tainted || variable.references.length !== 0)
		);
	}

	/**
	 * Whether a function's `this` binding is actually needed.
	 * @returns `true` unless nothing in a static scope mentions `this`.
	 */
	isThisMaterialized(): boolean {
		if (!this.isStatic()) {
			return true;
		}

		return this.thisFound;
	}

	/**
	 * Finds the reference this scope recorded for a particular identifier.
	 * @param identifier The identifier node index.
	 * @returns The reference, or `null` when the identifier is not one this
	 *      scope referenced.
	 */
	resolveIdentifier(identifier: number): Reference | null {
		for (let i = 0; i < this.references.length; i++) {
			if (this.references[i].identifier === identifier) {
				return this.references[i];
			}
		}

		return null;
	}

	/**
	 * Whether a name means something here.
	 * @param name The name to look for.
	 * @returns `true` when the name is bound here or passes through.
	 */
	isUsedName(name: string): boolean {
		if (this.set.has(name)) {
			return true;
		}

		for (let i = 0; i < this.through.length; i++) {
			if (this.through[i].name === name) {
				return true;
			}
		}

		return false;
	}
}

/**
 * Decides whether a scope runs under strict mode.
 * @param scopeManager The manager that owns the scope.
 * @param scope The scope being created.
 * @param block The node index of the syntax that opened it.
 * @param isMethodDefinition Whether the scope is a method body.
 * @returns `true` when strict mode rules apply.
 */
function isStrictScope(
	scopeManager: ScopeManager,
	scope: Scope,
	block: number,
	isMethodDefinition: boolean,
): boolean {
	// Strictness is inherited, so an enclosing strict scope settles it.
	if (scope.upper !== null && scope.upper.isStrict) {
		return true;
	}

	if (isMethodDefinition || isImplicitlyStrictType(scope.type)) {
		return true;
	}

	if (scope.type === SCOPE_BLOCK || scope.type === SCOPE_SWITCH) {
		return false;
	}

	const reader = scopeManager.reader;
	let body: number;

	if (scope.type === SCOPE_FUNCTION) {
		const kind = reader.kind(block);

		if (kind === N_Program) {
			body = block;
		} else {
			body = reader.field(block, NODE_C);

			/*
			 * An expression-bodied arrow has no statement list, so it has no
			 * prologue and cannot turn strict mode on by itself.
			 */
			if (
				kind === N_ArrowFunctionExpression &&
				(body === 0 || reader.kind(body) !== N_BlockStatement)
			) {
				return false;
			}
		}

		if (body === 0) {
			return false;
		}
	} else if (scope.type === SCOPE_GLOBAL) {
		body = block;
	} else {
		return false;
	}

	return hasUseStrictDirective(scopeManager, body);
}

/**
 * Reports whether a statement list opens with a `"use strict"` directive.
 * @param scopeManager The manager holding the reader.
 * @param body The `Program` or `BlockStatement` node index.
 * @returns `true` when the directive is present in the prologue.
 */
function hasUseStrictDirective(
	scopeManager: ScopeManager,
	body: number,
): boolean {
	const reader = scopeManager.reader;
	const statements = reader.field(body, NODE_A);
	const size = reader.listSize(statements);

	for (let i = 0; i < size; i++) {
		const statement = reader.listItem(statements, i);

		// The prologue ends at the first statement that is not a directive.
		if (reader.field(statement, NODE_B) !== 1) {
			return false;
		}

		const raw = reader.text(reader.field(statement, NODE_A));

		if (raw.slice(1, -1) === "use strict") {
			return true;
		}
	}

	return false;
}
