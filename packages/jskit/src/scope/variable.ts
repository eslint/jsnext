/**
 * @fileoverview A name bound in one scope.
 */

import type { Definition } from "./definition.js";
import type { Reference } from "./reference.js";
import type { Scope } from "./scope.js";

/**
 * A locally scoped name, together with everywhere it is declared and used.
 *
 * @template TNode How one node is represented.
 */
export class Variable<TNode> {
	/** The name as written in the source. */
	readonly name: string;

	/** The `Identifier` nodes that declare the name. */
	readonly identifiers: TNode[] = [];

	/**
	 * Every occurrence that resolved to this variable. Append through
	 * `addReference()` rather than directly, so that `readCount` and
	 * `writeCount` keep pace with it.
	 */
	readonly references: Reference<TNode>[] = [];

	/** How many of those occurrences read the variable. */
	readCount = 0;

	/**
	 * How many of them write it, its initializer included. A read-write such
	 * as `x += 1` counts in both, so the two do not sum to
	 * `references.length`.
	 */
	writeCount = 0;

	/** Every declaration of the name. */
	readonly defs: Definition<TNode>[] = [];

	/** The scope the name is bound in. */
	readonly scope: Scope<TNode>;

	/** Whether a `with` statement could redirect a reference to this name. */
	tainted = false;

	/** Whether every reference comes from the variable's own function scope. */
	stack = true;

	/**
	 * Set by ESLint's own machinery to mark a variable as used. It is not
	 * written here, only carried, because rules expect the field to exist.
	 */
	eslintUsed = false;

	/**
	 * The variable's ID in the scope buffer it was rehydrated from, or `-1`
	 * on a variable the walk built directly. IDs are assigned when the buffer
	 * is written and never change, so this is the stable way to correlate a
	 * rehydrated variable with `Scopes` queries over the same buffer.
	 */
	symbolId = -1;

	/**
	 * Creates a variable.
	 * @param name The name as written in the source.
	 * @param scope The scope the name is bound in.
	 */
	constructor(name: string, scope: Scope<TNode>) {
		this.name = name;
		this.scope = scope;
	}

	/**
	 * Records an occurrence of the variable and keeps the read and write
	 * counts current. The counts are what rules like `prefer-const` and
	 * `no-unused-vars` ask for, and asking them should not mean walking the
	 * reference list.
	 * @param reference The occurrence that resolved here.
	 * @returns Nothing.
	 */
	addReference(reference: Reference<TNode>): void {
		this.references.push(reference);

		if (reference.isRead()) {
			this.readCount++;
		}

		if (reference.isWrite()) {
			this.writeCount++;
		}
	}

	/**
	 * Whether the name can be used where a type is expected.
	 * @returns `true` when at least one declaration binds a type, or when the
	 *      variable has no declarations at all, as a global has none.
	 */
	get isTypeVariable(): boolean {
		if (this.defs.length === 0) {
			return true;
		}

		return this.defs.some(def => def.isTypeDefinition);
	}

	/**
	 * Whether the name can be used where a value is expected.
	 * @returns `true` when at least one declaration binds a value, or when the
	 *      variable has no declarations at all.
	 */
	get isValueVariable(): boolean {
		if (this.defs.length === 0) {
			return true;
		}

		return this.defs.some(def => def.isVariableDefinition);
	}
}
