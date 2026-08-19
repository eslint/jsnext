/**
 * @fileoverview The walk over a destructuring pattern.
 *
 * A pattern mixes names being bound with expressions being evaluated:
 * `{ [key]: value = fallback }` binds `value` but reads `key` and `fallback`.
 * This walk calls back at every name and collects the expressions into
 * `rightHandNodes` for the caller to visit as ordinary code.
 */

import {
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
} from "../parse/index.js";
import { SLOT_A, SLOT_B, type AstAccess } from "./ast-access.js";

/**
 * What the walk knows about a name by the time it reaches it.
 *
 * @template TNode How one node is represented.
 */
export interface PatternInfo<TNode> {
	/** Whether the name is the whole pattern rather than a part of one. */
	topLevel: boolean;

	/** Whether the name is the target of a rest element. */
	rest: boolean;

	/**
	 * The `AssignmentPattern` and `AssignmentExpression` nodes enclosing the
	 * name, which are the defaults that write to it.
	 */
	assignments: TNode[];
}

/** Called once per name found in a pattern. */
export type PatternCallback<TNode> = (
	pattern: TNode,
	info: PatternInfo<TNode>,
) => void;

/**
 * Walks a pattern, reporting the names it binds.
 *
 * @template TNode How one node is represented.
 */
export class PatternVisitor<TNode> {
	/** The expressions inside the pattern that are evaluated, not bound. */
	readonly rightHandNodes: TNode[] = [];

	/** How to read the program. */
	private readonly ast: AstAccess<TNode>;

	/** The node the walk started at. */
	private readonly rootPattern: TNode;

	/** What to call at every name. */
	private readonly callback: PatternCallback<TNode>;

	/** The defaults currently enclosing the walk. */
	private readonly assignments: TNode[] = [];

	/** The rest elements currently enclosing the walk. */
	private readonly restElements: TNode[] = [];

	/**
	 * Creates a pattern walk.
	 * @param ast How to read the program.
	 * @param rootPattern The node the walk starts at.
	 * @param callback What to call at every name.
	 */
	constructor(
		ast: AstAccess<TNode>,
		rootPattern: TNode,
		callback: PatternCallback<TNode>,
	) {
		this.ast = ast;
		this.rootPattern = rootPattern;
		this.callback = callback;
	}

	/**
	 * Walks a node of a pattern.
	 * @param node The node, or `null` for an array hole.
	 * @returns Nothing.
	 */
	visit(node: TNode | null): void {
		if (node === null) {
			return;
		}

		const ast = this.ast;
		const kind = ast.kind(node);

		switch (kind) {
			case N_Identifier: {
				const last = this.restElements.length - 1;

				this.callback(node, {
					topLevel: node === this.rootPattern,
					rest:
						last >= 0 &&
						ast.child(this.restElements[last], SLOT_A) === node,
					assignments: this.assignments,
				});

				return;
			}

			case N_Property:
				// A computed key is evaluated; it does not name a binding.
				if (ast.computed(node)) {
					this.pushRightHand(ast.child(node, SLOT_A));
				}

				/*
				 * Shorthand or not, the name being bound is always the
				 * property's value. For `{ a }` the parser points value at the
				 * same identifier as key, and for `{ a = 1 }` at the
				 * `AssignmentPattern` that wraps it.
				 */
				this.visit(ast.child(node, SLOT_B));
				return;

			case N_ArrayPattern:
			case N_ArrayExpression: {
				const size = ast.listSize(node, SLOT_A);

				for (let i = 0; i < size; i++) {
					this.visit(ast.listItem(node, SLOT_A, i));
				}

				return;
			}

			case N_AssignmentPattern:
			case N_AssignmentExpression:
				this.assignments.push(node);
				this.visit(ast.child(node, SLOT_A));
				this.pushRightHand(ast.child(node, SLOT_B));
				this.assignments.pop();
				return;

			case N_RestElement:
				this.restElements.push(node);
				this.visit(ast.child(node, SLOT_A));
				this.restElements.pop();
				return;

			case N_SpreadElement:
				this.visit(ast.child(node, SLOT_A));
				return;

			case N_MemberExpression:
				if (ast.computed(node)) {
					this.pushRightHand(ast.child(node, SLOT_B));
				}

				// The object is only read; the write lands on its property.
				this.pushRightHand(ast.child(node, SLOT_A));
				return;

			case N_CallExpression: {
				const size = ast.listSize(node, SLOT_B);

				for (let i = 0; i < size; i++) {
					this.pushRightHand(ast.listItem(node, SLOT_B, i));
				}

				this.visit(ast.child(node, SLOT_A));
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
	 * Records an expression that the pattern evaluates rather than binds.
	 * @param node The expression, or `null`.
	 * @returns Nothing.
	 */
	private pushRightHand(node: TNode | null): void {
		if (node !== null) {
			this.rightHandNodes.push(node);
		}
	}

	/**
	 * Walks every child of a node that the pattern grammar does not name, such
	 * as the properties of an object pattern.
	 * @param node The node.
	 * @param kind The node kind.
	 * @returns Nothing.
	 */
	private visitChildren(node: TNode, kind: number): void {
		const base = kind * SLOT_COUNT;

		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const descriptor = SLOT_TABLE[base + slot];

			if (descriptor === SLOT_NODE) {
				this.visit(this.ast.child(node, slot));
			} else if (descriptor === SLOT_LIST) {
				const size = this.ast.listSize(node, slot);

				for (let i = 0; i < size; i++) {
					this.visit(this.ast.listItem(node, slot, i));
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
