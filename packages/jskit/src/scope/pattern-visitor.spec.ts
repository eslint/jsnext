/**
 * @fileoverview Unit tests for the walk over a destructuring pattern.
 *
 * A pattern mixes names being bound with expressions being evaluated, and
 * this walk's whole job is telling them apart. The interesting cases —
 * a member expression as an assignment target, a spread, a call in a
 * position the grammar allows but nothing sensible writes — are reached by
 * handing it a pattern directly rather than by finding a program that
 * contains one.
 */

import { describe, expect, it } from "vitest";
import {
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
	N_VariableDeclarator,
} from "../parse/index.js";
import { SLOT_A, SLOT_B } from "./ast-access.js";
import { FakeAst, type FakeNode } from "./fake-ast.spec-helpers.js";
import { isPatternKind, PatternVisitor, type PatternInfo } from "./pattern-visitor.js";

/** One name the walk reached, with what it knew at the time. */
interface Found {
	node: number;
	topLevel: boolean;
	rest: boolean;
	assignments: number[];
}

/**
 * Walks a pattern and reports what it found.
 * @param nodes The nodes, where a node's handle is its index.
 * @param root The node to start at.
 * @returns The names found and the expressions collected.
 */
function walk(
	nodes: FakeNode[],
	root = 0,
): { found: Found[]; rightHandNodes: number[] } {
	const found: Found[] = [];
	const visitor = new PatternVisitor(
		new FakeAst(nodes),
		root,
		(node: number, info: PatternInfo<number>) => {
			found.push({
				node,
				topLevel: info.topLevel,
				rest: info.rest,
				assignments: [...info.assignments],
			});
		},
	);

	visitor.visit(root);

	return { found, rightHandNodes: visitor.rightHandNodes };
}

describe("PatternVisitor", () => {
	it("reports a bare identifier as the whole pattern", () => {
		const { found, rightHandNodes } = walk([{ kind: N_Identifier }]);

		expect(found).toEqual([
			{ node: 0, topLevel: true, rest: false, assignments: [] },
		]);
		expect(rightHandNodes).toEqual([]);
	});

	it("does nothing for an array hole", () => {
		const { found } = walk([
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [null, 1] } },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([1]);
	});

	it("walks the elements of an array pattern and an array expression", () => {
		for (const kind of [N_ArrayPattern, N_ArrayExpression]) {
			const { found } = walk([
				{ kind, lists: { [SLOT_A]: [1, 2] } },
				{ kind: N_Identifier },
				{ kind: N_Identifier },
			]);

			expect(found.map(entry => entry.node)).toEqual([1, 2]);
			expect(found.every(entry => !entry.topLevel)).toBe(true);
		}
	});

	it("binds a property's value, not its key", () => {
		const { found, rightHandNodes } = walk([
			{ kind: N_ObjectPattern, lists: { [SLOT_A]: [1] } },
			{ kind: N_Property, children: { [SLOT_A]: 2, [SLOT_B]: 3 } },
			{ kind: N_Identifier },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([3]);
		expect(rightHandNodes).toEqual([]);
	});

	it("evaluates a computed key rather than binding it", () => {
		const { found, rightHandNodes } = walk([
			{ kind: N_ObjectPattern, lists: { [SLOT_A]: [1] } },
			{
				kind: N_Property,
				computed: true,
				children: { [SLOT_A]: 2, [SLOT_B]: 3 },
			},
			{ kind: N_Identifier },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([3]);
		expect(rightHandNodes).toEqual([2]);
	});

	it("records the defaults enclosing a name", () => {
		for (const kind of [N_AssignmentPattern, N_AssignmentExpression]) {
			const { found, rightHandNodes } = walk([
				{ kind, children: { [SLOT_A]: 1, [SLOT_B]: 2 } },
				{ kind: N_Identifier },
				{ kind: N_Identifier },
			]);

			expect(found).toEqual([
				{ node: 1, topLevel: false, rest: false, assignments: [0] },
			]);
			expect(rightHandNodes).toEqual([2]);
		}
	});

	it("marks the target of a rest element", () => {
		const { found } = walk([
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [1, 2] } },
			{ kind: N_Identifier },
			{ kind: N_RestElement, children: { [SLOT_A]: 3 } },
			{ kind: N_Identifier },
		]);

		expect(found).toEqual([
			{ node: 1, topLevel: false, rest: false, assignments: [] },
			{ node: 3, topLevel: false, rest: true, assignments: [] },
		]);
	});

	it("does not mark a name nested below a rest element's own target", () => {
		const { found } = walk([
			{ kind: N_RestElement, children: { [SLOT_A]: 1 } },
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [2] } },
			{ kind: N_Identifier },
		]);

		expect(found[0].rest).toBe(false);
	});

	it("walks through a spread element", () => {
		const { found, rightHandNodes } = walk([
			{ kind: N_ArrayExpression, lists: { [SLOT_A]: [1] } },
			{ kind: N_SpreadElement, children: { [SLOT_A]: 2 } },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([2]);
		expect(rightHandNodes).toEqual([]);
	});

	it("treats a member expression as an evaluated object, not a binding", () => {
		const { found, rightHandNodes } = walk([
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [1] } },
			{ kind: N_MemberExpression, children: { [SLOT_A]: 2, [SLOT_B]: 3 } },
			{ kind: N_Identifier },
			{ kind: N_Identifier },
		]);

		expect(found).toEqual([]);
		expect(rightHandNodes).toEqual([2]);
	});

	it("evaluates a computed member's property as well as its object", () => {
		const { rightHandNodes } = walk([
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [1] } },
			{
				kind: N_MemberExpression,
				computed: true,
				children: { [SLOT_A]: 2, [SLOT_B]: 3 },
			},
			{ kind: N_Identifier },
			{ kind: N_Identifier },
		]);

		// The property first, then the object, in evaluation order.
		expect(rightHandNodes).toEqual([3, 2]);
	});

	it("evaluates a call's arguments and walks into its callee", () => {
		const { found, rightHandNodes } = walk([
			{ kind: N_ArrayPattern, lists: { [SLOT_A]: [1] } },
			{
				kind: N_CallExpression,
				children: { [SLOT_A]: 2 },
				lists: { [SLOT_B]: [3, 4] },
			},
			{ kind: N_Identifier },
			{ kind: N_Identifier },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([2]);
		expect(rightHandNodes).toEqual([3, 4]);
	});

	it("stops at a decorator and at a type annotation", () => {
		for (const kind of [N_Decorator, N_TSTypeAnnotation]) {
			const { found, rightHandNodes } = walk([
				{ kind, children: { [SLOT_A]: 1 } },
				{ kind: N_Identifier },
			]);

			expect(found).toEqual([]);
			expect(rightHandNodes).toEqual([]);
		}
	});

	it("falls back to the slot table for a node the pattern grammar does not name", () => {
		// A `VariableDeclarator` is not a pattern kind, so its slots decide.
		const { found } = walk([
			{ kind: N_VariableDeclarator, children: { [SLOT_A]: 1 } },
			{ kind: N_Identifier },
		]);

		expect(found.map(entry => entry.node)).toEqual([1]);
	});

	it("does nothing when handed no node at all", () => {
		const visitor = new PatternVisitor(
			new FakeAst([{ kind: N_Identifier }]),
			0,
			() => {
				throw new Error("The callback should not have run.");
			},
		);

		visitor.visit(null);

		expect(visitor.rightHandNodes).toEqual([]);
	});
});

describe("isPatternKind()", () => {
	it("accepts every node kind that can appear where a pattern is expected", () => {
		for (const kind of [
			N_Identifier,
			N_ArrayPattern,
			N_AssignmentPattern,
			N_RestElement,
			N_SpreadElement,
			N_ObjectPattern,
		]) {
			expect(isPatternKind(kind)).toBe(true);
		}
	});

	it("rejects the left-hand-side expressions that are not patterns", () => {
		expect(isPatternKind(N_MemberExpression)).toBe(false);
		expect(isPatternKind(N_CallExpression)).toBe(false);
		expect(isPatternKind(N_ArrayExpression)).toBe(false);
	});
});
