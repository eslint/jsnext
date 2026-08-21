/**
 * @fileoverview Reading a program out of an ordinary ESTree tree.
 *
 * This is the compatibility path: anything that produces an ESLint-shaped
 * AST — `espree`, `@typescript-eslint/parser`, this package's own `toAST()`
 * — can be analyzed without going through the binary format. It is slower
 * than the binary path, because the tree it reads had to be allocated first,
 * but it runs the same walk and produces the same graph.
 *
 * A node's kind is its `type` looked up once in a table; its children are its
 * properties, found through `SLOT_NAMES`.
 */

import {
	NODE_KIND_COUNT,
	NODE_KIND_NAMES,
	SLOT_COUNT,
} from "../parse/index.js";
import { type AstAccess } from "./ast-access.js";
import { SLOT_NAMES } from "./slot-names.js";

/**
 * A node of an ESTree tree.
 *
 * Only `type` is required, which is the same assumption `eslint-scope` makes.
 */
export interface EsTreeNode {
	type: string;
	[key: string]: unknown;
}

/**
 * Builds the type-to-kind map.
 *
 * Wrapped in a function, and called as a pure expression, so that a bundler
 * can drop it along with this adapter when only the binary entry point is
 * used.
 * @returns Every ESTree `type` mapped to the kind the analyzer dispatches on.
 */
function buildKindMap(): Map<string, number> {
	const kinds = new Map<string, number>();

	for (let kind = 1; kind < NODE_KIND_COUNT; kind++) {
		if (NODE_KIND_NAMES[kind] !== "") {
			kinds.set(NODE_KIND_NAMES[kind], kind);
		}
	}

	return kinds;
}

/** Maps an ESTree `type` to the node kind the analyzer dispatches on. */
const KIND_OF_TYPE = /* @__PURE__ */ buildKindMap();

/**
 * The base index in `SLOT_NAMES` used for a kind this analyzer does not know.
 * Kind `0` is never a real node, so its eight entries are all `null`.
 */
const NO_NAMES_BASE = 0;

/** Returned for a node that has no children of its own. */
const NO_CHILDREN: readonly EsTreeNode[] = [];

/**
 * Reports whether a value is a node rather than some other property value.
 * @param value The property value to test.
 * @returns `true` when the value looks like an AST node.
 */
function isNode(value: unknown): value is EsTreeNode {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as EsTreeNode).type === "string"
	);
}

/**
 * Reads a program out of an ESTree tree.
 */
export class EstreeAst implements AstAccess<EsTreeNode> {
	/**
	 * The node the slot names were last looked up for.
	 *
	 * Every access to a node's children arrives in a run — the walk asks for a
	 * kind and then for two or three of its slots — so remembering one node is
	 * enough to turn most of those lookups into a comparison.
	 */
	private lastNode: EsTreeNode | null = null;

	/** Where `lastNode`'s slot names begin in `SLOT_NAMES`. */
	private lastBase = NO_NAMES_BASE;

	/** The kind of `lastNode`. */
	private lastKind = 0;

	/**
	 * The node kind constant for a node.
	 *
	 * The walk asks for a node's kind and then, almost always, for some of its
	 * children, so the map lookup done here is the one the slot-name lookups
	 * afterward reuse.
	 * @param node The node.
	 * @returns The kind, or `0` for a type this analyzer does not know.
	 */
	kind(node: EsTreeNode): number {
		if (node !== this.lastNode) {
			this.lastNode = node;
			this.lastKind = KIND_OF_TYPE.get(node.type) ?? 0;
			this.lastBase = this.lastKind * SLOT_COUNT;
		}

		return this.lastKind;
	}

	/**
	 * The ESTree type string for a node.
	 * @param node The node.
	 * @returns Its `type`.
	 */
	typeName(node: EsTreeNode): string {
		return node.type;
	}

	/**
	 * The offset a node starts at.
	 * @param node The node.
	 * @returns The offset of the node's first character.
	 */
	start(node: EsTreeNode): number {
		const range = node.range as [number, number] | undefined;

		return range ? range[0] : (node.start as number);
	}

	/**
	 * The offset just past a node.
	 * @param node The node.
	 * @returns The offset just past the node's last character.
	 */
	end(node: EsTreeNode): number {
		const range = node.range as [number, number] | undefined;

		return range ? range[1] : (node.end as number);
	}

	/**
	 * The child in a slot.
	 * @param node The node.
	 * @param slot The slot position.
	 * @returns The child, or `null` when the node has none there.
	 */
	child(node: EsTreeNode, slot: number): EsTreeNode | null {
		const name = SLOT_NAMES[this.base(node) + slot];

		if (name === null) {
			return null;
		}

		const value = node[name];

		return isNode(value) ? value : null;
	}

	/**
	 * How many children a slot's list holds.
	 * @param node The node.
	 * @param slot The slot position.
	 * @returns The element count.
	 */
	listSize(node: EsTreeNode, slot: number): number {
		const list = this.listAt(node, slot);

		return list === null ? 0 : list.length;
	}

	/**
	 * One element of a slot's list.
	 * @param node The node.
	 * @param slot The slot position.
	 * @param index The position within the list.
	 * @returns The element, or `null` for an array hole.
	 */
	listItem(node: EsTreeNode, slot: number, index: number): EsTreeNode | null {
		const list = this.listAt(node, slot);
		const value = list === null ? null : list[index];

		return isNode(value) ? value : null;
	}

	/**
	 * The array a slot names, if the node has one there.
	 * @param node The node.
	 * @param slot The slot position.
	 * @returns The array, or `null`.
	 */
	private listAt(node: EsTreeNode, slot: number): unknown[] | null {
		const name = SLOT_NAMES[this.base(node) + slot];

		if (name === null) {
			return null;
		}

		const value = node[name];

		return Array.isArray(value) ? value : null;
	}

	/**
	 * Where a node's slot names begin in `SLOT_NAMES`, remembering the last
	 * node asked about.
	 * @param node The node.
	 * @returns The base index for the node's kind.
	 */
	private base(node: EsTreeNode): number {
		if (node !== this.lastNode) {
			this.kind(node);
		}

		return this.lastBase;
	}

	/**
	 * The children of a node of an unrecognized kind.
	 *
	 * A parser may produce node types this analyzer has never heard of. Rather
	 * than skip the subtree, every property that holds a node is walked, which
	 * is what `eslint-scope` does for the same case.
	 * @param node The node.
	 * @returns Every child found by inspecting the node's own properties.
	 */
	unknownChildren(node: EsTreeNode): readonly EsTreeNode[] {
		let children: EsTreeNode[] | null = null;

		for (const key of Object.keys(node)) {
			if (key === "parent") {
				continue;
			}

			const value = node[key];

			if (isNode(value)) {
				(children ??= []).push(value);
			} else if (Array.isArray(value)) {
				for (const item of value) {
					if (isNode(item)) {
						(children ??= []).push(item);
					}
				}
			}
		}

		return children ?? NO_CHILDREN;
	}

	/**
	 * The name an identifier spells.
	 * @param node The `Identifier` or `JSXIdentifier` node.
	 * @returns Its name.
	 */
	name(node: EsTreeNode): string {
		return node.name as string;
	}

	/**
	 * The string a literal denotes.
	 * @param node The `Literal` node.
	 * @returns Its value as a string.
	 */
	literalString(node: EsTreeNode): string {
		return node.value as string;
	}

	/**
	 * The directive a statement states.
	 *
	 * Some parsers set `directive` to `null` on statements that are not
	 * directives, so the type is what decides rather than the property's
	 * presence.
	 * @param node The `ExpressionStatement` node.
	 * @returns The directive's text, or `null` for an ordinary expression.
	 */
	directive(node: EsTreeNode): string | null {
		return typeof node.directive === "string" ? node.directive : null;
	}

	/**
	 * Whether a key or member is computed.
	 * @param node The node.
	 * @returns `true` when the node is marked computed.
	 */
	computed(node: EsTreeNode): boolean {
		return node.computed === true;
	}

	/**
	 * Whether an import or export was written `type`.
	 * @param node The node.
	 * @returns `true` for a type-only import or export.
	 */
	typeOnly(node: EsTreeNode): boolean {
		return node.importKind === "type" || node.exportKind === "type";
	}

	/**
	 * The keyword a variable declaration was written with.
	 * @param node The `VariableDeclaration` node.
	 * @returns One of `var`, `let`, `const`, `using`, or `await using`.
	 */
	declarationKind(node: EsTreeNode): string {
		return node.kind as string;
	}

	/**
	 * Whether a module declaration was written `global`.
	 * @param node The `TSModuleDeclaration` node.
	 * @returns `true` for `declare global`.
	 */
	isGlobalModule(node: EsTreeNode): boolean {
		return node.kind === "global";
	}

	/**
	 * Whether an assignment uses plain `=`.
	 * @param node The `AssignmentExpression` node.
	 * @returns `true` for `=`, `false` for a compound assignment.
	 */
	isSimpleAssignment(node: EsTreeNode): boolean {
		return node.operator === "=";
	}

	/**
	 * How many decorators a function parameter carries.
	 * @param node The parameter node.
	 * @returns The decorator count.
	 */
	parameterDecoratorSize(node: EsTreeNode): number {
		const decorators = node.decorators;

		return Array.isArray(decorators) ? decorators.length : 0;
	}

	/**
	 * One decorator of a function parameter.
	 * @param node The parameter node.
	 * @param index The position within the decorator list.
	 * @returns The `Decorator` node, or `null`.
	 */
	parameterDecoratorAt(node: EsTreeNode, index: number): EsTreeNode | null {
		const decorators = node.decorators as unknown[] | undefined;
		const value = Array.isArray(decorators) ? decorators[index] : null;

		return isNode(value) ? value : null;
	}

	/**
	 * The name a mapped type binds.
	 * @param node The `TSMappedType` node.
	 * @returns The key `Identifier`, or `null`.
	 */
	mappedTypeKey(node: EsTreeNode): EsTreeNode | null {
		return isNode(node.key) ? node.key : null;
	}

	/**
	 * The constraint a mapped type's key ranges over.
	 * @param node The `TSMappedType` node.
	 * @returns The constraint, or `null`.
	 */
	mappedTypeConstraint(node: EsTreeNode): EsTreeNode | null {
		return isNode(node.constraint) ? node.constraint : null;
	}
}
