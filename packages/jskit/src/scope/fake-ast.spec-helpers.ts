/**
 * @fileoverview A hand-built `AstAccess` for the unit tests.
 *
 * `Scope`, `ScopeManager`, and `PatternVisitor` are written against
 * `AstAccess` rather than against either representation, which is exactly what
 * lets a unit test hand them a tree it made up. Parsing a real program to
 * reach one branch of `isStrictScope()` would be an integration test wearing a
 * unit test's name; the tables here are the whole program instead.
 *
 * A node is its index in `nodes`, so `0` is a perfectly good node and `null`
 * is the only spelling of "no node", which is the rule the accessor layer
 * imposes on both real representations too.
 */

import { type AstAccess } from "./ast-access.js";

/** One node in a made-up program. */
export interface FakeNode {
	/** The parser's node kind constant. */
	kind: number;

	/** The ESTree `type` string. */
	type?: string;

	/** The offset the node starts at. */
	start?: number;

	/** The offset just past the node. */
	end?: number;

	/** The single child in each slot, by slot number. */
	children?: Record<number, number>;

	/** The child list in each slot, by slot number. */
	lists?: Record<number, (number | null)[]>;

	/** The name an identifier spells. */
	name?: string;

	/** The string a literal denotes. */
	literalString?: string;

	/** The directive the node states, for an `ExpressionStatement`. */
	directive?: string | null;

	/** Whether a key or member is computed. */
	computed?: boolean;

	/** Whether an import or export was written `type`. */
	typeOnly?: boolean;

	/** The keyword a declaration was written with. */
	declarationKind?: string;

	/** Whether a module declaration was written `global`. */
	isGlobalModule?: boolean;

	/** Whether an assignment uses plain `=`. */
	isSimpleAssignment?: boolean;

	/** The decorators a parameter carries. */
	parameterDecorators?: (number | null)[];

	/** The name a mapped type binds. */
	mappedTypeKey?: number;

	/** The constraint a mapped type's key ranges over. */
	mappedTypeConstraint?: number;

	/** The children of a node whose kind the analyzer does not know. */
	unknownChildren?: number[];
}

/** What `unknownChildren()` returns for a node with none. */
const NO_CHILDREN: readonly number[] = [];

/**
 * An `AstAccess` over a literal table of nodes.
 */
export class FakeAst implements AstAccess<number> {
	/** The nodes, indexed by the handle that names them. */
	private readonly nodes: FakeNode[];

	/**
	 * Creates the accessor.
	 * @param nodes The nodes, where a node's handle is its index.
	 */
	constructor(nodes: FakeNode[]) {
		this.nodes = nodes;
	}

	/**
	 * The parser's node kind constant for a node.
	 * @param node The node handle.
	 * @returns The kind.
	 */
	kind(node: number): number {
		return this.nodes[node].kind;
	}

	/**
	 * The ESTree `type` string for a node.
	 * @param node The node handle.
	 * @returns The type name.
	 */
	typeName(node: number): string {
		return this.nodes[node].type ?? "Unknown";
	}

	/**
	 * The offset a node starts at.
	 * @param node The node handle.
	 * @returns The offset.
	 */
	start(node: number): number {
		return this.nodes[node].start ?? 0;
	}

	/**
	 * The offset just past a node.
	 * @param node The node handle.
	 * @returns The offset.
	 */
	end(node: number): number {
		return this.nodes[node].end ?? 0;
	}

	/**
	 * The child in a slot.
	 * @param node The node handle.
	 * @param slot The slot to read.
	 * @returns The child, or `null` when the node has none there.
	 */
	child(node: number, slot: number): number | null {
		return this.nodes[node].children?.[slot] ?? null;
	}

	/**
	 * How many children a slot's list holds.
	 * @param node The node handle.
	 * @param slot The slot to read.
	 * @returns The length.
	 */
	listSize(node: number, slot: number): number {
		return this.nodes[node].lists?.[slot]?.length ?? 0;
	}

	/**
	 * One element of a slot's list.
	 * @param node The node handle.
	 * @param slot The slot to read.
	 * @param index The position in the list.
	 * @returns The element, or `null` for an array hole.
	 */
	listItem(node: number, slot: number, index: number): number | null {
		return this.nodes[node].lists?.[slot]?.[index] ?? null;
	}

	/**
	 * The children of a node whose kind the analyzer does not know.
	 * @param node The node handle.
	 * @returns The children.
	 */
	unknownChildren(node: number): readonly number[] {
		return this.nodes[node].unknownChildren ?? NO_CHILDREN;
	}

	/**
	 * The name an identifier spells.
	 * @param node The node handle.
	 * @returns The name.
	 */
	name(node: number): string {
		return this.nodes[node].name ?? "";
	}

	/**
	 * The string a literal denotes.
	 * @param node The node handle.
	 * @returns The string.
	 */
	literalString(node: number): string {
		return this.nodes[node].literalString ?? "";
	}

	/**
	 * The directive a statement states.
	 * @param node The node handle.
	 * @returns The directive, or `null` for an ordinary expression.
	 */
	directive(node: number): string | null {
		return this.nodes[node].directive ?? null;
	}

	/**
	 * Whether a key or member is computed.
	 * @param node The node handle.
	 * @returns `true` when it is.
	 */
	computed(node: number): boolean {
		return this.nodes[node].computed ?? false;
	}

	/**
	 * Whether an import or export was written `type`.
	 * @param node The node handle.
	 * @returns `true` when it was.
	 */
	typeOnly(node: number): boolean {
		return this.nodes[node].typeOnly ?? false;
	}

	/**
	 * The keyword a declaration was written with.
	 * @param node The node handle.
	 * @returns The keyword.
	 */
	declarationKind(node: number): string {
		return this.nodes[node].declarationKind ?? "var";
	}

	/**
	 * Whether a module declaration was written `global`.
	 * @param node The node handle.
	 * @returns `true` when it was.
	 */
	isGlobalModule(node: number): boolean {
		return this.nodes[node].isGlobalModule ?? false;
	}

	/**
	 * Whether an assignment uses plain `=`.
	 * @param node The node handle.
	 * @returns `true` when it does.
	 */
	isSimpleAssignment(node: number): boolean {
		return this.nodes[node].isSimpleAssignment ?? true;
	}

	/**
	 * How many decorators a function parameter carries.
	 * @param node The node handle.
	 * @returns The count.
	 */
	parameterDecoratorSize(node: number): number {
		return this.nodes[node].parameterDecorators?.length ?? 0;
	}

	/**
	 * One decorator of a function parameter.
	 * @param node The node handle.
	 * @param index The position in the list.
	 * @returns The decorator, or `null`.
	 */
	parameterDecoratorAt(node: number, index: number): number | null {
		return this.nodes[node].parameterDecorators?.[index] ?? null;
	}

	/**
	 * The name a mapped type binds.
	 * @param node The node handle.
	 * @returns The key, or `null`.
	 */
	mappedTypeKey(node: number): number | null {
		return this.nodes[node].mappedTypeKey ?? null;
	}

	/**
	 * The constraint a mapped type's key ranges over.
	 * @param node The node handle.
	 * @returns The constraint, or `null`.
	 */
	mappedTypeConstraint(node: number): number | null {
		return this.nodes[node].mappedTypeConstraint ?? null;
	}
}
