/**
 * @fileoverview Unit tests for the definition factories.
 */

import { describe, expect, it } from "vitest";
import {
	Definition,
	catchClauseDefinition,
	classNameDefinition,
	enumMemberDefinition,
	enumNameDefinition,
	functionNameDefinition,
	implicitGlobalDefinition,
	importBindingDefinition,
	moduleNameDefinition,
	parameterDefinition,
	typeDefinition,
	variableDefinition,
} from "./definition.js";
import {
	DEF_CATCH_CLAUSE,
	DEF_CLASS_NAME,
	DEF_FUNCTION_NAME,
	DEF_IMPLICIT_GLOBAL_VARIABLE,
	DEF_IMPORT_BINDING,
	DEF_PARAMETER,
	DEF_TS_ENUM_MEMBER,
	DEF_TS_ENUM_NAME,
	DEF_TS_MODULE_NAME,
	DEF_TYPE,
	DEF_VARIABLE,
} from "./kinds.js";

/*
 * Nodes are opaque above the accessor layer, so a number stands in for one
 * here exactly as a buffer index would.
 */
const NAME = 1;
const NODE = 2;
const PARENT = 3;

describe("Definition", () => {
	it("keeps every field it was constructed with", () => {
		const definition = new Definition(
			DEF_VARIABLE,
			NAME,
			NODE,
			PARENT,
			4,
			"const",
			true,
			true,
			false,
		);

		expect(definition.type).toBe(DEF_VARIABLE);
		expect(definition.name).toBe(NAME);
		expect(definition.node).toBe(NODE);
		expect(definition.parent).toBe(PARENT);
		expect(definition.index).toBe(4);
		expect(definition.kind).toBe("const");
		expect(definition.rest).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
		expect(definition.isVariableDefinition).toBe(false);
	});
});

describe("variableDefinition()", () => {
	it("records the declarator, the declaration, and the keyword", () => {
		const definition = variableDefinition(NAME, NODE, PARENT, 1, "let");

		expect(definition.type).toBe(DEF_VARIABLE);
		expect(definition.name).toBe(NAME);
		expect(definition.node).toBe(NODE);
		expect(definition.parent).toBe(PARENT);
		expect(definition.index).toBe(1);
		expect(definition.kind).toBe("let");
		expect(definition.rest).toBe(false);
	});

	it("binds a value and not a type", () => {
		const definition = variableDefinition(NAME, NODE, PARENT, 0, "var");

		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(false);
	});
});

describe("parameterDefinition()", () => {
	it("records the function and the position", () => {
		const definition = parameterDefinition(NAME, NODE, 2, false);

		expect(definition.type).toBe(DEF_PARAMETER);
		expect(definition.node).toBe(NODE);
		expect(definition.parent).toBeNull();
		expect(definition.index).toBe(2);
		expect(definition.kind).toBeNull();
		expect(definition.rest).toBe(false);
	});

	it("records a rest parameter as one", () => {
		expect(parameterDefinition(NAME, NODE, 0, true).rest).toBe(true);
	});

	it("binds a value and not a type", () => {
		const definition = parameterDefinition(NAME, NODE, 0, false);

		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(false);
	});
});

describe("functionNameDefinition()", () => {
	it("binds a value and not a type", () => {
		const definition = functionNameDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_FUNCTION_NAME);
		expect(definition.node).toBe(NODE);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(false);
	});
});

describe("classNameDefinition()", () => {
	it("binds both a value and a type", () => {
		const definition = classNameDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_CLASS_NAME);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
	});
});

describe("catchClauseDefinition()", () => {
	it("binds a value and not a type", () => {
		const definition = catchClauseDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_CATCH_CLAUSE);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(false);
	});
});

describe("importBindingDefinition()", () => {
	it("records the specifier as the node and the declaration as the parent", () => {
		const definition = importBindingDefinition(NAME, NODE, PARENT);

		expect(definition.type).toBe(DEF_IMPORT_BINDING);
		expect(definition.node).toBe(NODE);
		expect(definition.parent).toBe(PARENT);
	});

	it("binds both a value and a type", () => {
		const definition = importBindingDefinition(NAME, NODE, PARENT);

		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
	});
});

describe("implicitGlobalDefinition()", () => {
	it("binds a value and not a type", () => {
		const definition = implicitGlobalDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_IMPLICIT_GLOBAL_VARIABLE);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(false);
	});
});

describe("typeDefinition()", () => {
	it("binds a type and not a value", () => {
		const definition = typeDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_TYPE);
		expect(definition.isTypeDefinition).toBe(true);
		expect(definition.isVariableDefinition).toBe(false);
	});
});

describe("enumNameDefinition()", () => {
	it("binds both a value and a type", () => {
		const definition = enumNameDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_TS_ENUM_NAME);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
	});
});

describe("enumMemberDefinition()", () => {
	it("binds both a value and a type", () => {
		const definition = enumMemberDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_TS_ENUM_MEMBER);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
	});
});

describe("moduleNameDefinition()", () => {
	it("binds both a value and a type", () => {
		const definition = moduleNameDefinition(NAME, NODE);

		expect(definition.type).toBe(DEF_TS_MODULE_NAME);
		expect(definition.isVariableDefinition).toBe(true);
		expect(definition.isTypeDefinition).toBe(true);
	});
});

describe("every factory", () => {
	it("leaves the fields its declaration form has no use for null", () => {
		const withoutParent = [
			parameterDefinition(NAME, NODE, 0, false),
			functionNameDefinition(NAME, NODE),
			classNameDefinition(NAME, NODE),
			catchClauseDefinition(NAME, NODE),
			implicitGlobalDefinition(NAME, NODE),
			typeDefinition(NAME, NODE),
			enumNameDefinition(NAME, NODE),
			enumMemberDefinition(NAME, NODE),
			moduleNameDefinition(NAME, NODE),
		];

		for (const definition of withoutParent) {
			expect(definition.parent).toBeNull();
			expect(definition.kind).toBeNull();
		}
	});

	it("produces the same shape every time, whatever the declaration form", () => {
		const shapes = [
			variableDefinition(NAME, NODE, PARENT, 0, "const"),
			parameterDefinition(NAME, NODE, 0, false),
			functionNameDefinition(NAME, NODE),
			classNameDefinition(NAME, NODE),
			catchClauseDefinition(NAME, NODE),
			importBindingDefinition(NAME, NODE, PARENT),
			implicitGlobalDefinition(NAME, NODE),
			typeDefinition(NAME, NODE),
			enumNameDefinition(NAME, NODE),
			enumMemberDefinition(NAME, NODE),
			moduleNameDefinition(NAME, NODE),
		].map(definition => Object.keys(definition).join(","));

		expect(new Set(shapes).size).toBe(1);
	});
});
