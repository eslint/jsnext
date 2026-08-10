/**
 * @fileoverview A name bound in one scope.
 */

import type { Definition } from "./definition.js";
import type { Reference } from "./reference.js";
import type { Scope } from "./scope.js";

/**
 * A locally scoped name, together with everywhere it is declared and used.
 */
export class Variable {
	/** The name as written in the source. */
	readonly name: string;

	/** The `Identifier` nodes that declare the name, as node indices. */
	readonly identifiers: number[] = [];

	/** Every occurrence that resolved to this variable. */
	readonly references: Reference[] = [];

	/** Every declaration of the name. */
	readonly defs: Definition[] = [];

	/** The scope the name is bound in. */
	readonly scope: Scope;

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
	 * Creates a variable.
	 * @param name The name as written in the source.
	 * @param scope The scope the name is bound in.
	 */
	constructor(name: string, scope: Scope) {
		this.name = name;
		this.scope = scope;
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
