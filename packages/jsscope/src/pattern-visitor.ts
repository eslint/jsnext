/**
 * @fileoverview The walk over a destructuring pattern.
 *
 * A pattern mixes names being bound with expressions being evaluated:
 * `{ [key]: value = fallback }` binds `value` but reads `key` and `fallback`.
 * This walk calls back at every name and collects the expressions into
 * `rightHandNodes` for the caller to visit as ordinary code.
 */

import {
	NODE_A,
	NODE_B,
	NF_COMPUTED,
	SLOT_COUNT,
	SLOT_LIST,
	SLOT_NODE,
	SLOT_TABLE,
	N_ArrayExpression,
	N_ArrayPattern,
	N_AssignmentExpression,
	N_AssignmentPattern,
	N_CallExpression,
	N_Decorator,
	N_Identifier,
	N_MemberExpression,
	N_ObjectPattern,
	N_Property,
	N_RestElement,
	N_SpreadElement,
	N_TSTypeAnnotation,
	type AstReader,
} from "jsparse";

/**
 * What the walk knows about a name by the time it reaches it.
 */
export interface PatternInfo {
	/** Whether the name is the whole pattern rather than a part of one. */
	topLevel: boolean;

	/** Whether the name is the target of a rest element. */
	rest: boolean;

	/**
	 * The `AssignmentPattern` and `AssignmentExpression` nodes enclosing the
	 * name, which are the defaults that write to it.
	 */
	assignments: number[];
}

/** Called once per name found in a pattern. */
export type PatternCallback = (pattern: number, info: PatternInfo) => void;

/**
 * Walks a pattern, reporting the names it binds.
 */
export class PatternVisitor {
	/** The expressions inside the pattern that are evaluated, not bound. */
	readonly rightHandNodes: number[] = [];

	/** The reader over the AST buffer. */
	private readonly reader: AstReader;

	/** The node the walk started at. */
	private readonly rootPattern: number;

	/** What to call at every name. */
	private readonly callback: PatternCallback;

	/** The defaults currently enclosing the walk. */
	private readonly assignments: number[] = [];

	/** The rest elements currently enclosing the walk. */
	private readonly restElements: number[] = [];

	/**
	 * Creates a pattern walk.
	 * @param reader The reader over the AST buffer.
	 * @param rootPattern The node the walk starts at.
	 * @param callback What to call at every name.
	 */
	constructor(
		reader: AstReader,
		rootPattern: number,
		callback: PatternCallback,
	) {
		this.reader = reader;
		this.rootPattern = rootPattern;
		this.callback = callback;
	}

	/**
	 * Walks a node of a pattern.
	 * @param node The node index, or `0` for an array hole.
	 * @returns Nothing.
	 */
	visit(node: number): void {
		if (node === 0) {
			return;
		}

		const reader = this.reader;
		const kind = reader.kind(node);

		switch (kind) {
			case N_Identifier: {
				const last = this.restElements.length - 1;

				this.callback(node, {
					topLevel: node === this.rootPattern,
					rest:
						last >= 0 &&
						reader.field(this.restElements[last], NODE_A) === node,
					assignments: this.assignments,
				});

				return;
			}

			case N_Property:
				// A computed key is evaluated; it does not name a binding.
				if ((reader.flags(node) & NF_COMPUTED) !== 0) {
					this.rightHandNodes.push(reader.field(node, NODE_A));
				}

				/*
				 * Shorthand or not, the name being bound is always the
				 * property's value. For `{ a }` the parser points value at the
				 * same identifier as key, and for `{ a = 1 }` at the
				 * `AssignmentPattern` that wraps it.
				 */
				this.visit(reader.field(node, NODE_B));
				return;

			case N_ArrayPattern:
			case N_ArrayExpression: {
				const elements = reader.field(node, NODE_A);
				const size = reader.listSize(elements);

				for (let i = 0; i < size; i++) {
					this.visit(reader.listItem(elements, i));
				}

				return;
			}

			case N_AssignmentPattern:
			case N_AssignmentExpression:
				this.assignments.push(node);
				this.visit(reader.field(node, NODE_A));
				this.rightHandNodes.push(reader.field(node, NODE_B));
				this.assignments.pop();
				return;

			case N_RestElement:
				this.restElements.push(node);
				this.visit(reader.field(node, NODE_A));
				this.restElements.pop();
				return;

			case N_SpreadElement:
				this.visit(reader.field(node, NODE_A));
				return;

			case N_MemberExpression:
				if ((reader.flags(node) & NF_COMPUTED) !== 0) {
					this.rightHandNodes.push(reader.field(node, NODE_B));
				}

				// The object is only read; the write lands on its property.
				this.rightHandNodes.push(reader.field(node, NODE_A));
				return;

			case N_CallExpression: {
				const args = reader.field(node, NODE_B);
				const size = reader.listSize(args);

				for (let i = 0; i < size; i++) {
					this.rightHandNodes.push(reader.listItem(args, i));
				}

				this.visit(reader.field(node, NODE_A));
				return;
			}

			case N_Decorator:
			case N_TSTypeAnnotation:
				// Neither binds anything, and neither is evaluated here.
				return;

			default:
				this.visitChildren(node, kind);
		}
	}

	/**
	 * Walks every child of a node that the pattern grammar does not name, such
	 * as the properties of an object pattern.
	 * @param node The node index.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: number, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.reader.field(node, NODE_A + slot));
			} else if (descriptor === SLOT_LIST) {
				const handle = this.reader.field(node, NODE_A + slot);
				const size = this.reader.listSize(handle);

				for (let i = 0; i < size; i++) {
					this.visit(this.reader.listItem(handle, i));
				}
			}
		}
	}
}

/**
 * Reports whether a node can appear where a pattern is expected.
 *
 * `ForInStatement.left` and `AssignmentExpression.left` are left-hand-side
 * expressions in the grammar, so they can be a member expression rather than a
 * pattern, and the two cases are handled differently.
 * @param kind The node kind.
 * @returns `true` when the node is a binding pattern.
 */
export function isPatternKind(kind: number): boolean {
	return (
		kind === N_Identifier ||
		kind === N_ArrayPattern ||
		kind === N_AssignmentPattern ||
		kind === N_RestElement ||
		kind === N_SpreadElement ||
		kind === N_ObjectPattern
	);
}
