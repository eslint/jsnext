/**
 * @fileoverview Unit tests for the scope format's bit layouts.
 *
 * The definition-type bits on a symbol record are indexed by the definition
 * type table, so the two have to agree entry for entry; and the
 * `BINDING_ORIGIN_*` constants are those same bits plus four that must stay
 * clear of them. Nothing above this module would notice a constant that
 * drifted onto the wrong bit until a query answered for the wrong
 * declaration.
 */

import { describe, expect, it } from "vitest";
import {
	DEF_CATCH_CLAUSE,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_IMPORT_BINDING,
	DEF_PARAMETER,
	DEF_TS_ENUM_MEMBER,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TYPE,
	DEF_VARIABLE,
	type DefinitionType,
} from "./kinds.js";
import {
	BINDING_ORIGIN_ARGUMENTS,
	BINDING_ORIGIN_CATCH_CLAUSE,
	BINDING_ORIGIN_CLASS_NAME,
	BINDING_ORIGIN_CONFIGURED_GLOBAL,
	BINDING_ORIGIN_FUNCTION_NAME,
	BINDING_ORIGIN_IMPLICIT_GLOBAL,
	BINDING_ORIGIN_IMPORT_BINDING,
	BINDING_ORIGIN_PARAMETER,
	BINDING_ORIGIN_TS_ENUM_MEMBER,
	BINDING_ORIGIN_TS_ENUM_NAME,
	BINDING_ORIGIN_TS_MODULE_NAME,
	BINDING_ORIGIN_TYPE,
	BINDING_ORIGIN_UNRESOLVED,
	BINDING_ORIGIN_VARIABLE,
	bindingOriginNames,
	codeOfDefinitionType,
	DEFINITION_TYPE_CODES,
	VF_DEFINITION_MASK,
	VF_DEFINITION_SHIFT,
	VF_IMPLICIT_GLOBAL,
	VF_STACK,
	VF_TAINTED,
} from "./scope-buffer.js";

describe("symbol flags", () => {
	it("give every definition type exactly one bit of the mask", () => {
		expect(VF_DEFINITION_MASK).toBe(
			((1 << DEFINITION_TYPE_CODES.length) - 1) << VF_DEFINITION_SHIFT,
		);
	});

	it("keep the definition bits clear of the other flags", () => {
		const others = VF_TAINTED | VF_STACK | VF_IMPLICIT_GLOBAL;

		expect(VF_DEFINITION_MASK & others).toBe(0);

		/*
		 * The builder's working copy of the word uses bits 3 and 4 for its
		 * type and value binding bookkeeping; the mask must leave them be.
		 */
		expect(VF_DEFINITION_MASK & 0b11000).toBe(0);
	});

	it("fit in an unsigned 32-bit word", () => {
		expect(VF_DEFINITION_MASK >>> 0).toBe(VF_DEFINITION_MASK);
		expect(VF_DEFINITION_MASK).toBeLessThan(2 ** 31);
	});
});

describe("binding origins", () => {
	const byType: [DefinitionType, number][] = [
		[DEF_CATCH_CLAUSE, BINDING_ORIGIN_CATCH_CLAUSE],
		[DEF_PARAMETER, BINDING_ORIGIN_PARAMETER],
		[DEF_FUNCTION_NAME, BINDING_ORIGIN_FUNCTION_NAME],
		[DEF_CLASS_NAME, BINDING_ORIGIN_CLASS_NAME],
		[DEF_VARIABLE, BINDING_ORIGIN_VARIABLE],
		[DEF_IMPORT_BINDING, BINDING_ORIGIN_IMPORT_BINDING],
		[DEF_TYPE, BINDING_ORIGIN_TYPE],
		[DEF_TS_ENUM_NAME, BINDING_ORIGIN_TS_ENUM_NAME],
		[DEF_TS_MODULE_NAME, BINDING_ORIGIN_TS_MODULE_NAME],
		[DEF_TS_ENUM_MEMBER, BINDING_ORIGIN_TS_ENUM_MEMBER],
	];

	it.each(byType)("puts %s on its definition type's bit", (type, origin) => {
		expect(origin).toBe(
			1 << (VF_DEFINITION_SHIFT + codeOfDefinitionType(type)),
		);
	});

	it("names every definition type but the implicit global's", () => {
		const named = new Set(byType.map(([type]) => type));
		const unnamed = DEFINITION_TYPE_CODES.filter(type => !named.has(type));

		expect(unnamed).toEqual(["ImplicitGlobalVariable"]);
	});

	it("keep the four origins without a declaration below the mask", () => {
		const four = [
			BINDING_ORIGIN_CONFIGURED_GLOBAL,
			BINDING_ORIGIN_IMPLICIT_GLOBAL,
			BINDING_ORIGIN_UNRESOLVED,
			BINDING_ORIGIN_ARGUMENTS,
		];

		for (const origin of four) {
			expect(origin & VF_DEFINITION_MASK).toBe(0);
		}

		expect(four.reduce((all, origin) => all | origin, 0)).toBe(0b1111);
	});
});

describe("bindingOriginNames()", () => {
	it("names nothing for 0", () => {
		expect(bindingOriginNames(0)).toEqual([]);
	});

	it.each([
		[BINDING_ORIGIN_CONFIGURED_GLOBAL, "ConfiguredGlobal"],
		[BINDING_ORIGIN_IMPLICIT_GLOBAL, "ImplicitGlobal"],
		[BINDING_ORIGIN_UNRESOLVED, "Unresolved"],
		[BINDING_ORIGIN_ARGUMENTS, "Arguments"],
		[BINDING_ORIGIN_VARIABLE, "Variable"],
		[BINDING_ORIGIN_TS_ENUM_MEMBER, "TSEnumMemberName"],
	])("names origin %i %s", (origin, name) => {
		expect(bindingOriginNames(origin)).toEqual([name]);
	});

	it("names every definition type by its own name", () => {
		DEFINITION_TYPE_CODES.forEach((type, code) => {
			expect(
				bindingOriginNames(1 << (VF_DEFINITION_SHIFT + code)),
			).toEqual([type]);
		});
	});

	it("names a mixed mask in bit order", () => {
		expect(
			bindingOriginNames(
				BINDING_ORIGIN_FUNCTION_NAME | BINDING_ORIGIN_VARIABLE,
			),
		).toEqual(["FunctionName", "Variable"]);
		expect(bindingOriginNames(VF_DEFINITION_MASK)).toEqual([
			...DEFINITION_TYPE_CODES,
		]);
	});

	it("ignores bits that mean nothing", () => {
		expect(bindingOriginNames(0b11110000)).toEqual([]);
	});
});
