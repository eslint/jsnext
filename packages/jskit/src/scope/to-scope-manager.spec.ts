/**
 * @fileoverview Unit tests for `toDecodedScopeManager()`.
 *
 * It is internal — the ESLint parser is its one caller, and its node table
 * comes from a decode no public function exposes — so the tests that reach
 * it through the parser live in `tests/parse/eslint-parser.test.ts`. What is
 * left here is what the parser never provokes: a buffer from the wrong path,
 * and a reader passed in place of the parse result.
 */

import { describe, expect, it } from "vitest";
import { AstReader, parse, toAST } from "../parse/index.js";
import type { EsTreeNode } from "./estree-ast.js";
import { analyze, analyzeTree } from "./index.js";
import { toDecodedScopeManager } from "./to-scope-manager.js";

describe("toDecodedScopeManager()", () => {
	it("refuses a scope buffer analyzeTree() wrote", () => {
		const result = parse("a;");
		const ast = toAST(result) as unknown as EsTreeNode;

		expect(() =>
			toDecodedScopeManager(analyzeTree(ast), result, []),
		).toThrow(/analyzeTree/u);
	});

	it("accepts a reader in place of the parse result", () => {
		const result = parse("let a; a;", { sourceType: "script" });
		const nodes = new Array<EsTreeNode | null>(64).fill(null);
		const manager = toDecodedScopeManager(
			analyze(result, { sourceType: "script" }),
			new AstReader(result),
			nodes,
		);

		expect(manager.scopes).toHaveLength(1);
		expect(manager.reader).toBeNull();
	});
});
