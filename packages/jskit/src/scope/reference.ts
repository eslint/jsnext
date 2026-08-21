/**
 * @fileoverview A single occurrence of an identifier in code.
 */

import { READ, READ_WRITE, REF_TYPE, REF_VALUE, WRITE } from "./kinds.js";
import type { Scope } from "./scope.js";
import type { Variable } from "./variable.js";

/**
 * Where an assignment created a name that was never declared.
 *
 * The global scope collects these while closing and turns the ones that no
 * declaration covers into implicit global variables.
 */
export interface MaybeImplicitGlobal<TNode> {
	/** The `Identifier` node being assigned to. */
	pattern: TNode;

	/** The assignment or `for` statement that assigns it. */
	node: TNode;
}

/**
 * One occurrence of an identifier, and the variable it turned out to mean.
 *
 * @template TNode How one node is represented.
 */
export class Reference<TNode> {
	/** The `Identifier` or `JSXIdentifier` node. */
	readonly identifier: TNode;

	/** The name the identifier spells, with escapes already resolved. */
	readonly name: string;

	/** The scope the occurrence was written in. */
	readonly from: Scope<TNode>;

	/** The variable the occurrence resolved to, or `null` if none did. */
	resolved: Variable<TNode> | null = null;

	/**
	 * Whether a `with` statement could redirect this reference at runtime, so
	 * that its resolution cannot be trusted.
	 */
	tainted = false;

	/** The expression assigned, for a write, or `null`. */
	readonly writeExpr: TNode | null;

	/** Whether a write is the initialization of a declaration. */
	readonly init: boolean;

	/**
	 * Whether a write only sets part of what `writeExpr` evaluates to, as the
	 * writes in `[a, b] = pair` do.
	 *
	 * `@typescript-eslint/scope-manager` drops this field. It is kept because
	 * `eslint-scope` has it and rules read it.
	 */
	readonly partial: boolean;

	/** Where an undeclared assignment happened, or `null`. */
	readonly maybeImplicitGlobal: MaybeImplicitGlobal<TNode> | null;

	/**
	 * The reference's ID in the scope buffer, assigned when one is written or
	 * read; `-1` until then. IDs are creation order and never change.
	 */
	referenceId = -1;

	/** The read/write mode, one of `READ`, `WRITE`, or `READ_WRITE`. */
	private readonly flag: number;

	/** Whether the occurrence names a value, a type, or both. */
	private readonly referenceType: number;

	/**
	 * Creates a reference.
	 * @param identifier The identifier node.
	 * @param name The name the identifier spells.
	 * @param from The scope the occurrence was written in.
	 * @param flag The read/write mode.
	 * @param writeExpr The expression assigned, for a write, or `null`.
	 * @param maybeImplicitGlobal Where an undeclared assignment happened.
	 * @param partial Whether a write sets only part of the assigned value.
	 * @param init Whether a write initializes a declaration.
	 * @param referenceType Whether the name is a value, a type, or both.
	 */
	constructor(
		identifier: TNode,
		name: string,
		from: Scope<TNode>,
		flag: number,
		writeExpr: TNode | null,
		maybeImplicitGlobal: MaybeImplicitGlobal<TNode> | null,
		partial: boolean,
		init: boolean,
		referenceType: number,
	) {
		this.identifier = identifier;
		this.name = name;
		this.from = from;
		this.flag = flag;
		this.writeExpr = writeExpr;
		this.partial = partial;
		this.init = init;
		this.maybeImplicitGlobal = maybeImplicitGlobal;
		this.referenceType = referenceType;
	}

	/**
	 * Whether the occurrence names a type.
	 * @returns `true` for a type reference.
	 */
	get isTypeReference(): boolean {
		return (this.referenceType & REF_TYPE) !== 0;
	}

	/**
	 * Whether the occurrence names a value.
	 * @returns `true` for a value reference.
	 */
	get isValueReference(): boolean {
		return (this.referenceType & REF_VALUE) !== 0;
	}

	/**
	 * Whether the variable's resolution can be trusted at runtime.
	 * @returns `true` when nothing dynamic can redirect it.
	 */
	isStatic(): boolean {
		return (
			!this.tainted && !!this.resolved && this.resolved.scope.isStatic()
		);
	}

	/**
	 * Whether the occurrence writes the variable.
	 * @returns `true` for a write or a read-write.
	 */
	isWrite(): boolean {
		return (this.flag & WRITE) !== 0;
	}

	/**
	 * Whether the occurrence reads the variable.
	 * @returns `true` for a read or a read-write.
	 */
	isRead(): boolean {
		return (this.flag & READ) !== 0;
	}

	/**
	 * Whether the occurrence only reads the variable.
	 * @returns `true` for a read that is not also a write.
	 */
	isReadOnly(): boolean {
		return this.flag === READ;
	}

	/**
	 * Whether the occurrence only writes the variable.
	 * @returns `true` for a write that is not also a read.
	 */
	isWriteOnly(): boolean {
		return this.flag === WRITE;
	}

	/**
	 * Whether the occurrence both reads and writes the variable.
	 * @returns `true` for a compound assignment or an update.
	 */
	isReadWrite(): boolean {
		return this.flag === READ_WRITE;
	}
}
