/**
 * @fileoverview Unit tests for the scope graph enumerations.
 */

import { describe, expect, it } from "vitest";
import {
	READ,
	READ_WRITE,
	REF_TYPE,
	REF_VALUE,
	REF_VALUE_TYPE,
	SCOPE_BLOCK,
	SCOPE_CATCH,
	SCOPE_CLASS,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FOR,
	SCOPE_FUNCTION,
	SCOPE_FUNCTION_EXPRESSION_NAME,
	SCOPE_FUNCTION_TYPE,
	SCOPE_GLOBAL,
	SCOPE_MAPPED_TYPE,
	SCOPE_MODULE,
	SCOPE_SWITCH,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
	SCOPE_WITH,
	WRITE,
	isImplicitlyStrictType,
	isVariableScopeType,
} from "./kinds.js";

describe("isVariableScopeType()", () => {
	it("accepts the scopes a var declaration stops climbing at", () => {
		expect(isVariableScopeType(SCOPE_GLOBAL)).toBe(true);
		expect(isVariableScopeType(SCOPE_MODULE)).toBe(true);
		expect(isVariableScopeType(SCOPE_FUNCTION)).toBe(true);
		expect(isVariableScopeType(SCOPE_CLASS_FIELD_INITIALIZER)).toBe(true);
		expect(isVariableScopeType(SCOPE_CLASS_STATIC_BLOCK)).toBe(true);
		expect(isVariableScopeType(SCOPE_TS_MODULE)).toBe(true);
	});

	it("rejects the scopes a var declaration climbs past", () => {
		expect(isVariableScopeType(SCOPE_BLOCK)).toBe(false);
		expect(isVariableScopeType(SCOPE_SWITCH)).toBe(false);
		expect(isVariableScopeType(SCOPE_CATCH)).toBe(false);
		expect(isVariableScopeType(SCOPE_WITH)).toBe(false);
		expect(isVariableScopeType(SCOPE_FOR)).toBe(false);
		expect(isVariableScopeType(SCOPE_CLASS)).toBe(false);
		expect(isVariableScopeType(SCOPE_FUNCTION_EXPRESSION_NAME)).toBe(false);
	});
});

describe("isImplicitlyStrictType()", () => {
	it("accepts the scopes that are strict by construction", () => {
		expect(isImplicitlyStrictType(SCOPE_CLASS)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_MODULE)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_CONDITIONAL_TYPE)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_FUNCTION_TYPE)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_MAPPED_TYPE)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_TS_ENUM)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_TS_MODULE)).toBe(true);
		expect(isImplicitlyStrictType(SCOPE_TYPE)).toBe(true);
	});

	it("rejects the scopes that inherit strictness instead", () => {
		expect(isImplicitlyStrictType(SCOPE_GLOBAL)).toBe(false);
		expect(isImplicitlyStrictType(SCOPE_FUNCTION)).toBe(false);
		expect(isImplicitlyStrictType(SCOPE_BLOCK)).toBe(false);
	});
});

describe("reference flags", () => {
	it("combines READ and WRITE into READ_WRITE", () => {
		expect(READ_WRITE).toBe(READ | WRITE);
		expect(READ & WRITE).toBe(0);
	});

	it("combines REF_VALUE and REF_TYPE into REF_VALUE_TYPE", () => {
		expect(REF_VALUE_TYPE).toBe(REF_VALUE | REF_TYPE);
		expect(REF_VALUE & REF_TYPE).toBe(0);
	});
});
