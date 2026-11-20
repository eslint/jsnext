/**
 * @fileoverview Unit tests for `toScopeTree()`'s debugging view.
 *
 * The integration tests check the tree a consumer reads; this file pins the
 * two properties the view promises on top of that: every cross-link between
 * scopes, variables, and references is rendered in place rather than as a
 * bare ID — so each carries a node a viewer can highlight — and the one
 * cycle the graph contains, reference to variable to reference, is cut at
 * the variable's own reference list.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../parse/index.js";
import { analyze } from "./index.js";
import type { AnalyzeOptions } from "./options.js";
import {
	toScopeTree,
	type ScopeTree,
	type ScopeTreeReference,
	type ScopeTreeScope,
} from "./to-scope-tree.js";

/**
 * Parses, analyzes, and renders one program.
 * @param code The source text.
 * @param options The analysis options; `sourceType` also picks the parse.
 * @returns The rendered tree.
 */
function treeFor(code: string, options: AnalyzeOptions = {}): ScopeTree {
	const sourceType = options.sourceType ?? "script";
	const parsed = parse(code, { sourceType });

	return toScopeTree(analyze(parsed, { ...options, sourceType }), parsed);
}

/**
 * Every scope in the tree, depth first.
 * @param scope The scope to start at.
 * @returns The scope and its descendants.
 */
function allScopes(scope: ScopeTreeScope): ScopeTreeScope[] {
	return [scope, ...scope.childScopes.flatMap(allScopes)];
}

/**
 * Every reference rendered anywhere in the tree: in a scope's own list, in
 * its `through` list, and under each of its variables.
 * @param tree The rendered tree.
 * @returns The references, duplicates included.
 */
function allReferences(tree: ScopeTree): ScopeTreeReference[] {
	return allScopes(tree.root!).flatMap(scope => [
		...scope.references,
		...scope.through,
		...scope.variables.flatMap(variable => variable.references),
		...(scope.implicit ?? []).flatMap(variable => variable.references),
	]);
}

describe("toScopeTree()", () => {
	const CODE =
		"var v = 1; function f(p) { { v; p; missing; made; } arguments; } made = 2; Promise;";

	it("renders the same reference identically wherever it appears", () => {
		const tree = treeFor(CODE, { globals: ["Promise"] });
		const byId = new Map<number, ScopeTreeReference>();

		for (const reference of allReferences(tree)) {
			const seen = byId.get(reference.referenceId);

			if (seen === undefined) {
				byId.set(reference.referenceId, reference);
			} else {
				expect(reference).toEqual(seen);
			}
		}

		expect(byId.size).toBeGreaterThan(6);
	});

	it("gives every reference a node and its origins", () => {
		const tree = treeFor(CODE, { globals: ["Promise"] });

		for (const reference of allReferences(tree)) {
			expect(reference.identifier).toMatchObject({
				type: expect.any(String),
				start: expect.any(Number),
				end: expect.any(Number),
			});
			expect(reference.origins.length).toBeGreaterThan(0);
		}
	});

	it("renders the variable a reference resolved to, minus its references", () => {
		const tree = treeFor(CODE, { globals: ["Promise"] });
		const variables = new Map(
			allScopes(tree.root!)
				.flatMap(scope => scope.variables)
				.map(variable => [variable.symbolId, variable]),
		);

		for (const reference of allReferences(tree)) {
			if (reference.resolved !== null) {
				const { references, ...expected } = variables.get(
					reference.resolved.symbolId,
				)!;

				expect(reference.resolved).toEqual(expected);
				expect(reference.resolved).not.toHaveProperty("references");
				expect(
					references.some(
						other => other.referenceId === reference.referenceId,
					),
				).toBe(true);
			}
		}
	});

	it("renders unresolved references with no variable", () => {
		const tree = treeFor(CODE);
		const unresolved = tree.root!.through.filter(
			reference => reference.name === "missing",
		);

		expect(unresolved).toHaveLength(1);
		expect(unresolved[0]).toMatchObject({
			resolved: null,
			origins: ["Unresolved"],
		});
	});

	it("links each scope's variable scope by its block", () => {
		const tree = treeFor(CODE);

		for (const scope of allScopes(tree.root!)) {
			const target = allScopes(tree.root!).find(
				candidate => candidate.scopeId === scope.variableScope.scopeId,
			)!;

			expect(scope.variableScope).toEqual({
				scopeId: target.scopeId,
				type: target.type,
				block: target.block,
			});
		}
	});

	it("records the scope and origins of every variable", () => {
		const tree = treeFor(CODE, { globals: ["Promise"] });

		for (const scope of allScopes(tree.root!)) {
			for (const variable of scope.variables) {
				expect(variable.scopeId).toBe(scope.scopeId);
				expect(variable.origins.length).toBeGreaterThan(0);
			}
		}

		expect(tree.root!.implicit!.map(variable => variable.origins)).toEqual([
			["ImplicitGlobalVariable"],
		]);
	});

	it("stays JSON-serializable", () => {
		const tree = treeFor(CODE, { globals: ["Promise"] });

		expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
	});
});
