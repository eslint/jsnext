/**
 * @fileoverview A single declaring occurrence of a variable.
 *
 * `eslint-scope` models the definition types as a two-class hierarchy and
 * `@typescript-eslint/scope-manager` as eleven separate classes. Both shapes
 * are the same handful of fields, so one class carries all of them and the
 * factory functions below fill in the parts that vary. Keeping every
 * definition the same hidden class is also what lets the property loads in
 * `Variable#isTypeVariable` stay monomorphic.
 */

import {
	DEF_CATCH_CLAUSE,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_IMPLICIT_GLOBAL_VARIABLE,
	DEF_IMPORT_BINDING,
	DEF_PARAMETER,
	DEF_TS_ENUM_MEMBER,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TYPE,
	DEF_VARIABLE,
	type DefinitionType,
} from "./kinds.js";

/**
 * A declaring occurrence of a variable.
 *
 * Every node-valued field holds whatever the analysis represents a node with:
 * an index into a binary buffer, or an ESTree object. `null` means there is no
 * node.
 *
 * @template TNode How one node is represented.
 */
export class Definition<TNode> {
	/** Which kind of declaration introduced the name. */
	readonly type: DefinitionType;

	/** The `Identifier` node that spells the name. */
	readonly name: TNode;

	/** The node that declares it, such as the `VariableDeclarator`. */
	readonly node: TNode;

	/** The enclosing statement, such as the `VariableDeclaration`, or `null`. */
	readonly parent: TNode | null;

	/** The position within a multi-declarator statement, or `null`. */
	readonly index: number | null;

	/** The declaration keyword, such as `"const"`, or `null`. */
	readonly kind: string | null;

	/** Whether a parameter definition came from a rest element. */
	readonly rest: boolean;

	/** Whether this definition contributes a type binding. */
	readonly isTypeDefinition: boolean;

	/** Whether this definition contributes a value binding. */
	readonly isVariableDefinition: boolean;

	/**
	 * The definition's ID in the scope buffer, assigned when one is written
	 * or read; `-1` until then.
	 */
	definitionId = -1;

	/**
	 * Creates a definition.
	 * @param type Which kind of declaration introduced the name.
	 * @param name The `Identifier` node that spells the name.
	 * @param node The node that declares it.
	 * @param parent The enclosing statement, or `null`.
	 * @param index The position within a multi-declarator statement, or `null`.
	 * @param kind The declaration keyword, or `null`.
	 * @param rest Whether a parameter came from a rest element.
	 * @param isTypeDefinition Whether this contributes a type binding.
	 * @param isVariableDefinition Whether this contributes a value binding.
	 */
	constructor(
		type: DefinitionType,
		name: TNode,
		node: TNode,
		parent: TNode | null,
		index: number | null,
		kind: string | null,
		rest: boolean,
		isTypeDefinition: boolean,
		isVariableDefinition: boolean,
	) {
		this.type = type;
		this.name = name;
		this.node = node;
		this.parent = parent;
		this.index = index;
		this.kind = kind;
		this.rest = rest;
		this.isTypeDefinition = isTypeDefinition;
		this.isVariableDefinition = isVariableDefinition;
	}
}

/**
 * Creates the definition for a name bound by a `var`, `let`, or `const`.
 * @param name The `Identifier` node.
 * @param declarator The `VariableDeclarator` node.
 * @param declaration The `VariableDeclaration` node.
 * @param index The declarator's position within the declaration.
 * @param kind The declaration keyword.
 * @returns The definition.
 */
export function variableDefinition<TNode>(
	name: TNode,
	declarator: TNode,
	declaration: TNode,
	index: number,
	kind: string,
): Definition<TNode> {
	return new Definition(
		DEF_VARIABLE,
		name,
		declarator,
		declaration,
		index,
		kind,
		false,
		false,
		true,
	);
}

/**
 * Creates the definition for a function parameter.
 * @param name The `Identifier` node.
 * @param func The function node the parameter belongs to.
 * @param index The parameter's position in the list.
 * @param rest Whether the name came from a rest element.
 * @returns The definition.
 */
export function parameterDefinition<TNode>(
	name: TNode,
	func: TNode,
	index: number,
	rest: boolean,
): Definition<TNode> {
	return new Definition(
		DEF_PARAMETER,
		name,
		func,
		null,
		index,
		null,
		rest,
		false,
		true,
	);
}

/**
 * Creates the definition for a function's own name.
 * @param name The `Identifier` node.
 * @param func The function node.
 * @returns The definition.
 */
export function functionNameDefinition<TNode>(
	name: TNode,
	func: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_FUNCTION_NAME,
		name,
		func,
		null,
		null,
		null,
		false,
		false,
		true,
	);
}

/**
 * Creates the definition for a class's own name.
 * @param name The `Identifier` node.
 * @param node The class node.
 * @returns The definition.
 */
export function classNameDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_CLASS_NAME,
		name,
		node,
		null,
		null,
		null,
		false,
		true,
		true,
	);
}

/**
 * Creates the definition for a `catch` clause parameter.
 * @param name The `Identifier` node.
 * @param node The `CatchClause` node.
 * @returns The definition.
 */
export function catchClauseDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_CATCH_CLAUSE,
		name,
		node,
		null,
		null,
		null,
		false,
		false,
		true,
	);
}

/**
 * Creates the definition for an imported binding.
 * @param name The `Identifier` node.
 * @param specifier The specifier node, or the `TSImportEqualsDeclaration`.
 * @param declaration The `ImportDeclaration` node.
 * @returns The definition.
 */
export function importBindingDefinition<TNode>(
	name: TNode,
	specifier: TNode,
	declaration: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_IMPORT_BINDING,
		name,
		specifier,
		declaration,
		null,
		null,
		false,
		true,
		true,
	);
}

/**
 * Creates the definition for a name that an assignment created in the global
 * scope without ever declaring it.
 * @param name The `Identifier` node.
 * @param node The assignment or `for` statement that created it.
 * @returns The definition.
 */
export function implicitGlobalDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_IMPLICIT_GLOBAL_VARIABLE,
		name,
		node,
		null,
		null,
		null,
		false,
		false,
		true,
	);
}

/**
 * Creates the definition for a type-only name, such as an interface or a type
 * parameter.
 * @param name The `Identifier` node.
 * @param node The declaring node.
 * @returns The definition.
 */
export function typeDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_TYPE,
		name,
		node,
		null,
		null,
		null,
		false,
		true,
		false,
	);
}

/**
 * Creates the definition for an enum's own name.
 * @param name The `Identifier` node.
 * @param node The `TSEnumDeclaration` node.
 * @returns The definition.
 */
export function enumNameDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_TS_ENUM_NAME,
		name,
		node,
		null,
		null,
		null,
		false,
		true,
		true,
	);
}

/**
 * Creates the definition for a single enum member.
 * @param name The `Identifier` or string `Literal` node naming the member.
 * @param node The `TSEnumMember` node.
 * @returns The definition.
 */
export function enumMemberDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_TS_ENUM_MEMBER,
		name,
		node,
		null,
		null,
		null,
		false,
		true,
		true,
	);
}

/**
 * Creates the definition for a namespace or module's own name.
 * @param name The `Identifier` node.
 * @param node The `TSModuleDeclaration` node.
 * @returns The definition.
 */
export function moduleNameDefinition<TNode>(
	name: TNode,
	node: TNode,
): Definition<TNode> {
	return new Definition(
		DEF_TS_MODULE_NAME,
		name,
		node,
		null,
		null,
		null,
		false,
		true,
		true,
	);
}
