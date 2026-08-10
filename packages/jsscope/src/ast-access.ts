/**
 * @fileoverview The narrow view of an AST that the walk needs.
 *
 * There are two ways to hand a program to this analyzer: as the binary buffers
 * `@eslint/jsparse` produces, or as an ordinary ESTree tree from any
 * ESLint-compatible parser. Rather than write the walk twice, it is written
 * once against this interface and each representation supplies an
 * implementation.
 *
 * Two decisions make that possible without giving up much:
 *
 * - **Node kinds are integers,** including for a tree, where the adapter maps
 *   `node.type` to the same constants `@eslint/jsparse` assigns. Dispatch is
 *   then a `switch` over a small integer in both cases.
 * - **Children are addressed by slot,** the position a child occupies in a
 *   binary node record. A tree adapter turns a slot back into a property name
 *   through a table. Slot order matches the order a visitor-key walk would
 *   use, which is what keeps references in the same order as the reference
 *   implementations record them.
 *
 * A missing child is `null` in both representations. The binary format spells
 * it `0`, and the adapter translates.
 */

/** The slots a node record can hold children in. */
export const SLOT_A = 0;
export const SLOT_B = 1;
export const SLOT_C = 2;
export const SLOT_D = 3;
export const SLOT_E = 4;
export const SLOT_F = 5;
export const SLOT_G = 6;
export const SLOT_H = 7;

/**
 * Everything the walk needs to know about a program.
 *
 * @template TNode How one node is represented: an index into a binary buffer,
 *      or an ESTree object.
 */
export interface AstAccess<TNode> {
	/** The `@eslint/jsparse` node kind constant for a node. */
	kind(node: TNode): number;

	/** The ESTree `type` string for a node. */
	typeName(node: TNode): string;

	/** The offset a node starts at. */
	start(node: TNode): number;

	/** The offset just past a node. */
	end(node: TNode): number;

	/** The child in a slot, or `null` when the node has none there. */
	child(node: TNode, slot: number): TNode | null;

	/** How many children a slot's list holds. */
	listSize(node: TNode, slot: number): number;

	/** One element of a slot's list, or `null` for an array hole. */
	listItem(node: TNode, slot: number, index: number): TNode | null;

	/**
	 * The children of a node whose kind this analyzer does not know, so that a
	 * parser with extensions of its own is still walked rather than skipped.
	 */
	unknownChildren(node: TNode): readonly TNode[];

	/** The name an `Identifier` or `JSXIdentifier` spells. */
	name(node: TNode): string;

	/** The string a `Literal` denotes, for an enum member written as one. */
	literalString(node: TNode): string;

	/**
	 * The directive an `ExpressionStatement` states, or `null` when it is an
	 * ordinary expression. Only `"use strict"` matters here.
	 */
	directive(node: TNode): string | null;

	/** Whether a key or member is computed. */
	computed(node: TNode): boolean;

	/** Whether an import or export was written `type`. */
	typeOnly(node: TNode): boolean;

	/** The keyword a `VariableDeclaration` was written with. */
	declarationKind(node: TNode): string;

	/** Whether a `TSModuleDeclaration` was written `global`. */
	isGlobalModule(node: TNode): boolean;

	/** Whether an `AssignmentExpression` uses plain `=`. */
	isSimpleAssignment(node: TNode): boolean;

	/**
	 * How many decorators a function parameter carries.
	 *
	 * This is the one place the two representations put the same information
	 * somewhere genuinely different. `@eslint/jsparse` wraps a decorated
	 * parameter in a `TSParameterProperty` and hangs the decorators off that,
	 * while an ESTree tree leaves the parameter alone and gives it a
	 * `decorators` property of its own.
	 */
	parameterDecoratorSize(node: TNode): number;

	/** One decorator of a function parameter. */
	parameterDecoratorAt(node: TNode, index: number): TNode | null;

	/** The name a `TSMappedType` binds, which is its key. */
	mappedTypeKey(node: TNode): TNode | null;

	/** The constraint a `TSMappedType`'s key ranges over. */
	mappedTypeConstraint(node: TNode): TNode | null;
}
