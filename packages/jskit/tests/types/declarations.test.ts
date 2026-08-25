/**
 * @fileoverview Declared shapes: functions, classes, interfaces, object
 * literals, imports, and the origins their names carry.
 */

import { describe, expect, it } from "vitest";
import {
	TYPE_NONE,
	TYPE_NUMBER,
	TYPE_STRING,
	TYS_FOREIGN,
	TY_SHAPE,
} from "../../src/index.js";
import { nodeOf, typesOf } from "./helpers.js";

describe("functions", () => {
	it("binds annotated parameters inside the body", () => {
		const code = `function f(name: string) { name; }`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("name;") };

		expect(fixture.queries.getTypeId(use)).toBe(TYPE_STRING);
	});

	it("types calls through the declared return type, hoisting included", () => {
		const code = `const n = f(); n; function f(): number { return 1; }`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("n;") };

		expect(fixture.queries.getTypeId(use)).toBe(TYPE_NUMBER);
	});

	it("types an optional call as possibly undefined", () => {
		const code = `let f: (() => string) | undefined; (f?.());`;
		const fixture = typesOf(code);
		const call = nodeOf(fixture, "CallExpression");

		/*
		 * The callee is a union, so the return type is unclaimed — but the
		 * expression must never be typed as a bare string.
		 */
		expect(fixture.queries.isTypeOf(call, "string")).toBe(false);
	});

	it("renders a function type", () => {
		const code = `let f: (a: string, b: number) => boolean; f;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("f;") };

		expect(fixture.queries.typeToString(use)).toBe(
			"(string, number) => boolean",
		);
		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
	});
});

describe("classes", () => {
	it("types new expressions with the instance type", () => {
		const code = `class Point { x: number = 0; } const p = new Point(); p; (p.x);`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("p;") };
		const member = nodeOf(fixture, "MemberExpression");

		expect(fixture.queries.getTypeName(use)).toBe("Point");
		expect(fixture.queries.isTypeOf(use, "object")).toBe(true);
		expect(fixture.queries.getTypeId(member)).toBe(TYPE_NUMBER);
	});

	it("classifies the class binding itself as a function", () => {
		const code = `class Point {} Point;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("Point;") };

		expect(fixture.queries.isTypeOf(use, "function")).toBe(true);
	});

	it("finds members through getters and heritage", () => {
		const code = [
			`class Base { get label(): string { return ""; } }`,
			`class Derived extends Base { count: number = 0; }`,
			`declare const d: Derived;`,
			`(d.label); (d.count);`,
		].join("\n");
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 1)),
		).toBe(TYPE_NUMBER);
	});

	it("types methods on instances", () => {
		const code = `class Greeter { greet(): string { return "hi"; } } const g = new Greeter(); (g.greet());`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "CallExpression")),
		).toBe(TYPE_STRING);
	});
});

describe("interfaces", () => {
	it("classifies properties through references and extends", () => {
		const code = [
			`interface Named { name: string; }`,
			`interface Aged extends Named { age: number; }`,
			`let a: Aged;`,
			`(a.name); (a.age);`,
		].join("\n");
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("a.name") };

		expect(fixture.queries.getTypeName(use)).toBe("Aged");
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_STRING);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 1)),
		).toBe(TYPE_NUMBER);
		expect(fixture.queries.getPropertyTypeId(use, "name")).toBe(
			TYPE_STRING,
		);
		expect(fixture.queries.getPropertyTypeId(use, "missing")).toBe(
			TYPE_NONE,
		);
	});

	it("answers isTypeOf object for interface-typed values", () => {
		const code = `interface Box { v: number; } let b: Box; b;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("b;") };

		expect(fixture.queries.isTypeOf(use, "object")).toBe(true);
		expect(fixture.queries.isTypeOf(use, "function")).toBe(false);
	});
});

describe("object literals", () => {
	it("classifies object properties", () => {
		const code = `const config = { port: 8080, host: "localhost" }; (config.port); (config.host);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 0)),
		).toBe(TYPE_NUMBER);
		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression", 1)),
		).toBe(TYPE_STRING);
	});

	it("claims nothing about a property behind a spread", () => {
		const code = `declare const extra: object; const c = { a: 1, ...extra }; (c.b);`;
		const fixture = typesOf(code);

		expect(
			fixture.queries.getTypeId(nodeOf(fixture, "MemberExpression")),
		).toBe(TYPE_NONE);
	});
});

describe("imports", () => {
	it("tracks a package origin with the imported name", () => {
		const code = `import { SafePromise as SP } from "@tanstack/query-core"; SP;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("SP;") };

		expect(fixture.queries.getTypeName(use)).toBe("SafePromise");
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "package",
			specifier: "@tanstack/query-core",
		});
	});

	it("tracks a file origin as the path written", () => {
		const code = `import { VoidPromise } from "./utils/promise.ts"; VoidPromise;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("VoidPromise;") };

		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "file",
			specifier: "./utils/promise.ts",
		});
	});

	it("names a default import `default` and marks the type foreign", () => {
		const code = `import fs from "node:fs"; fs;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("fs;") };
		const type = fixture.queries.getTypeId(use);

		expect(fixture.queries.getTypeName(use)).toBe("default");
		expect(fixture.reader.typeField(type, TY_SHAPE) & TYS_FOREIGN).not.toBe(
			0,
		);
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});

	it("types an annotation naming an imported type by its origin", () => {
		const code = `import { Task } from "./task.js"; let t: Task; t;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("t;") };

		expect(fixture.queries.getTypeName(use)).toBe("Task");
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "file",
			specifier: "./task.js",
		});
	});
});

describe("globals", () => {
	it("marks unresolved well-known names as library types", () => {
		const code = `const m = new Map<string, number>(); m;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("m;") };

		expect(fixture.queries.getTypeName(use)).toBe("Map");
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "lib",
			specifier: null,
		});
	});

	it("marks other unresolved names as unattributed globals", () => {
		const code = `let w: SomeGlobalThing; w;`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("w;") };

		expect(fixture.queries.getTypeName(use)).toBe("SomeGlobalThing");
		expect(fixture.queries.getTypeOrigin(use)).toEqual({
			kind: "global",
			specifier: null,
		});
		expect(fixture.queries.isTypeOf(use, "object")).toBe(false);
	});
});

describe("type parameters", () => {
	it("answers through a parameter's constraint", () => {
		const code = `function f<T extends string>(value: T) { value; }`;
		const fixture = typesOf(code);
		const use = { type: "Identifier", start: code.indexOf("value;") };
		const type = fixture.queries.getTypeId(use);

		expect(type).not.toBe(TYPE_NONE);
		expect(fixture.queries.typeToString(use)).toBe("T");
	});
});
