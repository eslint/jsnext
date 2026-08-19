/**
 * @fileoverview Unit tests for the variable type.
 */

import { describe, expect, it } from "vitest";
import {
	classNameDefinition,
	typeDefinition,
	variableDefinition,
} from "./definition.js";
import type { Scope } from "./scope.js";
import { Variable } from "./variable.js";

/*
 * A variable only ever reads its scope back out, so a stand-in is enough to
 * exercise it without building a whole scope graph.
 */
const scope = { type: "module" } as unknown as Scope<number>;

describe("Variable", () => {
	it("keeps the name and the scope it was created with", () => {
		const variable = new Variable("a", scope);

		expect(variable.name).toBe("a");
		expect(variable.scope).toBe(scope);
	});

	it("starts with nothing recorded against it", () => {
		const variable = new Variable("a", scope);

		expect(variable.identifiers).toEqual([]);
		expect(variable.references).toEqual([]);
		expect(variable.defs).toEqual([]);
	});

	it("starts untainted, stack allocated, and unused", () => {
		const variable = new Variable("a", scope);

		expect(variable.tainted).toBe(false);
		expect(variable.stack).toBe(true);
		expect(variable.eslintUsed).toBe(false);
	});

	describe("isTypeVariable", () => {
		it("is true for a variable with no declarations, as a global has none", () => {
			expect(new Variable("window", scope).isTypeVariable).toBe(true);
		});

		it("is false when every declaration binds only a value", () => {
			const variable = new Variable("a", scope);

			variable.defs.push(variableDefinition(1, 2, 3, 0, "const"));

			expect(variable.isTypeVariable).toBe(false);
		});

		it("is true when a declaration binds a type", () => {
			const variable = new Variable("A", scope);

			variable.defs.push(typeDefinition(1, 2));

			expect(variable.isTypeVariable).toBe(true);
		});

		it("is true when only one of several declarations binds a type", () => {
			const variable = new Variable("A", scope);

			variable.defs.push(variableDefinition(1, 2, 3, 0, "const"));
			variable.defs.push(typeDefinition(4, 5));

			expect(variable.isTypeVariable).toBe(true);
		});
	});

	describe("isValueVariable", () => {
		it("is true for a variable with no declarations", () => {
			expect(new Variable("window", scope).isValueVariable).toBe(true);
		});

		it("is false when every declaration binds only a type", () => {
			const variable = new Variable("A", scope);

			variable.defs.push(typeDefinition(1, 2));

			expect(variable.isValueVariable).toBe(false);
		});

		it("is true when a declaration binds a value", () => {
			const variable = new Variable("a", scope);

			variable.defs.push(variableDefinition(1, 2, 3, 0, "let"));

			expect(variable.isValueVariable).toBe(true);
		});
	});

	it("reports a class name as both a type and a value", () => {
		const variable = new Variable("C", scope);

		variable.defs.push(classNameDefinition(1, 2));

		expect(variable.isTypeVariable).toBe(true);
		expect(variable.isValueVariable).toBe(true);
	});

	it("reports a merged interface and value declaration as both", () => {
		const variable = new Variable("A", scope);

		variable.defs.push(typeDefinition(1, 2));
		variable.defs.push(variableDefinition(3, 4, 5, 0, "const"));

		expect(variable.isTypeVariable).toBe(true);
		expect(variable.isValueVariable).toBe(true);
	});
});
