/**
 * @fileoverview Reading a program out of the parser's binary buffers.
 *
 * This is the fast path, and the reason the analyzer exists in this shape. A
 * node is an integer, a slot read is one multiply and one typed-array load,
 * and nothing between the parser and the scope graph allocates an object per
 * node.
 */

import {
	decodeEscapes,
	DECL_KIND_NAMES,
	DECL_MASK,
	DECL_SHIFT,
	MODULE_GLOBAL,
	MODULE_KIND_MASK,
	MODULE_KIND_SHIFT,
	NF_COMPUTED,
	NF_TYPE_ONLY,
	NODE_A,
	NODE_B,
	NODE_C,
	NODE_KIND_NAMES,
	N_TSParameterProperty,
	T_ASSIGN,
	type AstReader,
} from "../parse/index.js";
import { SLOT_B, SLOT_C, type AstAccess } from "./ast-access.js";

/** No node ever has children this way, so one empty array is enough. */
const NO_CHILDREN: readonly number[] = [];

/**
 * Reads a program out of a binary parse buffer.
 */
export class BinaryAst implements AstAccess<number> {
	/** The reader over the buffer. */
	readonly reader: AstReader;

	/** The source text, hoisted for slicing names out of. */
	private readonly source: string;

	/**
	 * Creates an accessor over a buffer.
	 * @param reader The reader over the parse buffer.
	 */
	constructor(reader: AstReader) {
		this.reader = reader;
		this.source = reader.source;
	}

	/**
	 * The node kind constant for a node.
	 * @param node The node index.
	 * @returns The kind.
	 */
	kind(node: number): number {
		return this.reader.kind(node);
	}

	/**
	 * The ESTree type string for a node.
	 * @param node The node index.
	 * @returns The `type` the node would decode to.
	 */
	typeName(node: number): string {
		return NODE_KIND_NAMES[this.reader.kind(node)];
	}

	/**
	 * The offset a node starts at.
	 * @param node The node index.
	 * @returns The offset of the node's first character.
	 */
	start(node: number): number {
		return this.reader.start(node);
	}

	/**
	 * The offset just past a node.
	 * @param node The node index.
	 * @returns The offset just past the node's last character.
	 */
	end(node: number): number {
		return this.reader.end(node);
	}

	/**
	 * The child in a slot.
	 * @param node The node index.
	 * @param slot The slot position.
	 * @returns The child's index, or `null` when the slot is empty.
	 */
	child(node: number, slot: number): number | null {
		const child = this.reader.field(node, NODE_A + slot);

		return child === 0 ? null : child;
	}

	/**
	 * How many children a slot's list holds.
	 * @param node The node index.
	 * @param slot The slot position.
	 * @returns The element count.
	 */
	listSize(node: number, slot: number): number {
		return this.reader.listSize(this.reader.field(node, NODE_A + slot));
	}

	/**
	 * One element of a slot's list.
	 * @param node The node index.
	 * @param slot The slot position.
	 * @param index The position within the list.
	 * @returns The element's index, or `null` for an array hole.
	 */
	listItem(node: number, slot: number, index: number): number | null {
		const item = this.reader.listItem(
			this.reader.field(node, NODE_A + slot),
			index,
		);

		return item === 0 ? null : item;
	}

	/**
	 * The children of a node of an unrecognized kind.
	 *
	 * A binary buffer cannot hold one: every kind in it is a kind this
	 * analyzer was built against.
	 * @returns An empty list.
	 */
	unknownChildren(): readonly number[] {
		return NO_CHILDREN;
	}

	/**
	 * The name an identifier spells.
	 *
	 * On an `Identifier` the node's `end` may reach past the name, because a
	 * type annotation extends it, so the name ends where slot A says it does.
	 * A `JSXIdentifier` leaves that slot empty and the whole node is the name.
	 * @param node The node index.
	 * @returns The name, with any unicode escapes resolved.
	 */
	name(node: number): string {
		const nameEnd = this.reader.field(node, NODE_A);
		const raw = this.source.slice(
			this.reader.start(node),
			nameEnd === 0 ? this.reader.end(node) : nameEnd,
		);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * The string a literal denotes.
	 * @param node The `Literal` node index.
	 * @returns The string, with any escapes resolved.
	 */
	literalString(node: number): string {
		const raw = this.source.slice(
			this.reader.start(node) + 1,
			this.reader.end(node) - 1,
		);

		return raw.indexOf("\\") === -1 ? raw : decodeEscapes(raw, false);
	}

	/**
	 * The directive a statement states.
	 * @param node The `ExpressionStatement` node index.
	 * @returns The directive's text, or `null` for an ordinary expression.
	 */
	directive(node: number): string | null {
		if (this.reader.field(node, NODE_B) !== 1) {
			return null;
		}

		return this.reader.text(this.reader.field(node, NODE_A)).slice(1, -1);
	}

	/**
	 * Whether a key or member is computed.
	 * @param node The node index.
	 * @returns `true` when the node carries the computed flag.
	 */
	computed(node: number): boolean {
		return (this.reader.flags(node) & NF_COMPUTED) !== 0;
	}

	/**
	 * Whether an import or export was written `type`.
	 * @param node The node index.
	 * @returns `true` for a type-only import or export.
	 */
	typeOnly(node: number): boolean {
		return (this.reader.flags(node) & NF_TYPE_ONLY) !== 0;
	}

	/**
	 * The keyword a variable declaration was written with.
	 * @param node The `VariableDeclaration` node index.
	 * @returns One of `var`, `let`, `const`, `using`, or `await using`.
	 */
	declarationKind(node: number): string {
		return DECL_KIND_NAMES[
			(this.reader.flags(node) & DECL_MASK) >>> DECL_SHIFT
		];
	}

	/**
	 * Whether a module declaration was written `global`.
	 * @param node The `TSModuleDeclaration` node index.
	 * @returns `true` for `declare global`.
	 */
	isGlobalModule(node: number): boolean {
		return (
			(this.reader.flags(node) & MODULE_KIND_MASK) >>>
				MODULE_KIND_SHIFT ===
			MODULE_GLOBAL
		);
	}

	/**
	 * Whether an assignment uses plain `=`.
	 * @param node The `AssignmentExpression` node index.
	 * @returns `true` for `=`, `false` for a compound assignment.
	 */
	isSimpleAssignment(node: number): boolean {
		return this.reader.field(node, NODE_C) === T_ASSIGN;
	}

	/**
	 * How many decorators a function parameter carries.
	 * @param node The parameter node index.
	 * @returns The decorator count.
	 */
	parameterDecoratorSize(node: number): number {
		return this.listSize(node, this.parameterDecoratorSlot(node));
	}

	/**
	 * Where a parameter's decorators sit.
	 *
	 * A parameter property keeps them beside its modifiers in slot B. Every
	 * other binding form carries its own in slot C, because a decorator on its
	 * own does not make a parameter property.
	 * @param node The parameter node index.
	 * @returns The slot holding the decorator list.
	 */
	private parameterDecoratorSlot(node: number): number {
		return this.reader.kind(node) === N_TSParameterProperty
			? SLOT_B
			: SLOT_C;
	}

	/**
	 * One decorator of a function parameter.
	 * @param node The parameter node index.
	 * @param index The position within the decorator list.
	 * @returns The `Decorator` node index, or `null`.
	 */
	parameterDecoratorAt(node: number, index: number): number | null {
		return this.listItem(node, this.parameterDecoratorSlot(node), index);
	}

	/**
	 * The name a mapped type binds.
	 *
	 * The binary format stores the key and its constraint on a
	 * `TSTypeParameter` in slot A, where the ESTree shape has them directly on
	 * the mapped type.
	 * @param node The `TSMappedType` node index.
	 * @returns The key `Identifier`, or `null`.
	 */
	mappedTypeKey(node: number): number | null {
		const typeParameter = this.reader.field(node, NODE_A);

		if (typeParameter === 0) {
			return null;
		}

		const key = this.reader.field(typeParameter, NODE_A);

		return key === 0 ? null : key;
	}

	/**
	 * The constraint a mapped type's key ranges over.
	 * @param node The `TSMappedType` node index.
	 * @returns The constraint, or `null`.
	 */
	mappedTypeConstraint(node: number): number | null {
		const typeParameter = this.reader.field(node, NODE_A);

		if (typeParameter === 0) {
			return null;
		}

		const constraint = this.reader.field(typeParameter, NODE_B);

		return constraint === 0 ? null : constraint;
	}
}
