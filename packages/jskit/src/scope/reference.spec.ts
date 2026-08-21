/**
 * @fileoverview Unit tests for the reference type.
 */

import { describe, expect, it } from "vitest";
import {
	READ,
	READ_WRITE,
	REF_TYPE,
	REF_VALUE,
	REF_VALUE_TYPE,
	WRITE,
} from "./kinds.js";
import { Reference } from "./reference.js";
import type { Scope } from "./scope.js";
import { Variable } from "./variable.js";

/**
 * Creates a stand-in for a scope, which a reference only asks about staticness.
 * @param isStatic What the scope should report.
 * @returns Something a reference accepts as its scope.
 */
function fakeScope(isStatic: boolean): Scope<number> {
	return {
		isStatic: () => isStatic,
	} as unknown as Scope<number>;
}

/**
 * Creates a reference with the defaults a plain read uses.
 * @param flag The read/write mode.
 * @param referenceType Whether the name is a value, a type, or both.
 * @returns The reference.
 */
function reference(flag: number, referenceType = REF_VALUE): Reference<number> {
	return new Reference(
		1,
		"a",
		fakeScope(true),
		flag,
		null,
		null,
		false,
		false,
		referenceType,
	);
}

describe("Reference", () => {
	it("keeps every field it was constructed with", () => {
		const from = fakeScope(true);
		const implicit = { pattern: 1, node: 2 };
		const created = new Reference(
			1,
			"a",
			from,
			WRITE,
			3,
			implicit,
			true,
			true,
			REF_VALUE,
		);

		expect(created.identifier).toBe(1);
		expect(created.name).toBe("a");
		expect(created.from).toBe(from);
		expect(created.writeExpr).toBe(3);
		expect(created.maybeImplicitGlobal).toBe(implicit);
		expect(created.partial).toBe(true);
		expect(created.init).toBe(true);
	});

	it("starts unresolved and untainted", () => {
		const created = reference(READ);

		expect(created.resolved).toBeNull();
		expect(created.tainted).toBe(false);
	});

	describe("read and write modes", () => {
		it("reports a read", () => {
			const created = reference(READ);

			expect(created.isRead()).toBe(true);
			expect(created.isWrite()).toBe(false);
			expect(created.isReadOnly()).toBe(true);
			expect(created.isWriteOnly()).toBe(false);
			expect(created.isReadWrite()).toBe(false);
		});

		it("reports a write", () => {
			const created = reference(WRITE);

			expect(created.isRead()).toBe(false);
			expect(created.isWrite()).toBe(true);
			expect(created.isReadOnly()).toBe(false);
			expect(created.isWriteOnly()).toBe(true);
			expect(created.isReadWrite()).toBe(false);
		});

		it("reports a read-write as both", () => {
			const created = reference(READ_WRITE);

			expect(created.isRead()).toBe(true);
			expect(created.isWrite()).toBe(true);
			expect(created.isReadOnly()).toBe(false);
			expect(created.isWriteOnly()).toBe(false);
			expect(created.isReadWrite()).toBe(true);
		});
	});

	describe("value and type modes", () => {
		it("reports a value reference", () => {
			const created = reference(READ, REF_VALUE);

			expect(created.isValueReference).toBe(true);
			expect(created.isTypeReference).toBe(false);
		});

		it("reports a type reference", () => {
			const created = reference(READ, REF_TYPE);

			expect(created.isValueReference).toBe(false);
			expect(created.isTypeReference).toBe(true);
		});

		it("reports a dual reference as both", () => {
			const created = reference(READ, REF_VALUE_TYPE);

			expect(created.isValueReference).toBe(true);
			expect(created.isTypeReference).toBe(true);
		});
	});

	describe("isStatic()", () => {
		it("is false while the reference is unresolved", () => {
			expect(reference(READ).isStatic()).toBe(false);
		});

		it("is true once it resolves into a static scope", () => {
			const created = reference(READ);

			created.resolved = new Variable("a", fakeScope(true));

			expect(created.isStatic()).toBe(true);
		});

		it("is false when the variable's scope is dynamic", () => {
			const created = reference(READ);

			created.resolved = new Variable("a", fakeScope(false));

			expect(created.isStatic()).toBe(false);
		});

		it("is false once a with statement taints it", () => {
			const created = reference(READ);

			created.resolved = new Variable("a", fakeScope(true));
			created.tainted = true;

			expect(created.isStatic()).toBe(false);
		});
	});
});
